// Kit.Tests/KitGoldenTests.cs — Golden-volume tests for PicoForge.Kit (KIT-GOLD-*)
// docs/11 §3 "Engine and Kit": sphere, tube, extrude, revolve, loft, rotor within 2 %.
// PICOGK_KNOWLEDGE §4: tolerance 2 % at voxel = R/50.
// PicoGK runs headless: a scoped `new Library(voxelMm)` registered as the global library — no viewer window.
// PicoGK's CalculateProperties reports mm³ (picogk_api.json: `out float fVolumeCubicMM`).

using System.Numerics;
using PicoForge.Kit;
using PicoGK;
using Xunit;
using KitApi = PicoForge.Kit.Kit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Kit.Tests;

internal static class Headless
{
    /// <summary>Runs fn with a scoped, globally registered PicoGK library (no viewer).</summary>
    public static T Run<T>(float voxelMm, Func<Ctx, T> fn)
    {
        using var lib = new Library(voxelMm);
        Library.RegisterGlobalLibrary(lib);
        try
        {
            var ctx = new Ctx(voxelMm, new Dictionary<string, double>(), _ => { }, _ => { });
            return fn(ctx);
        }
        finally
        {
            Library.UnregisterGlobalLibrary();
        }
    }

    /// <summary>Volume as reported to users: Stats.VolumeMm3 (mesh-based; PicoGK CalculateProperties ignores enclosed cavities).</summary>
    public static double VolumeMm3(Voxels v) => Stats.VolumeMm3(v);

    /// <summary>|signed volume| of a closed mesh by the divergence theorem (mm³).</summary>
    public static double MeshVolumeMm3(Mesh m)
    {
        double vol = 0;
        for (int i = 0; i < m.nTriangleCount(); i++)
        {
            m.GetTriangle(i, out Vector3 a, out Vector3 b, out Vector3 c);
            vol += Vector3.Dot(a, Vector3.Cross(b, c));
        }
        return Math.Abs(vol / 6.0);
    }
}

public class KitGoldenTests
{
    private const double Tolerance = 0.02;  // 2 %

    private static void AssertVolume(double actualMm3, double expectedMm3, string label)
    {
        double err = Math.Abs(actualMm3 - expectedMm3) / expectedMm3;
        Assert.True(err <= Tolerance,
            $"{label}: volume {actualMm3:F1} mm³ deviates {err:P2} from expected {expectedMm3:F1} mm³ (tolerance {Tolerance:P0})");
    }

    // ── KIT-GOLD-sphere ────────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-sphere")]
    public void KIT_GOLD_sphere()
    {
        const float R = 20f;
        var vol = Headless.Run(R / 50f, ctx =>
        {
            using var v = KitApi.voxSphere(ctx, Vector3.Zero, R);
            return Headless.VolumeMm3(v);
        });
        AssertVolume(vol, 4.0 / 3.0 * Math.PI * R * R * R, "Sphere R=20mm");
    }

    // ── Cylinder (support for tube) ───────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-cylinder")]
    public void Cylinder_Volume_WithinTolerance()
    {
        const float R = 15f, H = 40f;
        var vol = Headless.Run(R / 50f, ctx =>
        {
            using var v = KitApi.voxCylinder(ctx, Vector3.Zero, new Vector3(0, 0, H), R);
            return Headless.VolumeMm3(v);
        });
        AssertVolume(vol, Math.PI * R * R * H, "Cylinder R=15 H=40mm");
    }

    // ── KIT-GOLD-tube ──────────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-tube")]
    public void KIT_GOLD_tube()
    {
        const float Ro = 20f, Wall = 3f, H = 50f;
        var vol = Headless.Run(Ro / 50f, ctx =>
        {
            using var v = KitApi.voxTube(ctx, Vector3.Zero, new Vector3(0, 0, H), Ro, Wall);
            return Headless.VolumeMm3(v);
        });
        const float Ri = Ro - Wall;
        AssertVolume(vol, Math.PI * (Ro * Ro - Ri * Ri) * H, "Tube Ro=20 Wall=3 H=50mm");
    }

