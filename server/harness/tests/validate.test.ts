// server/harness/tests/validate.test.ts — GEOM-L3-01..07
// L3 geometry checks on engine stats (13 §7, archive LLM_HARNESS §7) → failure F4 (04 §7).

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { requiredMinWallMm, validateGeometry } from "../validate.ts";
import type { AcceptedBrief } from "../tools/_base.ts";
import type { EngineStats } from "../../engine/client.ts";

const BRIEF: AcceptedBrief = {
  parameters: [{ name: "diameter", value: 80, unit: "mm" }],
  envelope_mm: { x: 100, y: 100, z: 50 },
  voxel_size_mm: 0.5,
  material: "PETG",
};

const GOOD: EngineStats = {
  volumeCm3: 42.7,
  bboxMin: [-40, -40, 0],
  bboxMax: [40, 40, 24],
  triangles: 412_208,
  watertight: true,
  voxelSizeMm: 0.5,
  minWallProbeMm: 2.4,
};

function codes(stats: EngineStats): string[] {
  const r = validateGeometry(stats, BRIEF);
  return r.ok ? [] : r.error.failures.map((f) => f.code);
}

Deno.test("GEOM-L3-01: valid geometry passes with no warnings", () => {
  const r = validateGeometry(GOOD, BRIEF);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value.warnings, []);
});

Deno.test("GEOM-L3-02: empty volume → EMPTY_GEOMETRY with measured volume", () => {
  const r = validateGeometry({ ...GOOD, volumeCm3: 0.004 }, BRIEF);
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error.code, "EMPTY_GEOMETRY");
    assertStringIncludes(r.error.failures[0].message, "0.004");
  }
});

Deno.test("GEOM-L3-03: open mesh → NOT_WATERTIGHT", () => {
  assertEquals(codes({ ...GOOD, watertight: false }), ["NOT_WATERTIGHT"]);
});

Deno.test("GEOM-L3-04: min wall below max(material, brief min_wall, 3×voxel) → BELOW_MIN_WALL", () => {
  // PETG 1.0 mm, 3×0.5 = 1.5 mm → required 1.5
  assertEquals(requiredMinWallMm(BRIEF, 0.5).requiredMm, 1.5);
  assertEquals(codes({ ...GOOD, minWallProbeMm: 1.2 }), ["BELOW_MIN_WALL"]);

  // brief min_wall parameter governs when larger
  const thick: AcceptedBrief = {
    ...BRIEF,
    parameters: [...BRIEF.parameters, { name: "min_wall", value: 3, unit: "mm" }],
  };
  assertEquals(requiredMinWallMm(thick, 0.5).requiredMm, 3);
  const r = validateGeometry({ ...GOOD, minWallProbeMm: 2.4 }, thick);
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.error.failures[0].message, "2.4 mm");
    assertStringIncludes(r.error.failures[0].message, "3 mm");
    assertEquals(r.error.failures[0].measured, { minWallMm: 2.4 });
    assertEquals(r.error.failures[0].required, { minWallMm: 3 });
  }
});

Deno.test("GEOM-L3-05: bbox beyond brief envelope × 1.10 → ENVELOPE_EXCEEDED per axis", () => {
  // z extent 60 > 50 × 1.1 = 55 → overflow 5 mm; x extent 108 < 110 is fine
  const r = validateGeometry({ ...GOOD, bboxMin: [-54, -40, 0], bboxMax: [54, 40, 60] }, BRIEF);
  assertEquals(r.ok, false);
  if (!r.ok) {
    const f = r.error.failures[0];
    assertEquals(f.code, "ENVELOPE_EXCEEDED");
    assertEquals(f.measured, { zMm: 60 });
    assertEquals(f.required, { zMm: 55 });
    assertStringIncludes(f.message, "z 60 mm > 55 mm (+5 mm)");
  }
  // no brief → no envelope check
  assertEquals(validateGeometry({ ...GOOD, bboxMax: [400, 400, 400] }, undefined).ok, true);
});

Deno.test("GEOM-L3-06: triangle count must be > 0 and ≤ cap → TRIANGLE_COUNT", () => {
  assertEquals(codes({ ...GOOD, triangles: 0 }), ["TRIANGLE_COUNT"]);
  assertEquals(codes({ ...GOOD, triangles: 50_000_000 }), ["TRIANGLE_COUNT"]);
});

Deno.test("GEOM-L3-07: several failures reported together; min wall near limit warns", () => {
  assertEquals(codes({ ...GOOD, watertight: false, minWallProbeMm: 0.4 }), [
    "NOT_WATERTIGHT",
    "BELOW_MIN_WALL",
  ]);
  const near = validateGeometry({ ...GOOD, minWallProbeMm: 1.6 }, BRIEF);
  assertEquals(near.ok, true);
  if (near.ok) assertEquals(near.value.warnings.length, 1);
});
