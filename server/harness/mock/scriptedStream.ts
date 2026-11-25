// server/harness/mock/scriptedStream.ts — replay one scripted model turn with token timing.
// docs/11 §5: "replays scripted streams with realistic token timing (configurable tokens per
// second), including partial tool input deltas". Used by the test MockModel and by the running
// server's mock model (PICOFORGE_MODEL=mock). No SDK, no network.

import type { StreamCallbacks, TurnResult } from "../anthropic.ts";

export interface ScriptedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  text?: string;
  tools?: ScriptedToolCall[];
}

/** Characters per token used to size deltas (English prose and code average about 4). */
const CHARS_PER_TOKEN = 4;
/** One delta batch per tick, like a server-sent-events stream flushes. */
const TICK_MS = 16;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("CANCELLED"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("CANCELLED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Emit `body` in token-sized deltas at `tokensPerSecond`; 0 or less emits it in one delta. */
async function emitDeltas(
  body: string,
  tokensPerSecond: number,
  emit: (delta: string) => void,
  signal?: AbortSignal,
): Promise<number> {
  const tokens = Math.max(1, Math.ceil(body.length / CHARS_PER_TOKEN));
  if (tokensPerSecond <= 0) {
    emit(body);
    return tokens;
  }
  const charsPerTick = Math.max(1, Math.round((tokensPerSecond * CHARS_PER_TOKEN * TICK_MS) / 1000));
  for (let i = 0; i < body.length; i += charsPerTick) {
    emit(body.slice(i, i + charsPerTick));
    await sleep(TICK_MS, signal);
  }
  return tokens;
}

/**
 * Stream one scripted turn through the same callbacks the real client uses and return the same
 * TurnResult shape. Throws Error("CANCELLED") when the signal aborts mid-stream.
 */
export async function streamScriptedTurn(
  turn: ScriptedTurn,
  opts: { tokensPerSecond: number; signal?: AbortSignal; inputTokens?: number },
  callbacks?: StreamCallbacks,
): Promise<TurnResult> {
  let outputTokens = 0;
  const textBlocks: string[] = [];
  if (turn.text) {
    outputTokens += await emitDeltas(
      turn.text,
      opts.tokensPerSecond,
      (d) => callbacks?.onTextDelta?.(d),
      opts.signal,
    );
    textBlocks.push(turn.text);
  }
  const toolCalls: TurnResult["toolCalls"] = [];
  for (const call of turn.tools ?? []) {
    outputTokens += await emitDeltas(
      JSON.stringify(call.input),
      opts.tokensPerSecond,
      (d) => callbacks?.onInputJsonDelta?.(call.id, d),
      opts.signal,
    );
    toolCalls.push({ id: call.id, name: call.name, input: call.input });
  }
  return {
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    textBlocks,
    toolCalls,
    inputTokens: opts.inputTokens ?? 0,
    outputTokens,
  };
}
