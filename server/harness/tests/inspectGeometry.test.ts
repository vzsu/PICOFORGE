// server/harness/tests/inspectGeometry.test.ts — TOOL-INSPECT-01..04
// inspect_geometry calls `engine.inspect {target, ops}` through the engine port (04 §5).

import { resolve } from "jsr:@std/path@^1.0.0";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { inspectGeometryTool } from "../tools/inspectGeometry.ts";
import type { RunCtx } from "../tools/_base.ts";
import type { EngineApi, EngineInspectRequest, InspectOp } from "../../engine/client.ts";

function ctxWith(engine: EngineApi | undefined, lastArtifactId?: string): RunCtx {
  return {
    runId: "run-insp",
    projectId: "p",
    conversationId: "c",
    signal: new AbortController().signal,
    engineClient: engine,
    lastArtifactId,
  };
}

function fakeEngine(reply: unknown): { engine: EngineApi; calls: EngineInspectRequest[] } {
  const calls: EngineInspectRequest[] = [];
  const engine: EngineApi = {
    compile: () => Promise.resolve({ ok: true }),
    run: () => Promise.resolve({ ok: true }),
    inspect: (req) => {
      calls.push(req);
      return Promise.resolve(reply);
    },
  };
  return { engine, calls };
}

const MEASURED = {
  target: "art-1",
  measurements: {
    volumeCm3: 42.7,
    areaCm2: 310.2,
    bboxMin: [-40, -40, 0],
    bboxMax: [40, 40, 24],
    triangles: 412208,
    watertight: true,
    minWallMm: 1.62,
  },
  results: [{ type: "section", contours: 3 }],
};

Deno.test("TOOL-INSPECT-01: sends {target, ops} to engine.inspect and returns measurements", async () => {
  const { engine, calls } = fakeEngine({ ok: true, value: MEASURED });
  const ops: InspectOp[] = [{ type: "volume" }, { type: "section", plane: "z", offset_mm: 5 }];

  const r = await inspectGeometryTool.execute({ ops }, ctxWith(engine, "art-1"));

  // B-013: the engine needs the run folder path, not the artifact id
  assertEquals(calls, [{ target: resolve("runs", "art-1").replaceAll("\\", "/"), ops }]);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, MEASURED);
});

Deno.test("TOOL-INSPECT-02: no built geometry → error, engine not called", async () => {
  const { engine, calls } = fakeEngine({ ok: true, value: MEASURED });
  const r = await inspectGeometryTool.execute({ ops: [{ type: "bbox" }] }, ctxWith(engine));
  assertEquals(calls.length, 0);
  assertEquals(r.ok, true);
  if (r.ok) assertStringIncludes(JSON.stringify(r.value), "NO_GEOMETRY");
});

Deno.test("TOOL-INSPECT-03: engine error and malformed reply become typed errors", async () => {
  const failing = fakeEngine({ ok: false, error: { code: "TIMEOUT", detail: "inspect 30s" } });
  const r1 = await inspectGeometryTool.execute(
    { ops: [{ type: "wall_min" }] },
    ctxWith(failing.engine, "art-1"),
  );
  if (r1.ok) assertStringIncludes(JSON.stringify(r1.value), "TIMEOUT");

  const garbage = fakeEngine({ ok: true, value: { volume: "lots" } });
  const r2 = await inspectGeometryTool.execute(
    { ops: [{ type: "volume" }] },
    ctxWith(garbage.engine, "art-1"),
  );
  assertEquals(r2.ok, true);
  if (r2.ok) assertStringIncludes(JSON.stringify(r2.value), "ENGINE_PROTOCOL");
});

Deno.test("TOOL-INSPECT-04: no engine → ENGINE_NOT_READY; bad ops rejected by zod", async () => {
  const r1 = await inspectGeometryTool.execute(
    { ops: [{ type: "bbox" }] },
    ctxWith(undefined, "a"),
  );
  if (r1.ok) assertStringIncludes(JSON.stringify(r1.value), "ENGINE_NOT_READY");

  const { engine, calls } = fakeEngine({ ok: true, value: MEASURED });
  const r2 = await inspectGeometryTool.execute(
    { ops: [{ type: "section", plane: "w" }] },
    ctxWith(engine, "a"),
  );
  assertEquals(r2.ok, false);
  assertEquals(calls.length, 0);
});
