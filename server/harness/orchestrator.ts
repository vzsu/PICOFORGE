// server/harness/orchestrator.ts — LLM_HARNESS §6 orchestrator state machine
// driveRun: tool budget, repair loop, cancel, queue, state emission

import { z } from "zod";
import { makeLogger } from "../log.ts";
import { engineErrorSchema } from "../engine/client.ts";
import {
  type AnthropicMessage,
  createMessageStream,
  DEFAULT_MODEL,
  type Effort,
  MAX_OUTPUT_TOKENS,
  ModelError,
  type StreamArgs,
  type StreamCallbacks,
  type ToolDefinition,
  type TurnResult,
} from "./anthropic.ts";
import { type Result } from "../domain/result.ts";
import { TOOL_MAP, TOOLS } from "./tools/index.ts";
import type { RunCtx } from "./tools/_base.ts";
import {
  buildBudgetExhaustedInstruction,
  buildRepairHint,
  isBudgetExhausted,
} from "./prompts/repair.ts";
import { buildContextMessages, type HistoryEntry } from "./prompts/context.ts";
import { systemPromptForRun } from "./prompts/system.ts";

const log = makeLogger("harness.orchestrator");

// ─── Tool result shapes the loop reacts to (validated, never cast) ───────────

const askUserResultSchema = z.object({ __askUser: z.literal(true) }).passthrough();

const buildResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    artifactId: z.string(),
    stats: z.unknown(),
    files: z.record(z.string().nullable()).optional(),
  }).passthrough(),
  z.object({ ok: z.literal(false), error: engineErrorSchema }).passthrough(),
]);

// ─── Settings (overridden by DB settings in M3) ──────────────────────────────

// docs/13 §2: claude-opus-5-5, streaming with 64k max_tokens, effort explicit (STD = medium).
// No temperature: sampling parameters return a 400 on current models.
const DEFAULT_SETTINGS: { model: string; maxTokens: number; effort: Effort } = {
  model: DEFAULT_MODEL,
  maxTokens: MAX_OUTPUT_TOKENS,
  effort: "medium",
};

// ─── Tool budget ─────────────────────────────────────────────────────────────

const TOOL_CALL_BUDGET = 14; // LLM_HARNESS §6

// ─── Run state type ──────────────────────────────────────────────────────────

export type RunState =
  | "queued"
  | "understanding"
  | "briefing"
  | "building"
  | "inspecting"
  | "awaiting_user"
  | "done"
  | "failed"
  | "cancelled";

// ─── Callbacks injected by the server layer (M3 wires real versions) ─────────

export interface OrchestratorCallbacks {
  onStateChange?: (runId: string, state: RunState, detail?: unknown) => void;
  onTextDelta?: (runId: string, delta: string) => void;
  /** `files`: engine output paths by format (absolute, inside the run folder). */
  onGeometryReady?: (
    runId: string,
    artifactId: string,
    stats: unknown,
    files?: Record<string, string | null>,
  ) => void;
  /** An accepted design brief (the validated submit_design_brief input), for the brief card. */
  onBrief?: (runId: string, brief: unknown) => void;
  onError?: (runId: string, code: string, detail: unknown) => void;
}

// ─── Main driver ─────────────────────────────────────────────────────────────

/** Injectable stream function — defaults to real Anthropic client; tests inject mock */
export type StreamFn = (
  args: StreamArgs,
  callbacks?: StreamCallbacks,
) => Promise<Result<TurnResult, Error>>;

