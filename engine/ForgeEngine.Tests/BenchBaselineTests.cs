// ForgeEngine.Tests/BenchBaselineTests.cs — ENG-BENCH-baselines: cube, fan impeller, gyroid block through host→sandbox.
// docs/01 §4 P0 gate: "cube, fan and gyroid memory and time recorded in bench/baselines/".
// Always runs and asserts each part builds watertight; writes the measurements to $FORGE_BENCH_OUT when set
// (bench/baselines/engine.json is produced that way), otherwise next to the test binaries.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
using Xunit.Abstractions;

namespace ForgeEngine.Tests;

public class BenchBaselineTests(ITestOutputHelper output)
{
    [Fact(DisplayName = "ENG-BENCH-baselines cube, fan impeller, gyroid block")]
    public async Task ENG_BENCH_baselines()
    {
        var cases = new (string Name, string Code, JsonObject Params, double VoxelMm)[]
        {
            ("cube", Designs.Cube, new JsonObject { ["size"] = 20 }, 0.5),
            ("fan_impeller", Designs.Fan, Designs.FanParams(), 0.5),
            ("gyroid_block", Designs.Gyroid, new JsonObject { ["size"] = 40, ["cell"] = 10, ["wall"] = 1.2 }, 0.4),
        };

        using var eng = new EngineProcess();
        await eng.ResultAsync("engine.hello");
        var results = new JsonObject();
        foreach (var (name, code, p, voxel) in cases)
        {
            var dir = Paths.NewRunDir("bench-" + name);
            var sw = Stopwatch.StartNew();
            var r = await eng.ResultAsync("engine.run", new JsonObject
            {
                ["code"] = code, ["outDir"] = dir, ["params"] = p, ["voxelMm"] = voxel,
                ["exports"] = new JsonArray("stl"), ["limits"] = new JsonObject { ["timeoutS"] = 300 },
            }, timeoutS: 320);
            sw.Stop();
            Assert.True(r["ok"]!.GetValue<bool>(), $"{name}: {r.ToJsonString()}");
            var stats = r["stats"]!;
            Assert.True(stats["watertight"]!.GetValue<bool>(), $"{name} not watertight: {stats.ToJsonString()}");
            Assert.True(new FileInfo(r["files"]!["stl"]!.GetValue<string>()).Length > 1000);
            results[name] = new JsonObject
            {
                ["voxelMm"] = voxel,
                ["wallMs"] = sw.ElapsedMilliseconds,
                ["compileMs"] = r["timings"]!["compileMs"]!.DeepClone(),
                ["sandboxMs"] = r["timings"]!["sandboxMs"]!.DeepClone(),
                ["buildMs"] = r["sandboxTimings"]!["buildMs"]!.DeepClone(),
                ["statsMs"] = r["sandboxTimings"]!["statsMs"]!.DeepClone(),
                ["exportMs"] = r["sandboxTimings"]!["exportMs"]!.DeepClone(),
                ["sandboxPeakRssMiB"] = r["peakRssMiB"]!.DeepClone(),
                ["volumeCm3"] = stats["volumeCm3"]!.DeepClone(),
                ["triangles"] = stats["triangles"]!.DeepClone(),
                ["watertight"] = true,
            };
            output.WriteLine($"{name}: {results[name]!.ToJsonString()}");
        }

        var doc = new JsonObject
        {
            ["schema"] = "picoforge.bench.engine/1",
            ["measuredAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            ["machine"] = new JsonObject
            {
                ["os"] = RuntimeInformation.OSDescription,
                ["cpu"] = Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER") ?? RuntimeInformation.ProcessArchitecture.ToString(),
                ["logicalCores"] = Environment.ProcessorCount,
                ["ramGiB"] = Math.Round(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1073741824.0, 1),
                ["dotnet"] = Environment.Version.ToString(),
                ["picogk"] = (await eng.ResultAsync("engine.hello"))["picogkVersion"]!.DeepClone(),
                ["build"] = Paths.Config,
            },
            ["cases"] = results,
        };
        var outPath = Environment.GetEnvironmentVariable("FORGE_BENCH_OUT")
                      ?? Path.Combine(AppContext.BaseDirectory, "engine-bench.json");
        await File.WriteAllTextAsync(outPath, doc.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
        output.WriteLine($"wrote {outPath}");
    }
}
