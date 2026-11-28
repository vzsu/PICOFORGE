# PicoForge for AI agents: computational engineering with PicoGK

You are an AI agent connected to **PicoForge** over MCP. PicoForge turns engineering intent into real,
manufacturable 3D parts. You write a short **design brief** (numbers plus the physics behind them), then
**C# code** that builds the part with the **PicoGK** voxel kernel. PicoForge compiles your code in a
sandbox, builds it, checks the geometry, and shows the part live in the user's PicoForge window.

This one file is all you need: how to connect, the working loop, the rules, the API, worked examples
that build, prompt patterns, and how to repair failures. Read it once before your first build. It is
also served as the MCP resource `picoforge://guide` and the prompt `forge_engineer`.

**The loop in eight lines**

1. `open_project` → you get a `projectId`. The user's window switches to that project.
2. `post_message {kind:"request"}` with the human's request, then `post_message {kind:"plan"}`.
3. Size the part from first principles (section 8). Optionally `search_docs`.
4. `submit_design_brief` → fix every violation until `accepted: true`.
5. `run_picogk` with ONE complete C# file under the code contract (section 6).
6. On failure, read `code` and `repairHint`, fix the root cause, then send the FULL file again.
7. Check the result: the stats, `inspect_geometry`, and `capture_viewport` to see it.
8. `post_message {kind:"report"}`: what you built, key numbers with units, one honest caveat.

---

## 1. What "computational engineering" means here

In ordinary CAD a person draws a shape. In computational engineering you write the **rules** that
produce the shape: equations and algorithms driven by a few governing parameters. Change a parameter
(diameter, blade count, wall thickness) and the whole part regenerates consistently.

PicoForge splits that into two artefacts:

