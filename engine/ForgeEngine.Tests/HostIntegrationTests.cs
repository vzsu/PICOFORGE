// ForgeEngine.Tests/HostIntegrationTests.cs — real host process → sandbox child → PicoGK (docs/04 §2, §5, §7)
// ENG-GATE-cube, ENG-ISO-01, ENG-PARAMS-02, ENG-INSPECT-01, ENG-CONVERT-01, ENG-ANALYZER-run.

using System.Diagnostics;
using System.Text.Json.Nodes;
using Xunit;
using Xunit.Abstractions;

namespace ForgeEngine.Tests;

public class HostIntegrationTests(ITestOutputHelper output)
{
    private static JsonObject RunParams(string code, string outDir, JsonObject? p = null, double voxelMm = 0.5, string? runId = null) => new()
    {
        ["code"] = code,
        ["runId"] = runId ?? Guid.NewGuid().ToString("N"),
        ["outDir"] = outDir,
        ["params"] = p ?? [],
        ["voxelMm"] = voxelMm,
        ["exports"] = new JsonArray("stl", "vdb"),
        ["limits"] = new JsonObject { ["timeoutS"] = 120 },
    };

    [Fact(DisplayName = "ENG-GATE-cube host→sandbox cube STL < 6 s")]
    public async Task ENG_GATE_cube()
    {
        using var eng = new EngineProcess();
        await eng.ResultAsync("engine.hello");
        var dir = Paths.NewRunDir("cube");

        var sw = Stopwatch.StartNew();
        var r = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, dir, new JsonObject { ["size"] = 20 }));
        sw.Stop();

        Assert.True(r["ok"]!.GetValue<bool>(), r.ToJsonString());
        var stl = r["files"]!["stl"]!.GetValue<string>();
        Assert.True(File.Exists(stl) && new FileInfo(stl).Length > 1000, $"STL missing or empty: {stl}");
        var stats = r["stats"]!;
        Assert.InRange(stats["volumeCm3"]!.GetValue<double>(), 8.0 * 0.98, 8.0 * 1.02);
        Assert.True(stats["watertight"]!.GetValue<bool>());
        output.WriteLine($"cube wall={sw.ElapsedMilliseconds}ms timings={r["timings"]?.ToJsonString()} sandbox={r["sandboxTimings"]?.ToJsonString()} peakRssMiB={r["peakRssMiB"]}");
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(6), $"cube build took {sw.ElapsedMilliseconds} ms (budget 6000)");
    }

    [Fact(DisplayName = "ENG-ISO-01 kill sandbox mid-build: host answers ping, run fails SANDBOX_CRASH")]
    public async Task ENG_ISO_01()
    {
        using var eng = new EngineProcess();
        await eng.ResultAsync("engine.hello");
        var dir = Paths.NewRunDir("iso");
        var runId = "iso-" + Guid.NewGuid().ToString("N");

        var run = eng.CallAsync("engine.run", RunParams(Designs.Slow, dir, runId: runId), timeoutS: 120);

        // Wait until the design is really executing inside the child.
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (!eng.Notifications.Any(n => n["payload"]?["line"]?.ToString() == "iso-started"))
        {
            Assert.True(DateTime.UtcNow < deadline, "build never started");
            if (run.IsCompleted) Assert.Fail($"run finished early: {(await run).ToJsonString()}");
            await Task.Delay(100);
        }

        // Host answers ping while the build runs, and names the active child.
        var ping = await eng.ResultAsync("engine.ping", timeoutS: 5);
        var pids = ping["activePids"]!.AsArray().Select(p => p!.GetValue<int>()).ToArray();
        Assert.Single(pids);
        Assert.NotEqual(eng.Pid, pids[0]);

        // kill -9 the sandbox child.
        using (var child = Process.GetProcessById(pids[0])) child.Kill();

        var reply = await run;
        var result = reply["result"]!;
        Assert.False(result["ok"]!.GetValue<bool>());
        Assert.Equal("SANDBOX_CRASH", result["error"]!["code"]!.GetValue<string>());

        // Host is alive and healthy afterwards.
        Assert.False(eng.HasExited);
        var after = await eng.ResultAsync("engine.ping", timeoutS: 5);
        Assert.True(after["ok"]!.GetValue<bool>());
        Assert.Empty(after["activePids"]!.AsArray());

        // And still builds.
        var again = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, Paths.NewRunDir("iso-after"), new JsonObject { ["size"] = 10 }));
        Assert.True(again["ok"]!.GetValue<bool>(), again.ToJsonString());
    }

    [Fact(DisplayName = "ENG-PARAMS-02 engine.run params reach Ctx.P; missing name → RUNTIME_ERROR listing known names")]
    public async Task ENG_PARAMS_02()
    {
        using var eng = new EngineProcess();
        var ok = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, Paths.NewRunDir("params"), new JsonObject { ["size"] = 10 }));
        Assert.True(ok["ok"]!.GetValue<bool>(), ok.ToJsonString());
        Assert.InRange(ok["stats"]!["volumeCm3"]!.GetValue<double>(), 0.98, 1.02);   // 10 mm cube = 1 cm³
        Assert.InRange(ok["stats"]!["bboxMax"]![0]!.GetValue<double>(), 9.5, 10.5);

        var missing = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, Paths.NewRunDir("params-missing"), new JsonObject { ["width"] = 10, ["depth"] = 5 }));
        Assert.False(missing["ok"]!.GetValue<bool>());
        Assert.Equal("RUNTIME_ERROR", missing["error"]!["code"]!.GetValue<string>());
        var detail = missing["error"]!["detail"]!.GetValue<string>();
        Assert.Contains("'size' not found", detail, StringComparison.Ordinal);
        Assert.Contains("depth, width", detail, StringComparison.Ordinal);

        var bad = await eng.CallAsync("engine.run", RunParams(Designs.Cube, Paths.NewRunDir("params-bad"), new JsonObject { ["size"] = "ten" }));
        Assert.Equal("INVALID_PARAMS", bad["error"]!["code"]!.GetValue<string>());
    }

    [Fact(DisplayName = "ENG-ANALYZER-run engine.run rejects banned code before the sandbox")]
    public async Task ENG_ANALYZER_run()
    {
        using var eng = new EngineProcess();
        var code = Designs.Cube.Replace("float s = ctx.P(\"size\");", "float s = System.IO.File.ReadAllText(\"x\").Length;", StringComparison.Ordinal);
        var r = await eng.ResultAsync("engine.run", RunParams(code, Paths.NewRunDir("banned")));
        Assert.False(r["ok"]!.GetValue<bool>());
        Assert.Equal("COMPILE_ERROR", r["error"]!["code"]!.GetValue<string>());
        Assert.Contains(r["error"]!["diagnostics"]!.AsArray(), d => d!["id"]!.GetValue<string>() == "FORGE001" && d["line"]!.GetValue<int>() == 9);
    }

    [Fact(DisplayName = "ENG-INSPECT-01 engine.inspect returns measurements and per-op results")]
    public async Task ENG_INSPECT_01()
    {
        using var eng = new EngineProcess();
        var dir = Paths.NewRunDir("inspect");
        var build = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, dir, new JsonObject { ["size"] = 20 }));
        Assert.True(build["ok"]!.GetValue<bool>(), build.ToJsonString());

        var ops = new JsonArray(
            new JsonObject { ["type"] = "bbox" },
            new JsonObject { ["type"] = "volume" },
            new JsonObject { ["type"] = "wall_min" },
            new JsonObject { ["type"] = "section", ["plane"] = "z", ["offset_mm"] = 10 },
            new JsonObject { ["type"] = "ray", ["origin"] = new JsonArray(-10, 10, 10), ["dir"] = new JsonArray(1, 0, 0) });
        var r = await eng.ResultAsync("engine.inspect", new JsonObject { ["target"] = dir, ["ops"] = ops }, timeoutS: 120);
        output.WriteLine(r.ToJsonString());

        var m = r["measurements"]!;
        Assert.EndsWith("part.vdb", r["target"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.InRange(m["volumeCm3"]!.GetValue<double>(), 7.84, 8.16);
        Assert.InRange(m["areaCm2"]!.GetValue<double>(), 24 * 0.97, 24 * 1.03);          // 6 × 2 cm × 2 cm
        Assert.Equal(3, m["bboxMin"]!.AsArray().Count);
        Assert.InRange(m["bboxMax"]![2]!.GetValue<double>(), 19.5, 20.5);
        Assert.True(m["triangles"]!.GetValue<int>() > 0);
        Assert.True(m["watertight"]!.GetValue<bool>());
        // 20 mm cube: erosion t/2 leaves (20 − t)³ / 20³ < 0.15 once t > 9.4 mm.
        Assert.InRange(m["minWallMm"]!.GetValue<double>(), 8.4, 10.4);

        var results = r["results"]!.AsArray();
        Assert.Equal(new[] { "bbox", "volume", "wall_min", "section", "ray" }, results.Select(x => x!["type"]!.GetValue<string>()));
        Assert.InRange(results[3]!["areaMm2"]!.GetValue<double>(), 400 * 0.97, 400 * 1.03);
        Assert.True(results[4]!["hit"]!.GetValue<bool>());
        Assert.InRange(results[4]!["distanceMm"]!.GetValue<double>(), 9.5, 10.5);

        var bad = await eng.CallAsync("engine.inspect", new JsonObject { ["target"] = dir, ["ops"] = new JsonArray(new JsonObject { ["type"] = "teleport" }) });
        Assert.Equal("INVALID_PARAMS", bad["error"]!["code"]!.GetValue<string>());
    }

    [Fact(DisplayName = "ENG-CONVERT-01 engine.convert writes STL and reports {path, bytes}")]
    public async Task ENG_CONVERT_01()
    {
        using var eng = new EngineProcess();
        var dir = Paths.NewRunDir("convert");
        var build = await eng.ResultAsync("engine.run", RunParams(Designs.Cube, dir, new JsonObject { ["size"] = 10 }));
        Assert.True(build["ok"]!.GetValue<bool>(), build.ToJsonString());
        var outPath = Path.Combine(dir, "export", "cube.stl");
        var r = await eng.ResultAsync("engine.convert", new JsonObject { ["target"] = dir, ["format"] = "stl", ["outPath"] = outPath }, timeoutS: 120);
        Assert.Equal(outPath, r["path"]!.GetValue<string>());
        Assert.Equal(new FileInfo(outPath).Length, r["bytes"]!.GetValue<long>());
        Assert.True(r["bytes"]!.GetValue<long>() > 1000);

        var unsupported = await eng.CallAsync("engine.convert", new JsonObject { ["target"] = dir, ["format"] = "3mf", ["outPath"] = outPath + ".3mf" });
        Assert.Equal("UNSUPPORTED_FORMAT", unsupported["error"]!["code"]!.GetValue<string>());
    }

    [Fact(DisplayName = "ENG-MEM-01 build over the memory cap is killed and reported OOM with a voxel-size hint")]
    public async Task ENG_MEM_01()
    {
        using var eng = new EngineProcess();
        await eng.ResultAsync("engine.hello");
        // 200 mm cube at 0.2 mm voxels: far more than a 200 MiB cap (an idle sandbox is ~85 MiB).
        var p = new JsonObject
        {
            ["code"] = Designs.Cube,
            ["runId"] = "mem-" + Guid.NewGuid().ToString("N"),
            ["outDir"] = Paths.NewRunDir("mem"),
            ["params"] = new JsonObject { ["size"] = 200 },
            ["voxelMm"] = 0.2,
            ["exports"] = new JsonArray("stl"),
            ["limits"] = new JsonObject { ["timeoutS"] = 120, ["maxRssMiB"] = 200 },
        };
        var r = await eng.ResultAsync("engine.run", p, timeoutS: 150);
        output.WriteLine(r.ToJsonString());
        Assert.False(r["ok"]!.GetValue<bool>(), "an over-cap build must not succeed");
        var error = r["error"]!;
        Assert.Equal("OOM", error["code"]!.GetValue<string>());
        Assert.Contains("voxel", error.ToJsonString(), StringComparison.OrdinalIgnoreCase);

        // Containment: the host answers and has no child left (docs/04 §7 F3).
        var ping = await eng.ResultAsync("engine.ping", timeoutS: 5);
        Assert.True(ping["ok"]!.GetValue<bool>());
        Assert.Empty(ping["activePids"]!.AsArray());
    }

    [Fact(DisplayName = "ENG-MEM-02 the running sandbox sits in a Windows job object with a hard memory cap")]
    public async Task ENG_MEM_02()
    {
        // Windows is the primary platform (docs/11 §7); Linux limits (cgroups/seccomp) are a P9 item.
        Assert.True(OperatingSystem.IsWindows(), "ENG-MEM-02 targets the Windows job object");
        using var eng = new EngineProcess();
        await eng.ResultAsync("engine.hello");
        var p = new JsonObject
        {
            ["code"] = Designs.Slow,
            ["runId"] = "job-" + Guid.NewGuid().ToString("N"),
            ["outDir"] = Paths.NewRunDir("job"),
            ["params"] = new JsonObject(),
            ["voxelMm"] = 0.5,
            ["exports"] = new JsonArray("stl"),
            ["limits"] = new JsonObject { ["timeoutS"] = 120, ["maxRssMiB"] = 1000 },
        };
        var run = eng.CallAsync("engine.run", p, timeoutS: 120);
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (!eng.Notifications.Any(n => n["payload"]?["line"]?.ToString() == "iso-started"))
        {
            Assert.True(DateTime.UtcNow < deadline, "build never started");
            await Task.Delay(100);
        }
        var ping = await eng.ResultAsync("engine.ping", timeoutS: 5);
        var jobs = ping["activeJobs"]!.AsArray();
        Assert.Single(jobs);
        // hard cap = RSS cap + 25 % headroom (the RSS poll stays the primary, friendlier guard)
        Assert.Equal(1250, jobs[0]!["memLimitMiB"]!.GetValue<long>());
        Assert.Equal(1, jobs[0]!["activeProcessLimit"]!.GetValue<int>());
        await eng.CallAsync("engine.cancel", new JsonObject { ["runId"] = p["runId"]!.GetValue<string>() });
        await run;
    }
}
