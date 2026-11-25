// ForgeSandbox/Runner.cs — PicoGK headless lifecycle + Design execution + export + inspect
// docs/04 §2 (sandbox child), §5 (engine.build / engine.inspect), §7 (failure codes)
// This is the ONLY file that owns the PicoGK Library lifecycle.

using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using PicoForge.Kit;
using PicoGK;

namespace ForgeSandbox;

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by System.Text.Json.")]
internal sealed class JobSpec
{
    public string Kind { get; init; } = "build";
    public string RunId { get; init; } = "";
    public string DllPath { get; init; } = "";
    public Dictionary<string, double> Params { get; init; } = [];
    public float? VoxelMm { get; init; }
    public IReadOnlyList<string> Exports { get; init; } = ["stl"];
    public string OutDir { get; init; } = "";
    public float TimeLimitS { get; init; } = 120f;
    // inspect
    public string? Target { get; init; }
    public IReadOnlyList<string> Ops { get; init; } = [];
}

/// <summary>Typed failure carrying a failure-table code (docs/04 §7).</summary>
[SuppressMessage("Design", "CA1032:Implement standard exception constructors", Justification = "Internal typed failure; a failure-table code is always required.")]
internal sealed class SandboxFailure(string code, string message, Exception? inner = null) : Exception(message, inner)
{
    public string Code { get; } = code;
}

internal static class Runner
{
    internal const float DefaultVoxelMm = 0.5f;

    private static readonly JsonSerializerOptions ReadOpts = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WriteOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [SuppressMessage("Design", "CA1031:Do not catch general exception types",
        Justification = "Process boundary: every failure must become a typed error line for the host, never an unhandled crash.")]
    public static int Run(string jobPath)
    {
        JobSpec job;
        try
        {
            job = JsonSerializer.Deserialize<JobSpec>(File.ReadAllText(jobPath), ReadOpts)
                  ?? throw new InvalidOperationException("job.json deserialized to null");
        }
        catch (Exception ex)
        {
            WriteError(null, "JOB_PARSE", ex.Message, null);
            return 2;
        }

        Directory.CreateDirectory(job.OutDir);
        // docs/04 §8: the child works inside its run folder.
        Directory.SetCurrentDirectory(job.OutDir);
        var logLines = new List<string>();
        void Log(string msg)
        {
            logLines.Add(msg);
            Console.WriteLine(msg);
            Console.Out.Flush();
        }

        try
        {
            return job.Kind switch
            {
                "build" => Build(job, Log),
                "inspect" => Inspect(job, Log),
                _ => throw new SandboxFailure("JOB_PARSE", $"Unknown job kind '{job.Kind}'"),
            };
        }
        catch (SandboxFailure f)
        {
            WriteError(job.OutDir, f.Code, f.Message, logLines);
            return 1;
        }
        catch (Exception ex)
        {
            WriteError(job.OutDir, "SANDBOX_CRASH", $"{ex.GetType().Name}: {ex.Message}", logLines);
            return 1;
        }
    }

    private static int Build(JobSpec job, Action<string> log)
    {
        float voxelMm = job.VoxelMm ?? DefaultVoxelMm;
        if (!(voxelMm > 0.005f && voxelMm < 50f))
            throw new SandboxFailure("JOB_PARSE", $"voxelMm {voxelMm} out of range (0.005, 50)");

        // Load the generated Design DLL (compiled by the host after the analyzer passed).
        var designAssembly = Assembly.LoadFrom(job.DllPath);
        var designType = designAssembly.GetType("Design")
            ?? throw new SandboxFailure("CONTRACT_VIOLATION", "public static class Design not found in DLL");
        var voxBuild = designType.GetMethod("voxBuild", BindingFlags.Public | BindingFlags.Static, [typeof(Ctx)])
            ?? throw new SandboxFailure("CONTRACT_VIOLATION", "public static Voxels voxBuild(Ctx ctx) not found in Design");

        var swTotal = Stopwatch.StartNew();
        log($"[runner] PicoGK {Library.strVersion()} headless voxel={voxelMm.ToString(CultureInfo.InvariantCulture)}mm");
        using var lib = new Library(voxelMm);
        Library.RegisterGlobalLibrary(lib);
        try
        {
            var ctx = new Ctx(voxelMm, job.Params, log,
                p => log($"[progress] {p.ToString("F3", CultureInfo.InvariantCulture)}"),
                timeLimitS: job.TimeLimitS, runId: job.RunId);

            var swBuild = Stopwatch.StartNew();
            Voxels? result;
            try
            {
                result = (Voxels?)voxBuild.Invoke(null, [ctx]);
            }
            catch (TargetInvocationException tie) when (tie.InnerException is not null)
            {
                var e = tie.InnerException;
                var frames = (e.StackTrace ?? "").Split('\n').Take(5).Select(s => s.Trim());
                throw new SandboxFailure("RUNTIME_ERROR", $"{e.GetType().Name}: {e.Message} | {string.Join(" | ", frames)}", e);
            }
            swBuild.Stop();

            if (result is null || result.bIsEmpty())
                throw new SandboxFailure("EMPTY_GEOMETRY", "voxBuild returned null or an empty Voxels");
            log($"[runner] voxBuild completed in {swBuild.ElapsedMilliseconds}ms");

            var swStats = Stopwatch.StartNew();
            var stats = Stats.Of(ctx, result, bProbeMinWall: true);
            swStats.Stop();

            var swExport = Stopwatch.StartNew();
            var files = new Dictionary<string, string>();
            foreach (var format in job.Exports)
            {
                switch (format)
                {
                    case "stl":
                    {
                        var p = Path.Combine(job.OutDir, "part.stl");
                        using var mesh = result.mshAsMesh();
                        mesh.SaveToStlFile(p);
                        files["stl"] = p;
                        break;
                    }
                    case "vdb":
                    {
                        var p = Path.Combine(job.OutDir, "part.vdb");
                        result.SaveToVdbFile(p);
                        files["vdb"] = p;
                        break;
                    }
                    default:
                        log($"[runner] export '{format}' not supported yet; skipped");
                        break;
                }
            }
            swExport.Stop();
            result.Dispose();

            var report = new
            {
                stats,
                files,
                timings = new
                {
                    buildMs = swBuild.ElapsedMilliseconds,
                    statsMs = swStats.ElapsedMilliseconds,
                    exportMs = swExport.ElapsedMilliseconds,
                    totalMs = swTotal.ElapsedMilliseconds,
                },
                peakWorkingSetMiB = Math.Round(Process.GetCurrentProcess().PeakWorkingSet64 / 1048576.0, 1),
            };
            File.WriteAllText(Path.Combine(job.OutDir, "report.json"), JsonSerializer.Serialize(report, WriteOpts));
            log($"[runner] done vol={stats.VolumeCm3}cm3 tris={stats.Triangles} watertight={stats.Watertight}");
            return 0;
        }
        finally
        {
            Library.UnregisterGlobalLibrary();
        }
    }

