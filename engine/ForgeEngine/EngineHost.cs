// ForgeEngine/EngineHost.cs — RPC method handlers (docs/04 §5)
// Methods: engine.hello, engine.ping, engine.compile, engine.run (= spec engine.build), engine.inspect,
// engine.convert, engine.cancel. Long methods run off the read loop so engine.ping always answers.

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ForgeEngine;

internal sealed class EngineOptions
{
    public required string SandboxBin { get; init; }
    public required string SymbolTablePath { get; init; }
    public bool Prewarm { get; init; } = true;

    /// <summary>FORGE_SANDBOX_BIN, else packaged layout (sandbox/ next to the host), else the dev build tree.</summary>
    public static EngineOptions Discover()
    {
        var baseDir = AppContext.BaseDirectory;
        var exe = OperatingSystem.IsWindows() ? "forge-sandbox.exe" : "forge-sandbox";
        var sandbox = Environment.GetEnvironmentVariable("FORGE_SANDBOX_BIN");
        // Dev layout: engine/ForgeEngine/bin/<Config>/net9.0/ → engine/ForgeSandbox/bin/<Config>/net9.0/
        var tfmDir = new DirectoryInfo(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var config = tfmDir.Parent?.Name ?? "Debug";
        var engineRoot = tfmDir.Parent?.Parent?.Parent?.Parent?.FullName ?? baseDir;
        if (string.IsNullOrEmpty(sandbox))
        {
            var packaged = Path.Combine(baseDir, "sandbox", exe);
            var dev = Path.Combine(engineRoot, "ForgeSandbox", "bin", config, tfmDir.Name, exe);
            sandbox = File.Exists(packaged) ? packaged : dev;
        }
        var symbols = Path.Combine(baseDir, "picogk_api.json");
        if (!File.Exists(symbols)) symbols = Path.Combine(engineRoot, "picogk_api.json");
        return new EngineOptions
        {
            SandboxBin = sandbox,
            SymbolTablePath = symbols,
            Prewarm = Environment.GetEnvironmentVariable("FORGE_NO_PREWARM") != "1",
        };
    }
}

internal sealed class EngineHost : IDisposable
{
    public const string Version = "1.0.0-p0";
    private static readonly JsonSerializerOptions WriteOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly SymbolTable _symbols;
    private readonly DesignCompiler _compiler;
    private readonly SandboxPool _pool;
    private readonly SemaphoreSlim _sandboxGate = new(1, 1);   // one sandbox job at a time (8 GB T0 machines)
    private readonly ConcurrentDictionary<string, ReadOnlyMemory<byte>> _dllByCodeId = new(StringComparer.Ordinal);
    private readonly string _picogkVersion;

    public EngineHost(EngineOptions opts)
    {
        ArgumentNullException.ThrowIfNull(opts);
        _symbols = SymbolTable.Load(opts.SymbolTablePath);
        _picogkVersion = _symbols.PicoGKVersion;
        _compiler = new DesignCompiler(Path.GetDirectoryName(opts.SandboxBin) ?? ".");
        _pool = new SandboxPool(opts.SandboxBin, opts.Prewarm);
        if (!File.Exists(opts.SandboxBin))
            Console.Error.WriteLine($"[engine] warning: sandbox not found at {opts.SandboxBin}");
        _ = Task.Run(_compiler.WarmUp);
    }

    public string SymbolTableHash => _symbols.Hash;

    /// <summary>Methods that may take seconds; dispatched off the stdin loop.</summary>
    public static bool IsLong(string method) => method is "engine.run" or "engine.build" or "engine.inspect" or "engine.convert" or "engine.compile";

