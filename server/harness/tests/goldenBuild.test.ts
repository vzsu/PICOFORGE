// server/harness/tests/goldenBuild.test.ts — HARNESS-GOLD-params, HARNESS-GOLD-geometry
//
// Mock-model transcripts that drive the full orchestrator against a fake engine:
//   HARNESS-GOLD-params    accepted brief parameters reach the engine build call as {name: number}
//   HARNESS-GOLD-geometry  invalid geometry (L3) → repair message with measured numbers (04 §7 F4)

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { driveRun, type StreamFn } from "../orchestrator.ts";
import { MockModel } from "./mockModel.ts";
import type { EngineApi, EngineRunParams, EngineStats } from "../../engine/client.ts";

const FAN_BRIEF = {
  title: "Test Fan",
  category: "rotor_fan",
  requirements: ["5 blades"],
  parameters: [
    { name: "diameter", value: 80, unit: "mm", rationale: "fits" },
    { name: "blade_count", value: 5, unit: "count", rationale: "design" },
    { name: "hub_d", value: 22.5, unit: "mm", rationale: "motor shaft" },
  ],
  physics_checks: [
    { name: "tip_speed", formula: "v=ωr", computed: 50, limit: 200, pass: true },
    { name: "centrifugal_stress_sf", formula: "σ", computed: 2, limit: 10, pass: true },
    { name: "solidity", formula: "σ=Bc/πD", computed: 0.3, limit: 0.7, pass: true },
    { name: "min_blade_thickness", formula: "t=3×vox", computed: 1.5, limit: 0.8, pass: true },
  ],
  envelope_mm: { x: 100, y: 100, z: 50 },
  voxel_size_mm: 0.5,
  material: "PETG",
  assumptions: [],
  risks: [],
};

const VALID_CODE = `using PicoGK;
using PicoForge.Kit;
public static class Design {
    public static PicoGK.Voxels voxBuild(PicoForge.Kit.Ctx ctx) {
        return new PicoGK.Voxels(ctx.fVoxelMM);
    }
}`;

/** Stats that pass every L3 check for FAN_BRIEF (PETG, 0.5 mm voxels → min wall 1.5 mm). */
const GOOD_STATS: EngineStats = {
  volumeCm3: 42.7,
  bboxMin: [-40, -40, 0],
  bboxMax: [40, 40, 24],
  triangles: 412_208,
  watertight: true,
  voxelSizeMm: 0.5,
  minWallProbeMm: 1.62,
  buildMs: 4180,
};

function fakeEngine(
  statsPerRun: EngineStats[],
): { engine: EngineApi; runCalls: EngineRunParams[] } {
  const runCalls: EngineRunParams[] = [];
  const engine: EngineApi = {
    compile: () =>
      Promise.resolve({ ok: true, value: { ok: true, diagnostics: [], dllCached: false } }),
    run: (params) => {
      runCalls.push(params);
      const stats = statsPerRun[Math.min(runCalls.length - 1, statsPerRun.length - 1)];
      return Promise.resolve({ ok: true, value: { ok: true, stats } });
    },
  };
  return { engine, runCalls };
}

let n = 0;
async function drive(mock: MockModel, engine: EngineApi) {
  const geometry: string[] = [];
  const streamFn: StreamFn = (args, cb) => mock.stream(args, cb);
  const result = await driveRun({
    runId: `gold-build-${++n}`,
    projectId: "p",
    conversationId: "c",
    userMessage: "build a fan impeller with 5 blades, 80mm diameter",
    history: [],
    signal: new AbortController().signal,
    streamFn,
    ctx: { engineClient: engine },
    callbacks: { onGeometryReady: (_, artifactId) => geometry.push(artifactId) },
  });
  return { result, geometry };
}

