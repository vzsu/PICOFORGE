// ForgeSandbox/Runner.cs — PicoGK headless lifecycle + Design execution + export + inspect
// docs/04 §2 (sandbox child), §5 (engine.build / engine.inspect), §7 (failure codes)
// This is the ONLY file that owns the PicoGK Library lifecycle.

using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Numerics;
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
    // inspect / convert
    public string? Target { get; init; }
    public IReadOnlyList<JsonElement> Ops { get; init; } = [];
    public string? Format { get; init; }
    public string? OutPath { get; init; }
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
                "convert" => Convert(job, Log),
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

    /// <summary>Loads an exported part: .vdb (exact voxels) or .stl (re-voxelised at the job voxel size).</summary>
    private static Voxels LoadTarget(string? target)
    {
        if (string.IsNullOrEmpty(target) || !File.Exists(target))
            throw new SandboxFailure("INSPECT_TARGET", $"Target not found: {target}");
        var ext = Path.GetExtension(target);
        if (ext.Equals(".vdb", StringComparison.OrdinalIgnoreCase)) return Voxels.voxFromVdbFile(target);
        if (ext.Equals(".stl", StringComparison.OrdinalIgnoreCase))
        {
            using var msh = Mesh.mshFromStlFile(target);
            return new Voxels(msh);
        }
        throw new SandboxFailure("INSPECT_TARGET", $"Unsupported target type '{ext}' (use .stl or .vdb)");
    }

    /// <summary>
    /// engine.inspect {target, ops} → inspect.json {target, measurements, results} (docs/04 §5, server/engine/client.ts).
    /// measurements always carry volume/area/bbox/triangles/watertight; minWallMm only when a wall_min op asks for it.
    /// </summary>
    private static int Inspect(JobSpec job, Action<string> log)
    {
        float voxelMm = job.VoxelMm ?? DefaultVoxelMm;
        var sw = Stopwatch.StartNew();
        using var lib = new Library(voxelMm);
        Library.RegisterGlobalLibrary(lib);
        try
        {
            using var vox = LoadTarget(job.Target);
            var ctx = new Ctx(voxelMm, new Dictionary<string, double>(), log, _ => { });
            bool wantWall = job.Ops.Any(o => OpType(o) == "wall_min");
            var s = Stats.Of(ctx, vox, bProbeMinWall: wantWall);
            using var mesh = vox.mshAsMesh();

            var results = new List<object>();
            foreach (var op in job.Ops)
            {
                var type = OpType(op);
                results.Add(type switch
                {
                    "bbox" => new { type, min = s.BboxMin, max = s.BboxMax },
                    "volume" => new { type, volumeCm3 = s.VolumeCm3 },
                    "wall_min" => new { type, minWallMm = s.MinWallProbeMm },
                    "section" => Section(mesh, op),
                    "ray" => Ray(vox, op),
                    _ => throw new SandboxFailure("INSPECT_TARGET", $"Unknown inspect op '{type}'"),
                });
            }

            var outObj = new
            {
                target = job.Target,
                measurements = new
                {
                    volumeCm3 = s.VolumeCm3,
                    areaCm2 = s.AreaCm2,
                    bboxMin = s.BboxMin,
                    bboxMax = s.BboxMax,
                    triangles = s.Triangles,
                    watertight = s.Watertight,
                    minWallMm = s.MinWallProbeMm,
                    openEdges = s.OpenEdges,
                    nonManifoldEdges = s.NonManifoldEdges,
                    voxelSizeMm = voxelMm,
                },
                results,
                ms = sw.ElapsedMilliseconds,
            };
            File.WriteAllText(Path.Combine(job.OutDir, "inspect.json"), JsonSerializer.Serialize(outObj, WriteOpts));
            log($"[runner] inspect done in {sw.ElapsedMilliseconds}ms");
            return 0;
        }
        finally
        {
            Library.UnregisterGlobalLibrary();
        }
    }

    private static string OpType(JsonElement op)
        => op.ValueKind == JsonValueKind.Object && op.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";

    /// <summary>Cross-section area on an axis plane: Green's theorem over the mesh/plane intersection segments.</summary>
    private static object Section(Mesh mesh, JsonElement op)
    {
        var plane = op.TryGetProperty("plane", out var pl) ? pl.GetString() ?? "z" : "z";
        float off = op.TryGetProperty("offset_mm", out var o) ? o.GetSingle() : 0f;
        int ax = plane switch
        {
            "x" => 0,
            "y" => 1,
            "z" => 2,
            _ => throw new SandboxFailure("INSPECT_TARGET", $"section plane must be x, y or z, got '{plane}'"),
        };
        static float C(Vector3 v, int i) => i == 0 ? v.X : i == 1 ? v.Y : v.Z;
        int u = (ax + 1) % 3, w = (ax + 2) % 3;
        double area2 = 0;
        int segments = 0;
        var pts = new List<Vector3>(2);
        for (int i = 0; i < mesh.nTriangleCount(); i++)
        {
            mesh.GetTriangle(i, out Vector3 a, out Vector3 b, out Vector3 c);
            pts.Clear();
            foreach (var (p, q) in new[] { (a, b), (b, c), (c, a) })
            {
                float dp = C(p, ax) - off, dq = C(q, ax) - off;
                if ((dp < 0) != (dq < 0)) pts.Add(p + (q - p) * (dp / (dp - dq)));
            }
            if (pts.Count != 2) continue;
            // Orient the segment so the triangle normal's in-plane part points to its right (outward contour CCW).
            var n = Vector3.Cross(b - a, c - a);
            var s0 = pts[0]; var s1 = pts[1];
            var d = s1 - s0;
            // in-plane cross (d × n) along the plane axis decides orientation
            double cross = C(d, u) * C(n, w) - C(d, w) * C(n, u);
            if (cross > 0) (s0, s1) = (s1, s0);
            area2 += C(s0, u) * C(s1, w) - C(s1, u) * C(s0, w);
            segments++;
        }
        return new { type = "section", plane, offset_mm = off, areaMm2 = Math.Round(Math.Abs(area2) / 2.0, 3), segments };
    }

    private static object Ray(Voxels vox, JsonElement op)
    {
        static Vector3 V(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out var a) || a.ValueKind != JsonValueKind.Array || a.GetArrayLength() != 3)
                throw new SandboxFailure("INSPECT_TARGET", $"ray op needs '{name}' as [x,y,z]");
            return new Vector3(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());
        }
        var origin = V(op, "origin");
        var dir = Vector3.Normalize(V(op, "dir"));
        bool hit = vox.bRayCastToSurface(origin, dir, out Vector3 p);
        return new
        {
            type = "ray",
            hit,
            point = hit ? new[] { p.X, p.Y, p.Z } : null,
            distanceMm = hit ? Math.Round(Vector3.Distance(origin, p), 4) : (double?)null,
        };
    }

    /// <summary>engine.convert {target, format, outPath}: stl | vdb | cli.</summary>
    private static int Convert(JobSpec job, Action<string> log)
    {
        if (string.IsNullOrEmpty(job.OutPath)) throw new SandboxFailure("INVALID_PARAMS", "convert needs outPath");
        float voxelMm = job.VoxelMm ?? DefaultVoxelMm;
        using var lib = new Library(voxelMm);
        Library.RegisterGlobalLibrary(lib);
        try
        {
            using var vox = LoadTarget(job.Target);
            switch (job.Format)
            {
                case "stl":
                {
                    using var m = vox.mshAsMesh();
                    m.SaveToStlFile(job.OutPath);
                    break;
                }
                case "vdb":
                    vox.SaveToVdbFile(job.OutPath);
                    break;
                case "cli":
                    vox.SaveToCliFile(job.OutPath);
                    break;
                default:
                    throw new SandboxFailure("UNSUPPORTED_FORMAT", $"format '{job.Format}' not supported (stl, vdb, cli)");
            }
            log($"[runner] converted {job.Target} -> {job.OutPath}");
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
