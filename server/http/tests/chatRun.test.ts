// server/http/tests/chatRun.test.ts — CHAT-RUN-01/02 (docs/04 §4 WS protocol, B-003)
// The WS chat path must give the orchestrator the engine and data dir, and every frame it emits
// must validate against ServerEventSchema (zod both directions, CLAUDE.md #2).

import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { type ChatFrame, runChat } from "../chatRun.ts";
import { ServerEventSchema } from "../../domain/events.ts";
import type { EngineApi, EngineRunParams } from "../../engine/client.ts";

const FAN_PROMPT = "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";

function withMock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("PICOFORGE_MODEL");
  const prevTps = Deno.env.get("PICOFORGE_MOCK_TPS");
  Deno.env.set("PICOFORGE_MODEL", "mock");
  Deno.env.set("PICOFORGE_MOCK_TPS", "0");
  return fn().finally(() => {
    if (prev === undefined) Deno.env.delete("PICOFORGE_MODEL");
    else Deno.env.set("PICOFORGE_MODEL", prev);
    if (prevTps === undefined) Deno.env.delete("PICOFORGE_MOCK_TPS");
    else Deno.env.set("PICOFORGE_MOCK_TPS", prevTps);
  });
}

function fakeEngine(): EngineApi & { runs: EngineRunParams[] } {
  const runs: EngineRunParams[] = [];
  return {
    runs,
    compile: () => Promise.resolve({ ok: true, value: { ok: true, diagnostics: [] } }),
    async run(p: EngineRunParams) {
      runs.push(p);
      await Deno.mkdir(p.outDir, { recursive: true });
      const stl = join(p.outDir, "part.stl");
      await Deno.writeFile(stl, new Uint8Array(84));
      return {
        ok: true,
        value: {
          ok: true,
          files: { stl },
          stats: {
            volumeCm3: 31.2,
            bboxMin: [-59.5, -59.5, 0],
            bboxMax: [59.5, 59.5, 24],
            triangles: 200_000,
            watertight: true,
            voxelSizeMm: 0.5,
            minWallProbeMm: 1.8,
          },
        },
      };
    },
  };
}

Deno.test("CHAT-RUN-01 mock fan prompt → brief block, text, states, geometry.ready with a served URL", async () => {
  await withMock(async () => {
    const dataDir = await Deno.makeTempDir({ prefix: "pf-chat-" });
    const engine = fakeEngine();
    const frames: ChatFrame[] = [];
    const final = await runChat(
      { emit: (f) => frames.push(f), engine, dataDir, signal: new AbortController().signal },
      { runId: "run-1", projectId: "p", conversationId: "c", text: FAN_PROMPT, history: [] },
    );
    assertEquals(final, "done");
    // every frame is a valid ServerEvent once the hub stamps a seq
    frames.forEach((f, i) => {
      const parsed = ServerEventSchema.safeParse({ ...f, seq: i });
      assert(
        parsed.success,
        `frame ${i} ${f.type} invalid: ${!parsed.success && parsed.error.message}`,
      );
    });
    const states = frames.flatMap((f) => f.type === "run.status" ? [f.state] : []);
    assertEquals(states, ["understanding", "briefing", "building", "done"]);
    const brief = frames.find((f) => f.type === "chat.block");
    assert(brief && brief.type === "chat.block", "no brief block");
    assert(JSON.stringify(brief.block).includes("blade_count"));
    assert(frames.some((f) => f.type === "chat.delta"), "no streamed text");
    const geo = frames.find((f) => f.type === "geometry.ready");
    assert(geo && geo.type === "geometry.ready", "no geometry.ready");
    assertEquals(geo.url, "/files/runs/run-1/part.stl");
    assertEquals(geo.stats.volumeCm3, 31.2);
    await Deno.stat(join(dataDir, "runs", "run-1", "part.stl")); // URL maps to a real file
    assertEquals(engine.runs[0].params?.blade_count, 7);
    assertEquals(frames.at(-1)?.type, "chat.done");
    await Deno.remove(dataDir, { recursive: true });
  });
});

Deno.test("CHAT-RUN-02 no engine → run fails with a typed error frame, never throws", async () => {
  await withMock(async () => {
    const frames: ChatFrame[] = [];
    const final = await runChat(
      { emit: (f) => frames.push(f), dataDir: ".", signal: new AbortController().signal },
      { runId: "run-2", projectId: "p", conversationId: "c", text: FAN_PROMPT, history: [] },
    );
    assertEquals(final, "done"); // mock reports the failed build in prose; no geometry
    assert(!frames.some((f) => f.type === "geometry.ready"));
    frames.forEach((f, i) => assert(ServerEventSchema.safeParse({ ...f, seq: i }).success, f.type));
  });
});
