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
        if (bProbeMinWall) s.MinWallProbeMm = Math.Round(MinWallProbe(v, c.fVoxelMM), 2);
        return s;
    }

    /// <summary>
    /// Signed distance per voxel centre in voxel units (PicoGK slices give mm, narrow band clamped at ±3 voxels),
    /// padded by one outside voxel on every side. Negative = inside.
    /// </summary>
    private static float[] SignedField(Voxels v, out int nx, out int ny, out int nz)
    {
        v.GetVoxelDimensions(out int sx, out int sy, out int sz);
        nx = sx + 2; ny = sy + 2; nz = sz + 2;
        var sd = new float[(long)nx * ny * nz];
        Array.Fill(sd, 3f);
        if (sx <= 0 || sy <= 0 || sz <= 0) return sd;
        float inv = 1f / v.fVoxelSize;
        ImageGrayScale img = v.imgAllocateSlice(out int nSlices, Voxels.ESliceAxis.Z);
        int w = Math.Min(img.nWidth, sx), h = Math.Min(img.nHeight, sy);
        for (int z = 0; z < Math.Min(nSlices, sz); z++)
        {
            v.GetVoxelSlice(z, ref img, Voxels.ESliceMode.SignedDistance, Voxels.ESliceAxis.Z);
            long zo = (long)(z + 1) * nx * ny;
            for (int y = 0; y < h; y++)
            {
                long row = zo + (long)(y + 1) * nx + 1;
                for (int x = 0; x < w; x++) sd[row + x] = img.fValue(x, y) * inv;
            }
        }
        return sd;
    }

    /// <summary>Fraction of a voxel cell that is solid, from its centre's signed distance (voxel units).</summary>
    private static float Fill(float sdVox) => Math.Clamp(0.5f - sdVox, 0f, 1f);

    /// <summary>A voxel centre strictly inside the surface (centres lying on the surface count as outside).</summary>
    private static bool Inside(float sdVox) => sdVox < -1e-3f;

    /// <summary>Solid volume in mm³ from partial voxel occupancy (cavity-correct, independent of meshing).</summary>
    public static double InsideVolumeMm3(Voxels v)
    {
        ArgumentNullException.ThrowIfNull(v);
        var sd = SignedField(v, out _, out _, out _);
        double n = 0;
        foreach (float s in sd) n += Fill(s);
        double vox = v.fVoxelSize;
        return n * vox * vox * vox;
    }

    /// <summary>
    /// Min-wall probe by one exact Euclidean distance transform (Felzenszwalb–Huttenlocher, separable) of the
    /// voxel occupancy. Surface distance of an inside centre = distance to the nearest outside centre − c, where c is
    /// the mean distance from boundary outside centres to the surface (measured from the signed field, 0…1 voxel).
    /// Erosion by r keeps voxels with surface distance &gt; r, so the 15 % rule of the definition becomes a quantile
    /// of the distance histogram. O(voxels), no meshing.
    /// </summary>
    public static double MinWallProbe(Voxels v, float voxelMm)
    {
        ArgumentNullException.ThrowIfNull(v);
        var sd = SignedField(v, out int nx, out int ny, out int nz);
        long total = (long)nx * ny * nz;
        const float Inf = 1e20f;
        var f = new float[total];
        var occ = new bool[total];
        double solidCells = 0;
        long nInside = 0;
        for (long i = 0; i < total; i++)
        {
            solidCells += Fill(sd[i]);
            if (Inside(sd[i])) { occ[i] = true; f[i] = Inf; nInside++; }
        }
        if (nInside == 0) return 0;
        // c: mean signed distance of outside centres that have an inside 6-neighbour (where the surface crosses).
        double cSum = 0;
        long cN = 0;
        long plane0 = (long)nx * ny;
        for (int z = 1; z < nz - 1; z++)
            for (int y = 1; y < ny - 1; y++)
                for (int x = 1; x < nx - 1; x++)
                {
                    long i = z * plane0 + (long)y * nx + x;
                    if (occ[i]) continue;
                    if (occ[i - 1] || occ[i + 1] || occ[i - nx] || occ[i + nx] || occ[i - plane0] || occ[i + plane0])
                    {
                        cSum += Math.Clamp(sd[i], 0f, 1f);
                        cN++;
                    }
                }
        double c = cN > 0 ? cSum / cN : 0.5;
        int nMax = Math.Max(nx, Math.Max(ny, nz));
        var line = new float[nMax];
        var outLine = new float[nMax];
        var vIdx = new int[nMax];
        var zB = new float[nMax + 1];
        // x pass
        for (int z = 0; z < nz; z++)
            for (int y = 0; y < ny; y++)
            {
                long o = ((long)z * ny + y) * nx;
                for (int x = 0; x < nx; x++) line[x] = f[o + x];
                Edt1D(line, nx, outLine, vIdx, zB);
                for (int x = 0; x < nx; x++) f[o + x] = outLine[x];
            }
        // y pass
        for (int z = 0; z < nz; z++)
            for (int x = 0; x < nx; x++)
            {
                long o = (long)z * ny * nx + x;
                for (int y = 0; y < ny; y++) line[y] = f[o + (long)y * nx];
                Edt1D(line, ny, outLine, vIdx, zB);
                for (int y = 0; y < ny; y++) f[o + (long)y * nx] = outLine[y];
            }
        // z pass
        long plane = (long)nx * ny;
        for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
            {
                long o = (long)y * nx + x;
                for (int z = 0; z < nz; z++) line[z] = f[o + z * plane];
                Edt1D(line, nz, outLine, vIdx, zB);
                for (int z = 0; z < nz; z++) f[o + z * plane] = outLine[z];
            }
        // squared centre distances are integers: histogram them, then walk from the top until 15 % is kept.
        var hist = new Dictionary<int, long>();
        for (long i = 0; i < total; i++)
        {
            if (!occ[i]) continue;
            int d2 = (int)MathF.Round(f[i]);
            hist[d2] = hist.TryGetValue(d2, out long n) ? n + 1 : 1;
        }
        double keepMax = 0.15 * solidCells;
        long kept = 0;
        double rVox = 0;
        foreach (int d2 in hist.Keys.OrderByDescending(k => k))
        {
            kept += hist[d2];
            // erosion by r keeps the levels deeper than r; the smallest r that keeps < 15 % sits at the first level
            // whose inclusion would push the kept volume past 15 %.
            if (kept > keepMax) { rVox = Math.Sqrt(d2) - c; break; }
        }
        return Math.Max(0, 2.0 * rVox * voxelMm);
    }

    /// <summary>1-D squared distance transform of sampled function f (lower envelope of parabolas).</summary>
    private static void Edt1D(float[] f, int n, float[] d, int[] v, float[] z)
    {
        int k = 0;
        v[0] = 0; z[0] = float.NegativeInfinity; z[1] = float.PositiveInfinity;
        for (int q = 1; q < n; q++)
        {
            float s = Intersect(f, q, v[k]);
            while (s <= z[k]) // z[0] = −∞, so k never goes below 0
            {
                k--;
                s = Intersect(f, q, v[k]);
            }
            k++;
            v[k] = q; z[k] = s; z[k + 1] = float.PositiveInfinity;
        }
        k = 0;
        for (int q = 0; q < n; q++)
        {
            while (z[k + 1] < q) k++;
            float dq = q - v[k];
            d[q] = dq * dq + f[v[k]];
        }
    }

    private static float Intersect(float[] f, int q, int p) =>
        ((f[q] + (float)q * q) - (f[p] + (float)p * p)) / (2f * (q - p));

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
    /// Reference implementation for tests; slow (one meshed erosion per step). Builds use MinWallProbe.
    /// </summary>
    public static double MinWallProbeByErosion(Voxels v, float baseVolMm3, BBox3 bbox, float voxelMm)
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
