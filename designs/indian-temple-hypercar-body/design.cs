using System;
using System.Numerics;
using System.Collections.Generic;
using System.Linq;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    static float s, L, W2, H, z0, yN;

    // normalised styling keypoints along the length t = 0 (nose) .. 1 (tail)
    static readonly float[] aTw = { 0f, 0.06f, 0.20f, 0.40f, 0.55f, 0.78f, 0.93f, 1f };
    static readonly float[] aVw = { 0.62f, 0.88f, 1.00f, 0.93f, 0.95f, 1.00f, 0.97f, 0.86f };
    static readonly float[] aTt = { 0f, 0.12f, 0.25f, 0.80f, 0.92f, 1f };
    static readonly float[] aVt = { 0.22f, 0.40f, 0.47f, 0.57f, 0.61f, 0.64f };
    static readonly float[] aTs = { 0f, 0.20f, 0.32f, 0.60f, 0.78f, 1f };
    static readonly float[] aVs = { 0.27f, 0.73f, 0.56f, 0.60f, 0.78f, 0.66f };
    const float fCan0 = 0.27f, fCan1 = 0.80f;

    static float Interp(float[] aT, float[] aV, float t)
    {
        if (t <= aT[0]) return aV[0];
        for (int i = 1; i < aT.Length; i++)
            if (t <= aT[i]) { float u = (t - aT[i - 1]) / (aT[i] - aT[i - 1]); return aV[i - 1] + (aV[i] - aV[i - 1]) * u; }
        return aV[aV.Length - 1];
    }
    static float Lerp(float a, float b, float u) => a + (b - a) * u;
    static float Smooth(float u) { u = Math.Clamp(u, 0f, 1f); return u * u * (3f - 2f * u); }
    static float fW(float t) => W2 * Interp(aTw, aVw, t);
    static float fZt(float t) => H * Interp(aTt, aVt, t);
    static float fZs(float t) => H * Interp(aTs, aVs, t);
    static float fY(float t) => yN + t * L;
    static float fT(float y) => (y - yN) / L;
    static float zBand => z0 + 0.035f * H;
    static float zSill => z0 + 0.168f * H;

    // right-half section a..h as (x, z)
    static Vector2[] aHalf(float t)
    {
        float w = fW(t);
        float zE = zSill + 0.045f * H;
        float zS = fZs(t);
        float zF = MathF.Max(zS - 0.053f * H, zE + 0.06f * H);
        float zG = MathF.Max(zS, zF + 0.03f * H);
        return new[] {
            new Vector2(0f, z0), new Vector2(0.86f * w, z0), new Vector2(w, zBand), new Vector2(w, zSill),
            new Vector2(0.90f * w, zE), new Vector2(0.96f * w, zF), new Vector2(0.62f * w, zG), new Vector2(0f, fZt(t)) };
    }
    static float fDeckZ(float t, float x)
    {
        var a = aHalf(t);
        float u = Math.Clamp(MathF.Abs(x) / a[6].X, 0f, 1f);
        return Lerp(a[7].Y, a[6].Y, u);
    }

    // ---------------- hull ----------------
    static List<Vector3> BodyRing(float t)
    {
        var a = aHalf(t); float y = fY(t);
        var r = new List<Vector3>();
        for (int i = 0; i < 8; i++) r.Add(new Vector3(a[i].X, y, a[i].Y));
        for (int i = 6; i >= 1; i--) r.Add(new Vector3(-a[i].X, y, a[i].Y));
        return r;
    }
    static Voxels voxHull(Ctx ctx)
    {
        int n = 96;
        var rings = new List<IReadOnlyList<Vector3>>();
        for (int i = 0; i <= n; i++) rings.Add(BodyRing(i / (float)n));
        return new Voxels(Kit.mshLoft(rings, true));
    }

    static void CanopyAt(float t, out float cw, out float zb, out float h)
    {
        float tc = Math.Clamp((t - fCan0) / (fCan1 - fCan0), 0f, 1f);
        float cwMax = 0.50f * W2;
        cw = tc < 0.35f ? cwMax * MathF.Pow(MathF.Sin(tc / 0.35f * MathF.PI * 0.5f), 0.6f)
                        : cwMax * (1f - 0.85f * MathF.Pow((tc - 0.35f) / 0.65f, 1.6f));
        cw = MathF.Max(cw, 0.08f * cwMax);
        float zDeck = fZt(t);
        zb = zDeck - 0.035f * H;
        float zTop = tc < 0.3f ? Lerp(zDeck, H, Smooth(tc / 0.3f)) : Lerp(H, zDeck, MathF.Pow((tc - 0.3f) / 0.7f, 1.5f));
        h = MathF.Max(zTop - zb, 0.5f);
    }
    static Voxels voxCanopy(Ctx ctx)
    {
        int n = 64;
        var rings = new List<IReadOnlyList<Vector3>>();
        for (int i = 0; i <= n; i++)
        {
            float t = Lerp(fCan0, fCan1, i / (float)n);
            CanopyAt(t, out float cw, out float zb, out float h);
            float y = fY(t);
            rings.Add(new List<Vector3> {
                new(0f, y, zb), new(cw, y, zb), new(0.92f * cw, y, zb + 0.45f * h), new(0.55f * cw, y, zb + 0.92f * h),
                new(0f, y, zb + h), new(-0.55f * cw, y, zb + 0.92f * h), new(-0.92f * cw, y, zb + 0.45f * h), new(-cw, y, zb) });
        }
        return new Voxels(Kit.mshLoft(rings, true));
    }

    // ---------------- motif primitives ----------------
    static void Petal(Lattice lat, Vector3 a, Vector3 b, float r)
    {
        Vector3 m = Vector3.Lerp(a, b, 0.55f);
        lat.AddBeam(a, r, m, r * 1.5f, true);
        lat.AddBeam(m, r * 1.5f, b, r, true);
    }
    static void Mandala(Lattice lat, Vector3 c, Vector3 n, Vector3 u, float R, float rb)
    {
        Vector3 v = Vector3.Normalize(Vector3.Cross(n, u));
        c += n * (0.3f * rb);
        lat.AddSphere(c, MathF.Max(0.26f * R, 1.2f * rb));
        for (int k = 0; k < 8; k++)
        {
            float a = k * MathF.PI / 4f;
            Vector3 d = u * MathF.Cos(a) + v * MathF.Sin(a);
            Petal(lat, c + d * 0.3f * R, c + d * 0.7f * R, rb);
        }
        int nB = Math.Max(8, (int)(2f * MathF.PI * 0.92f * R / (2.1f * rb)));
        for (int k = 0; k < nB; k++)
        {
            float a = (k + 0.5f) * 2f * MathF.PI / nB;
            lat.AddSphere(c + (u * MathF.Cos(a) + v * MathF.Sin(a)) * 0.92f * R, rb);
        }
    }
    static void StepTowerBoxes(Ctx ctx, List<Voxels> boxes, Vector3 vMinBase, Vector3 vMaxBase, int axisW, float[] aWidth, float tierH)
    {
        Vector3 c = (vMinBase + vMaxBase) * 0.5f;
        for (int k = 0; k < aWidth.Length; k++)
        {
            Vector3 lo = vMinBase, hi = vMaxBase;
            if (axisW == 0) { lo.X = c.X - aWidth[k] / 2f; hi.X = c.X + aWidth[k] / 2f; }
            else { lo.Y = c.Y - aWidth[k] / 2f; hi.Y = c.Y + aWidth[k] / 2f; }
            lo.Z = vMinBase.Z + k * tierH; hi.Z = vMinBase.Z + (k + 1) * tierH + 0.05f;
            boxes.Add(Kit.voxBox(ctx, lo, hi));
        }
    }

    // sill band: plinth rail, shikhara tower frieze, lotus buds, pearl string
    static void SillFrieze(Ctx ctx, List<Voxels> boxes, Lattice lat, float t0, float t1, float p, float relief, float rb)
    {
        float zBase = zBand + 2f * rb;
        float tierH = MathF.Max(1.3f, (zSill - zBand - 6f * rb) / 3f);
        float y0 = fY(t0), y1 = fY(t1);
        int n = Math.Max(1, (int)((y1 - y0) / p));
        float pp = (y1 - y0) / n;
        float[] aWid = { 0.77f * p, 0.55f * p, 0.32f * p };
        foreach (float sg in new[] { 1f, -1f })
        {
            Vector3 prev = Vector3.Zero; bool bHas = false;
            for (float y = y0; y <= y1 + 0.01f; y += 1.2f)
            {
                float w = fW(fT(y));
                var pt = new Vector3(sg * (w + relief - rb), y, zBand + rb);
                if (bHas) lat.AddBeam(prev, rb, pt, rb, true);
                prev = pt; bHas = true;
            }
            for (float y = y0; y <= y1; y += 2.1f * rb)
                lat.AddSphere(new Vector3(sg * (fW(fT(y)) + relief - rb), y, zSill - rb), rb);
            for (int i = 0; i < n; i++)
            {
                float y = y0 + (i + 0.5f) * pp;
                float w = fW(fT(y));
                float xa = sg > 0 ? w - 1.5f : -w - relief;
                float xb = sg > 0 ? w + relief : -w + 1.5f;
                StepTowerBoxes(ctx, boxes, new Vector3(xa, y - 0.5f, zBase), new Vector3(xb, y + 0.5f, zBase), 1, aWid, tierH);
                lat.AddSphere(new Vector3(sg * (w + relief - rb), y, zBase + 3f * tierH + 0.6f * rb), rb);
                if (i < n - 1)
                    lat.AddSphere(new Vector3(sg * (fW(fT(y + pp / 2f)) + relief - rb), y + pp / 2f, zBase + 1.2f * tierH), rb);
            }
        }
    }

    // door seams and shoulder crease: pearl strings on the e-f side face
    static void SeamPearls(Lattice lat, float tDoorA, float tDoorB, float rb)
    {
        foreach (float sg in new[] { 1f, -1f })
        {
            foreach (float tD in new[] { tDoorA, tDoorB })
            {
                var a = aHalf(tD); Vector2 e = a[4], f = a[5];
                Vector2 d = Vector2.Normalize(f - e); Vector2 nn = new Vector2(d.Y, -d.X);
                int m = Math.Max(2, (int)((f - e).Length() / (2.2f * rb)));
                for (int k = 0; k <= m; k++)
                {
                    Vector2 p = Vector2.Lerp(e, f, k / (float)m) + nn * 0.3f * rb;
                    lat.AddSphere(new Vector3(sg * p.X, fY(tD), p.Y), rb);
                }
            }
            for (float y = fY(tDoorA); y <= fY(tDoorB); y += 2.2f * rb)
            {
                var a = aHalf(fT(y));
                lat.AddSphere(new Vector3(sg * a[5].X, y, a[5].Y), rb);
            }
        }
    }

    // window border: rail + lotus petal frieze along the canopy crease
    static void WindowLotus(Lattice lat, float rb)
    {
        foreach (float sg in new[] { 1f, -1f })
        {
            Vector3 prev = Vector3.Zero; bool bHas = false;
            for (float y = fY(fCan0 + 0.03f); y < fY(fCan1 - 0.06f); y += 2.4f)
            {
                float t = fT(y);
                CanopyAt(t, out float cw, out float zb, out float h);
                Vector2 p = new(0.92f * cw, zb + 0.45f * h), q = new(0.55f * cw, zb + 0.92f * h);
                if (p.Y < fDeckZ(t, p.X) + 1.2f) { bHas = false; continue; }
                var bas = new Vector3(sg * p.X, y, p.Y);
                if (bHas) lat.AddBeam(prev, rb, bas, rb, true);
                prev = bas; bHas = true;
                Vector2 d = Vector2.Normalize(q - p);
                float len = MathF.Min(2.4f, (q - p).Length() * 0.5f);
                Petal(lat, bas, bas + new Vector3(sg * d.X, 0f, d.Y) * len, rb * 0.95f);
            }
        }
    }

    // ---------------- front: splitter with stepped kangura edge + pincers ----------------
    static Voxels voxSplitter(Ctx ctx, float proj, float p)
    {
        float wn = 0.95f * fW(0f);
        float yF = yN - proj;
        float d = 1.4f;
        int n = Math.Max(2, (int)(2f * wn / p));
        float pp = 2f * wn / n;
        var poly = new List<Vector2> { new(-wn, yN + 0.04f * L), new(-wn, yF) };
        for (int k = 0; k < n; k++)
        {
            float xc = -wn + (k + 0.5f) * pp, hb = 0.33f * pp, ht = 0.17f * pp;
            poly.Add(new(xc - hb, yF)); poly.Add(new(xc - hb, yF - d)); poly.Add(new(xc - ht, yF - d)); poly.Add(new(xc - ht, yF - 2f * d));
            poly.Add(new(xc + ht, yF - 2f * d)); poly.Add(new(xc + ht, yF - d)); poly.Add(new(xc + hb, yF - d)); poly.Add(new(xc + hb, yF));
        }
        poly.Add(new(wn, yF)); poly.Add(new(wn, yN + 0.04f * L));
        return Kit.voxExtrudeZ(ctx, poly, z0 - 1.0f, z0 + 0.6f);
    }
    static Vector2 Bez(Vector2 a, Vector2 b, Vector2 c, float u) => (1 - u) * (1 - u) * a + 2 * u * (1 - u) * b + u * u * c;
    static Voxels voxClaw(Ctx ctx, Lattice lat, float sg, float cl, float rb)
    {
        float wn = fW(0f); float yB = yN + 0.02f * L;
        Vector2 P0 = new(wn, yB), P1 = new(1.06f * wn, yN - 0.7f * cl), P2 = new(0.34f * wn, yN - cl);
        Vector2 Q0 = new(0.34f * wn, yN - cl + 1.8f), Q1 = new(0.66f * wn, yN - 0.45f * cl), Q2 = new(0.58f * wn, yB);
        var poly = new List<Vector2>();
        for (int i = 0; i <= 14; i++) poly.Add(Bez(P0, P1, P2, i / 14f));
        for (int i = 0; i <= 14; i++) poly.Add(Bez(Q0, Q1, Q2, i / 14f));
        for (int i = 2; i <= 10; i += 2)
        {
            Vector2 q = Bez(Q0, Q1, Q2, i / 14f);
            lat.AddSphere(new Vector3(sg * q.X, q.Y, z0 + 0.5f), rb * 1.1f);
        }
        if (sg > 0) poly.Reverse();
        else poly = poly.Select(v => new Vector2(-v.X, v.Y)).ToList();
        return Kit.voxExtrudeZ(ctx, poly, z0 - 1.5f, z0 + 2.5f);
    }

    // ---------------- rear: crest, chevrons, mandala lamps ----------------
    static void RearDetails(Ctx ctx, List<Voxels> boxes, Lattice lat, float p, float rb)
    {
        float yR = yN + L; float w1 = fW(1f);
        float tierH = 1.9f * rb, depth = 3.2f * rb;
        int n = Math.Max(2, (int)(1.2f * w1 / p));
        float pp = 1.2f * w1 / n;
        float[] aWid = { 0.77f * p, 0.55f * p, 0.32f * p };
        for (int i = 0; i < n; i++)
        {
            float x = -0.6f * w1 + (i + 0.5f) * pp;
            float zD = fDeckZ(1f, x) - 0.8f * rb;
            StepTowerBoxes(ctx, boxes, new Vector3(x - 0.5f, yR - depth, zD), new Vector3(x + 0.5f, yR, zD), 0, aWid, tierH);
            lat.AddSphere(new Vector3(x, yR - depth / 2f, zD + 3f * tierH + 0.6f * rb), rb);
        }
        for (int row = 0; row < 2; row++)
        {
            float zLo = zBand + 1.2f + row * 2.6f, zHi = zLo + 2.2f;
            int m = Math.Max(4, (int)(1.6f * w1 / 3.0f));
            Vector3 prev = Vector3.Zero;
            for (int k = 0; k <= m; k++)
            {
                var pt = new Vector3(-0.8f * w1 + k * 1.6f * w1 / m, yR + 0.3f * rb, (k % 2 == 0) ? zLo : zHi);
                if (k > 0) lat.AddBeam(prev, rb, pt, rb, true);
                prev = pt;
            }
        }
        float zL = zSill + 0.45f * (fZt(1f) - zSill);
        foreach (float sg in new[] { 1f, -1f })
            Mandala(lat, new Vector3(sg * 0.55f * w1, yR, zL), Vector3.UnitY, Vector3.UnitX, 4.5f, rb);
    }

    // ---------------- wheels with lotus spokes ----------------
    static Voxels voxWheel(Ctx ctx, Lattice lat, float sg, float xIn, float xOut, float y, float R, float rb)
    {
        Vector3 vN = new(sg, 0, 0), vU = Vector3.UnitY, vV = Vector3.UnitZ;
        Vector3 cIn = new(sg * xIn, y, R), cOut = new(sg * xOut, y, R);
        float fRec = 2f * rb;
        Voxels w = Kit.voxCylinder(ctx, cIn, cOut, R);
        Vector3 cFloor = cOut - vN * fRec;
        w.BoolSubtract(Kit.voxCylinder(ctx, cFloor, cOut + vN * 1f, 0.76f * R));
        w.BoolAdd(Kit.voxCylinder(ctx, cFloor - vN * 0.5f, cOut, 0.17f * R));
        Vector3 cP = cFloor + vN * (0.6f * rb);
        for (int k = 0; k < 8; k++)
        {
            float a = k * MathF.PI / 4f;
            Vector3 d = vU * MathF.Cos(a) + vV * MathF.Sin(a);
            Petal(lat, cP + d * 0.17f * R, cP + d * 0.72f * R, rb);
            float a2 = a + MathF.PI / 8f;
            Vector3 d2 = vU * MathF.Cos(a2) + vV * MathF.Sin(a2);
            Petal(lat, cP + d2 * 0.17f * R, cP + d2 * 0.46f * R, rb * 0.95f);
        }
        for (int k = 0; k < 24; k++)
        {
            float a = k * MathF.PI / 12f;
            lat.AddSphere(cOut + (vU * MathF.Cos(a) + vV * MathF.Sin(a)) * 0.88f * R, rb);
        }
        return w;
    }

    // ---------------- scorpion tail, wing, temple endplates ----------------
    static Vector3 CR(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float u)
    {
        float u2 = u * u, u3 = u2 * u;
        return 0.5f * ((2f * p1) + (-p0 + p2) * u + (2f * p0 - 5f * p1 + 4f * p2 - p3) * u2 + (-p0 + 3f * p1 - 3f * p2 + p3) * u3);
    }
    static void Tail(Lattice lat, float Hs, float r0)
    {
        // (fraction of length from nose, fraction of sting height)
        float[,] aK = { { 0.872f, 0.47f }, { 0.947f, 0.56f }, { 0.99f, 0.72f }, { 0.985f, 0.88f }, { 0.95f, 0.975f }, { 0.912f, 0.955f } };
        int nK = aK.GetLength(0);
        var P = new List<Vector3>();
        for (int i = 0; i < nK; i++) P.Add(new Vector3(0f, yN + aK[i, 0] * L, aK[i, 1] * Hs));
        var S = new List<Vector3>();
        for (int i = 0; i < nK - 1; i++)
        {
            Vector3 p0 = P[Math.Max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.Min(nK - 1, i + 2)];
            for (int j = 0; j < 16; j++) S.Add(CR(p0, p1, p2, p3, j / 16f));
        }
        S.Add(P[nK - 1]);
        float fTot = 0f;
        for (int i = 1; i < S.Count; i++) fTot += (S[i] - S[i - 1]).Length();
        float fAcc = 0f, fLast = -1e9f;
        for (int i = 0; i < S.Count; i++)
        {
            if (i > 0) fAcc += (S[i] - S[i - 1]).Length();
            float r = Lerp(r0, 0.5f * r0, fAcc / fTot);
            if (i > 0) lat.AddBeam(S[i - 1], 0.55f * r, S[i], 0.55f * r, true);
            if (fAcc - fLast >= 1.3f * r) { lat.AddSphere(S[i], r); fLast = fAcc; }
        }
        Vector3 F = P[nK - 1];
        Vector3 G = new Vector3(0f, yN + 0.885f * L, 0.87f * Hs);
        lat.AddSphere(F, 0.62f * r0);
        lat.AddBeam(F, 0.45f * r0, G, 0.7f, true);
    }
    static float Ht(float u, float hMax, float hTE) => hTE + (hMax - hTE) * MathF.Sqrt(u) * (1f - u) / 0.385f;
    static Voxels voxWing(Ctx ctx, List<Voxels> boxes, Lattice lat, float c, float span, float zW, float yLE, float aoaDeg, float rb)
    {
        float th = aoaDeg * MathF.PI / 180f, cs = MathF.Cos(th), sn = MathF.Sin(th);
        float hMax = 0.06f * c, hTE = MathF.Max(0.75f, 0.02f * c);
        int n = 16;
        var sec = new List<Vector2>();
        for (int i = n; i >= 0; i--) { float u = 0.5f * (1f - MathF.Cos(MathF.PI * i / n)); sec.Add(new(u * c, -0.16f * c * u * (1f - u) + Ht(u, hMax, hTE))); }
        for (int i = 0; i <= n; i++) { float u = 0.5f * (1f - MathF.Cos(MathF.PI * i / n)); sec.Add(new(u * c, -0.16f * c * u * (1f - u) - Ht(u, hMax, hTE))); }
        var rings = new List<IReadOnlyList<Vector3>>();
        foreach (float x in new[] { -span / 2f, span / 2f })
            rings.Add(sec.Select(p => new Vector3(x, yLE + p.X * cs - p.Y * sn, zW + (p.X - 0.5f * c) * sn + p.Y * cs)).ToList());
        Voxels wing = new Voxels(Kit.mshLoft(rings, true));
        float yC = yLE + 0.5f * c * cs;
        float tierH = 0.117f * c;
        float[] aLen = { c + 4f, 0.8f * (c + 4f), 0.6f * (c + 4f), 0.4f * (c + 4f) };
        foreach (float sg in new[] { 1f, -1f })
        {
            float xa = sg > 0 ? span / 2f - 0.4f : -span / 2f - 1.4f;
            float xb = sg > 0 ? span / 2f + 1.4f : -span / 2f + 0.4f;
            float zb = zW - 2.1f * tierH;
            StepTowerBoxes(ctx, boxes, new Vector3(xa, yC - 1f, zb), new Vector3(xb, yC + 1f, zb), 1, aLen, tierH);
            lat.AddSphere(new Vector3(0.5f * (xa + xb), yC, zb + 4f * tierH + 0.7f), 1.0f);
        }
        return wing;
    }

    // ---------------- build ----------------
    public static Voxels voxBuild(Ctx ctx)
    {
        s = ctx.P("scale");
        float k = 1000f * s; // metres -> model mm
        L = ctx.P("length_full_m") * k;
        W2 = 0.5f * ctx.P("width_full_m") * k;
        H = ctx.P("height_full_m") * k;
        z0 = ctx.P("ground_clearance_full") * s;
        float fClaw = ctx.P("claw_length_full") * s;
        float fChord = ctx.P("wing_chord_full_m") * k;
        yN = -(L + 0.25f * fChord + fClaw) * 0.5f + fClaw;

        float fWall = ctx.P("wall");
        float fRelief = ctx.P("motif_relief");
        float rb = ctx.P("bead_radius");
        float fPitch = ctx.P("motif_pitch");
        float tF = ctx.P("front_overhang_full_m") / ctx.P("length_full_m");
        float tR = (ctx.P("front_overhang_full_m") + ctx.P("wheelbase_full_m")) / ctx.P("length_full_m");
        float RF = 0.5f * ctx.P("wheel_dia_front_full_m") * k, RR = 0.5f * ctx.P("wheel_dia_rear_full_m") * k;
        float twF = ctx.P("tire_width_front_full") * s, twR = ctx.P("tire_width_rear_full") * s;
        float fInset = ctx.P("wheel_inset_full") * s, fGap = ctx.P("arch_gap_full") * s;

        ctx.Log("1/6 hull loft + cab-forward teardrop canopy");
        Voxels body = voxHull(ctx);
        body.BoolAdd(voxCanopy(ctx));
        ctx.Progress(0.15f);

        ctx.Log("2/6 wheel arches, hollow shell, open floor");
        var axles = new[] { (tF, RF, twF), (tR, RR, twR) };
        var arches = new List<Voxels>();
        foreach (var (tA, R, tw) in axles)
        {
            float y = fY(tA), w = fW(tA), xOut = w - fInset, xIn = xOut - tw;
            foreach (float sg in new[] { 1f, -1f })
                arches.Add(Kit.voxCylinder(ctx, new Vector3(sg * (xIn - 1.5f * fGap), y, R), new Vector3(sg * (w + 5f), y, R), R + fGap));
        }
        body.BoolSubtractAll(arches);
        Voxels inner = body.voxOffset(-fWall);
        body.BoolSubtract(inner);
        body.BoolSubtract(Kit.voxBox(ctx, new Vector3(-0.7f * W2, yN + 0.06f * L, z0 - 1f), new Vector3(0.7f * W2, yN + 0.94f * L, z0 + fWall + 0.5f)));
        ctx.Progress(0.4f);

        var parts = new List<Voxels>();
        var boxes = new List<Voxels>();
        var lat = new Lattice();

        ctx.Log("3/6 splitter (kangura edge) + scorpion pincers");
        parts.Add(voxSplitter(ctx, ctx.P("splitter_full") * s, 1.1f * fPitch));
        parts.Add(voxClaw(ctx, lat, 1f, fClaw, rb));
        parts.Add(voxClaw(ctx, lat, -1f, fClaw, rb));
        float zNose = 0.5f * (z0 + fZt(0f)) + 1.5f;
        foreach (float x in new[] { 0f, -0.55f * fW(0f), 0.55f * fW(0f) })
            Mandala(lat, new Vector3(x, yN, zNose), -Vector3.UnitY, Vector3.UnitX, 3.4f, rb);

        ctx.Log("4/6 temple friezes: shikhara sills, pearl seams, lotus window line, mandalas");
        SillFrieze(ctx, boxes, lat, tF + 0.1f, tR - 0.1f, fPitch, fRelief, rb);
        SeamPearls(lat, 0.34f, 0.60f, rb);
        WindowLotus(lat, rb);
        {
            float tM = 0.5f * (0.60f + tR - 0.1f);
            var a = aHalf(tM); Vector2 e = a[4], f = a[5];
            Vector2 d = Vector2.Normalize(f - e); Vector2 c2 = Vector2.Lerp(e, f, 0.45f);
            foreach (float sg in new[] { 1f, -1f })
                Mandala(lat, new Vector3(sg * c2.X, fY(tM), c2.Y), Vector3.Normalize(new Vector3(sg * d.Y, 0f, -d.X)), Vector3.UnitY, 4.5f, rb);
        }
        RearDetails(ctx, boxes, lat, fPitch, rb);
        ctx.Progress(0.55f);

        ctx.Log("5/6 lotus-spoke wheels + axles");
        foreach (var (tA, R, tw) in axles)
        {
            float y = fY(tA), w = fW(tA), xOut = w - fInset, xIn = xOut - tw;
            foreach (float sg in new[] { 1f, -1f }) parts.Add(voxWheel(ctx, lat, sg, xIn, xOut, y, R, rb));
            float xc = 0.5f * (xIn + xOut);
            parts.Add(Kit.voxCylinder(ctx, new Vector3(-xc, y, R), new Vector3(xc, y, R), ctx.P("axle_radius")));
        }
        ctx.Progress(0.7f);

        ctx.Log("6/6 scorpion tail, wing, gopuram endplates");
        Tail(lat, ctx.P("sting_height_full_m") * k, ctx.P("sting_radius_full") * s);
        parts.Add(voxWing(ctx, boxes, lat, fChord, ctx.P("wing_span_full_m") * k, ctx.P("wing_height_full_m") * k,
            yN + L - 0.75f * fChord, ctx.P("wing_aoa"), rb));

        parts.AddRange(boxes);
        parts.Add(new Voxels(lat));
        body.BoolAddAll(parts);
        ctx.Log($"done: {boxes.Count} frieze boxes, L={L:F1} W={2 * W2:F1} H={H:F1} mm (model)");
        ctx.Progress(1f);
        return body;
    }
}