    // ── KIT-GOLD-extrude ───────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-extrude")]
    public void KIT_GOLD_extrude()
    {
        const float W = 30f, D = 20f, H = 15f;
        var vol = Headless.Run(0.3f, ctx =>
        {
            var poly = new List<Vector2> { new(0, 0), new(W, 0), new(W, D), new(0, D) };
            using var v = KitApi.voxExtrudeZ(ctx, poly, 0, H);
            return Headless.VolumeMm3(v);
        });
        AssertVolume(vol, W * D * H, "ExtrudeZ 30x20x15mm");
    }

    // ── KIT-GOLD-revolve ───────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-revolve")]
    public void KIT_GOLD_revolve()
    {
        // Rectangle profile revolved 360° = washer. voxRevolve uses n = 72 angular steps, so the analytic
        // solid is a regular 72-gon washer: area factor (n/2)·sin(2π/n) instead of π.
        const float Ri = 10f, Ro = 20f, H = 5f;
        var vol = Headless.Run(0.2f, ctx =>
        {
            var profile = new List<Vector2> { new(Ri, 0), new(Ro, 0), new(Ro, H), new(Ri, H) };
            using var v = KitApi.voxRevolve(ctx, profile, 360f);
            return Headless.VolumeMm3(v);
        });
        const int n = 72;
        double polyFactor = n / 2.0 * Math.Sin(2 * Math.PI / n);
        AssertVolume(vol, polyFactor * (Ro * Ro - Ri * Ri) * H, "Revolve washer Ri=10 Ro=20 H=5mm");
        AssertVolume(vol, Math.PI * (Ro * Ro - Ri * Ri) * H, "Revolve washer vs true circle");
    }

    // ── KIT-GOLD-loft ──────────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-loft")]
    public void KIT_GOLD_loft()
    {
        const float R = 12f, H = 30f;
        var vol = Headless.Run(R / 50f, ctx =>
        {
            var bot = KitApi.aCircle(R).Select(p => new Vector3(p.X, p.Y, 0)).ToList();
            var top = KitApi.aCircle(R).Select(p => new Vector3(p.X, p.Y, H)).ToList();
            using var m = KitApi.mshLoft([bot, top], true);
            using var v = new Voxels(m);
            return Headless.VolumeMm3(v);
        });
        AssertVolume(vol, Math.PI * R * R * H, "Loft circle->circle cylinder R=12 H=30mm");
    }

    // ── KIT-GOLD-rotor ─────────────────────────────────────────────────────
    [Fact(DisplayName = "KIT-GOLD-rotor")]
    public void KIT_GOLD_rotor()
    {
        // Construction (no fillet). Blade root section lies on the plane Y = BladeRootR (root extension 0); the hub
        // cylinder has radius HubR = BladeRootR + 0.4, so each blade dips ≤ 0.4 mm into the hub — enough for a
        // manifold union (a purely tangential contact meshes non-manifold), small enough to bound the overlap:
        //   overlap per blade ≤ 0.4 mm (Y) × 2·√(HubR² − BladeRootR²) (X) × 3 mm (max thickness) ≈ 7 mm³ (< 0.25 % of V).
        //   V ≈ π·Rh²·H (hub beam) − π·Rb²·H (bore) + nBlades · V(blade mesh)
        // V(blade mesh) is the exact enclosed volume of Kit.mshAxialBlade by the divergence theorem.
        const float BladeRootR = 10f, HubR = 10.4f, TipR = 40f, HubH = 20f, BoreR = 3f;
        const int NBlades = 3;
        var spec = new BladeSpec(BladeRootR, TipR, 6, _ => 20f, _ => 35f, _ => "4415", fRootExtendMM: 0f);

        var (vol, bladeVol, stats) = Headless.Run(0.2f, ctx =>
        {
            using var blade = KitApi.mshAxialBlade(spec);
            double bv = Headless.MeshVolumeMm3(blade);
            using var v = KitApi.voxAxialRotor(ctx, spec, NBlades, HubR, 0f, HubH, BoreR, 0f);
            var s = Stats.Of(ctx, v, bProbeMinWall: false);
            return (Headless.VolumeMm3(v), bv, s);
        });
        double expected = Math.PI * HubR * HubR * HubH - Math.PI * BoreR * BoreR * HubH + NBlades * bladeVol;
        Assert.True(bladeVol > 500, $"blade volume {bladeVol:F1} mm³ is implausibly small");
        AssertVolume(vol, expected, $"Rotor 3 blades (blade {bladeVol:F1} mm³)");
        Assert.True(stats.Watertight, $"rotor mesh not watertight: {stats.OpenEdges} open edges");
    }

