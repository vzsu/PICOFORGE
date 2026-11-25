// ForgeSandbox/Kit/Kit.cs — PicoForge.Kit golden helper library
// PICOGK_KNOWLEDGE §4 — signatures checked against engine/picogk_api.json (PicoGK 2.2.0).
// All functions: pure w.r.t. inputs (modifiers documented), argument-validated with actionable exceptions.
// Every PicoGK object created here uses the global Library registered by the sandbox Runner.

using System.Numerics;
using PicoGK;

namespace PicoForge.Kit;

[System.Diagnostics.CodeAnalysis.SuppressMessage("Naming", "CA1724:Type names should not match namespaces",
    Justification = "PicoForge.Kit.Kit is the contract name used by generated designs (PICOGK_KNOWLEDGE §4).")]
public static class Kit
{
    // ═══════════════════════════════════════════════════════════════════════
    // PRIMITIVES
    // ═══════════════════════════════════════════════════════════════════════

    public static Voxels voxBox(Ctx c, Vector3 vMin, Vector3 vMax)
    {
        if (vMin.X >= vMax.X || vMin.Y >= vMax.Y || vMin.Z >= vMax.Z)
            throw new ArgumentException($"voxBox: vMin ({vMin}) must be strictly less than vMax ({vMax}) on all axes");
        using var m = BoxMesh(vMin, vMax);
        return new Voxels(m);
    }

    public static Voxels voxBoxCentered(Ctx c, Vector3 vCenter, Vector3 vSize)
    {
        var half = vSize / 2f;
        return voxBox(c, vCenter - half, vCenter + half);
    }

    public static Voxels voxCylinder(Ctx c, Vector3 vA, Vector3 vB, float fR)
    {
        if (fR <= 0) throw new ArgumentException($"voxCylinder: fR ({fR}) must be > 0");
        using var lat = new Lattice();
        lat.AddBeam(vA, vB, fR, fR, false);  // flat caps
        return new Voxels(lat);
    }

    public static Voxels voxCapsule(Ctx c, Vector3 vA, Vector3 vB, float fR)
    {
        if (fR <= 0) throw new ArgumentException($"voxCapsule: fR ({fR}) must be > 0");
        using var lat = new Lattice();
        lat.AddBeam(vA, vB, fR, fR, true);   // round caps
        return new Voxels(lat);
    }

    public static Voxels voxSphere(Ctx c, Vector3 vCenter, float fR)
    {
        if (fR <= 0) throw new ArgumentException($"voxSphere: fR ({fR}) must be > 0");
        using var lat = new Lattice();
        lat.AddSphere(vCenter, fR);
        return new Voxels(lat);
    }

    public static Voxels voxCone(Ctx c, Vector3 vBase, Vector3 vTip, float fRBase, float fRTip)
    {
        if (fRBase < 0) throw new ArgumentException($"voxCone: fRBase ({fRBase}) must be >= 0");
        if (fRTip < 0) throw new ArgumentException($"voxCone: fRTip ({fRTip}) must be >= 0");
        using var lat = new Lattice();
        lat.AddBeam(vBase, vTip, fRBase, fRTip, false);
        return new Voxels(lat);
    }