export async function driveRun(
  {
    runId,
    projectId,
    conversationId,
    userMessage,
    history,
    signal,
    ctx: runCtxOverrides,
    callbacks,
    settings,
    streamFn,
  }: {
    runId: string;
    projectId: string;
    conversationId: string;
    userMessage: string;
    history: HistoryEntry[];
    signal: AbortSignal;
    ctx?: Partial<RunCtx>;
    callbacks?: OrchestratorCallbacks;
    settings?: Partial<typeof DEFAULT_SETTINGS>;
    /** Inject a mock stream function in tests; omit in production */
    streamFn?: StreamFn;
  },
): Promise<{ state: RunState }> {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  let toolCallsLeft = TOOL_CALL_BUDGET;

  // Repair attempt counters per error code
  const repairAttempts: Record<string, number> = {};

  // Build RunCtx
  const runCtx: RunCtx = {
    runId,
    projectId,
    conversationId,
    signal,
    ...runCtxOverrides,
  };

  // Tool definitions for the API
  const toolDefs: ToolDefinition[] = TOOLS.map((t) => t.def);

  const emit = (state: RunState, detail?: unknown) => {
    callbacks?.onStateChange?.(runId, state, detail);
    log.info("run state", { runId, state });
  };

  // Build messages from history + append user message
  const contextMessages = buildContextMessages(history, {});
  const messages: AnthropicMessage[] = [
    ...contextMessages,
    { role: "user", content: [{ type: "text", text: userMessage }] },
  ];

  const system = await systemPromptForRun(); // + the real PicoGK/Kit API card (B-012)
  emit("understanding");

  // ─── Main loop ─────────────────────────────────────────────────────────────

  while (true) {
    if (signal.aborted) {
      emit("cancelled");
      return { state: "cancelled" };
    }

    const turnResult = await (streamFn ?? createMessageStream)(
      {
        model: s.model,
        maxTokens: s.maxTokens,
        effort: s.effort,
        system,
        messages,
        tools: toolDefs,
        signal,
      },
      {
        onTextDelta: (delta) => callbacks?.onTextDelta?.(runId, delta),
      },
    );

    if (!turnResult.ok) {
      const e = turnResult.error;
      if (e.message === "CANCELLED" || (e instanceof ModelError && e.code === "CANCELLED")) {
        emit("cancelled");
        return { state: "cancelled" };
      }
      const code = e instanceof ModelError ? e.code : "ANTHROPIC_ERROR";
      emit("failed", { code, detail: e.message });
      callbacks?.onError?.(runId, code, e.message);
      return { state: "failed" };
    }

    const turn = turnResult.value;

    // Append the assistant turn: readable form for the harness, raw blocks (thinking included) to
    // send back unchanged (docs/13 §6).
    const assistantContent: AnthropicMessage["content"] = [];
    for (const text of turn.textBlocks) {
      assistantContent.push({ type: "text", text });
    }
    for (const tc of turn.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({
      role: "assistant",
      content: assistantContent,
      ...(turn.raw ? { raw: turn.raw } : {}),
    });

    // A refusal can cut a tool input off mid-way: never run that turn's tools (docs/13 §4).
    if (turn.stopReason === "refusal") {
      const why = turn.refusal?.explanation ?? "The model declined this request.";
      emit("failed", { code: "MODEL_REFUSED", detail: why });
      callbacks?.onError?.(runId, "MODEL_REFUSED", why);
      return { state: "failed" };
    }
    // Server-side tool iteration limit: the assistant turn is appended, re-send to continue.
    if (turn.stopReason === "pause_turn") continue;

    if (turn.stopReason === "end_turn" || turn.toolCalls.length === 0) {
      emit("done");
      return { state: "done" };
    }

    // max_tokens with tool calls: the last input may be truncated yet still parse, so nothing runs.
    // Every call still needs a tool_result (the API requires one per tool_use).
    if (turn.stopReason === "max_tokens") {
      toolCallsLeft--;
      messages.push({
        role: "user",
        content: turn.toolCalls.map((call) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          is_error: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "INPUT_TRUNCATED",
                detail:
                  "Output hit max_tokens before this tool input was complete. Re-send it more compactly.",
              },
            }),
          }],
        })),
      });
      if (toolCallsLeft <= 0) {
        emit("failed", { code: "TOOL_BUDGET" });
        callbacks?.onError?.(
          runId,
          "TOOL_BUDGET",
          "Tool budget exhausted after truncated outputs.",
        );
        return { state: "failed" };
      }
      continue;
    }

    // ─── Tool dispatch ───────────────────────────────────────────────────────

    const toolResultContent: AnthropicMessage["content"] = [];

    for (const call of turn.toolCalls) {
      if (signal.aborted) {
        emit("cancelled");
        return { state: "cancelled" };
      }

      // Budget check: this call and any after it get the budget notice (one tool_result per tool_use).
      if (toolCallsLeft <= 0) {
        const budgetMsg = buildBudgetExhaustedInstruction("TOOL_BUDGET");
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: [{ type: "text", text: budgetMsg }],
        });
        continue;
      }
      toolCallsLeft--;

      // State transition based on tool
      const nextState: RunState = call.name === "submit_design_brief"
        ? "briefing"
        : call.name === "run_picogk"
        ? "building"
        : call.name === "inspect_geometry"
        ? "inspecting"
        : call.name === "capture_viewport"
        ? "inspecting"
        : call.name === "ask_user"
        ? "awaiting_user"
        : "understanding";
      emit(nextState);

      // Find and execute tool
      const tool = TOOL_MAP[call.name];
      if (!tool) {
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: [{ type: "text", text: `Unknown tool: ${call.name}` }],
        });
        continue;
      }

      const result = await tool.execute(call.input, runCtx);
      let resultText: string;

      // submitDesignBrief stores the accepted brief on runCtx; surface it for the brief card
      if (call.name === "submit_design_brief" && result.ok && runCtx.brief) {
        callbacks?.onBrief?.(runId, call.input);
      }

      let isError = false;
      if (!result.ok) {
        // Invalid (or eagerly-streamed, unvalidated) input: returned to the model, never executed.
        isError = true;
        resultText = JSON.stringify({
          error: { code: "INVALID_INPUT", detail: result.error.message },
        });
      } else {
        const value = result.value;
        const askUser = askUserResultSchema.safeParse(value);
        const build = call.name === "run_picogk" ? buildResultSchema.safeParse(value) : null;

        // Handle ask_user terminal
        if (askUser.success) {
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: [{ type: "text", text: JSON.stringify(value) }],
          });
          messages.push({ role: "user", content: toolResultContent });
          emit("awaiting_user");
          return { state: "awaiting_user" };
        }

        // run_picogk repair loop
        if (build?.success && !build.data.ok) {
          const runError = build.data.error;
          const errorCode = runError.code;
          repairAttempts[errorCode] = (repairAttempts[errorCode] ?? 0) + 1;

          if (isBudgetExhausted(errorCode, repairAttempts[errorCode])) {
            const exhaustedMsg = buildBudgetExhaustedInstruction(errorCode);
            resultText = exhaustedMsg;
          } else {
            const repairHint = buildRepairHint({
              errorCode,
              attempt: repairAttempts[errorCode],
              payload: runError,
            });
            resultText = repairHint;
          }
        } else if (build?.success && build.data.ok) {
          // Success (cleared L0–L3) — reset repair counters, emit geometry ready
          for (const key of Object.keys(repairAttempts)) delete repairAttempts[key];
          callbacks?.onGeometryReady?.(
            runId,
            build.data.artifactId,
            build.data.stats,
            build.data.files,
          );
          resultText = JSON.stringify(value);
        } else {
          resultText = JSON.stringify(value);
        }
      }

      toolResultContent.push({
        type: "tool_result",
        tool_use_id: call.id,
        ...(isError ? { is_error: true } : {}),
        content: [{ type: "text", text: resultText }],
      });
    }

    // Append all tool results as a single user message
    if (toolResultContent.length > 0) {
      messages.push({ role: "user", content: toolResultContent });
    }

    // Continue to next model turn
  }
}
