using System;
using System.Numerics;
using System.Collections.Generic;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    static float S, ZC, SA, CA;
    static Ctx C;
    static readonly Vector3 X = new Vector3(1, 0, 0);
    static readonly Vector3 Y = new Vector3(0, 1, 0);
    static readonly Vector3 Z = new Vector3(0, 0, 1);

    // ---------- oriented rounded box as an implicit ----------
    private sealed class OBox : IImplicit
    {
        readonly Vector3 m_c, m_u, m_v, m_w, m_h; readonly float m_r;
        public OBox(Vector3 c, Vector3 u, Vector3 v, Vector3 w, Vector3 h, float r)
        { m_c = c; m_u = u; m_v = v; m_w = w; m_h = h; m_r = r; }
        public float fSignedDistance(in Vector3 p)
        {
            Vector3 d = p - m_c;
            Vector3 q = new Vector3(MathF.Abs(Vector3.Dot(d, m_u)), MathF.Abs(Vector3.Dot(d, m_v)), MathF.Abs(Vector3.Dot(d, m_w))) - (m_h - new Vector3(m_r));
            Vector3 qp = Vector3.Max(q, Vector3.Zero);
            return qp.Length() + MathF.Min(MathF.Max(q.X, MathF.Max(q.Y, q.Z)), 0f) - m_r;
        }
        public BBox3 Bounds(float fGrow)
        {
            var b = new BBox3();
            for (int i = 0; i < 8; i++)
            {
                Vector3 p = m_c + m_u * m_h.X * ((i & 1) == 0 ? -1f : 1f)
                                + m_v * m_h.Y * (((i >> 1) & 1) == 0 ? -1f : 1f)
                                + m_w * m_h.Z * (((i >> 2) & 1) == 0 ? -1f : 1f);
                b.Include(p);
            }
            b.Grow(fGrow);
            return b;
        }
    }

    // ---------- full-size helpers (scaled at the primitive) ----------
    static Voxels OB(Vector3 c, Vector3 u, Vector3 v, Vector3 w, Vector3 h, float r)
    {
        var o = new OBox(c * S, u, v, w, h * S, r * S);
        return Kit.voxFromImplicit(C, o, o.Bounds(3f * C.fVoxelMM));
    }
    static Voxels OBa(Vector3 c, Vector3 h, float r) => OB(c, X, Y, Z, h, r);
    static Voxels BoxMM(Vector3 a, Vector3 b)
        => Kit.voxBox(C, Vector3.Min(a, b) * S, Vector3.Max(a, b) * S);
    static Voxels Cyl(Vector3 a, Vector3 b, float r) => Kit.voxCylinder(C, a * S, b * S, r * S);
    static Voxels Cone(Vector3 a, Vector3 b, float ra, float rb) => Kit.voxCone(C, a * S, b * S, ra * S, rb * S);
    static Voxels Sweep(List<Vector3> pts, float r)
    {
        var l = new List<Vector3>();
        foreach (var p in pts) l.Add(p * S);
        return Kit.voxSweepCircle(C, l, r * S);
    }

    // bank frame: r along the cylinder axis, l across the bank (positive = outboard), x along the crank
    static Vector3 BP(int s, float r, float l, float x)
        => new Vector3(x, s * (r * SA + l * CA), ZC + r * CA - l * SA);
    static Vector3 Dax(int s) => new Vector3(0, s * SA, CA);
    static Vector3 Nax(int s) => new Vector3(0, s * CA, -SA);

    static List<Vector3> Smooth(List<Vector3> p, int n)
    {
        var o = new List<Vector3>();
        for (int i = 0; i < p.Count - 1; i++)
        {
            Vector3 p0 = p[Math.Max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.Min(i + 2, p.Count - 1)];
            for (int k = 0; k < n; k++)
            {
                float t = k / (float)n, t2 = t * t, t3 = t2 * t;
                o.Add(0.5f * (2f * p1 + (p2 - p0) * t + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 + (3f * p1 - p0 - 3f * p2 + p3) * t3));
            }
        }
        o.Add(p[p.Count - 1]);
        return o;
    }
    static List<Vector3> Extend(List<Vector3> p, float e0, float e1)
    {
        var o = new List<Vector3>(p);
        Vector3 d0 = Vector3.Normalize(p[0] - p[1]);
        Vector3 d1 = Vector3.Normalize(p[p.Count - 1] - p[p.Count - 2]);
        o.Insert(0, p[0] + d0 * e0);
        o.Add(p[p.Count - 1] + d1 * e1);
        return o;
    }
    // hollow pipe: outer added, bore cut at the end. The sweep has round end caps,
    // so an OPEN end needs the bore pushed past the outer cap (rOut + 3 mm).
    static void Pipe(List<Voxels> adds, List<Voxels> cuts, List<Vector3> pts, float rOut, float wall,
                     bool bOpenStart = false, bool bOpenEnd = false)
    {
        var sm = Smooth(pts, 8);
        adds.Add(Sweep(sm, rOut));
        cuts.Add(Sweep(Extend(sm, bOpenStart ? rOut + 3f : 4f, bOpenEnd ? rOut + 3f : 4f), rOut - wall));
    }

    public static Voxels voxBuild(Ctx ctx)
    {
        C = ctx;
        S = ctx.P("scale");
        ZC = ctx.P("crank_height");
        float fHalf = ctx.P("bank_angle") * 0.5f * MathF.PI / 180f;
        SA = MathF.Sin(fHalf); CA = MathF.Cos(fHalf);

        var adds = new List<Voxels>();
        var cuts = new List<Voxels>();

        ctx.Log("bottom end: sump, crankcase, bellhousing");
        BottomEnd(ctx, adds);
        ctx.Progress(0.1f);
        foreach (int s in new[] { -1, 1 })
        {
            ctx.Log($"bank {s}: block, jacket, head, covers");
            Bank(ctx, s, adds, cuts);
            ctx.Log($"bank {s}: 4-into-1 headers");
            Exhaust(ctx, s, adds, cuts);
            ctx.Log($"bank {s}: intake runners");
            Runners(ctx, s, adds, cuts);
            ctx.Progress(s < 0 ? 0.3f : 0.5f);
        }
        ctx.Log("plenum + air-to-water intercooler");
        Intercooler(ctx, adds, cuts);
        ctx.Log("twin tandem roots blowers");
        Blowers(ctx, adds, cuts);
        ctx.Log("front drive + coolant plumbing");
        FrontAndCoolant(ctx, adds, cuts);
        ctx.Progress(0.7f);

        ctx.Log($"union {adds.Count} bodies, cut {cuts.Count} voids");
        Voxels vox = adds[0];
        vox.BoolAddAll(adds.GetRange(1, adds.Count - 1));
        ctx.Progress(0.85f);
        vox.BoolSubtractAll(cuts);
        ctx.Progress(1f);
        return vox;
    }

    static void BottomEnd(Ctx ctx, List<Voxels> adds)
    {
        float bl = ctx.P("block_half_length");
        float finT = ctx.P("fin_thickness"), finH = ctx.P("fin_height");
        float zs = ZC - 90f;
        adds.Add(OBa(new Vector3(0, 0, zs / 2f), new Vector3(bl - 10f, 120f, zs / 2f), 12f));          // sump
        adds.Add(OBa(new Vector3(0, 0, ZC - 30f), new Vector3(bl + 10f, 150f, 70f), 15f));             // crankcase
        foreach (int s in new[] { -1, 1 })                                                            // sump oil fins
            for (float z = 25f; z <= zs - 25f; z += 25f)
                adds.Add(BoxMM(new Vector3(-(bl - 30f), s * 116f, z - finT / 2f), new Vector3(bl - 30f, s * (120f + finH * 0.85f), z + finT / 2f)));
        adds.Add(Cyl(new Vector3(bl + 8f, 0, ZC), new Vector3(bl + 24f, 0, ZC), 200f));                // bellhousing flange
    }

    static void Bank(Ctx ctx, int s, List<Voxels> adds, List<Voxels> cuts)
    {
        float bl = ctx.P("block_half_length"), st = ctx.P("bank_stagger"), bs = ctx.P("bore_spacing");
        float deck = ctx.P("deck_height"), hh = ctx.P("head_height"), hw = ctx.P("head_half_width"), bw = ctx.P("block_half_width");
        float rb = ctx.P("bore") / 2f, rl = rb + ctx.P("liner_wall"), gap = ctx.P("jacket_gap"), rj = rl + gap;
        float finT = ctx.P("fin_thickness"), finH = ctx.P("fin_height"), pitch = ctx.P("fin_pitch");
        float xo = s * st / 2f;
        Vector3 d = Dax(s), n = Nax(s);
        float rJ0 = deck - ctx.P("stroke") - 33f, rJ1 = deck - 10f;
        float rc = deck + 35f, lc = rl + gap / 2f, rhc = ctx.P("head_channel_d") / 2f;

        // block bank + external air fins on the outboard face
        adds.Add(OB(BP(s, (60f + deck) / 2f, 0, xo), X, d, n, new Vector3(bl, (deck - 60f) / 2f, bw), 8f));
        int nF = (int)((2f * bl - 40f) / pitch) + 1;
        float fx0 = -(nF - 1) * pitch / 2f;
        for (int i = 0; i < nF; i++)
            adds.Add(OB(BP(s, 150f, bw + finH / 2f - 2f, xo + fx0 + i * pitch), X, d, n, new Vector3(finT / 2f, 65f, finH / 2f + 2f), 0f));

        // head, cam cover, cover fins, coil packs
        adds.Add(OB(BP(s, deck + hh / 2f, 0, xo), X, d, n, new Vector3(bl + 5f, hh / 2f, hw), 10f));
        adds.Add(OB(BP(s, deck + hh + 23f, 0, xo), X, d, n, new Vector3(bl - 10f, 25f, hw - 15f), 12f));
        foreach (float l in new[] { -65f, -40f, -15f, 10f })
            adds.Add(OB(BP(s, deck + hh + 56f, l, xo), X, d, n, new Vector3(bl - 30f, 10f, finT / 2f), 0f));
        for (int i = 0; i < 4; i++)
        {
            float xi = xo + (i - 1.5f) * bs;
            adds.Add(Cyl(BP(s, deck + hh + 40f, 50f, xi), BP(s, deck + hh + 75f, 50f, xi), 14f));
        }

        // ---- coolant voids ----
        Voxels jacket = OB(BP(s, (rJ0 + rJ1) / 2f, 0, xo), X, d, n, new Vector3(1.5f * bs + rl + 25f, (rJ1 - rJ0) / 2f, rj), 5f);
        var liners = new List<Voxels>();
        for (int i = 0; i < 4; i++)
        {
            float xi = xo + (i - 1.5f) * bs;
            liners.Add(Cyl(BP(s, rJ0 - 10f, 0, xi), BP(s, rJ1 + 10f, 0, xi), rl));
        }
        jacket.BoolSubtractAll(liners);
        cuts.Add(jacket);
        float rMid = (rJ0 + rJ1) / 2f;
        cuts.Add(Cyl(BP(s, rMid, 0, xo - bl - 15f), BP(s, rMid, 0, xo - (1.5f * bs + rl + 15f)), ctx.P("coolant_port_d") / 2f)); // bank inlet port
        float rt = ctx.P("transfer_d") / 2f;
        for (int i = 0; i < 4; i++)
        {
            float xi = xo + (i - 1.5f) * bs;
            foreach (float l in new[] { -lc, lc })
                cuts.Add(Cyl(BP(s, rJ1 - 10f, l, xi), BP(s, rc + 5f, l, xi), rt));                   // deck transfer holes
        }
        foreach (float l in new[] { -lc, lc })
            cuts.Add(Cyl(BP(s, rc, l, xo - bl + 10f), BP(s, rc, l, xo + bl - 10f), rhc));            // head galleries
        cuts.Add(Cyl(BP(s, rc, -lc, xo + bl - 20f), BP(s, rc, lc, xo + bl - 20f), rhc));              // rear cross gallery
        cuts.Add(Cyl(BP(s, rc, 0, xo + bl - 30f), BP(s, rc, 0, xo + bl + 2f), ctx.P("hose_od") / 2f - ctx.P("pipe_wall"))); // outlet bore
    }

    static void Exhaust(Ctx ctx, int s, List<Voxels> adds, List<Voxels> cuts)
    {
        float bl = ctx.P("block_half_length"), st = ctx.P("bank_stagger"), bs = ctx.P("bore_spacing");
        float deck = ctx.P("deck_height"), hh = ctx.P("head_height"), hw = ctx.P("head_half_width");
        float ro = ctx.P("header_od") / 2f, wall = ctx.P("pipe_wall"), rcol = ctx.P("collector_od") / 2f;
        float xo = s * st / 2f, xc = xo + bl * 0.48f, rp = deck + hh * 0.65f;
        float[] dr = { 12f, -12f, 12f, -12f }, dx = { -12f, -12f, 12f, 12f };
        for (int i = 0; i < 4; i++)
        {
            float xi = xo + (i - 1.5f) * bs;
            Func<float, float> lx = t => xi + (xc - xi) * t;
            var pts = new List<Vector3> {
                BP(s, rp, hw - 7f, xi), BP(s, rp, hw + 40f, xi), BP(s, rp - 35f, hw + 90f, xi),
                BP(s, 210f, hw + 120f, lx(0.25f)), BP(s, 130f, hw + 133f, lx(0.6f)),
                BP(s, 75f + dr[i] * 0.5f, hw + 137f, lx(0.9f)), BP(s, 55f + dr[i], hw + 137f, xc + dx[i]) };
            Pipe(adds, cuts, pts, ro, wall);
        }
        var col = new List<Vector3> {
            BP(s, 70f, hw + 137f, xc - 25f), BP(s, 50f, hw + 137f, xc + 5f),
            new Vector3(xc + 60f, s * 212f, 75f), new Vector3(xc + 110f, s * 214f, 58f), new Vector3(xc + 150f, s * 214f, 55f) };
        Pipe(adds, cuts, col, rcol, wall, false, true);                                                // open tail pipe
    }

    static void Runners(Ctx ctx, int s, List<Voxels> adds, List<Voxels> cuts)
    {
        float st = ctx.P("bank_stagger"), bs = ctx.P("bore_spacing");
        float deck = ctx.P("deck_height"), hh = ctx.P("head_height"), hw = ctx.P("head_half_width");
        float xo = s * st / 2f, rp = deck + hh * 0.65f;
        for (int i = 0; i < 4; i++)
        {
            float xi = xo + (i - 1.5f) * bs;
            var pts = new List<Vector3> {
                new Vector3(xi, s * 60f, ZC + 340f), new Vector3(xi, s * 110f, ZC + 356f),
                new Vector3(xi, s * 150f, ZC + 336f), new Vector3(xi, s * 162f, ZC + 310f),
                BP(s, rp, -(hw - 12f), xi) };
            Pipe(adds, cuts, pts, ctx.P("runner_od") / 2f, ctx.P("pipe_wall"));
        }
    }

    static void Intercooler(Ctx ctx, List<Voxels> adds, List<Voxels> cuts)
    {
        float bl = ctx.P("block_half_length"), icH = ctx.P("ic_height"), finT = ctx.P("fin_thickness"), wall = ctx.P("pipe_wall");
        adds.Add(OBa(new Vector3(0, 0, ZC + 335f), new Vector3(bl - 20f, 105f, 45f), 12f));           // plenum
        cuts.Add(OBa(new Vector3(0, 0, ZC + 335f), new Vector3(bl - 27f, 98f, 38f), 6f));             // plenum volume
        float z0 = ZC + 380f;
        adds.Add(OBa(new Vector3(0, 0, z0 + icH / 2f - 2f), new Vector3(bl - 30f, 110f, icH / 2f + 2f), 6f)); // IC core
        for (float xk = -(bl - 45f); xk <= bl - 45f; xk += 2f * finT)                                  // fin-stack grooves
            foreach (int s in new[] { -1, 1 })
                cuts.Add(BoxMM(new Vector3(xk - finT / 2f, s * 98f, z0 + 8f), new Vector3(xk + finT / 2f, s * 113f, z0 + icH - 8f)));
        float zw = z0 + 20f;
        foreach (int s in new[] { -1, 1 })
            cuts.Add(Cyl(new Vector3(-(bl - 45f), s * 70f, zw), new Vector3(bl - 45f, s * 70f, zw), 10f)); // water galleries
        foreach (float xk in new[] { -200f, -80f, 80f, 200f })
            cuts.Add(Cyl(new Vector3(xk, -70f, zw), new Vector3(xk, 70f, zw), 7f));                    // water cross tubes
        foreach (int s in new[] { -1, 1 })
        {
            var p = new List<Vector3> {
                new Vector3(-(bl - 50f), s * 70f, zw), new Vector3(-(bl + 10f), s * 70f, zw),
                new Vector3(-(bl + 28f), s * 100f, zw - 12f), new Vector3(-(bl + 30f), s * 165f, zw - 12f) };
            Pipe(adds, cuts, p, 16f, wall, false, true);                                               // IC water in/out
        }
    }

    static void Blowers(Ctx ctx, List<Voxels> adds, List<Voxels> cuts)
    {
        float icH = ctx.P("ic_height"), Rb = ctx.P("blower_lobe_r"), L = ctx.P("blower_length");
        float z0 = ZC + 380f, zb = z0 + icH + 50f;
        foreach (float xcB in new[] { -(L / 2f + 20f), L / 2f + 20f })
        {
            float xa = xcB - L / 2f, xb = xcB + L / 2f;
            foreach (float y in new[] { -45f, 45f })
            {
                adds.Add(Cyl(new Vector3(xa, y, zb), new Vector3(xb, y, zb), Rb));
                foreach (float xr in new[] { xcB - L / 4f, xcB, xcB + L / 4f })
                    adds.Add(Cyl(new Vector3(xr - 4f, y, zb), new Vector3(xr + 4f, y, zb), Rb + 4f)); // housing ribs
            }
            adds.Add(BoxMM(new Vector3(xa, -45f, zb - 40f), new Vector3(xb, 45f, zb + 40f)));
            adds.Add(BoxMM(new Vector3(xa - 10f, -95f, z0 + icH - 4f), new Vector3(xb + 10f, 95f, zb - 30f))); // base flange
            foreach (float xe in new[] { xa - 6f, xb + 6f })
                adds.Add(OBa(new Vector3(xe, 0, zb), new Vector3(6f, 115f, 70f), 5f));                // end plates
            adds.Add(OBa(new Vector3(xcB, 0, zb + 55f), new Vector3(70f, 62f, 18f), 8f));            // hat adapter
            adds.Add(Cyl(new Vector3(xcB, 0, zb + 60f), new Vector3(xcB, 0, zb + 100f), 55f));         // throat
            adds.Add(Cone(new Vector3(xcB, 0, zb + 100f), new Vector3(xcB, 0, zb + 135f), 55f, 78f));  // bellmouth
            cuts.Add(Cyl(new Vector3(xcB, 0, zb + 30f), new Vector3(xcB, 0, zb + 101f), 47f));
            cuts.Add(Cone(new Vector3(xcB, 0, zb + 100f), new Vector3(xcB, 0, zb + 137f), 47f, 71f));
            // charge-air path: blower -> intercooler core -> plenum
            cuts.Add(Cyl(new Vector3(xcB, 0, ZC + 365f), new Vector3(xcB, 0, zb + 31f), 30f));
        }
    }

    static void FrontAndCoolant(Ctx ctx, List<Voxels> adds, List<Voxels> cuts)
    {
        float bl = ctx.P("block_half_length"), st = ctx.P("bank_stagger"), icH = ctx.P("ic_height");
        float deck = ctx.P("deck_height"), wall = ctx.P("pipe_wall"), rh = ctx.P("hose_od") / 2f;
        float zb = ZC + 380f + icH + 50f;
        float rMid = (deck - ctx.P("stroke") - 33f + deck - 10f) / 2f, rc = deck + 35f;

        // belt drive: crank snout + pulley, blower snout + pulley, two belt runs
        adds.Add(Cyl(new Vector3(-(bl + 5f), 0, ZC), new Vector3(-355f, 0, ZC), 28f));
        adds.Add(Cyl(new Vector3(-355f, 0, ZC), new Vector3(-375f, 0, ZC), 85f));
        adds.Add(Cyl(new Vector3(-280f, 0, zb), new Vector3(-355f, 0, zb), 24f));
        adds.Add(Cyl(new Vector3(-355f, 0, zb), new Vector3(-375f, 0, zb), 60f));
        foreach (int s in new[] { -1, 1 })
            adds.Add(Kit.voxCapsule(C, new Vector3(-365f, s * 85f, ZC) * S, new Vector3(-365f, s * 60f, zb) * S, 8f * S));

        // water pump with volute, radiator-return inlet nub, hoses to both bank inlet ports
        adds.Add(Cyl(new Vector3(-(bl + 10f), 0, ZC + 90f), new Vector3(-(bl + 35f), 0, ZC + 90f), 50f));
        cuts.Add(Cyl(new Vector3(-(bl + 8f), 0, ZC + 90f), new Vector3(-(bl + 28f), 0, ZC + 90f), 36f));
        Pipe(adds, cuts, new List<Vector3> {
            new Vector3(-(bl + 30f), 0, ZC + 75f), new Vector3(-(bl + 30f), -55f, ZC + 38f), new Vector3(-(bl + 30f), -170f, ZC + 38f) }, 18f, wall, false, true);
        foreach (int s in new[] { -1, 1 })
        {
            float xo = s * st / 2f;
            Vector3 port = BP(s, rMid, 0, xo - bl + 3f);
            Pipe(adds, cuts, new List<Vector3> {
                new Vector3(-(bl + 22f), 0, ZC + 90f), new Vector3(-(bl + 26f), s * 60f, ZC + 102f),
                new Vector3(-(bl + 26f), port.Y, port.Z), port }, rh, wall);

            // head outlet -> rear crossover
            Pipe(adds, cuts, new List<Vector3> {
                BP(s, rc, 0, xo + bl - 5f), BP(s, rc, 0, xo + bl + 25f),
                new Vector3(bl + 40f, s * 120f, ZC + 300f), new Vector3(bl + 40f, s * 40f, ZC + 330f), new Vector3(bl + 40f, 0, ZC + 332f) }, rh * 0.8f, wall);
        }
        // thermostat housing + outlet neck to the radiator
        adds.Add(Kit.voxSphere(C, new Vector3(bl + 40f, 0, ZC + 332f) * S, 38f * S));
        cuts.Add(Kit.voxSphere(C, new Vector3(bl + 40f, 0, ZC + 332f) * S, 31f * S));
        Pipe(adds, cuts, new List<Vector3> {
            new Vector3(bl + 40f, 0, ZC + 340f), new Vector3(bl + 40f, 0, ZC + 380f), new Vector3(bl + 60f, 0, ZC + 405f) }, 22f, wall, false, true);
    }
}