    private static readonly HashSet<string> KnownOps = new(StringComparer.Ordinal)
    { "volume", "area", "bbox", "triangles", "watertight", "minWall" };

    /// <summary>engine.inspect: measure an exported part (.vdb exact voxels, or .stl re-voxelised).</summary>
    private static int Inspect(JobSpec job, Action<string> log)
    {
        if (string.IsNullOrEmpty(job.Target) || !File.Exists(job.Target))
            throw new SandboxFailure("INSPECT_TARGET", $"Inspect target not found: {job.Target}");
        var ops = job.Ops.Count == 0 ? KnownOps.ToList() : job.Ops.ToList();
        var unknown = ops.Where(o => !KnownOps.Contains(o)).ToList();
        if (unknown.Count > 0)
            throw new SandboxFailure("INSPECT_TARGET", $"Unknown inspect op(s): {string.Join(", ", unknown)}. Known: {string.Join(", ", KnownOps)}");

        float voxelMm = job.VoxelMm ?? DefaultVoxelMm;
        var sw = Stopwatch.StartNew();
        using var lib = new Library(voxelMm);
        Library.RegisterGlobalLibrary(lib);
        try
        {
            var ext = Path.GetExtension(job.Target);
            Voxels vox;
            if (ext.Equals(".vdb", StringComparison.OrdinalIgnoreCase))
            {
                vox = Voxels.voxFromVdbFile(job.Target);
            }
            else if (ext.Equals(".stl", StringComparison.OrdinalIgnoreCase))
            {
                using var msh = Mesh.mshFromStlFile(job.Target);
                vox = new Voxels(msh);
            }
            else
            {
                throw new SandboxFailure("INSPECT_TARGET", $"Unsupported inspect target type '{ext}' (use .stl or .vdb)");
            }

            using (vox)
            {
                var ctx = new Ctx(voxelMm, new Dictionary<string, double>(), log, _ => { });
                var s = Stats.Of(ctx, vox, bProbeMinWall: ops.Contains("minWall"));
                var measures = new Dictionary<string, object?>();
                foreach (var op in ops)
                {
                    measures[op] = op switch
                    {
                        "volume" => new { volumeCm3 = s.VolumeCm3 },
                        "area" => new { areaCm2 = s.AreaCm2 },
                        "bbox" => new { min = s.BboxMin, max = s.BboxMax },
                        "triangles" => new { triangles = s.Triangles },
                        "watertight" => new { watertight = s.Watertight, openEdges = s.OpenEdges },
                        "minWall" => new { minWallProbeMm = s.MinWallProbeMm },
                        _ => null,
                    };
                }
                var outObj = new { target = job.Target, voxelSizeMm = voxelMm, measures, ms = sw.ElapsedMilliseconds };
                File.WriteAllText(Path.Combine(job.OutDir, "inspect.json"), JsonSerializer.Serialize(outObj, WriteOpts));
                log($"[runner] inspect done in {sw.ElapsedMilliseconds}ms");
            }
            return 0;
        }
        finally
        {
            Library.UnregisterGlobalLibrary();
        }
    }

    [SuppressMessage("Design", "CA1031:Do not catch general exception types",
        Justification = "Best-effort error.json write while already reporting a failure.")]
    private static void WriteError(string? outDir, string code, string message, List<string>? logLines)
    {
        var json = JsonSerializer.Serialize(new { error = code, message, logTail = logLines?.TakeLast(30).ToArray() ?? [] });
        Console.Error.WriteLine(json);
        Console.Error.Flush();
        if (outDir is null) return;
        try { File.WriteAllText(Path.Combine(outDir, "error.json"), json); }
        catch (Exception) { /* stderr line above is authoritative */ }
    }
}