| Artefact | What it holds | Who checks it |
|---|---|---|
| **Design brief** (JSON) | Every governing number, with its unit and rationale, plus physics checks evaluated with numbers | The brief validator (envelope, voxel budget, units, material, the checks each category requires) |
| **Design code** (C#) | The algorithm that turns those numbers into geometry | Contract lint → Roslyn compile → sandboxed build → geometry checks (non-empty, watertight, inside the envelope, minimum wall) |

The code reads every governing dimension from the brief with `ctx.P("name")`. Numbers are never
hard-coded. That keeps the brief the single source of truth, so a later change ("make it 140 mm") is a
one-parameter edit.

**PicoGK** (from LEAP 71) is a voxel-based geometry kernel. A part is a `Voxels` field: a solid sampled
on a fine 3D grid (the voxel size, e.g. 0.25 mm). This makes the hard CAD operations robust:

- Booleans (union, subtract, intersect) never fail on bad topology.
- Offsets, shells, fillets and smoothing are simple distance operations.
- Lattices (beams and spheres) and implicit fields (gyroids, TPMS) are first-class.
- The result is always meshed to a closed, watertight STL.

Trade-off: the finest detail is about 3 voxels. Pick `voxel_size_mm` so the thinnest wall spans at
least 3 voxels, and keep the voxel count within budget (section 5).

## 2. Connect

PicoForge runs locally (`deno task start`, port 7317). Get your connection command from the person
running it: `deno task mcp:connect` prints it with their local token. For Claude Code:

```sh
claude mcp add --transport http picoforge http://127.0.0.1:7317/mcp --header "X-PicoForge-Token: <TOKEN>"
```

Other clients (Cursor, VS Code, Codex, Gemini CLI) take the same URL and header in their MCP config.
After adding the server, reload MCP servers so the tools appear.

## 3. Tools, resources, prompts

| Tool | Input | What it does |
|---|---|---|
| `open_project` | `projectName?` | Opens or creates a project and shows it in the user's window. Returns `projectId`. Without a name it opens the project the user has open. |
| `post_message` | `projectId`, `text`, `kind` (`request` / `plan` / `report`) | Shows a message in the PicoForge chat so the human can follow along. |
| `search_docs` | `query` | Searches the PicoForge knowledge base (recipes, formulas, PicoGK notes). |
| `submit_design_brief` | `projectId`, brief fields | Validates and registers the brief. Required before any build. |
| `run_picogk` | `projectId`, `code`, `notes?` | Builds one complete C# design file. On success the part appears in the viewport and you get stats. |
| `inspect_geometry` | `projectId`, `ops[]` | Measures the last successful part. |
| `capture_viewport` | `projectId`, `view` (`iso` / `front` / `top` / `right` / `current`) | Returns a PNG of the part from the open window, so you can see what you built. |
| `export_artifact` | `projectId`, `format` (`stl` / `3mf` / `glb`) | Exports the last successful part; returns a file URL. |
| `get_run` | `runId` | State and error of a build run. |

Resources: `picoforge://guide` (this file), `picoforge://api/picogk-card` (exact PicoGK signatures you
may use), `picoforge://api/kit-card` (PicoForge.Kit helpers). Prompt: `forge_engineer {goal}`.

**Errors always say what to do next:**

| Code | Meaning | Do this |
|---|---|---|
| `BRIEF_REQUIRED` | No accepted brief in this project | `submit_design_brief` first |
| `INVALID_INPUT` | Input failed its schema | Fix the field named in the message |
| `RUN_BUSY` | A build is running in this project | Wait, then `get_run` |
| `NO_PART` | Nothing built yet | `run_picogk` first |
| `NEEDS_DECISION` | A repair or build budget is spent; `options[]` attached | Stop and ask the human, quoting the options |
| `CONTRACT_VIOLATION`, `COMPILE_ERROR`, `UNKNOWN_SYMBOL`, `BANNED_API` | Code rejected before running | Follow `repairHint` and the diagnostics (line and column) |
| `RUNTIME_ERROR`, `TIMEOUT`, `OOM` | Build crashed or ran out of budget | Guard inputs; coarsen `voxel_size_mm`; fewer booleans |
| `EMPTY_GEOMETRY`, `NOT_WATERTIGHT`, `ENVELOPE_EXCEEDED`, `BELOW_MIN_WALL` | Built, but the geometry check failed | Fix using the measured and required numbers in the payload |

## 4. The working loop in detail

1. **Open.** `open_project {projectName: "<short name>"}`. Keep the returned `projectId`.
2. **Show the request.** `post_message {kind: "request", text: <the human's words>}`, then a 2–4 line
   `plan`. The human watches the PicoForge window, so tell them what you are about to do.
3. **Understand.** Restate the part in one sentence. If a critical number is missing (size, speed,
   load, material, process), adopt a clearly labelled sensible default. Ask the human only if the choice
   forks the design.
4. **Engineer.** Derive every governing dimension from first principles (section 8). Put the formula,
   the computed value and the limit into `physics_checks`.
5. **Brief.** `submit_design_brief`. If `accepted: false`, fix every listed violation and resubmit.
6. **Build.** `run_picogk` with the full file. Use `notes` to say what changed when repairing.
7. **Verify.** Read `stats`: `volumeCm3`, `bboxMin`/`bboxMax`, `triangles`, `watertight`,
   `minWallProbeMm`. `capture_viewport {view: "iso"}` to look at it. `inspect_geometry` for specific
   measurements.
8. **Iterate.** For a change, update the brief parameter, resubmit, rebuild. Never patch numbers in code.
9. **Report.** `post_message {kind: "report"}` covering: what was built; the key numbers with units
   (diameter, mass ≈ volume × density, minimum wall); which checks are first-order estimates; one
   suggested next step. Then `export_artifact` if the human wants a file.

## 5. The design brief

```text
title             short name, ≤ 120 chars
category          rotor_fan | rotor_turbine | bracket | enclosure | heat_exchanger | gear | shaft |
                  duct | lattice_part | generic
requirements[]    the human's requirements, one per line
parameters[]      {name, value, unit, rationale}; name matches ^[a-zA-Z][a-zA-Z0-9_]*$
                  unit: mm | deg | rad | rpm | count | mps | mpa | w | kg | ratio
physics_checks[]  {name, formula, computed, limit, pass}
envelope_mm       {x, y, z}: the bounding box the part must fit (≤ 400 × 400 × 400; bbox may exceed by 10 %)
voxel_size_mm     e.g. 0.25 for small parts, 0.5 for ~100 mm parts, 1.0 for large ones
material          PLA | PETG | ABS | PA12 | Resin | Al6061-T6 | SS316L | CF_3K_PLATE
assumptions[]     what you assumed; write "waived" here to accept a check with pass:false
risks[]           honest caveats
```

**Physics checks each category must include** (by these exact names; extra checks are welcome):

| Category | Required checks |
|---|---|
| `rotor_fan`, `rotor_turbine` | `tip_speed`, `centrifugal_stress_sf`, `solidity`, `min_blade_thickness` |
| `bracket` | `bending_stress_sf`, `deflection` |
| `enclosure` | `wall_thickness_min`, `fastener_boss_size` |
| `heat_exchanger` | `wall_thickness_min`, `channel_hydraulic_diameter` |
| `gear` | `module_bending_lewis`, `min_root_thickness` |
| `shaft` | `torsion_stress_sf` |
| `duct`, `generic` | `wall_thickness_min` |
| `lattice_part` | `strut_diameter_min`, `relative_density` |

**Validator rules:** every `mm` parameter must be ≤ 1.05 × the envelope diagonal. The voxel count
`⌈x/v⌉·⌈y/v⌉·⌈z/v⌉` has a hard cap; the error gives the voxel size to use. Every check needs
`pass: true` unless an assumption says it is waived.

**Materials** (density g/cm³, yield MPa, E GPa, minimum wall mm, max °C):
PLA 1.24/45/3.5/1.0/55 · PETG 1.27/50/2.1/1.0/75 · ABS 1.05/40/2.0/1.2/95 · PA12 1.01/48/1.7/0.8/120 ·
Resin 1.15/55/2.6/0.6/60 · Al6061-T6 2.70/276/68.9/0.8/200 · SS316L 8.00/205/193/0.5/400 ·
CF_3K_PLATE 1.55/570 (tensile)/55/1.5/120. CF_3K_PLATE is CNC-cut sheet: keep CF parts as flat plates
of one thickness (curvy outlines are fine, 3D sculpting is not), or say that the organic 3D version
must be printed in PA12 instead.
The minimum wall the geometry check enforces is the largest of: the material minimum, a `min_wall`
parameter, and 3 × voxel size.

## 6. The code contract (violations are rejected before compile)

```csharp
using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    public static Voxels voxBuild(Ctx ctx)
    {
        float fSize = ctx.P("size");   // every governing number comes from the brief
        // ... build and return ONE non-empty Voxels
    }
    // optional: private static helper methods
}
```

- Exactly one `public static class Design` with `public static PicoGK.Voxels voxBuild(PicoForge.Kit.Ctx ctx)`.
- Allowed `using`s only: `System`, `System.Numerics`, `System.Collections.Generic`, `System.Linq`,
  `PicoGK`, `PicoForge.Kit`.
- Forbidden (analyzer-enforced): file/network IO, processes, threads, tasks, reflection, `unsafe`,
  `DllImport`, `Environment`, `DateTime.Now`, `new Random()`. Use `ctx.Rng` for randomness.
- `ctx.P("name")` returns a float and `ctx.Pi("name")` an int. The names are your brief parameters. An
  unknown name fails the build and lists the known names.
- `ctx.Log("text")` narrates stages (shown in the build log). `ctx.Progress(0..1)` in long loops.
- Units are millimetres. Z is up. The part sits on the build plate at Z = 0, centred on X/Y = 0.
- Union all bodies into one `Voxels` before returning. Never return null. At most 1200 lines.

## 7. PicoGK and PicoForge.Kit in five minutes

**Voxels**: the solid. Mutating operations change it in place; `vox...` variants return a new one.

| Operation | Use |
|---|---|
| `a.BoolAdd(b)` / `a.BoolSubtract(b)` / `a.BoolIntersect(b)` | Union, cut, intersect |
| `a.BoolAddAll(list)` / `a.BoolSubtractAll(list)` | Many at once (faster than a loop of single booleans) |
| `a.Offset(mm)` / `a.voxOffset(mm)` | Grow (+) or shrink (−) the surface |
| `a.voxShell(mm)` | Hollow shell of a solid |
| `a.Fillet(mm)`, `a.Smoothen(mm)` | Round concave and convex edges, smooth the surface |
| `new Voxels(lattice)`, `new Voxels(mesh)`, `new Voxels(implicit, bbox)` | From a lattice, a closed mesh, or an implicit field |

**Lattice**: beams and spheres, rendered with round caps:
`var lat = new Lattice(); lat.AddBeam(a, rA, b, rB, true); lat.AddSphere(c, r); var v = new Voxels(lat);`

**BBox3**: `new BBox3(new Vector3(x0,y0,z0), new Vector3(x1,y1,z1))`.

**PicoForge.Kit** (vetted helpers; prefer them over hand-made meshes):

| Helper | Makes |
|---|---|
| `Kit.voxBox(ctx, vMin, vMax)`, `Kit.voxBoxCentered(ctx, vCenter, vSize)` | Boxes |
| `Kit.voxCylinder(ctx, vA, vB, r)`, `Kit.voxTube(ctx, vA, vB, rOuter, wall)` | Cylinders and tubes along any axis |
| `Kit.voxSphere(ctx, c, r)`, `Kit.voxCapsule(ctx, vA, vB, r)`, `Kit.voxCone(ctx, vBase, vTip, rBase, rTip)` | Round primitives |
| `Kit.voxExtrudeZ(ctx, polyXY, z0, z1)` | Extrude a 2D outline (`Kit.aCircle`, `Kit.aRoundedRect`, `Kit.aNaca4`) |
| `Kit.voxRevolve(ctx, profileRZ, deg)` | Revolve an (r, z) profile around Z (nozzles, bells, hubs) |
| `Kit.voxSweepCircle(ctx, path, r)` | Sweep a circle along a 3D path (pipes, springs, coils) |
| `Kit.voxFromImplicit(ctx, Kit.impGyroid(cell, wall), bbox)` | Gyroid (TPMS) lattice filling a box |
| `Kit.voxAxialRotor(ctx, BladeSpec, nBlades, fHubR, fHubZ0, fHubZ1, fBoreR, fFilletR)` | Fans, propellers, turbines: twisted NACA blades on a hub |
| `Kit.voxPolarPatternZ(ctx, mesh, n)`, `Kit.voxLinearPattern(ctx, mesh, step, n)` | Patterns of a mesh |
| `Kit.mshLoft(rings)`, `Kit.mshTransform(mesh, matrix)` | Closed lofted meshes, transformed meshes |
| `Kit.Shell(v, wall)`, `Kit.FilletClose(v, r)`, `Kit.RoundOpen(v, r)` | Shell, fillet inside corners, round outside edges |

`BladeSpec(fHubR, fTipR, nSections, fChordAt, fBetaDegAt, sNacaAt)`: the three functions take
`t` = 0 at the hub to 1 at the tip. They return the chord (mm), the blade angle β measured from the
rotation plane (degrees), and the NACA 4-digit section (e.g. `"4412"`).

The exact signatures are in `picoforge://api/picogk-card` and `picoforge://api/kit-card`. Use only those.

## 8. Engineering doctrine and formula pack

- Work from first principles. State loads, speeds and pressures. Evaluate the formula with numbers.
- Safety factors: static ≥ 2, rotating ≥ 3, pressure ≥ 4 unless the human says otherwise.
- Minimum feature = max(process minimum, 3 × voxel size). FDM: avoid unsupported overhangs past 45°.
  Powder (SLS PA12): no trapped volumes.
- This is geometry plus first-order engineering, not FEA or CFD. Say so for safety-critical parts.

| Topic | Formula |
|---|---|
| Angular speed | ω = 2π · RPM / 60 (rad/s) |
| Tip speed, tip Mach | v = ω · r_tip; M = v / 343 m/s |
| Blade angle for a pitch P | β(r) = atan(P / (2π r)) |
| Free-vortex fan blade angle | β(r) = atan(c_a / (ω r)) + incidence |
| Solidity | σ = B · c / (2π r) at r ≈ 0.75 R |
| Centrifugal stress, uniform blade (first order) | σ ≈ ρ ω² (R² − r_h²) / 2 |
| Bending | σ = M / Z, rectangle Z = b t² / 6, I = b t³ / 12 |
| Deflection | simply supported, centre load: δ = F L³ / (48 E I); cantilever: δ = F L³ / (3 E I) |
| Torsion, solid shaft | τ = 16 T / (π d³) |
| Gear root (Lewis) | σ = F_t / (b · m · Y) |
| Hydraulic diameter | D_h = 4 A / P |

**Quiet rotors** (fans, propellers): noise rises steeply with tip speed. Keep the cruise tip Mach low
(≲ 0.3). Use lower pitch at a given thrust, wider chord, more blades at lower RPM, and a tapered or
rounded tip. Printed trailing edges cannot be razor thin: respect the minimum wall.

## 9. Worked examples (each one builds; `deno task guide:check` proves it)

### Example 1: mounting plate with four bolt holes (bracket)

Boxes and cylinders with a boolean subtract. All hole positions derive from the parameters.

<!-- example: plate -->
```json
{
  "title": "80 x 50 mm PETG mounting plate, 4x M4",
  "category": "bracket",
  "requirements": ["80 x 50 mm plate", "6 mm thick", "4x M4 clearance holes, 7 mm from the edges", "carries 50 N at the centre"],
  "parameters": [
    {"name": "length", "value": 80, "unit": "mm", "rationale": "requested"},
    {"name": "width", "value": 50, "unit": "mm", "rationale": "requested"},
    {"name": "thickness", "value": 6, "unit": "mm", "rationale": "bending check below"},
    {"name": "hole_diameter", "value": 4.4, "unit": "mm", "rationale": "M4 clearance"},
    {"name": "hole_inset", "value": 7, "unit": "mm", "rationale": "≥ 1.5 x hole diameter edge distance"}
  ],
  "physics_checks": [
    {"name": "bending_stress_sf", "formula": "SF = σy / (F·L/4 / (b·t²/6)), L = 66 mm span", "computed": 18.2, "limit": 2, "pass": true},
    {"name": "deflection", "formula": "δ = F·L³ / (48·E·b·t³/12), mm", "computed": 0.16, "limit": 0.5, "pass": true}
  ],
  "envelope_mm": {"x": 80, "y": 50, "z": 6},
  "voxel_size_mm": 0.25,
  "material": "PETG",
  "assumptions": ["simply supported between the bolt rows", "static load"],
  "risks": ["FDM layer adhesion: print flat"]
}
```

```csharp
using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    public static Voxels voxBuild(Ctx ctx)
    {
        float fL = ctx.P("length");
        float fW = ctx.P("width");
        float fT = ctx.P("thickness");
        float fHoleR = ctx.P("hole_diameter") / 2f;
        float fInset = ctx.P("hole_inset");

        Voxels vox = Kit.voxBoxCentered(ctx, new Vector3(0f, 0f, fT / 2f), new Vector3(fL, fW, fT));

        float fX = fL / 2f - fInset;
        float fY = fW / 2f - fInset;
        foreach (Vector2 v in new[] { new Vector2(fX, fY), new Vector2(-fX, fY), new Vector2(fX, -fY), new Vector2(-fX, -fY) })
        {
            // cut through with 1 mm of overshoot on both faces
            vox.BoolSubtract(Kit.voxCylinder(ctx, new Vector3(v.X, v.Y, -1f), new Vector3(v.X, v.Y, fT + 1f), fHoleR));
        }
        ctx.Log("plate with 4 holes");
        return vox;
    }
}
```

### Example 2: lightweight lattice cube (lattice_part)

A body-centred-cubic (BCC) strut lattice built with `Lattice`, closed by solid skins top and bottom so
it can be bolted or printed.

<!-- example: lattice -->
```json
{
  "title": "40 mm BCC lattice cube with skins",
  "category": "lattice_part",
  "requirements": ["40 mm cube", "BCC strut lattice", "solid 2 mm skins top and bottom"],
  "parameters": [
    {"name": "size", "value": 40, "unit": "mm", "rationale": "requested"},
    {"name": "cells", "value": 4, "unit": "count", "rationale": "10 mm cells"},
    {"name": "strut_diameter", "value": 2, "unit": "mm", "rationale": "2x PETG minimum wall"},
    {"name": "skin", "value": 2, "unit": "mm", "rationale": "bolt-on faces"}
  ],
  "physics_checks": [
    {"name": "strut_diameter_min", "formula": "d ≥ max(material min wall, 3·voxel)", "computed": 2, "limit": 1, "pass": true},
    {"name": "relative_density", "formula": "ρ* ≈ 8·π(d/2)²·(√3/2·L) / L³", "computed": 0.22, "limit": 0.35, "pass": true}
  ],
  "envelope_mm": {"x": 42, "y": 42, "z": 42},
  "voxel_size_mm": 0.25,
  "material": "PETG",
  "assumptions": ["relative density estimate ignores node overlap"],
  "risks": ["internal struts need support-free orientation: print skins horizontal"]
}
```

```csharp
using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    public static Voxels voxBuild(Ctx ctx)
    {
        float fSize = ctx.P("size");
        int nCells = ctx.Pi("cells");
        float fR = ctx.P("strut_diameter") / 2f;
        float fSkin = ctx.P("skin");
        float fCell = fSize / nCells;
        float fH = fSize / 2f;

        var lat = new Lattice();
        for (int i = 0; i < nCells; i++)
        for (int j = 0; j < nCells; j++)
        for (int k = 0; k < nCells; k++)
        {
            var vMin = new Vector3(-fH + i * fCell, -fH + j * fCell, k * fCell);
            var vCentre = vMin + new Vector3(fCell / 2f);
            for (int c = 0; c < 8; c++)
            {
                var vCorner = vMin + new Vector3((c & 1) * fCell, ((c >> 1) & 1) * fCell, ((c >> 2) & 1) * fCell);
                lat.AddBeam(vCentre, fR, vCorner, fR, true);
            }
        }
        Voxels vox = new Voxels(lat);
        vox.BoolAdd(Kit.voxBox(ctx, new Vector3(-fH, -fH, 0f), new Vector3(fH, fH, fSkin)));
        vox.BoolAdd(Kit.voxBox(ctx, new Vector3(-fH, -fH, fSize - fSkin), new Vector3(fH, fH, fSize)));
        ctx.Log($"BCC lattice {nCells}^3 cells");
        return vox;
    }
}
```

### Example 3: gyroid heat-sink block (heat_exchanger)

An implicit TPMS (gyroid) field fills a box; a solid base plate is added for the heat source.
Lesson from the real build: the wall that `impGyroid(cell, wall)` produces measures about 75 % of the
nominal `wall`. A nominal 1.2 mm came out at 0.9 mm and failed `BELOW_MIN_WALL` for PLA, so size the
nominal wall up and trust the measured `minWallProbeMm`.

<!-- example: gyroid -->
```json
{
  "title": "30 mm gyroid heat-sink block",
  "category": "heat_exchanger",
  "requirements": ["30 mm cube", "gyroid fins", "3 mm solid base"],
  "parameters": [
    {"name": "size", "value": 30, "unit": "mm", "rationale": "requested"},
    {"name": "cell_size", "value": 8, "unit": "mm", "rationale": "open channels for natural convection"},
    {"name": "wall", "value": 1.6, "unit": "mm", "rationale": "gyroid walls measure ≈ 0.75 × nominal: 1.6 → ≈ 1.2 mm > PLA 1.0 mm"},
    {"name": "base", "value": 3, "unit": "mm", "rationale": "spreads heat from the source"}
  ],
  "physics_checks": [
    {"name": "wall_thickness_min", "formula": "t_measured ≈ 0.75·wall ≥ max(material min wall, 3·voxel)", "computed": 1.2, "limit": 1, "pass": true},
    {"name": "channel_hydraulic_diameter", "formula": "D_h ≈ cell/2 − wall", "computed": 2.4, "limit": 1.5, "pass": true}
  ],
  "envelope_mm": {"x": 30, "y": 30, "z": 30},
  "voxel_size_mm": 0.25,
  "material": "PLA",
  "assumptions": ["hydraulic diameter is a first-order estimate"],
  "risks": ["PLA softens at 55 °C: use PETG or metal for real heat loads"]
}
```

```csharp
using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    public static Voxels voxBuild(Ctx ctx)
    {
        float fSize = ctx.P("size");
        float fH = fSize / 2f;
        var bounds = new BBox3(new Vector3(-fH, -fH, 0f), new Vector3(fH, fH, fSize));

        Voxels vox = Kit.voxFromImplicit(ctx, Kit.impGyroid(ctx.P("cell_size"), ctx.P("wall")), bounds);
        vox.BoolAdd(Kit.voxBox(ctx, new Vector3(-fH, -fH, 0f), new Vector3(fH, fH, ctx.P("base"))));
        ctx.Log("gyroid block");
        return vox;
    }
}
```

### Example 4: quiet 3-blade propeller for a 3-inch FPV drone (rotor_fan)

A 76.2 mm (3") three-blade propeller with low pitch and wide, tapered blades for low noise. The blade
angle follows the geometric pitch, β(r) = atan(P / 2πr). The chord tapers from 11 mm at the root to
8 mm at the tip. The section is NACA 4412. `Kit.voxAxialRotor` builds the twisted blades, hub, bore
and root fillets.

Numbers: at 40 000 RPM (max), ω = 4189 rad/s and v_tip = 160 m/s. At 20 000 RPM cruise, v_tip = 80 m/s
(Mach 0.23). Centrifugal stress ≈ ρω²R²/2 = 1010 · 4189² · 0.0381² / 2 ≈ 12.9 MPa, so SF = 48 / 12.9 = 3.7
(PA12, SLS).

<!-- example: prop3 -->
```json
{
  "title": "3-inch quiet 3-blade FPV propeller",
  "category": "rotor_fan",
  "requirements": ["3 inch (76.2 mm) diameter", "3 blades", "quiet: low pitch, wide tapered blades", "5 mm motor shaft"],
  "parameters": [
    {"name": "tip_radius", "value": 38.1, "unit": "mm", "rationale": "3 inch diameter"},
    {"name": "hub_radius", "value": 5, "unit": "mm", "rationale": "10 mm hub"},
    {"name": "blade_count", "value": 3, "unit": "count", "rationale": "requested"},
    {"name": "pitch", "value": 50.8, "unit": "mm", "rationale": "2.0 inch pitch: lower tip loading, quieter"},
    {"name": "root_chord", "value": 11, "unit": "mm", "rationale": "wide blade for thrust at lower RPM"},
    {"name": "tip_chord", "value": 8, "unit": "mm", "rationale": "tapered tip; keeps 4412 thickness ≥ 0.8 mm"},
    {"name": "hub_height", "value": 6, "unit": "mm", "rationale": "typical 3 inch hub"},
    {"name": "bore_radius", "value": 2.5, "unit": "mm", "rationale": "5 mm shaft"},
    {"name": "max_rpm", "value": 40000, "unit": "rpm", "rationale": "4S 3 inch motor, loaded"}
  ],
  "physics_checks": [
    {"name": "tip_speed", "formula": "v = ω·r_tip at max RPM, m/s", "computed": 159.6, "limit": 170, "pass": true},
    {"name": "tip_mach_cruise", "formula": "M = ω·r_tip / 343 at 20 000 RPM", "computed": 0.23, "limit": 0.3, "pass": true},
    {"name": "centrifugal_stress_sf", "formula": "SF = σy / (ρ·ω²·R²/2)", "computed": 3.7, "limit": 3, "pass": true},
    {"name": "solidity", "formula": "σ = B·c / (2π·r) at 0.75R", "computed": 0.16, "limit": 0.4, "pass": true},
    {"name": "min_blade_thickness", "formula": "t = 0.12·c_tip, mm", "computed": 0.96, "limit": 0.8, "pass": true}
  ],
  "envelope_mm": {"x": 77, "y": 77, "z": 14},
  "voxel_size_mm": 0.25,
  "material": "PA12",
  "assumptions": ["geometric pitch, no induced-velocity correction", "uniform-blade stress estimate"],
  "risks": ["a printed prop must be balanced and spin-tested behind a guard before flight"]
}
```

```csharp
using System;
using System.Numerics;
using PicoGK;
using PicoForge.Kit;

public static class Design
{
    // beta(r) = atan(P / (2*pi*r)); chord tapers root -> tip
    public static Voxels voxBuild(Ctx ctx)
    {
        float fTipR = ctx.P("tip_radius");
        float fHubR = ctx.P("hub_radius");
        int nBlades = ctx.Pi("blade_count");
        float fPitch = ctx.P("pitch");
        float fRootC = ctx.P("root_chord");
        float fTipC = ctx.P("tip_chord");

        var spec = new BladeSpec(
            fHubR: fHubR - 0.5f, fTipR: fTipR, nSections: 9,
            fChordAt: t => fTipC + (fRootC - fTipC) * (1f - t * t),
            fBetaDegAt: t =>
            {
                float fR = fHubR + t * (fTipR - fHubR);
                return MathF.Atan2(fPitch, 2f * MathF.PI * fR) * 180f / MathF.PI;
            },
            sNacaAt: _ => "4412");
        ctx.Log($"propeller: {nBlades} blades, pitch {fPitch} mm");
        return Kit.voxAxialRotor(ctx, spec, nBlades, fHubR: fHubR, fHubZ0: 0f, fHubZ1: ctx.P("hub_height"),
            fBoreR: ctx.P("bore_radius"), fFilletR: 0.6f);
    }
}
```

**Variations an agent can try:** two blades and a higher pitch for efficiency; four blades and a lower
RPM for less noise; a rounded tip, done by blending the chord to the minimum printable width over the
last 10 % of span; ducted (add a `Kit.voxTube` ring with tip clearance ≥ 0.5 mm).

## 9b. Large and complex parts (engines, car bodies, frames)

- **Envelope:** at most 400 × 400 × 400 mm. A real car or engine becomes a **scale model**. Put the
  scale in a `scale` parameter (unit `ratio`, e.g. 0.0556 for 1:18). Give full-size dimensions in
  `mm`, with names ending in **`_full`** (e.g. `length_full` 4700). The validator does not check
  `_full` values against the model envelope; every other mm parameter is a model dimension. In code
  multiply: `ctx.P("length_full") * ctx.P("scale")`. State the scale in the brief title.
- **Voxel budget on this machine (8 GB RAM):** keep `⌈x/v⌉·⌈y/v⌉·⌈z/v⌉` under about 150 million
  cells. A 300 × 150 × 120 mm model at 0.5 mm is 54 M cells (fine); at 0.25 mm it is 432 M (too slow).
  Draft at 0.8–1.0 mm, then refine.
- **Build in sub-assemblies:** write one `private static Voxels voxBlock(Ctx ctx)`,
  `voxHeads(...)`, `voxIntake(...)` and so on, then union them in `voxBuild`. Collect bodies in a
  `List<Voxels>` and call `BoolAddAll` once. That is far faster than many single `BoolAdd` calls.
- **Pipes, runners, manifolds:** `Kit.voxSweepCircle(ctx, path, r)` along a list of points. Its ends
  are **rounded caps**. For a hollow pipe, sweep the outer radius, then `BoolSubtract` an inner sweep
  whose path is extended past each open end by **more than the outer radius** (along the end
  tangent). If you extend it only 1 mm, the outer cap leaves a skin and the pipe is sealed. Check open
  ends with an `inspect_geometry` `ray` op along the pipe axis.
- **Internal cooling channels:** subtract swept circles or `Kit.voxCylinder` bores from the solid
  (water jackets, oil galleries). Keep at least 3 voxels of wall between a channel and the outside.
  Fins: thin `Kit.voxBox` plates in a loop, unioned with `BoolAddAll`.
- **Surface patterns** (grilles, ornamental seams, lattice skins): cut or emboss small primitives
  along a curve in a loop. Keep each feature at least 3 voxels thick, or it vanishes.
- **Flat plates (CF_3K_PLATE, sheet metal):** `Fillet` / `Kit.FilletClose` on a thin extruded plate
  rounds in 3D and can turn narrow through-cuts into blind pockets that cannot be CNC-cut. Extrude
  the outline taller than the plate (e.g. 3 × t), round it, then `BoolIntersect` with a box from
  z = 0 to t. Every cut then stays straight through. Check with `inspect_geometry` sections near
  both faces: the areas must match.
- **Organic / biophilic forms:** branching `Lattice` beams with tapering radii (thick at the root,
  thin at the tip) followed by `vox.Smoothen(mm)` read as grown structures. Use `Kit.impGyroid` for
  bone-like infill.
- **Your own shapes:** a nested `private class` inside `Design` may implement `PicoGK.IImplicit`
  (`float fSignedDistance(in Vector3 vec)`) for shapes Kit lacks, such as a tilted box or a twisted
  section. Build it with `Kit.voxFromImplicit(ctx, shape, bounds)`.
- **Measuring big parts:** `inspect_geometry` re-voxelises the saved STL. Sealed internal voids come
  back filled, so its volume can exceed the build volume. That difference is a clue that a channel is
  closed. On multi-million-triangle parts inspect can take a minute or two.
- **Views:** `capture_viewport` front looks from −Y toward +Y, right from +X, top from +Z down, iso
  from the front-right-top. Put the part's "front" toward −Y so the views read naturally.
- **Time limit:** a build is killed after the run timeout. If you get `TIMEOUT`, coarsen the voxel
  size first, then cut feature counts.

## 10. Repairing a failed build

- Read `code`, the diagnostics or measured numbers, and `repairHint`. Change only what the root cause
  needs, then resend the **full** file with `notes` saying what changed.
- `COMPILE_ERROR`: diagnostics give the line and column. Check the signature against the API card.
- `UNKNOWN_SYMBOL`: the diagnostic suggests the closest real name. Use only card symbols.
- `EMPTY_GEOMETRY`: a subtract removed everything, a radius was ≤ 0, or the implicit bounds miss the shape.
- `ENVELOPE_EXCEEDED`: the payload gives per-axis overflow. Fix the brief envelope or the geometry.
- `BELOW_MIN_WALL`: thicken to the required value, or choose a material with a lower minimum.
- `TIMEOUT` / `OOM`: coarser `voxel_size_mm` (the payload suggests one), fewer booleans, `BoolAddAll`.
- Budgets per brief: compile 3, runtime 2, geometry 2; 14 builds; 6 builds per minute. When a budget
  is spent you get `NEEDS_DECISION`. Stop and ask the human using the options provided.

## 11. Prompts a human can give you

> Using the picoforge MCP server: read picoforge://guide, open project "FPV props", and design a quiet
> 3-blade propeller for a 3 inch FPV drone (5 mm shaft, PA12 SLS). Post my request and your plan in
> PicoForge, submit a brief with the physics, build it, look at it with capture_viewport, and report
> diameter, mass, minimum blade thickness and what is only estimated.

> In picoforge, design a wall bracket for a 2 kg speaker: 100 mm arm, two M5 screws, PETG, safety
> factor 3. Brief first, then build and report deflection and mass.

> Make a 40 mm gyroid lattice cube in PLA with 1.2 mm walls and a 3 mm base for a heat sink; show it in
> PicoForge and export an STL.

> Take the last propeller and make a 4-blade version with 10 % lower pitch; rebuild and compare volume
> and tip speed with the 3-blade one.

## 12. Rules that always apply

- Never build before the brief is accepted. Never hard-code a number the brief parameterises.
- Never paste large code into the PicoForge chat. The code belongs in `run_picogk`.
- Do not present estimates as measurements. Name the formula or say "first-order".
- Keep the human informed with `post_message`: the request first, the plan, then the report.
- On `NEEDS_DECISION`, stop and ask the human.