    [System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1031:Do not catch general exception types",
        Justification = "RPC boundary: every failure must become an error frame; the host must never die on a bad request.")]
    public async Task HandleAsync(RpcRequest req)
    {
        ArgumentNullException.ThrowIfNull(req);
        try
        {
            object result = req.Method switch
            {
                "engine.hello" => new
                {
                    version = Version,
                    picogkVersion = _picogkVersion,
                    dotnet = Environment.Version.ToString(),
                    symbolTableHash = _symbols.Hash,
                },
                "engine.ping" => Ping(),
                "engine.compile" => Compile(req.Params),
                // docs/04 §5 names the method engine.build; the Deno client calls engine.run (SPEC-GAP in devlog).
                "engine.run" or "engine.build" => await RunAsync(req.Params).ConfigureAwait(false),
                "engine.inspect" => await InspectAsync(req.Params).ConfigureAwait(false),
                "engine.convert" => await ConvertAsync(req.Params).ConfigureAwait(false),
                "engine.cancel" => Cancel(req.Params),
                _ => throw new RpcException("METHOD_NOT_FOUND", $"Unknown method '{req.Method}'"),
            };
            RpcWriter.WriteResult(req.Id, result);
        }
        catch (RpcException ex)
        {
            RpcWriter.WriteError(req.Id, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            RpcWriter.WriteError(req.Id, "ENGINE_INTERNAL", $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    private object Ping()
    {
        using var self = Process.GetCurrentProcess();
        return new
        {
            ok = true,
            rssMiB = Math.Round(self.WorkingSet64 / 1048576.0, 1),
            children = _pool.ChildCount,
            activePids = _pool.ActivePids,
        };
    }

    private object Compile(JsonObject p)
    {
        var code = Str(p, "code") ?? throw new RpcException("INVALID_PARAMS", "engine.compile requires 'code'");
        var r = _compiler.Compile(code, Str(p, "codeId"));
        if (r.Ok) Remember(r.CodeId, r.Dll);
        return new { ok = r.Ok, codeId = r.CodeId, diagnostics = r.Diagnostics, dllCached = r.DllCached };
    }

    private void Remember(string codeId, ReadOnlyMemory<byte> dll)
    {
        if (_dllByCodeId.Count > 64) _dllByCodeId.Clear();
        _dllByCodeId[codeId] = dll;
    }

    private async Task<object> RunAsync(JsonObject p)
    {
        var total = Stopwatch.StartNew();
        var runId = Str(p, "runId") ?? Guid.NewGuid().ToString("N");
        var outDir = Str(p, "outDir") ?? throw new RpcException("INVALID_PARAMS", "engine.run requires 'outDir'");
        var parameters = ParseParams(p["params"]);
        float? voxelMm = Num(p, "voxelMm") is { } vm ? (float)vm
                       : parameters.TryGetValue("voxel_size_mm", out var vs) ? (float)vs : null;
        var limitsNode = p["limits"] as JsonObject;
        var limits = new RunLimits
        {
            TimeoutS = (int)(Num(limitsNode, "timeoutS") ?? 120),
            MaxRssMiB = (long)(Num(limitsNode, "maxRssMiB") ?? 2560),
        };
        var exports = (p["exports"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(s => s.Length > 0).ToArray()
                      ?? ["stl"];

        // Compile (analyzer runs inside) or reuse a compiled codeId.
        var compileSw = Stopwatch.StartNew();
        ReadOnlyMemory<byte> dll;
        var code = Str(p, "code");
        if (code is not null)
        {
            var cr = _compiler.Compile(code, Str(p, "codeId"));
            if (!cr.Ok)
                return new { ok = false, error = new { code = "COMPILE_ERROR", detail = "Design failed analyzer/compile", diagnostics = cr.Diagnostics } };
            Remember(cr.CodeId, cr.Dll);
            dll = cr.Dll;
        }
        else
        {
            var codeId = Str(p, "codeId") ?? throw new RpcException("INVALID_PARAMS", "engine.run requires 'code' or 'codeId'");
            if (!_dllByCodeId.TryGetValue(codeId, out dll))
                throw new RpcException("UNKNOWN_CODE_ID", $"codeId '{codeId}' was not compiled by this engine instance");
        }
        compileSw.Stop();

        Directory.CreateDirectory(outDir);
        foreach (var stale in new[] { "report.json", "error.json", "part.stl", "part.vdb" })
            File.Delete(Path.Combine(outDir, stale));
        var dllPath = Path.Combine(outDir, "design.dll");
        await File.WriteAllBytesAsync(dllPath, dll.ToArray()).ConfigureAwait(false);
        var jobPath = Path.Combine(outDir, "job.json");
        await File.WriteAllTextAsync(jobPath, JsonSerializer.Serialize(new
        {
            kind = "build", runId, dllPath, @params = parameters, voxelMm, exports, outDir, timeLimitS = limits.TimeoutS,
        }, WriteOpts)).ConfigureAwait(false);

        var sr = await RunSandboxAsync(runId, jobPath, limits).ConfigureAwait(false);
        total.Stop();
        var timings = new { compileMs = compileSw.ElapsedMilliseconds, sandboxMs = sr.WallMs, totalMs = total.ElapsedMilliseconds };

        if (!sr.Ok)
        {
            return new
            {
                ok = false,
                error = new { code = sr.ErrorCode ?? "SANDBOX_CRASH", detail = sr.ErrorDetail },
                log = sr.Log.TakeLast(30).ToArray(),
                timings,
                peakRssMiB = Math.Round(sr.PeakRssMiB, 1),
            };
        }

        var reportPath = Path.Combine(outDir, "report.json");
        var report = JsonNode.Parse(await File.ReadAllTextAsync(reportPath).ConfigureAwait(false))!.AsObject();
        var stats = report["stats"]!.AsObject();
        stats["buildMs"] = report["timings"]?["buildMs"]?.DeepClone();
        string? FileOrNull(string name) => File.Exists(Path.Combine(outDir, name)) ? Path.Combine(outDir, name) : null;
        return new
        {
            ok = true,
            stats,
            files = new Dictionary<string, string?>
            {
                ["stl"] = FileOrNull("part.stl"),
                ["vdb"] = FileOrNull("part.vdb"),
                ["report"] = reportPath,
            },
            log = sr.Log.TakeLast(15).ToArray(),
            timings,
            sandboxTimings = report["timings"]?.DeepClone(),
            // Peak working set: max of the child's own PeakWorkingSet64 and the host's 250 ms poll.
            peakRssMiB = Math.Round(Math.Max(sr.PeakRssMiB, report["peakWorkingSetMiB"]?.GetValue<double>() ?? 0), 1),
        };
    }

    private async Task<SandboxResult> RunSandboxAsync(string runId, string jobPath, RunLimits limits)
    {
        await _sandboxGate.WaitAsync().ConfigureAwait(false);
        try
        {
            return await _pool.RunAsync(runId, jobPath, limits, line =>
            {
                if (line.StartsWith("[progress] ", StringComparison.Ordinal)
                    && double.TryParse(line.AsSpan(11), NumberStyles.Float, CultureInfo.InvariantCulture, out var frac))
                    RpcWriter.WriteNotification("job.progress", new { runId, frac });
                else
                    RpcWriter.WriteNotification("job.log", new { runId, line });
            }, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _sandboxGate.Release();
        }
    }

    /// <summary>engine.inspect {target, ops} → {target, measurements, results} (docs/04 §5).</summary>
    private async Task<object> InspectAsync(JsonObject p)
    {
        var target = ResolveTarget(Str(p, "target"));
        var ops = p["ops"] as JsonArray ?? [];
        foreach (var op in ops)
        {
            var type = (op as JsonObject)?["type"]?.GetValue<string>();
            if (type is not ("bbox" or "volume" or "section" or "wall_min" or "ray"))
                throw new RpcException("INVALID_PARAMS", $"Unknown inspect op '{op?.ToJsonString()}'. Known: bbox, volume, section, wall_min, ray");
        }
        var work = Path.Combine(Path.GetTempPath(), "picoforge-inspect", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var jobPath = Path.Combine(work, "job.json");
            await File.WriteAllTextAsync(jobPath, JsonSerializer.Serialize(new
            {
                kind = "inspect", runId = "inspect-" + Path.GetFileName(work), target, ops, voxelMm = VoxelFor(target, p), outDir = work,
            }, WriteOpts)).ConfigureAwait(false);
            var sr = await RunSandboxAsync("inspect-" + Path.GetFileName(work), jobPath, new RunLimits { TimeoutS = 120 }).ConfigureAwait(false);
            if (!sr.Ok) throw new RpcException(sr.ErrorCode ?? "SANDBOX_CRASH", sr.ErrorDetail ?? "inspect failed");
            return JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(work, "inspect.json")).ConfigureAwait(false))!;
        }
        finally
        {
            TryDelete(work);
        }
    }

    /// <summary>engine.convert {target, format, outPath} → {path, bytes}.</summary>
    private async Task<object> ConvertAsync(JsonObject p)
    {
        var target = ResolveTarget(Str(p, "target"));
        var format = Str(p, "format") ?? throw new RpcException("INVALID_PARAMS", "engine.convert requires 'format'");
        var outPath = Str(p, "outPath") ?? throw new RpcException("INVALID_PARAMS", "engine.convert requires 'outPath'");
        if (format is not ("stl" or "vdb" or "cli"))
            throw new RpcException("UNSUPPORTED_FORMAT", $"Export format '{format}' is not supported yet (supported: stl, vdb, cli)");
        outPath = Path.GetFullPath(outPath);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        var work = Path.Combine(Path.GetTempPath(), "picoforge-convert", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var jobPath = Path.Combine(work, "job.json");
            await File.WriteAllTextAsync(jobPath, JsonSerializer.Serialize(new
            {
                kind = "convert", runId = "convert-" + Path.GetFileName(work), target, format, outPath, voxelMm = VoxelFor(target, p), outDir = work,
            }, WriteOpts)).ConfigureAwait(false);
            var sr = await RunSandboxAsync("convert-" + Path.GetFileName(work), jobPath, new RunLimits { TimeoutS = 120 }).ConfigureAwait(false);
            if (!sr.Ok) throw new RpcException(sr.ErrorCode ?? "SANDBOX_CRASH", sr.ErrorDetail ?? "convert failed");
            return new { path = outPath, bytes = new FileInfo(outPath).Length };
        }
        finally
        {
            TryDelete(work);
        }
    }

    private object Cancel(JsonObject p)
    {
        var id = Str(p, "runId") ?? Str(p, "jobId") ?? throw new RpcException("INVALID_PARAMS", "engine.cancel requires 'runId'");
        return new { ok = true, cancelled = _pool.Cancel(id) };
    }

    /// <summary>A target is a part file (.vdb/.stl) or a run folder containing part.vdb / part.stl.</summary>
    private static string ResolveTarget(string? target)
    {
        if (string.IsNullOrEmpty(target)) throw new RpcException("INVALID_PARAMS", "'target' is required");
        if (Directory.Exists(target))
        {
            foreach (var name in new[] { "part.vdb", "part.stl" })
                if (File.Exists(Path.Combine(target, name))) return Path.GetFullPath(Path.Combine(target, name));
            throw new RpcException("INSPECT_TARGET", $"No part.vdb or part.stl in '{target}'");
        }
        if (!File.Exists(target)) throw new RpcException("INSPECT_TARGET", $"Target not found: '{target}'");
        return Path.GetFullPath(target);
    }

    /// <summary>Voxel size: explicit voxelMm, else the build report next to the target, else 0.5 mm.</summary>
    private static double VoxelFor(string target, JsonObject p)
    {
        if (Num(p, "voxelMm") is { } v) return v;
        var report = Path.Combine(Path.GetDirectoryName(target)!, "report.json");
        if (File.Exists(report))
        {
            var n = JsonNode.Parse(File.ReadAllText(report))?["stats"]?["voxelSizeMm"];
            if (n is not null) return n.GetValue<double>();
        }
        return 0.5;
    }

    /// <summary>params: JSON object name → finite number (docs/05 §4, 08 §3).</summary>
    internal static Dictionary<string, double> ParseParams(JsonNode? node)
    {
        var result = new Dictionary<string, double>(StringComparer.Ordinal);
        if (node is null) return result;
        if (node is not JsonObject obj) throw new RpcException("INVALID_PARAMS", "'params' must be an object of name → number");
        foreach (var (name, value) in obj)
        {
            if (value is not JsonValue jv || jv.GetValueKind() != JsonValueKind.Number || !double.IsFinite(jv.GetValue<double>()))
                throw new RpcException("INVALID_PARAMS", $"param '{name}' must be a finite number, got {value?.ToJsonString() ?? "null"}");
            result[name] = jv.GetValue<double>();
        }
        return result;
    }

    private static string? Str(JsonObject? o, string key)
        => o?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static double? Num(JsonObject? o, string key)
        => o?[key] is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? v.GetValue<double>() : null;

    private static void TryDelete(string dir)
    {
        try { Directory.Delete(dir, recursive: true); }
        catch (IOException) { /* temp folder; best effort */ }
        catch (UnauthorizedAccessException) { /* temp folder; best effort */ }
    }

    public void Dispose()
    {
        _pool.Dispose();
        _sandboxGate.Dispose();
    }
}
