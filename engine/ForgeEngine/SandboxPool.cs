// ForgeEngine/SandboxPool.cs — Sandbox child lifecycle: prewarm 1 spare, spawn/kill/monitor (RSS poll 250 ms)
// docs/04 §2 (spawn per job, killed on any fault), §7 (F3: crash / OOM / timeout → child killed, typed error),
// §8 (no inherited secrets, cwd = run folder).

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace ForgeEngine;

internal sealed class RunLimits
{
    public int TimeoutS { get; init; } = 120;
    /// <summary>T0 sandbox cap 2.5 GB (docs/11 PERF-T0-03).</summary>
    public long MaxRssMiB { get; init; } = 2560;
}

internal sealed class SandboxResult
{
    public bool Ok { get; init; }
    public string? ErrorCode { get; init; }
    public string? ErrorDetail { get; init; }
    public IReadOnlyList<string> Log { get; init; } = [];
    public int ExitCode { get; init; }
    public double PeakRssMiB { get; init; }
    public long WallMs { get; init; }
}

internal sealed class SandboxPool : IDisposable
{
    private const int MaxLogLines = 5000;
    private readonly string _sandboxBin;
    private readonly bool _prewarm;
    private readonly Lock _lock = new();
    private readonly ConcurrentDictionary<string, Process> _active = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _cancelled = new(StringComparer.Ordinal);
    private Process? _spare;
    private bool _disposed;

    public SandboxPool(string sandboxBin, bool prewarm = true)
    {
        _sandboxBin = sandboxBin;
        _prewarm = prewarm;
        if (_prewarm) _ = Task.Run(PrewarmSpare);
    }

    public string SandboxBin => _sandboxBin;

    /// <summary>Running children (active jobs + spare).</summary>
    public int ChildCount
    {
        get
        {
            lock (_lock) return _active.Count + (_spare is { HasExited: false } ? 1 : 0);
        }
    }

    public IReadOnlyList<int> ActivePids => _active.Values.Select(SafePid).Where(p => p > 0).ToArray();

    /// <summary>Job-object limits of running children, for engine.ping (ENG-MEM-02).</summary>
    public IReadOnlyList<object> ActiveJobs =>
        _jobs.Values.Select(j => (object)new { pid = j.Pid, memLimitMiB = j.MemLimitMiB, activeProcessLimit = j.ProcessLimit })
            .ToArray();

    private readonly ConcurrentDictionary<string, (int Pid, long MemLimitMiB, int ProcessLimit)> _jobs =
        new(StringComparer.Ordinal);

