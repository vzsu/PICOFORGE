// ForgeSandbox/Kit/Stats.cs — Stats.Of(Ctx, Voxels): volume, area, bbox, triangles, watertight, min-wall probe
// docs/05 §4, docs/04 §5 (engine.inspect), PICOGK_KNOWLEDGE §4 (min-wall probe definition)

using System.Numerics;
using PicoGK;

namespace PicoForge.Kit;

public sealed class GeomStats
{
    public double VolumeCm3 { get; set; }
    public double AreaCm2 { get; set; }
    public IReadOnlyList<double> BboxMin { get; set; } = [];
    public IReadOnlyList<double> BboxMax { get; set; } = [];
    public int Triangles { get; set; }
    public bool Watertight { get; set; }
    /// <summary>Directed edges whose reverse does not occur equally often (boundary or flipped; 0 when watertight).</summary>
    public int OpenEdges { get; set; }
    /// <summary>Directed edges used by more than one triangle (closed but non-manifold pinches).</summary>
    public int NonManifoldEdges { get; set; }
    public double VoxelSizeMm { get; set; }
    /// <summary>Erosion thickness t at which volume(erode(v, t/2)) first drops below 15 % of volume(v); null if not probed.</summary>
    public double? MinWallProbeMm { get; set; }
}

public static class Stats
{
    /// <summary>Full measurement of a voxel field. The mesh is the one exported (mshAsMesh).</summary>
    public static GeomStats Of(Ctx c, Voxels v, bool bProbeMinWall = true)
    {
        ArgumentNullException.ThrowIfNull(c);
        ArgumentNullException.ThrowIfNull(v);
        // Volume comes from the exported mesh (divergence theorem), not Voxels.CalculateProperties:
        // PicoGK 2.2.0 CalculateProperties counts enclosed cavities as solid (measured: 30x20x15 box minus a
        // fully enclosed inner box reports the full 8988 mm³; the mesh gives the correct 4420 mm³).
        v.CalculateProperties(out _, out BBox3 bbox);
        using var mesh = v.mshAsMesh();
        var s = OfMesh(mesh);
        s.BboxMin = [bbox.vecMin.X, bbox.vecMin.Y, bbox.vecMin.Z];
        s.BboxMax = [bbox.vecMax.X, bbox.vecMax.Y, bbox.vecMax.Z];
        s.VoxelSizeMm = c.fVoxelMM;
        if (bProbeMinWall) s.MinWallProbeMm = Math.Round(MinWallProbe(v, (float)(s.VolumeCm3 * 1000.0), bbox, c.fVoxelMM), 2);
        return s;
    }

    /// <summary>Enclosed volume of a voxel field in mm³, measured on its mesh (cavity-correct).</summary>
    public static double VolumeMm3(Voxels v)
    {
        ArgumentNullException.ThrowIfNull(v);
        using var m = v.mshAsMesh();
        double vol = 0;
        int n = m.nTriangleCount();
        for (int i = 0; i < n; i++)
        {
            m.GetTriangle(i, out Vector3 a, out Vector3 b, out Vector3 c);
            vol += Vector3.Dot(a, Vector3.Cross(b, c));
        }
        return Math.Abs(vol / 6.0);
    }

    /// <summary>Surface measurements of a triangle mesh: area, triangle count, watertightness.</summary>
    public static GeomStats OfMesh(Mesh m)
    {
        ArgumentNullException.ThrowIfNull(m);
        int nTri = m.nTriangleCount();
        double areaMm2 = 0, volMm3 = 0;
        // Directed edge → count. A closed, consistently oriented 2-manifold has every directed edge exactly once
        // and its reverse exactly once. Vertices are keyed by exact position so duplicated (unwelded) vertices still match;
        // quantising would merge distinct near-coincident vertices and report false open edges.
        var edges = new Dictionary<(Vector3, Vector3), int>(nTri * 3);
        for (int i = 0; i < nTri; i++)
        {
            m.GetTriangle(i, out Vector3 a, out Vector3 b, out Vector3 c);
            areaMm2 += Vector3.Cross(b - a, c - a).Length() / 2.0;
            Bump(edges, a, b); Bump(edges, b, c); Bump(edges, c, a);
            volMm3 += Vector3.Dot(a, Vector3.Cross(b, c)) / 6.0;
        }
        // Watertight (closed): every directed edge a→b is matched by as many b→a (no boundary, consistent orientation).
        // Non-manifold: an edge used by more than two triangles (closed pinch, e.g. thin features at voxel scale).
        int open = 0, nonManifold = 0;
        foreach (var (e, count) in edges)
        {
            int rc = edges.TryGetValue((e.Item2, e.Item1), out var r) ? r : 0;
            if (count != rc) open++;
            if (count > 1) nonManifold++;
        }
        var bb = m.oBoundingBox();
        return new GeomStats
        {
            AreaCm2 = Math.Round(areaMm2 / 100.0, 4),
            VolumeCm3 = Math.Round(Math.Abs(volMm3) / 1000.0, 4),
            Triangles = nTri,
            OpenEdges = open,
            NonManifoldEdges = nonManifold,
            Watertight = nTri > 0 && open == 0,
            BboxMin = [bb.vecMin.X, bb.vecMin.Y, bb.vecMin.Z],
            BboxMax = [bb.vecMax.X, bb.vecMax.Y, bb.vecMax.Z],
        };
    }

    /// <summary>
    /// Binary search for erosion thickness t where volume(erode(v, t/2)) / volume(v) first drops below 0.15.
    /// Upper bound is the smallest bbox extent (no wall can be thicker than the part).
    /// </summary>
    public static double MinWallProbe(Voxels v, float baseVolMm3, BBox3 bbox, float voxelMm)
    {
        ArgumentNullException.ThrowIfNull(v);
        if (baseVolMm3 <= 0) return 0;
        var size = bbox.vecSize();
        float lo = voxelMm, hi = Math.Max(Math.Min(size.X, Math.Min(size.Y, size.Z)), 2 * voxelMm);
        for (int i = 0; i < 8 && hi - lo > voxelMm / 2f; i++)
        {
            float mid = (lo + hi) / 2f;
            using var eroded = v.voxOffset(-mid / 2f);
            double erodedVol = eroded.bIsEmpty() ? 0 : VolumeMm3(eroded);
            if (erodedVol / baseVolMm3 < 0.15) hi = mid;
            else lo = mid;
        }
        return (lo + hi) / 2.0;
    }

    private static void Bump(Dictionary<(Vector3, Vector3), int> d, Vector3 a, Vector3 b)
    {
        var k = (a, b);
        d[k] = d.TryGetValue(k, out var n) ? n + 1 : 1;
    }
}
