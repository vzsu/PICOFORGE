// Kit.Tests/MinWallTests.cs — min-wall probe accuracy and cost (ENG-MINWALL-*)
// Definition (PICOGK_KNOWLEDGE §4): t such that volume(erode(v, t/2)) / volume(v) first drops below 0.15.
// Stats.MinWallProbe computes it from one Euclidean distance transform of the voxel field instead of a
// binary search over meshed erosions. These tests pin it to (a) the analytic value of the definition on
// shapes where erosion has a closed form and (b) the erosion reference, each within one voxel.

using System.Diagnostics;
using System.Numerics;
using PicoForge.Kit;
using PicoGK;
using Xunit;
using KitApi = PicoForge.Kit.Kit;

namespace Kit.Tests;

public class MinWallTests
{
    /// <summary>Smallest t with frac(t/2) &lt; 0.15, frac(r) = eroded / base volume, by bisection on r.</summary>
    private static double AnalyticProbe(Func<double, double> fracAtR, double rMax)
    {
        double lo = 0, hi = rMax;
        for (int i = 0; i < 60; i++)
        {
            double mid = (lo + hi) / 2;
            if (fracAtR(mid) < 0.15) hi = mid;
            else lo = mid;
        }
        return 2 * hi;
    }

    // ── Plate 40 × 40 × 2 mm ────────────────────────────────────────────────
    [Fact(DisplayName = "ENG-MINWALL-01 plate 2 mm: probe within one voxel of the definition and of 2 mm")]
    public void ENG_MINWALL_01_plate()
    {
        const float W = 40f, T = 2f, Vox = 0.25f;
        var (probe, reference, insideMm3, meshMm3) = Headless.Run(Vox, ctx =>
        {
            using var v = KitApi.voxBox(ctx, Vector3.Zero, new Vector3(W, W, T));
            v.CalculateProperties(out _, out BBox3 bb);
            double mesh = Stats.VolumeMm3(v);
            return (Stats.MinWallProbe(v, Vox), Stats.MinWallProbeByErosion(v, (float)mesh, bb, Vox),
                Stats.InsideVolumeMm3(v), mesh);
        });
        // eroded plate: (W − 2r)² (T − 2r)
        double analytic = AnalyticProbe(r => (W - 2 * r) * (W - 2 * r) * (T - 2 * r) / (W * W * T), T / 2);
        Assert.InRange(insideMm3, meshMm3 * 0.97, meshMm3 * 1.03); // the distance field sees the same solid
        Assert.True(Math.Abs(probe - analytic) <= Vox, $"probe {probe:F3} vs definition {analytic:F3} (voxel {Vox})");
        Assert.True(Math.Abs(probe - reference) <= Vox, $"probe {probe:F3} vs erosion reference {reference:F3}");
        Assert.True(probe <= T + Vox, $"probe {probe:F3} exceeds the 2 mm wall by more than one voxel");
    }

    // ── Tube Ro 10, wall 2, H 30 ───────────────────────────────────────────
    [Fact(DisplayName = "ENG-MINWALL-02 tube wall 2 mm: probe within one voxel of the definition and the erosion reference")]
    public void ENG_MINWALL_02_tube()
    {
        const float Ro = 10f, Wall = 2f, H = 30f, Vox = 0.25f;
        const float Ri = Ro - Wall;
        var (probe, reference) = Headless.Run(Vox, ctx =>
        {
            using var v = KitApi.voxTube(ctx, Vector3.Zero, new Vector3(0, 0, H), Ro, Wall);
            v.CalculateProperties(out _, out BBox3 bb);
            return (Stats.MinWallProbe(v, Vox), Stats.MinWallProbeByErosion(v, (float)Stats.VolumeMm3(v), bb, Vox));
        });
        // eroded tube: π((Ro − r)² − (Ri + r)²)(H − 2r)
        double analytic = AnalyticProbe(
            r => ((Ro - r) * (Ro - r) - (Ri + r) * (Ri + r)) * (H - 2 * r) / ((Ro * Ro - Ri * Ri) * H), Wall / 2);
        Assert.True(Math.Abs(probe - analytic) <= Vox, $"probe {probe:F3} vs definition {analytic:F3} (voxel {Vox})");
        Assert.True(Math.Abs(probe - reference) <= Vox, $"probe {probe:F3} vs erosion reference {reference:F3}");
    }

    // ── Hollow box with an enclosed cavity (PicoGK CalculateProperties counts it as solid) ──
    [Fact(DisplayName = "ENG-MINWALL-03 shelled box with enclosed cavity: cavity is not counted as solid")]
    public void ENG_MINWALL_03_enclosed_cavity()
    {
        const float Vox = 0.3f;
        var (probe, reference) = Headless.Run(Vox, ctx =>
        {
            using var v = KitApi.voxBox(ctx, Vector3.Zero, new Vector3(30, 20, 15));
            KitApi.Shell(v, 2f);
            v.CalculateProperties(out _, out BBox3 bb);
            return (Stats.MinWallProbe(v, Vox), Stats.MinWallProbeByErosion(v, (float)Stats.VolumeMm3(v), bb, Vox));
        });
        Assert.True(Math.Abs(probe - reference) <= Vox, $"probe {probe:F3} vs erosion reference {reference:F3}");
        Assert.InRange(probe, 1.2, 2.0 + Vox); // 2 mm shell; a cavity counted as solid would give ~9 mm
    }

    // ── Cost ───────────────────────────────────────────────────────────────
    [Fact(DisplayName = "ENG-MINWALL-perf probe on a 1.2 M-voxel gyroid is < 1 s and ≥ 5× faster than erosion")]
    public void ENG_MINWALL_perf()
    {
        const float Vox = 0.4f;
        var (probeMs, refMs, probe, reference) = Headless.Run(Vox, ctx =>
        {
            using var v = KitApi.voxFromImplicit(ctx, KitApi.impGyroid(10f, 1.2f),
                new BBox3(Vector3.Zero, new Vector3(40, 40, 40)));
            v.CalculateProperties(out _, out BBox3 bb);
            float vol = (float)Stats.VolumeMm3(v);
            Stats.MinWallProbe(v, Vox); // warm-up (JIT)
            var sw = Stopwatch.StartNew();
            double p = Stats.MinWallProbe(v, Vox);
            long pMs = sw.ElapsedMilliseconds;
            sw.Restart();
            double r = Stats.MinWallProbeByErosion(v, vol, bb, Vox);
            return (pMs, sw.ElapsedMilliseconds, p, r);
        });
        Assert.True(Math.Abs(probe - reference) <= Vox, $"probe {probe:F3} vs erosion reference {reference:F3}");
        Assert.True(probeMs < 1000, $"probe took {probeMs} ms (erosion {refMs} ms)");
        Assert.True(probeMs * 5 <= refMs, $"probe {probeMs} ms is not ≥ 5× faster than erosion {refMs} ms");
    }
}