    public static Voxels voxTube(Ctx c, Vector3 vA, Vector3 vB, float fROuter, float fWall)
    {
        ArgumentNullException.ThrowIfNull(c);
        if (fROuter <= 0) throw new ArgumentException($"voxTube: fROuter ({fROuter}) must be > 0");
        if (fWall <= 0 || fWall >= fROuter)
            throw new ArgumentException($"voxTube: fWall ({fWall}) must be in (0, {fROuter})");
        var outer = voxCylinder(c, vA, vB, fROuter);
        // Inner cutter is lengthened past both ends so the bore is open (no skin left at the caps).
        var axis = Vector3.Normalize(vB - vA);
        var ext = axis * (1f + 4f * c.fVoxelMM);
        using var inner = voxCylinder(c, vA - ext, vB + ext, fROuter - fWall);
        outer.BoolSubtract(inner);
        return outer;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROFILES & SWEEPS
    // ═══════════════════════════════════════════════════════════════════════

    public static Voxels voxExtrudeZ(Ctx c, IReadOnlyList<Vector2> aPolyXY, float fZ0, float fZ1)
    {
        ArgumentNullException.ThrowIfNull(aPolyXY);
        if (aPolyXY.Count < 3) throw new ArgumentException($"voxExtrudeZ: polygon needs >= 3 points, got {aPolyXY.Count}");
        if (fZ0 >= fZ1) throw new ArgumentException($"voxExtrudeZ: fZ0 ({fZ0}) must be < fZ1 ({fZ1})");

        // Loft bottom ring to top ring with fan caps (polygon must be star-shaped about its centroid).
        var bot = aPolyXY.Select(p => new Vector3(p.X, p.Y, fZ0)).ToList();
        var top = aPolyXY.Select(p => new Vector3(p.X, p.Y, fZ1)).ToList();
        using var m = mshLoft([bot, top], true);
        return new Voxels(m);
    }

    public static Voxels voxRevolve(Ctx c, IReadOnlyList<Vector2> aProfileRZ, float fDeg = 360f)
    {
        ArgumentNullException.ThrowIfNull(aProfileRZ);
        if (aProfileRZ.Count < 3) throw new ArgumentException("voxRevolve: closed profile needs >= 3 points (R,Z)");
        if (fDeg <= 0 || fDeg > 360) throw new ArgumentException("voxRevolve: fDeg must be in (0,360]");
        if (aProfileRZ.Any(p => p.X < 0)) throw new ArgumentException("voxRevolve: profile R must be >= 0");

        int nSteps = Math.Max(32, (int)(fDeg / 5f));
        float dRad = fDeg * MathF.PI / 180f / nSteps;
        var rings = new List<IReadOnlyList<Vector3>>(nSteps + 1);
        for (int s = 0; s <= nSteps; s++)
        {
            float angle = s * dRad;
            float cosA = MathF.Cos(angle), sinA = MathF.Sin(angle);
            rings.Add(aProfileRZ.Select(p => new Vector3(p.X * cosA, p.X * sinA, p.Y)).ToList());
        }
        // Full revolution: last ring coincides with the first, the surface is closed without caps.
        using var m = mshLoft(rings, fDeg < 360f);
        return new Voxels(m);
    }

    public static Voxels voxSweepCircle(Ctx c, IReadOnlyList<Vector3> aPath, float fR)
    {
        ArgumentNullException.ThrowIfNull(aPath);
        if (aPath.Count < 2) throw new ArgumentException("voxSweepCircle: path needs >= 2 points");
        if (fR <= 0) throw new ArgumentException($"voxSweepCircle: fR ({fR}) must be > 0");
        using var lat = new Lattice();
        for (int i = 0; i < aPath.Count - 1; i++)
            lat.AddBeam(aPath[i], aPath[i + 1], fR, fR, true);
        return new Voxels(lat);
    }

    /// <summary>
    /// Loft equal-count closed rings into a closed mesh (side quads + fan caps).
    /// Orientation is normalised so the mesh always has outward normals (positive signed volume).
    /// </summary>
    public static Mesh mshLoft(IReadOnlyList<IReadOnlyList<Vector3>> aRings, bool bCapEnds = true)
    {
        ArgumentNullException.ThrowIfNull(aRings);
        if (aRings.Count < 2) throw new ArgumentException($"mshLoft: need >= 2 rings, got {aRings.Count}");
        int n = aRings[0].Count;
        if (n < 3) throw new ArgumentException($"mshLoft: rings need >= 3 vertices, got {n}");
        foreach (var r in aRings)
            if (r.Count != n) throw new ArgumentException($"mshLoft: all rings must have equal vertex count ({n})");

        var verts = new List<Vector3>(aRings.Count * n + 2);
        foreach (var ring in aRings) verts.AddRange(ring);
        int Idx(int ri, int vi) => ri * n + vi;

        var tris = new List<(int A, int B, int C)>();
        for (int ri = 0; ri < aRings.Count - 1; ri++)
        {
            for (int vi = 0; vi < n; vi++)
            {
                int vNext = (vi + 1) % n;
                int a = Idx(ri, vi), b = Idx(ri, vNext), c = Idx(ri + 1, vNext), d = Idx(ri + 1, vi);
                tris.Add((a, b, c));
                tris.Add((a, c, d));
            }
        }

        if (bCapEnds)
        {
            int last = aRings.Count - 1;
            int c0 = verts.Count; verts.Add(Centroid(aRings[0]));
            int c1 = verts.Count; verts.Add(Centroid(aRings[last]));
            for (int vi = 0; vi < n; vi++)
            {
                int vNext = (vi + 1) % n;
                tris.Add((Idx(0, vi), c0, Idx(0, vNext)));        // start cap faces against loft direction
                tris.Add((Idx(last, vi), Idx(last, vNext), c1));  // end cap faces along loft direction
            }
        }

        return MeshFrom(verts, tris);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRANSFORMS & PATTERNS
    // ═══════════════════════════════════════════════════════════════════════

    public static Mesh mshTransform(Mesh m, Matrix4x4 mat)
    {
        ArgumentNullException.ThrowIfNull(m);
        return m.mshCreateTransformed(mat);
    }

    public static Voxels voxPolarPatternZ(Ctx c, Mesh mOne, int nCount)
    {
        ArgumentNullException.ThrowIfNull(mOne);
        if (nCount < 1) throw new ArgumentException("voxPolarPatternZ: nCount must be >= 1");
        var result = new Voxels(mOne);
        float dAngle = 2f * MathF.PI / nCount;
        for (int i = 1; i < nCount; i++)
        {
            using var mRot = mOne.mshCreateTransformed(Matrix4x4.CreateRotationZ(i * dAngle));
            using var vRot = new Voxels(mRot);
            result.BoolAdd(vRot);
        }
        return result;
    }

    public static Voxels voxLinearPattern(Ctx c, Mesh mOne, Vector3 vStep, int nCount)
    {
        ArgumentNullException.ThrowIfNull(mOne);
        if (nCount < 1) throw new ArgumentException("voxLinearPattern: nCount must be >= 1");
        var result = new Voxels(mOne);
        for (int i = 1; i < nCount; i++)
        {
            using var mT = mOne.mshCreateTransformed(Matrix4x4.CreateTranslation(vStep * i));
            using var vT = new Voxels(mT);
            result.BoolAdd(vT);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODIFIERS (mutate in place, return the same object for chaining)
    // ═══════════════════════════════════════════════════════════════════════

    public static Voxels Shell(Voxels v, float fWallMM)
    {
        ArgumentNullException.ThrowIfNull(v);
        if (fWallMM <= 0) throw new ArgumentException($"Shell: fWallMM ({fWallMM}) must be > 0");
        using var inner = new Voxels(v);
        inner.Offset(-fWallMM);
        v.BoolSubtract(inner);
        return v;
    }

    public static Voxels FilletClose(Voxels v, float fR)
    {
        ArgumentNullException.ThrowIfNull(v);
        if (fR <= 0) throw new ArgumentException($"FilletClose: fR ({fR}) must be > 0");
        v.Offset(fR);
        v.Offset(-fR);
        return v;
    }

    public static Voxels RoundOpen(Voxels v, float fR)
    {
        ArgumentNullException.ThrowIfNull(v);
        if (fR <= 0) throw new ArgumentException($"RoundOpen: fR ({fR}) must be > 0");
        v.Offset(-fR);
        v.Offset(fR);
        return v;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2D & AIRFOIL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    public static IReadOnlyList<Vector2> aCircle(float fR, int n = 64)
    {
        if (fR <= 0) throw new ArgumentException($"aCircle: fR ({fR}) must be > 0");
        if (n < 3) throw new ArgumentException($"aCircle: n ({n}) must be >= 3");
        return Enumerable.Range(0, n)
            .Select(i => { float a = 2 * MathF.PI * i / n; return new Vector2(fR * MathF.Cos(a), fR * MathF.Sin(a)); })
            .ToList();
    }

    public static IReadOnlyList<Vector2> aRoundedRect(float fW, float fH, float fCornerR, int nPerCorner = 8)
    {
        if (fW <= 0 || fH <= 0) throw new ArgumentException("aRoundedRect: dimensions must be > 0");
        if (nPerCorner < 2) throw new ArgumentException("aRoundedRect: nPerCorner must be >= 2");
        fCornerR = Math.Min(fCornerR, Math.Min(fW, fH) / 2f);
        var pts = new List<Vector2>();
        float hw = fW / 2f - fCornerR, hh = fH / 2f - fCornerR;
        (float cx, float cy, float startDeg)[] corners =
        [
            (hw, hh, 0f), (-hw, hh, 90f), (-hw, -hh, 180f), (hw, -hh, 270f)
        ];
        foreach (var (cx, cy, startDeg) in corners)
            for (int i = 0; i < nPerCorner; i++)
            {
                float a = (startDeg + 90f * i / (nPerCorner - 1)) * MathF.PI / 180f;
                pts.Add(new Vector2(cx + fCornerR * MathF.Cos(a), cy + fCornerR * MathF.Sin(a)));
            }
        return pts;
    }

    /// <summary>
    /// NACA 4-digit airfoil — closed CCW polygon, LE at origin, chord along +X, thickness in Y.
    /// Starts at the upper trailing edge. PICOGK_KNOWLEDGE §4.
    /// </summary>
    public static IReadOnlyList<Vector2> aNaca4(string sCode, float fChord, int n = 61, bool bBluntTE = true)
    {
        ArgumentNullException.ThrowIfNull(sCode);
        if (sCode.Length != 4 || !sCode.All(char.IsAsciiDigit))
            throw new ArgumentException($"aNaca4: sCode must be 4 digits (e.g. '4409'), got '{sCode}'");
        if (fChord <= 0) throw new ArgumentException($"aNaca4: fChord ({fChord}) must be > 0");
        if (n < 5) throw new ArgumentException($"aNaca4: n ({n}) must be >= 5");
        float m = (sCode[0] - '0') / 100f;                              // max camber (fraction of chord)
        float p = (sCode[1] - '0') / 10f;                               // max camber position
        float t = ((sCode[2] - '0') * 10 + (sCode[3] - '0')) / 100f;    // thickness (fraction of chord)
        if (t <= 0) throw new ArgumentException($"aNaca4: thickness digits of '{sCode}' must be > 0");
        float k4 = bBluntTE ? 0.1015f : 0.1036f;

        var upper = new List<Vector2>(n);
        var lower = new List<Vector2>(n);
        for (int i = 0; i < n; i++)
        {
            float beta = MathF.PI * i / (n - 1);                        // cosine spacing
            float x = (1f - MathF.Cos(beta)) / 2f;
            float yt = 5f * t * (0.2969f * MathF.Sqrt(x) - 0.1260f * x - 0.3516f * x * x
                                 + 0.2843f * x * x * x - k4 * x * x * x * x);
            float yc = 0f, dyc = 0f;
            if (m > 0 && p > 0)
            {
                if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dyc = 2 * m / (p * p) * (p - x); }
                else { yc = m / ((1 - p) * (1 - p)) * (1 - 2 * p + 2 * p * x - x * x); dyc = 2 * m / ((1 - p) * (1 - p)) * (p - x); }
            }
            float th = MathF.Atan(dyc);
            upper.Add(new Vector2(x - yt * MathF.Sin(th), yc + yt * MathF.Cos(th)) * fChord);
            lower.Add(new Vector2(x + yt * MathF.Sin(th), yc - yt * MathF.Cos(th)) * fChord);
        }

        // CCW: upper TE → LE, then lower LE → TE. LE point is shared; a sharp TE is shared too.
        var poly = new List<Vector2>(2 * n);
        for (int i = n - 1; i >= 0; i--) poly.Add(upper[i]);
        int lowerEnd = bBluntTE ? n : n - 1;
        for (int i = 1; i < lowerEnd; i++) poly.Add(lower[i]);
        return poly;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ROTOR HIGH-LEVEL (fan/turbine fast path)
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// One blade, span along +Y, stacked at 40 % chord, centred on Z = 0.
    /// Section at radius r lies in the plane Y = r; the chord is tilted by β from the rotation plane (XY).
    /// The root section is sunk fRootExtendMM below fHubR for a clean union with the hub.
    /// </summary>
    public static Mesh mshAxialBlade(BladeSpec s)
    {
        ArgumentNullException.ThrowIfNull(s);
        if (s.fTipR <= s.fHubR)
            throw new ArgumentException($"mshAxialBlade: fTipR ({s.fTipR}) must exceed fHubR ({s.fHubR})");
        if (s.nSections < 4)
            throw new ArgumentException($"mshAxialBlade: nSections must be >= 4, got {s.nSections}");
        if (s.fRootExtendMM < 0 || s.fRootExtendMM >= s.fHubR)
            throw new ArgumentException($"mshAxialBlade: fRootExtendMM ({s.fRootExtendMM}) must be in [0, {s.fHubR})");

        var rings = new List<IReadOnlyList<Vector3>>(s.nSections);
        for (int si = 0; si < s.nSections; si++)
        {
            float rNorm = (float)si / (s.nSections - 1);
            float r = si == 0 ? s.fHubR - s.fRootExtendMM : s.fHubR + rNorm * (s.fTipR - s.fHubR);
            float chord = s.fChordAt(rNorm);
            if (chord <= 0) throw new ArgumentException($"mshAxialBlade: chord at rNorm={rNorm:F2} is {chord}, must be > 0");
            float betaRad = s.fBetaDegAt(rNorm) * MathF.PI / 180f;
            var profile2d = aNaca4(s.sNacaAt(rNorm), chord);

            float stackX = 0.4f * chord;
            float cb = MathF.Cos(betaRad), sb = MathF.Sin(betaRad);
            rings.Add(profile2d.Select(p =>
            {
                float u = p.X - stackX, v = p.Y;
                return new Vector3(u * cb - v * sb, r, u * sb + v * cb);
            }).ToList());
        }
        return mshLoft(rings, true);
    }

    public static Voxels voxAxialRotor(
        Ctx c, BladeSpec s, int nBlades,
        float fHubR, float fHubZ0, float fHubZ1,
        float fBoreR = 0f, float fFilletR = 0f)
    {
        ArgumentNullException.ThrowIfNull(c);
        ArgumentNullException.ThrowIfNull(s);
        if (nBlades < 1) throw new ArgumentException("voxAxialRotor: nBlades must be >= 1");
        if (fHubZ1 <= fHubZ0) throw new ArgumentException($"voxAxialRotor: fHubZ1 ({fHubZ1}) must be > fHubZ0 ({fHubZ0})");
        if (fHubR <= 0) throw new ArgumentException($"voxAxialRotor: fHubR ({fHubR}) must be > 0");
        if (fBoreR < 0 || fBoreR >= fHubR) throw new ArgumentException($"voxAxialRotor: fBoreR ({fBoreR}) must be in [0, {fHubR})");

        c.Log($"[Kit.voxAxialRotor] hub R={fHubR} Z={fHubZ0}..{fHubZ1} blades={nBlades}");

        // Hub: full disc as a lattice beam (flat caps).
        Voxels? rotor = voxCylinder(c, new Vector3(0, 0, fHubZ0), new Vector3(0, 0, fHubZ1), fHubR);
        try
        {
            c.Progress(0.2f);

            // One blade mesh, centred at hub mid-height → polar pattern.
            using var blade0 = mshAxialBlade(s);
            using var blade = blade0.mshCreateTransformed(Matrix4x4.CreateTranslation(0, 0, (fHubZ0 + fHubZ1) / 2f));
            using var blades = voxPolarPatternZ(c, blade, nBlades);
            rotor.BoolAdd(blades);
            c.Progress(0.6f);

            if (fBoreR > 0)
            {
                using var bore = voxCylinder(c, new Vector3(0, 0, fHubZ0 - 1), new Vector3(0, 0, fHubZ1 + 1), fBoreR);
                rotor.BoolSubtract(bore);
            }

            if (fFilletR > 0)
                FilletClose(rotor, fFilletR);
            c.Progress(0.9f);
            var done = rotor;
            rotor = null;   // ownership passes to the caller
            return done;
        }
        finally
        {
            rotor?.Dispose();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // IMPLICIT TOOLBOX
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>Gyroid sheet of wall thickness fWallMM, cell size fCellMM (approximate signed distance).</summary>
    public static IImplicit impGyroid(float fCellMM, float fWallMM)
    {
        if (fCellMM <= 0) throw new ArgumentException($"impGyroid: fCellMM ({fCellMM}) must be > 0");
        if (fWallMM <= 0 || fWallMM >= fCellMM) throw new ArgumentException($"impGyroid: fWallMM ({fWallMM}) must be in (0, {fCellMM})");
        return new GyroidImplicit(fCellMM, fWallMM);
    }

    public static Voxels voxFromImplicit(Ctx c, IImplicit i, BBox3 bounds)
    {
        ArgumentNullException.ThrowIfNull(i);
        return new Voxels(i, bounds);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATS
    // ═══════════════════════════════════════════════════════════════════════

    public static GeomStats oStats(Ctx c, Voxels v) => Stats.Of(c, v);

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    private static Vector3 Centroid(IReadOnlyList<Vector3> ring)
        => ring.Aggregate(Vector3.Zero, (acc, v) => acc + v) / ring.Count;

    /// <summary>Signed volume (divergence theorem) of a closed triangle list, mm³.</summary>
    internal static double SignedVolume(IReadOnlyList<Vector3> verts, IReadOnlyList<(int A, int B, int C)> tris)
    {
        double vol = 0;
        foreach (var (a, b, c) in tris)
            vol += Vector3.Dot(verts[a], Vector3.Cross(verts[b], verts[c]));
        return vol / 6.0;
    }

    /// <summary>Build a PicoGK mesh, flipping all triangles if needed so normals point outward.</summary>
    private static Mesh MeshFrom(List<Vector3> verts, List<(int A, int B, int C)> tris)
    {
        bool flip = SignedVolume(verts, tris) < 0;
        var m = new Mesh();
        var idx = new int[verts.Count];
        for (int i = 0; i < verts.Count; i++) idx[i] = m.nAddVertex(verts[i]);
        foreach (var (a, b, c) in tris)
        {
            if (flip) m.nAddTriangle(idx[a], idx[c], idx[b]);
            else m.nAddTriangle(idx[a], idx[b], idx[c]);
        }
        return m;
    }

    private static Mesh BoxMesh(Vector3 min, Vector3 max)
    {
        var v = new List<Vector3>
        {
            new(min.X, min.Y, min.Z), new(max.X, min.Y, min.Z), new(max.X, max.Y, min.Z), new(min.X, max.Y, min.Z),
            new(min.X, min.Y, max.Z), new(max.X, min.Y, max.Z), new(max.X, max.Y, max.Z), new(min.X, max.Y, max.Z),
        };
        var t = new List<(int, int, int)>
        {
            (0, 2, 1), (0, 3, 2), // bottom (-Z)
            (4, 5, 6), (4, 6, 7), // top (+Z)
            (0, 1, 5), (0, 5, 4), // front (-Y)
            (2, 3, 7), (2, 7, 6), // back (+Y)
            (0, 4, 7), (0, 7, 3), // left (-X)
            (1, 2, 6), (1, 6, 5), // right (+X)
        };
        return MeshFrom(v, t);
    }

    private sealed class GyroidImplicit(float fCellMM, float fWallMM) : IImplicit
    {
        private readonly float _k = 2f * MathF.PI / fCellMM;
        private readonly float _halfWall = fWallMM / 2f;

        public float fSignedDistance(in Vector3 vec)
        {
            float x = vec.X * _k, y = vec.Y * _k, z = vec.Z * _k;
            float g = MathF.Sin(x) * MathF.Cos(y) + MathF.Sin(y) * MathF.Cos(z) + MathF.Sin(z) * MathF.Cos(x);
            // |∇g| ≈ k·1.2 near the surface; scale so the field is roughly in mm.
            return MathF.Abs(g) / (_k * 1.2f) - _halfWall;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPORTING TYPES
// ═══════════════════════════════════════════════════════════════════════════

public sealed record BladeSpec(
    float fHubR,
    float fTipR,
    int nSections,
    Func<float, float> fChordAt,
    Func<float, float> fBetaDegAt,
    Func<float, string> sNacaAt,
    float fRootExtendMM = 1.5f);
