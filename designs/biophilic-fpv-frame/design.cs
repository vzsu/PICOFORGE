using System;
using System.Numerics;
using System.Collections.Generic;
using System.Linq;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    public static Voxels voxBuild(Ctx ctx)
    {
        float fT = ctx.P("plate_thickness");
        float fR = ctx.P("motor_radius");
        float fHoleSp = ctx.P("motor_hole_spacing");
        float fMHoleR = ctx.P("motor_hole_d") / 2f;
        float fCHoleR = ctx.P("motor_center_hole_d") / 2f;
        float fPadR = ctx.P("pad_r");
        float fLobeR = ctx.P("pad_lobe_r");
        float fStack = ctx.P("stack_spacing");
        float fSHoleR = ctx.P("stack_hole_d") / 2f;
        float fBx = ctx.P("body_lobe_x");
        float fBy = ctx.P("body_lobe_y");
        float fBr = ctx.P("body_lobe_r");
        float fMidRoot = ctx.P("midrib_root_w") / 2f;
        float fMidTip = ctx.P("midrib_tip_w") / 2f;
        float fMarRoot = ctx.P("margin_root_w") / 2f;
        float fMarTip = ctx.P("margin_tip_w") / 2f;
        float fLeafW = ctx.P("leaf_half_width");
        float fVeinR = ctx.P("vein_w") / 2f;
        float fFillet = ctx.P("fillet_r");

        // Build the outline as a tall prism, fillet it, then trim to the plate:
        // every Z-slice is then the same 2D outline (CNC-cuttable flat plate).
        float fOver = fFillet + 1f;
        float fZ0 = -fOver;
        float fZ1 = fT + fOver;

        var parts = new List<Voxels>();

        // ---- seed-shaped body
        var bodyPts = new List<Vector2>();
        foreach (float sx in new[] { -1f, 1f })
            foreach (float sy in new[] { -1f, 1f })
                bodyPts.AddRange(CirclePts(new Vector2(sx * fBx, sy * fBy), fBr, 48));
        parts.Add(Kit.voxExtrudeZ(ctx, Hull(bodyPts), fZ0, fZ1));
        ctx.Log("seed body");

        float fHoleRad = fHoleSp / MathF.Sqrt(2f); // 12x12 square -> 8.49 mm radius

        for (int k = 0; k < 4; k++)
        {
            float fA = (45f + 90f * k) * MathF.PI / 180f;
            var u = new Vector2(MathF.Cos(fA), MathF.Sin(fA));
            var v = new Vector2(-u.Y, u.X);
            Func<float, float, Vector2> P = (s, w) => u * s + v * w;
            Vector2 vM = u * fR;

            // midrib: tapered branch
            parts.Add(Cap(ctx, P(0.12f * fR, 0f), fMidRoot, P(fR - 6f, 0f), fMidTip, fZ0, fZ1));

            for (int side = -1; side <= 1; side += 2)
            {
                // leaf margin: curved, tapering vein from the body to the motor pad
                var aS = new[] { 0.20f * fR, 0.51f * fR, 0.74f * fR, fR - 3f };
                var aW = new[] { 0.46f, 1.0f, 0.82f, 0.50f };
                var aPts = new Vector2[4];
                for (int i = 0; i < 4; i++) aPts[i] = P(aS[i], side * aW[i] * fLeafW);
                for (int i = 0; i < 3; i++)
                {
                    float r0 = fMarRoot + (fMarTip - fMarRoot) * i / 3f;
                    float r1 = fMarRoot + (fMarTip - fMarRoot) * (i + 1) / 3f;
                    parts.Add(Cap(ctx, aPts[i], r0, aPts[i + 1], r1, fZ0, fZ1));
                }
                // lateral veins, angled toward the tip like a leaf
                foreach (float fs in new[] { 0.35f, 0.54f })
                {
                    Vector2 vEnd = OnPolyline(aPts, aS, (fs + 0.13f) * fR);
                    parts.Add(Cap(ctx, P(fs * fR, 0f), fVeinR * 1.15f, vEnd, fVeinR, fZ0, fZ1));
                }
            }

            // flower motor pad: core + 4 petals around the M2 holes
            parts.Add(Kit.voxExtrudeZ(ctx, Hull(CirclePts(vM, fPadR, 48)), fZ0, fZ1));
            for (int h = 0; h < 4; h++)
            {
                float fH = h * MathF.PI / 2f;
                Vector2 vH = vM + new Vector2(MathF.Cos(fH), MathF.Sin(fH)) * fHoleRad;
                parts.Add(Cap(ctx, vM + (vH - vM) * 0.5f, fLobeR, vH, fLobeR, fZ0, fZ1));
            }
            ctx.Progress((k + 1) / 5f);
        }

        Voxels vox = new Voxels();
        vox.BoolAddAll(parts);
        ctx.Log("arms + pads unioned");
        vox.Fillet(fFillet);
        ctx.Log("grown 2D fillets");
        float fXY = fR + fPadR + fLobeR + 10f;
        vox.BoolIntersect(Kit.voxBox(ctx, new Vector3(-fXY, -fXY, 0f), new Vector3(fXY, fXY, fT)));
        ctx.Log("trimmed to plate thickness");

        // ---- through cuts
        var cuts = new List<Voxels>();
        for (int k = 0; k < 4; k++)
        {
            float fA = (45f + 90f * k) * MathF.PI / 180f;
            var vM = new Vector2(MathF.Cos(fA), MathF.Sin(fA)) * fR;
            cuts.Add(Hole(ctx, vM, fCHoleR, fT));
            for (int h = 0; h < 4; h++)
            {
                float fH = h * MathF.PI / 2f;
                cuts.Add(Hole(ctx, vM + new Vector2(MathF.Cos(fH), MathF.Sin(fH)) * fHoleRad, fMHoleR, fT));
            }
        }
        float fS = fStack / 2f;
        foreach (float sx in new[] { -1f, 1f })
            foreach (float sy in new[] { -1f, 1f })
                cuts.Add(Hole(ctx, new Vector2(sx * fS, sy * fS), fSHoleR, fT));
        // seed cut-out at the centre and two leaf cut-outs fore/aft
        cuts.Add(Cap(ctx, new Vector2(0f, -0.4f * fBy), 3.5f, new Vector2(0f, 0.4f * fBy), 3.5f, -1f, fT + 1f));
        foreach (float sy in new[] { -1f, 1f })
            cuts.Add(Cap(ctx, new Vector2(0f, sy * (fBy + 2.5f)), 2.5f, new Vector2(0f, sy * (fBy + 6.5f)), 1.5f, -1f, fT + 1f));
        vox.BoolSubtractAll(cuts);
        ctx.Log("holes and cut-outs");
        ctx.Progress(1f);
        return vox;
    }

    private static Vector2 OnPolyline(Vector2[] aPts, float[] aS, float s)
    {
        for (int i = 0; i < aS.Length - 1; i++)
        {
            if (s >= aS[i] && s <= aS[i + 1])
            {
                float t = (s - aS[i]) / (aS[i + 1] - aS[i]);
                return aPts[i] + (aPts[i + 1] - aPts[i]) * t;
            }
        }
        return aPts[aPts.Length - 1];
    }

    private static Voxels Hole(Ctx ctx, Vector2 c, float r, float fT)
    {
        return Kit.voxCylinder(ctx, new Vector3(c.X, c.Y, -1f), new Vector3(c.X, c.Y, fT + 1f), r);
    }

    // tapered 2D capsule (convex hull of two circles), extruded between z0 and z1
    private static Voxels Cap(Ctx ctx, Vector2 a, float ra, Vector2 b, float rb, float fZ0, float fZ1)
    {
        var pts = new List<Vector2>();
        pts.AddRange(CirclePts(a, ra, 32));
        pts.AddRange(CirclePts(b, rb, 32));
        return Kit.voxExtrudeZ(ctx, Hull(pts), fZ0, fZ1);
    }

    private static List<Vector2> CirclePts(Vector2 c, float r, int n)
    {
        var l = new List<Vector2>(n);
        for (int i = 0; i < n; i++)
        {
            float a = 2f * MathF.PI * i / n;
            l.Add(c + new Vector2(MathF.Cos(a), MathF.Sin(a)) * r);
        }
        return l;
    }

    private static float Cross(Vector2 o, Vector2 a, Vector2 b)
    {
        return (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
    }

    // Andrew monotone chain, CCW
    private static List<Vector2> Hull(List<Vector2> p)
    {
        var s = p.OrderBy(q => q.X).ThenBy(q => q.Y).ToList();
        var h = new List<Vector2>();
        foreach (var q in s)
        {
            while (h.Count >= 2 && Cross(h[h.Count - 2], h[h.Count - 1], q) <= 1e-6f) h.RemoveAt(h.Count - 1);
            h.Add(q);
        }
        int nLow = h.Count + 1;
        for (int i = s.Count - 2; i >= 0; i--)
        {
            var q = s[i];
            while (h.Count >= nLow && Cross(h[h.Count - 2], h[h.Count - 1], q) <= 1e-6f) h.RemoveAt(h.Count - 1);
            h.Add(q);
        }
        h.RemoveAt(h.Count - 1);
        return h;
    }
}