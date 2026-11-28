// server/harness/tests/exportArtifact.test.ts — TOOL-EXPORT-01..03
// export_artifact asks the engine to write STL/3MF into the run folder and returns its URL.

import { resolve } from "jsr:@std/path@^1.0.0";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { exportArtifactTool } from "../tools/exportArtifact.ts";
import type { RunCtx } from "../tools/_base.ts";
import type { EngineApi, EngineExportRequest } from "../../engine/client.ts";

function ctxWith(engine: EngineApi | undefined, dataDir: string, lastArtifactId?: string): RunCtx {
  return {
    runId: "run-export-01",
    projectId: "p",
    conversationId: "c",
    signal: new AbortController().signal,
    engineClient: engine,
    dataDir,
    lastArtifactId,
  };
}

/** Fake engine that writes the requested file like the real host would. */
function writingEngine(): { engine: EngineApi; calls: EngineExportRequest[] } {
  const calls: EngineExportRequest[] = [];
  const engine: EngineApi = {
    compile: () => Promise.resolve({ ok: true }),
    run: () => Promise.resolve({ ok: true }),
    export: async (req) => {
      calls.push(req);
      const bytes = new TextEncoder().encode(`solid ${req.format}\nendsolid\n`);
      await Deno.writeFile(req.outPath, bytes);
      return { ok: true, value: { path: req.outPath, bytes: bytes.length } };
    },
  };
  return { engine, calls };
}

Deno.test("TOOL-EXPORT-01: STL lands in the run folder and the tool returns its URL", async () => {
  const dataDir = (await Deno.makeTempDir({ prefix: "pf_export_" })).replaceAll("\\", "/");
  const { engine, calls } = writingEngine();

  const r = await exportArtifactTool.execute(
    { format: "stl", filename: "fan.stl" },
    ctxWith(engine, dataDir, "art-9"),
  );

  const expectedPath = `${dataDir}/runs/run-export-01/exports/fan.stl`;
  const target = resolve(dataDir, "runs", "art-9").replaceAll("\\", "/"); // B-013
  assertEquals(calls, [{ target, format: "stl", outPath: expectedPath }]);
  assertEquals((await Deno.stat(expectedPath)).isFile, true);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.value, {
      filename: "fan.stl",
      format: "stl",
      bytes: "solid stl\nendsolid\n".length,
      url: "/files/runs/run-export-01/exports/fan.stl",
      message: "Ready: fan.stl",
    });
  }
  await Deno.remove(dataDir, { recursive: true });
});

Deno.test("TOOL-EXPORT-02: 3MF default name; path traversal in filename is neutralised", async () => {
  const dataDir = (await Deno.makeTempDir({ prefix: "pf_export_" })).replaceAll("\\", "/");
  const { engine, calls } = writingEngine();

  const r1 = await exportArtifactTool.execute({ format: "3mf" }, ctxWith(engine, dataDir, "a"));
  if (r1.ok) assertStringIncludes(JSON.stringify(r1.value), "/exports/part_xport-01.3mf");

  const r2 = await exportArtifactTool.execute(
    { format: "stl", filename: "../../evil.stl" },
    ctxWith(engine, dataDir, "a"),
  );
  assertEquals(r2.ok, true);
  assertEquals(calls[1].outPath, `${dataDir}/runs/run-export-01/exports/evil.stl`);
  await Deno.remove(dataDir, { recursive: true });
});

Deno.test("TOOL-EXPORT-03: engine claims success but no file on disk → typed error", async () => {
  const dataDir = (await Deno.makeTempDir({ prefix: "pf_export_" })).replaceAll("\\", "/");
  const engine: EngineApi = {
    compile: () => Promise.resolve({ ok: true }),
    run: () => Promise.resolve({ ok: true }),
    export: (req) => Promise.resolve({ ok: true, value: { path: req.outPath, bytes: 10 } }),
  };
  const r = await exportArtifactTool.execute({ format: "stl" }, ctxWith(engine, dataDir, "a"));
  assertEquals(r.ok, true);
  if (r.ok) assertStringIncludes(JSON.stringify(r.value), "EXPORT_MISSING");

  const none = await exportArtifactTool.execute(
    { format: "stl" },
    ctxWith(undefined, dataDir, "a"),
  );
  if (none.ok) assertStringIncludes(JSON.stringify(none.value), "ENGINE_NOT_READY");
  await Deno.remove(dataDir, { recursive: true });
});
