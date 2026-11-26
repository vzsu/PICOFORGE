// server/harness/tests/mockFanModel.test.ts — HARNESS-MOCK-* (docs/11 §5 mock model)
// PICOFORGE_MODEL=mock makes createMessageStream replay a scripted fan run with token timing:
// no network, no API key. The brief must pass the real validator and the code the real L0 lint.

import { assert, assertEquals, assertGreater, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { type AnthropicMessage, createMessageStream } from "../anthropic.ts";
import { parseFanPrompt } from "../mock/fanModel.ts";
import { validateBrief } from "../tools/submitDesignBrief.ts";
import { submitDesignBriefTool } from "../tools/submitDesignBrief.ts";
import { runPicoGKTool } from "../tools/runPicoGK.ts";
import { driveRun } from "../orchestrator.ts";
import type { EngineApi } from "../../engine/client.ts";

const FAN_PROMPT = "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";

function withMockEnv<T>(tps: string, fn: () => Promise<T>): Promise<T> {
  const prevModel = Deno.env.get("PICOFORGE_MODEL");
  const prevTps = Deno.env.get("PICOFORGE_MOCK_TPS");
  const prevKey = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.set("PICOFORGE_MODEL", "mock");
  Deno.env.set("PICOFORGE_MOCK_TPS", tps);
  Deno.env.delete("ANTHROPIC_API_KEY"); // mock must not need a key
  const restore = () => {
    if (prevModel === undefined) Deno.env.delete("PICOFORGE_MODEL");
    else Deno.env.set("PICOFORGE_MODEL", prevModel);
    if (prevTps === undefined) Deno.env.delete("PICOFORGE_MOCK_TPS");
    else Deno.env.set("PICOFORGE_MOCK_TPS", prevTps);
    if (prevKey !== undefined) Deno.env.set("ANTHROPIC_API_KEY", prevKey);
  };
  return fn().finally(restore);
}

const baseArgs = (messages: AnthropicMessage[]) => ({
  model: "mock",
  maxTokens: 4096,
  effort: "medium" as const,
  system: "",
  messages,
  tools: [],
});

const userText = (text: string): AnthropicMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

Deno.test("HARNESS-MOCK-01 prompt parser reads the fan prompt", () => {
  assertEquals(parseFanPrompt(FAN_PROMPT), {
    diameterMm: 120,
    blades: 7,
    hubDiameterMm: 25,
    material: "PLA",
  });
});

Deno.test("HARNESS-MOCK-02 mock turn 1 streams text + a brief the validator accepts", async () => {
  await withMockEnv("400", async () => {
    const deltas: string[] = [];
    const jsonDeltas: string[] = [];
    const t0 = performance.now();
    const res = await createMessageStream(baseArgs([userText(FAN_PROMPT)]), {
      onTextDelta: (d) => deltas.push(d),
      onInputJsonDelta: (_id, d) => jsonDeltas.push(d),
    });
    const ms = performance.now() - t0;
    assert(res.ok, `mock stream failed: ${!res.ok ? res.error.message : ""}`);
    const turn = res.value;
    assertEquals(turn.stopReason, "tool_use");
    assertEquals(turn.toolCalls.length, 1);
    assertEquals(turn.toolCalls[0].name, "submit_design_brief");
    // streamed, not one burst: many text deltas, partial tool-input deltas that join to the input
    assertGreater(deltas.length, 5);
    assertGreater(jsonDeltas.length, 5);
    assertEquals(deltas.join(""), turn.textBlocks.join(""));
    assertEquals(JSON.parse(jsonDeltas.join("")), turn.toolCalls[0].input);
    // token timing is real: output tokens / tps ≈ elapsed (lower bound, generous)
    assertGreater(ms, (turn.outputTokens / 400) * 1000 * 0.5);
    // the real brief tool accepts it
    const brief = await submitDesignBriefTool.execute(turn.toolCalls[0].input, {
      runId: "r",
      projectId: "p",
      conversationId: "c",
      signal: new AbortController().signal,
    });
    assert(brief.ok);
    assertEquals((brief.value as { accepted: boolean }).accepted, true);
  });
});

Deno.test("HARNESS-MOCK-03 mock drives the full orchestrator to geometry + done", async () => {
  await withMockEnv("0", async () => {
    const compiled: string[] = [];
    let runParams: unknown = null;
    const engine: EngineApi = {
      compile(code) {
        compiled.push(code);
        return Promise.resolve({ ok: true, value: { ok: true, diagnostics: [] } });
      },
      run(params) {
        runParams = params;
        return Promise.resolve({
          ok: true,
          value: {
            ok: true,
            stats: {
              volumeCm3: 31.2,
              bboxMin: [-59.5, -59.5, -1],
              bboxMax: [59.5, 59.5, 25],
              triangles: 200_000,
              watertight: true,
              voxelSizeMm: 0.5,
              minWallProbeMm: 1.8,
            },
          },
        });
      },
    };
    const states: string[] = [];
    const geometry: string[] = [];
    const text: string[] = [];
    const result = await driveRun({
      runId: "mock-run-1",
      projectId: "p",
      conversationId: "c",
      userMessage: FAN_PROMPT,
      history: [],
      signal: new AbortController().signal,
      ctx: { engineClient: engine, dataDir: "/tmp/pf" },
      callbacks: {
        onStateChange: (_r, s) => states.push(s),
        onGeometryReady: (_r, id) => geometry.push(id),
        onTextDelta: (_r, d) => text.push(d),
      },
    });
    assertEquals(result.state, "done");
    assertEquals(states, ["understanding", "briefing", "building", "done"]);
    assertEquals(geometry, ["mock-run-1"]);
    assertEquals(compiled.length, 1);
    // brief parameters reach the engine (08 §3) together with the brief voxel size
    const p = runParams as { params: Record<string, number>; voxelMm?: number };
    assertEquals(p.params.blade_count, 7);
    assertEquals(p.params.hub_radius, 12.5);
    assertEquals(p.voxelMm, 0.5);
    assertStringIncludes(text.join(""), "Built and validated: 31.2 cm³");
  });
});

Deno.test("HARNESS-MOCK-04 mock code passes L0 lint (no engine → ENGINE_NOT_READY, not lint)", async () => {
  await withMockEnv("0", async () => {
    const res = await createMessageStream(
      baseArgs([
        userText(FAN_PROMPT),
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "b", name: "submit_design_brief", input: {} }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "b",
            content: [{ type: "text", text: JSON.stringify({ accepted: true }) }],
          }],
        },
      ]),
    );
    assert(res.ok);
    const call = res.value.toolCalls[0];
    assertEquals(call.name, "run_picogk");
    const out = await runPicoGKTool.execute(call.input, {
      runId: "r",
      projectId: "p",
      conversationId: "c",
      signal: new AbortController().signal,
    });
    assert(out.ok);
    const v = out.value as { ok: boolean; error: { code: string } };
    assertEquals(v.error.code, "ENGINE_NOT_READY");
  });
});

Deno.test("HARNESS-MOCK-05 validateBrief accepts the mock brief for other fan sizes", async () => {
  const { fanBrief } = await import("../mock/fanModel.ts");
  for (const prompt of [FAN_PROMPT, "an 80 mm fan with 5 blades, 20 mm hub, PETG", "a fan"]) {
    const v = validateBrief(submitDesignBriefTool.zodInput.parse(fanBrief(parseFanPrompt(prompt))));
    assertEquals(v.violations, [], prompt);
  }
});
