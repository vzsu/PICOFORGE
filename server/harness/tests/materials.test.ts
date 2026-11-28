// MAT-SYNC-01: the brief validator, the L3 min-wall table and the engine's Material.FromName know the
// same materials (a name accepted by one and rejected by another fails a build late).
// MAT-CF-01: CF_3K_PLATE (docs/15 example) is accepted end to end.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { MATERIAL_MIN_WALL_MM } from "../validate.ts";
import { submitDesignBriefTool } from "../tools/submitDesignBrief.ts";
import type { RunCtx } from "../tools/_base.ts";

const ctxCs = new URL("../../../engine/ForgeSandbox/Kit/Ctx.cs", import.meta.url);

Deno.test("MAT-SYNC-01 validator, min-wall table and engine FromName agree", async () => {
  const cs = await Deno.readTextFile(ctxCs);
  const engine = [...cs.matchAll(/^\s*"([A-Z0-9_-]+)" => \w+,/gm)].map((m) => m[1]).sort();
  const server = Object.keys(MATERIAL_MIN_WALL_MM).map((k) => k.toUpperCase()).sort();
  assertEquals(server, engine);
});

Deno.test("MAT-CF-01 a CF_3K_PLATE brief is accepted", async () => {
  const ctx: RunCtx = {
    runId: "r",
    projectId: "p",
    conversationId: "c",
    signal: new AbortController().signal,
  };
  const r = await submitDesignBriefTool.execute({
    title: "cf plate",
    category: "generic",
    parameters: [{ name: "thickness", value: 3, unit: "mm", rationale: "3 mm plate" }],
    physics_checks: [{
      name: "wall_thickness_min",
      formula: "t ≥ 1.5",
      computed: 3,
      limit: 1.5,
      pass: true,
    }],
    envelope_mm: { x: 100, y: 100, z: 3 },
    voxel_size_mm: 0.25,
    material: "CF_3K_PLATE",
  }, ctx);
  assert(r.ok && ctx.brief, JSON.stringify(r));
  assertEquals(MATERIAL_MIN_WALL_MM.CF_3K_PLATE, 1.5);
});
