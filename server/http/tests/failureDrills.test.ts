// FAIL-F15-01, FAIL-F16-01 — failure drills for the rows added on 2026-11-25 (docs/04 §7).
// Each triggers the failure on purpose and asserts what the user (or agent) sees.

import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { type ChatFrame, runChat } from "../chatRun.ts";
import { ServerEventSchema } from "../../domain/events.ts";
import type { EngineApi } from "../../engine/client.ts";
import { inspectGeometryTool } from "../../harness/tools/inspectGeometry.ts";
import { failureRow } from "../../domain/failures.ts";

const FAN_PROMPT = "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";

async function withMock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("PICOFORGE_MODEL");
  const prevTps = Deno.env.get("PICOFORGE_MOCK_TPS");
  Deno.env.set("PICOFORGE_MODEL", "mock");
  Deno.env.set("PICOFORGE_MOCK_TPS", "0");
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("PICOFORGE_MODEL");
    else Deno.env.set("PICOFORGE_MODEL", prev);
    if (prevTps === undefined) Deno.env.delete("PICOFORGE_MOCK_TPS");
    else Deno.env.set("PICOFORGE_MOCK_TPS", prevTps);
  }
}

Deno.test("FAIL-F15-01 malformed engine build reply → no geometry, typed ENGINE_PROTOCOL, run survives", async () => {
  await withMock(async () => {
    let runs = 0;
    const engine: EngineApi = {
      compile: () => Promise.resolve({ ok: true, value: { ok: true, diagnostics: [] } }),
      // ok:true but the stats are missing required fields: the reply fails its schema
      run: () => {
        runs++;
        return Promise.resolve({ ok: true, value: { ok: true, stats: { volumeCm3: 1 } } });
      },
    };
    const frames: ChatFrame[] = [];
    const final = await runChat(
      { emit: (f) => frames.push(f), engine, dataDir: ".", signal: new AbortController().signal },
      { runId: "drill-f15", projectId: "p", conversationId: "c", text: FAN_PROMPT, history: [] },
    );
    assertEquals(runs, 1, "the build ran once");
    assert(!frames.some((f) => f.type === "geometry.ready"), "reply discarded, nothing applied");
    frames.forEach((f, i) => assert(ServerEventSchema.safeParse({ ...f, seq: i }).success, f.type));
    const text = frames.flatMap((f) => (f.type === "chat.delta" ? [f.textDelta] : [])).join("");
    assert(
      text.includes("ENGINE_PROTOCOL"),
      `agent saw the typed error; text: ${text.slice(-300)}`,
    );
    assertEquals(failureRow("ENGINE_PROTOCOL"), "F15");
    assert(final === "done" || final === "failed", `run ended cleanly (${final})`);
  });
});

Deno.test("FAIL-F16-01 inspect before any build → typed NO_GEOMETRY, engine never called", async () => {
  let calls = 0;
  const engine: EngineApi = {
    compile: () => Promise.resolve({ ok: true, value: {} }),
    run: () => Promise.resolve({ ok: true, value: {} }),
    inspect: () => {
      calls++;
      return Promise.resolve({ ok: true, value: {} });
    },
  };
  const res = await inspectGeometryTool.execute({ ops: [{ type: "bbox" }] }, {
    runId: "drill-f16",
    projectId: "p",
    conversationId: "c",
    signal: new AbortController().signal,
    engineClient: engine,
  });
  assert(res.ok);
  assertEquals(res.value, {
    error: { code: "NO_GEOMETRY", detail: "No geometry available — run run_picogk first" },
  });
  assertEquals(calls, 0, "tool not executed against the engine");
  assertEquals(failureRow("NO_GEOMETRY"), "F16");
});
