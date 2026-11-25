// ForgeEngine.Tests/TestSupport.cs — paths and a real host process speaking ndjson RPC over stdio.

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace ForgeEngine.Tests;

internal static class Paths
{
    public static string EngineRoot { get; } = FindEngineRoot();
    public static string Config { get; } = new DirectoryInfo(AppContext.BaseDirectory.TrimEnd('\\', '/')).Parent!.Name;
    public static string HostDll => Path.Combine(EngineRoot, "ForgeEngine", "bin", Config, "net9.0", "forge-engine.dll");
    public static string SandboxDir => Path.Combine(EngineRoot, "ForgeSandbox", "bin", Config, "net9.0");
    public static string RepoRoot => Path.GetDirectoryName(EngineRoot)!;

    public static string NewRunDir(string name)
    {
        var d = Path.Combine(Path.GetTempPath(), "picoforge-tests", $"{name}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(d);
        return d;
    }

    private static string FindEngineRoot()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "PicoForge.sln"))) d = d.Parent;
        return d?.FullName ?? throw new InvalidOperationException("engine/PicoForge.sln not found above test folder");
    }
}

/// <summary>Spawns `dotnet forge-engine.dll` and speaks the same ndjson RPC as server/engine/client.ts.</summary>
internal sealed class EngineProcess : IDisposable
{
    private readonly Process _p;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> _pending = new();
    private int _seq;

    public ConcurrentQueue<JsonObject> Notifications { get; } = new();
    public ConcurrentQueue<string> Stderr { get; } = new();

    public EngineProcess()
    {
        var psi = new ProcessStartInfo("dotnet", $"\"{Paths.HostDll}\"")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        _p = Process.Start(psi)!;
        _p.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(e.Data)) return;
            var msg = JsonNode.Parse(e.Data)!.AsObject();
            var id = msg["id"]?.ToString();
            if (id is not null && _pending.TryRemove(id, out var tcs)) tcs.TrySetResult(msg);
            else if (msg["method"] is not null) Notifications.Enqueue(msg);
        };
        _p.ErrorDataReceived += (_, e) => { if (e.Data is not null) Stderr.Enqueue(e.Data); };
        _p.BeginOutputReadLine();
        _p.BeginErrorReadLine();
    }

    public int Pid => _p.Id;
    public bool HasExited => _p.HasExited;

    /// <summary>Sends a request and returns the whole reply frame ({id, result} or {id, error}).</summary>
    public async Task<JsonObject> CallAsync(string method, JsonObject? @params = null, int timeoutS = 60)
    {
        var id = Interlocked.Increment(ref _seq).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var tcs = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        var frame = new JsonObject { ["id"] = id, ["method"] = method, ["params"] = @params ?? [] };
        lock (_p) { _p.StandardInput.Write(frame.ToJsonString() + "\n"); _p.StandardInput.Flush(); }
        var done = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(timeoutS)));
        if (done != tcs.Task)
            throw new TimeoutException($"{method} timed out after {timeoutS}s. stderr: {string.Join(" | ", Stderr)}");
        return await tcs.Task;
    }

    public async Task<JsonObject> ResultAsync(string method, JsonObject? @params = null, int timeoutS = 60)
    {
        var reply = await CallAsync(method, @params, timeoutS);
        Assert.True(reply["error"] is null, $"{method} returned error {reply["error"]?.ToJsonString()}");
        return reply["result"]!.AsObject();
    }

    public void Dispose()
    {
        try
        {
            _p.StandardInput.Close();
            if (!_p.WaitForExit(5000)) _p.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { /* already exited */ }
        _p.Dispose();
    }
}

internal static class Designs
{
    public const string Cube = """
        using System.Numerics;
        using PicoGK;
        using PicoForge.Kit;

        public static class Design
        {
            public static Voxels voxBuild(Ctx ctx)
            {
                float s = ctx.P("size");
                return Kit.voxBox(ctx, Vector3.Zero, new Vector3(s, s, s));
            }
        }
        """;

    /// <summary>Runs for minutes unless killed; logs a marker once building has started.</summary>
    public const string Slow = """
        using System.Numerics;
        using PicoGK;
        using PicoForge.Kit;

        public static class Design
        {
            public static Voxels voxBuild(Ctx ctx)
            {
                Voxels v = Kit.voxSphere(ctx, Vector3.Zero, 5f);
                ctx.Log("iso-started");
                for (int i = 0; i < 1000000; i++)
                {
                    using Voxels s = Kit.voxSphere(ctx, new Vector3(i % 40, (i / 40) % 40, (i / 1600) % 40), 3f);
                    v.BoolAdd(s);
                }
                return v;
            }
        }
        """;

    /// <summary>PICOGK_KNOWLEDGE §6 axial fan impeller recipe, parameters via ctx.P / ctx.Pi.</summary>
    public const string Fan = """
        using System;
        using System.Numerics;
        using PicoGK;
        using PicoForge.Kit;

        public static class Design
        {
            // beta(r) = atan(c_a / (omega * r)) + 4 deg incidence (free vortex)
            public static Voxels voxBuild(Ctx ctx)
            {
                float fHubR = ctx.P("hub_radius");
                float fTipR = ctx.P("tip_radius");
                int nB = ctx.Pi("blade_count");
                float fCa = ctx.P("axial_velocity");
                float fOmega = ctx.P("omega");
                float fHubH = ctx.P("hub_height");
                float fBore = ctx.P("bore_radius");

                var spec = new BladeSpec(
                    fHubR: fHubR - 0.5f, fTipR: fTipR, nSections: 7,
                    fChordAt: r => 26f - 8f * r,
                    fBetaDegAt: r =>
                    {
                        float fRad = (fHubR + r * (fTipR - fHubR)) / 1000f;
                        return MathF.Atan2(fCa, fOmega * fRad) * 180f / MathF.PI + 4f;
                    },
                    sNacaAt: _ => "4409");
                ctx.Log($"rotor: {nB} blades");
                return Kit.voxAxialRotor(ctx, spec, nB, fHubR: fHubR, fHubZ0: 0, fHubZ1: fHubH, fBoreR: fBore, fFilletR: 1.2f);
            }
        }
        """;

    public static JsonObject FanParams() => new()
    {
        ["hub_radius"] = 18, ["tip_radius"] = 59.5, ["blade_count"] = 7, ["axial_velocity"] = 4.9,
        ["omega"] = 188.5, ["hub_height"] = 24, ["bore_radius"] = 2.5,
    };

    public const string Gyroid = """
        using System.Numerics;
        using PicoGK;
        using PicoForge.Kit;

        public static class Design
        {
            public static Voxels voxBuild(Ctx ctx)
            {
                float s = ctx.P("size");
                IImplicit g = Kit.impGyroid(ctx.P("cell"), ctx.P("wall"));
                return Kit.voxFromImplicit(ctx, g, new BBox3(Vector3.Zero, new Vector3(s, s, s)));
            }
        }
        """;
}
