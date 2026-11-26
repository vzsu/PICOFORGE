// HARNESS-GOLD-refusal, -truncated, -raw, -invalid-input, -settings: the real-model loop rules of
// docs/13 §2, §4, §6, driven by a scripted StreamFn (no network).
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { driveRun, type StreamFn } from "../orchestrator.ts";
import type { AnthropicMessage, AssistantContent, StreamArgs, TurnResult } from "../anthropic.ts";
import type { EngineApi } from "../../engine/client.ts";

function scripted(turns: TurnResult[]): { fn: StreamFn; calls: StreamArgs[] } {
  const calls: StreamArgs[] = [];
  let i = 0;
  const fn: StreamFn = (args) => {
    // snapshot: the loop mutates its messages array after the call
    calls.push({ ...args, messages: args.messages.map((m) => ({ ...m })) });
    const t = turns[Math.min(i++, turns.length - 1)];
    return Promise.resolve({ ok: true, value: t });
  };
  return { fn, calls };
}

function engineSpy(): EngineApi & { runs: number } {
  const e = {
    runs: 0,
    compile: () => Promise.resolve({ ok: true, value: { ok: true, diagnostics: [] } }),
    run: () => {
      e.runs++;
      return Promise.resolve({ ok: true, value: { ok: true } });
    },
  };
  return e;
}

const base = (over: Partial<TurnResult>): TurnResult => ({
  stopReason: "end_turn",
  textBlocks: [],
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  ...over,
});

const runPicogk = {
  id: "t1",
  name: "run_picogk",
  input: { code: "public static class Design {}" },
};

async function drive(fn: StreamFn, engine: EngineApi, onError?: (code: string) => void) {
  return await driveRun({
    runId: "r",
    projectId: "p",
    conversationId: "c",
    userMessage: "make a bracket",
    history: [],
    signal: new AbortController().signal,
    ctx: { engineClient: engine, dataDir: "." },
    callbacks: { onError: (_r, code) => onError?.(code) },
    streamFn: fn,
    settings: { model: "claude-opus-5-5", effort: "high" },
  });
}

Deno.test("HARNESS-GOLD-refusal a refusal ends the run and never runs that turn's tools", async () => {
  const engine = engineSpy();
  const codes: string[] = [];
  const { fn } = scripted([
    base({
      stopReason: "refusal",
      toolCalls: [runPicogk],
      refusal: { category: "cyber", explanation: "declined" },
    }),
  ]);
  const r = await drive(fn, engine, (c) => codes.push(c));
  assertEquals(r.state, "failed");
  assertEquals(codes, ["MODEL_REFUSED"]);
  assertEquals(engine.runs, 0);
});

Deno.test("HARNESS-GOLD-truncated max_tokens with a tool call → INPUT_TRUNCATED results, nothing runs", async () => {
  const engine = engineSpy();
  const { fn, calls } = scripted([
    base({ stopReason: "max_tokens", toolCalls: [runPicogk] }),
    base({ stopReason: "end_turn", textBlocks: ["ok, shorter next time"] }),
  ]);
  const r = await drive(fn, engine);
  assertEquals(r.state, "done");
  assertEquals(engine.runs, 0);
  const last: AnthropicMessage | undefined = calls[1].messages.at(-1);
  assert(last && last.role === "user");
  const block = last.content[0];
  assert(block.type === "tool_result" && block.tool_use_id === "t1" && block.is_error === true);
  assert(JSON.stringify(block.content).includes("INPUT_TRUNCATED"));
});

Deno.test("HARNESS-GOLD-raw assistant blocks (thinking included) are sent back unchanged", async () => {
  const raw: AssistantContent = [
    { type: "thinking", thinking: "", signature: "sig-abc" },
    { type: "text", text: "Brief first." },
    { type: "tool_use", id: "t9", name: "search_docs", input: { query: "rotor" } },
  ];
  const { fn, calls } = scripted([
    base({
      stopReason: "tool_use",
      textBlocks: ["Brief first."],
      toolCalls: [{ id: "t9", name: "search_docs", input: { query: "rotor" } }],
      raw,
    }),
    base({ stopReason: "end_turn", textBlocks: ["done"] }),
  ]);
  const r = await drive(fn, engineSpy());
  assertEquals(r.state, "done");
  const assistant = calls[1].messages.find((m) => m.role === "assistant");
  assert(assistant);
  assertEquals(assistant.raw, raw); // identical blocks, signature included
});

Deno.test("HARNESS-GOLD-invalid-input an input that fails validation is returned is_error, never executed", async () => {
  const engine = engineSpy();
  const { fn, calls } = scripted([
    base({
      stopReason: "tool_use",
      toolCalls: [{ id: "t2", name: "submit_design_brief", input: {} }],
    }),
    base({ stopReason: "end_turn" }),
  ]);
  await drive(fn, engine);
  const last = calls[1].messages.at(-1);
  assert(last);
  const block = last.content[0];
  assert(block.type === "tool_result" && block.is_error === true);
  assert(JSON.stringify(block.content).includes("INVALID_INPUT"));
});

Deno.test("HARNESS-GOLD-settings model and effort reach the request; no sampling parameters", async () => {
  const { fn, calls } = scripted([base({ stopReason: "end_turn" })]);
  await drive(fn, engineSpy());
  assertEquals(calls[0].model, "claude-opus-5-5");
  assertEquals(calls[0].effort, "high");
  assertEquals(calls[0].maxTokens, 64_000);
  assert(!("temperature" in calls[0]));
  assert(calls[0].system.includes("### Voxels"), "the run prompt carries the API card");
});