    public async Task<SandboxResult> RunAsync(string runId, string jobPath, RunLimits limits,
        Action<string> onLog, CancellationToken cancel)
    {
        ArgumentNullException.ThrowIfNull(onLog);
        var wall = Stopwatch.StartNew();
        Process child;
        lock (_lock)
        {
            if (_spare is { HasExited: false }) { child = _spare; _spare = null; }
            else { _spare?.Dispose(); _spare = null; child = SpawnChild(); }
        }
        if (_prewarm) _ = Task.Run(PrewarmSpare, CancellationToken.None);
        _active[runId] = child;
        // Hard OS limit for this job (docs/04 §8). The spare was spawned before the limits were known,
        // so the job is attached here, before the child reads its job file.
        using var job = SandboxJob.Create(limits.MaxRssMiB);
        job?.Assign(child);
        if (job is not null) _jobs[runId] = (SafePid(child), job.MemLimitMiB, SandboxJob.ActiveProcessLimit);

        var log = new List<string>();
        var stderr = new StringBuilder();
        child.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (log)
            {
                if (log.Count < MaxLogLines) { log.Add(e.Data); onLog(e.Data); }
                else if (log.Count == MaxLogLines) { log.Add("[log truncated at 5000 lines]"); onLog(log[^1]); }
            }
        };
        child.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (stderr) stderr.AppendLine(e.Data); };

        double peakMiB = 0;
        string? guard = null;
        try
        {
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            await child.StandardInput.WriteLineAsync(jobPath.AsMemory(), cancel).ConfigureAwait(false);
            await child.StandardInput.FlushAsync(cancel).ConfigureAwait(false);
            child.StandardInput.Close();

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            timeout.CancelAfter(TimeSpan.FromSeconds(limits.TimeoutS));
            var exited = child.WaitForExitAsync(CancellationToken.None);
            while (!exited.IsCompleted)
            {
                try
                {
                    child.Refresh();
                    var rss = child.WorkingSet64 / 1048576.0;
                    peakMiB = Math.Max(peakMiB, rss);
                    if (rss > limits.MaxRssMiB)
                    {
                        guard = "OOM";
                        onLog($"[OOM guard] RSS {rss:F0} MiB exceeds limit {limits.MaxRssMiB} MiB, killing");
                        Kill(child);
                        break;
                    }
                }
                catch (InvalidOperationException) { break; /* exited between checks */ }
                if (timeout.IsCancellationRequested)
                {
                    guard = cancel.IsCancellationRequested ? "CANCELLED" : "TIMEOUT";
                    Kill(child);
                    break;
                }
                await Task.WhenAny(exited, Task.Delay(250, CancellationToken.None)).ConfigureAwait(false);
            }
            await exited.ConfigureAwait(false);   // WaitForExitAsync also drains redirected stdout/stderr
            wall.Stop();

            if (_cancelled.TryRemove(runId, out _)) guard = "CANCELLED";
            // The job cap fired between polls: allocation failed or the child died at the limit.
            if (guard is null && child.ExitCode != 0 && job is not null && job.PeakProcessMemoryMiB >= job.MemLimitMiB * 0.97)
            {
                guard = "OOM";
                peakMiB = Math.Max(peakMiB, job.PeakProcessMemoryMiB);
            }
            IReadOnlyList<string> logCopy;
            lock (log) logCopy = log.ToArray();
            string err;
            lock (stderr) err = stderr.ToString();

            if (guard is not null)
            {
                return Fail(guard, guard switch
                {
                    "OOM" => $"Sandbox RSS exceeded {limits.MaxRssMiB} MiB. Retry at a coarser voxel size.",
                    "TIMEOUT" => $"Exceeded {limits.TimeoutS}s wall-clock limit. Retry at a coarser voxel size.",
                    _ => "Run cancelled",
                }, logCopy, child, peakMiB, wall.ElapsedMilliseconds);
            }
            if (child.ExitCode != 0)
            {
                // The child reports typed failures as a JSON line on stderr; anything else is a crash (F3).
                var (code, msg) = ParseChildError(err);
                return Fail(code ?? "SANDBOX_CRASH",
                    msg ?? $"Sandbox exited with code {child.ExitCode} without a typed error (native crash or killed)",
                    logCopy, child, peakMiB, wall.ElapsedMilliseconds);
            }
            return new SandboxResult { Ok = true, Log = logCopy, ExitCode = 0, PeakRssMiB = peakMiB, WallMs = wall.ElapsedMilliseconds };
        }
        finally
        {
            _active.TryRemove(runId, out _);
            _jobs.TryRemove(runId, out _);
            Kill(child);
            child.Dispose();
        }
    }

    public bool Cancel(string runId)
    {
        if (!_active.TryGetValue(runId, out var p)) return false;
        _cancelled[runId] = true;
        Kill(p);
        return true;
    }

    private static SandboxResult Fail(string code, string detail, IReadOnlyList<string> log, Process child, double peak, long ms)
        => new()
        {
            Ok = false, ErrorCode = code, ErrorDetail = detail, Log = log,
            ExitCode = child.HasExited ? child.ExitCode : -1, PeakRssMiB = peak, WallMs = ms,
        };

    internal static (string? Code, string? Message) ParseChildError(string stderr)
    {
        foreach (var line in stderr.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Reverse())
        {
            if (!line.StartsWith('{')) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String)
                    return (e.GetString(), doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null);
            }
            catch (JsonException) { /* not a typed error line */ }
        }
        return (null, null);
    }

    private Process SpawnChild()
    {
        var psi = new ProcessStartInfo(_sandboxBin)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetTempPath(),   // child switches to its run folder once it reads the job
        };
        // docs/04 §8: no inherited secrets. Start from an empty environment and pass only what the runtime needs.
        var keep = new[] { "SystemRoot", "windir", "SystemDrive", "TEMP", "TMP", "PATH", "PATHEXT", "ComSpec",
                           "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "DOTNET_ROOT", "LOCALAPPDATA", "USERPROFILE",
                           "HOME", "LANG" };
        var src = psi.Environment.ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase);
        psi.Environment.Clear();
        foreach (var k in keep)
            if (src.TryGetValue(k, out var v) && v is not null) psi.Environment[k] = v;
        psi.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
        return Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start sandbox: {_sandboxBin}");
    }

    private void PrewarmSpare()
    {
        if (_disposed) return;
        Process spare;
        try { spare = SpawnChild(); }
        catch (System.ComponentModel.Win32Exception ex)
        {
            Console.Error.WriteLine($"[engine] sandbox prewarm failed: {ex.Message}");
            return;
        }
        lock (_lock)
        {
            if (_disposed || _spare is { HasExited: false }) { Kill(spare); spare.Dispose(); return; }
            _spare?.Dispose();
            _spare = spare;
        }
    }

    private static int SafePid(Process p)
    {
        try { return p.HasExited ? -1 : p.Id; }
        catch (InvalidOperationException) { return -1; }
    }

    private static void Kill(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { /* already gone */ }
        catch (System.ComponentModel.Win32Exception) { /* exiting */ }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _disposed = true;
            if (_spare is not null) { Kill(_spare); _spare.Dispose(); _spare = null; }
        }
        foreach (var p in _active.Values) Kill(p);
    }
}