Deno.test("HARNESS-GOLD-params: engine build receives the accepted brief's parameters", async () => {
  const { engine, runCalls } = fakeEngine([GOOD_STATS]);
  const mock = new MockModel([
    { tools: [{ id: "t1", name: "submit_design_brief", input: FAN_BRIEF }] },
    { tools: [{ id: "t2", name: "run_picogk", input: { code: VALID_CODE, notes: "initial" } }] },
    { text: "Built." },
  ]);

  const { result, geometry } = await drive(mock, engine);

  assertEquals(result.state, "done");
  assertEquals(runCalls.length, 1);
  assertEquals(runCalls[0].params, { diameter: 80, blade_count: 5, hub_d: 22.5 });
  assertEquals(geometry.length, 1);
});

/** Text of every tool_result the model received, in order. */
function toolResultTexts(mock: MockModel): string[] {
  const last = mock.calls[mock.calls.length - 1];
  const out: string[] = [];
  for (const m of last?.messages ?? []) {
    if (typeof m !== "object" || m === null || !("content" in m)) continue;
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_result" || !Array.isArray(block.content)) continue;
      for (const c of block.content) {
        if (c?.type === "text" && typeof c.text === "string") out.push(c.text);
      }
    }
  }
  return out;
}

Deno.test("HARNESS-GOLD-geometry: invalid geometry → repair message with measured numbers", async () => {
  // First build: wall 0.42 mm (PETG + 0.5 mm voxels needs 1.5) and z 61 mm (> 50 × 1.1 = 55).
  const thin: EngineStats = {
    ...GOOD_STATS,
    bboxMax: [40, 40, 61],
    minWallProbeMm: 0.42,
  };
  const { engine, runCalls } = fakeEngine([thin, GOOD_STATS]);
  const mock = new MockModel([
    { tools: [{ id: "t1", name: "submit_design_brief", input: FAN_BRIEF }] },
    { tools: [{ id: "t2", name: "run_picogk", input: { code: VALID_CODE, notes: "initial" } }] },
    { tools: [{ id: "t3", name: "run_picogk", input: { code: VALID_CODE, notes: "thicker" } }] },
    { text: "Fixed the wall." },
  ]);

  const { result, geometry } = await drive(mock, engine);

  assertEquals(result.state, "done");
  assertEquals(runCalls.length, 2);
  // Only the second (valid) build is announced as geometry.ready
  assertEquals(geometry.length, 1);

  const repair = toolResultTexts(mock)[1];
  assertStringIncludes(repair, "REPAIR CONTEXT (attempt 1/2 for ENVELOPE_EXCEEDED)");
  assertStringIncludes(repair, "BELOW_MIN_WALL");
  assertStringIncludes(repair, "0.42 mm");
  assertStringIncludes(repair, "1.5 mm");
  assertStringIncludes(repair, "z 61 mm > 55 mm (+6 mm)");
});

Deno.test("HARNESS-GOLD-geometry: geometry budget exhausted → stop-building instruction", async () => {
  const empty: EngineStats = { ...GOOD_STATS, volumeCm3: 0 };
  const { engine } = fakeEngine([empty]);
  const run = (id: string) => ({
    tools: [{ id, name: "run_picogk", input: { code: VALID_CODE, notes: id } }],
  });
  const mock = new MockModel([
    { tools: [{ id: "t1", name: "submit_design_brief", input: FAN_BRIEF }] },
    run("t2"),
    run("t3"),
    run("t4"),
    { text: "Stopping." },
  ]);

  const { geometry } = await drive(mock, engine);

  assertEquals(geometry.length, 0);
  const texts = toolResultTexts(mock);
  assertStringIncludes(texts[1], "EMPTY_GEOMETRY");
  assertStringIncludes(texts[3], "Stop building");
});

Deno.test("HARNESS-GOLD-params: no accepted brief → engine gets empty params", async () => {
  const { engine, runCalls } = fakeEngine([GOOD_STATS]);
  const rejected = { ...FAN_BRIEF, material: "Unobtainium" };
  const mock = new MockModel([
    { tools: [{ id: "t1", name: "submit_design_brief", input: rejected }] },
    { tools: [{ id: "t2", name: "run_picogk", input: { code: VALID_CODE, notes: "initial" } }] },
    { text: "Done." },
  ]);

  await drive(mock, engine);

  assertEquals(runCalls.length, 1);
  assertEquals(runCalls[0].params, {});
});