    // ── Rotor smoke (original placeholder test, kept) ─────────────────────
    [Fact]
    public void AxialRotor_IsWatertight_And_NotEmpty()
    {
        var (triangles, isEmpty, watertight) = Headless.Run(0.5f, ctx =>
        {
            var spec = new BladeSpec(
                fHubR: 10f, fTipR: 40f, nSections: 5,
                fChordAt: _ => 15f,
                fBetaDegAt: _ => 35f,
                sNacaAt: _ => "4409");
            using var v = KitApi.voxAxialRotor(ctx, spec, 3, 10f, 0f, 20f, 3f, 1f);
            using var m = v.mshAsMesh();
            return (m.nTriangleCount(), v.bIsEmpty(), Stats.OfMesh(m).Watertight);
        });
        Assert.False(isEmpty, "Rotor voxels must not be empty");
        Assert.True(triangles > 0, "Rotor mesh must have triangles");
        Assert.True(watertight, "Rotor mesh must be watertight");
    }

    // ── NACA airfoil ───────────────────────────────────────────────────────
    [Fact]
    public void Naca4409_HasCorrectPointCount()
    {
        var poly = KitApi.aNaca4("4409", 25f, n: 61);
        Assert.True(poly.Count >= 100, $"NACA 4409 poly has {poly.Count} points (expected >= 100)");
        Assert.All(poly, p => Assert.True(p.X >= -1f && p.X <= 30f, $"Point {p} out of chord range"));
        // Upper surface must reach ~9 % of chord (+camber), not a chord²-scaled value.
        float maxY = poly.Max(p => p.Y);
        Assert.InRange(maxY, 0.04f * 25f, 0.12f * 25f);
    }

    // ── Shell ──────────────────────────────────────────────────────────────
    [Fact]
    public void Shell_ReducesVolume()
    {
        var (fullVol, shellVol) = Headless.Run(0.3f, ctx =>
        {
            using var full = KitApi.voxBox(ctx, new Vector3(0, 0, 0), new Vector3(30, 20, 15));
            using var shelled = KitApi.voxBox(ctx, new Vector3(0, 0, 0), new Vector3(30, 20, 15));
            KitApi.Shell(shelled, 2f);
            return (Headless.VolumeMm3(full), Headless.VolumeMm3(shelled));
        });
        Assert.True(shellVol < fullVol * 0.9, $"Shell did not reduce volume: full={fullVol} shell={shellVol}");
        AssertVolume(fullVol, 30.0 * 20 * 15, "Box 30x20x15");
        // Shell(2) of a 30x20x15 box = 30·20·15 − 26·16·11 (enclosed cavity)
        AssertVolume(shellVol, 30.0 * 20 * 15 - 26.0 * 16 * 11, "Shell 2mm of 30x20x15 box");
    }
}

public class CtxParamsTests
{
    private static Ctx MakeCtx(Dictionary<string, double> p) => new(0.5f, p, _ => { }, _ => { });

    [Fact(DisplayName = "ENG-PARAMS-01 Ctx.P/Pi read params; missing name lists known names")]
    public void ENG_PARAMS_01()
    {
        var ctx = MakeCtx(new() { ["hub_radius"] = 18, ["blade_count"] = 7, ["omega"] = 188.5 });
        Assert.Equal(18f, ctx.P("hub_radius"));
        Assert.Equal(188.5f, ctx.P("omega"));
        Assert.Equal(7, ctx.Pi("blade_count"));

        var ex = Assert.Throws<KeyNotFoundException>(() => ctx.P("tip_radius"));
        Assert.Contains("tip_radius", ex.Message, StringComparison.Ordinal);
        Assert.Contains("blade_count, hub_radius, omega", ex.Message, StringComparison.Ordinal);
        Assert.Throws<KeyNotFoundException>(() => ctx.Pi("nope"));

        // Pi rejects non-integers instead of silently truncating.
        Assert.Throws<ArgumentException>(() => ctx.Pi("omega"));

        var empty = MakeCtx([]);
        Assert.Contains("(none)", Assert.Throws<KeyNotFoundException>(() => empty.P("x")).Message, StringComparison.Ordinal);
    }
}
