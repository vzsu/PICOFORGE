// server/harness/anthropic.ts — the only file that imports the Anthropic SDK (CLAUDE.md #5).
// Implements docs/13 §2–§6 on @anthropic-ai/sdk 1.x:
//   model claude-opus-5-5 by default, adaptive thinking (omitted: always on), effort set explicitly per
//   mode, streaming with max_tokens 64k, eager_input_streaming on every tool (inputs zod-validated by the
//   tools before anything runs), server-side refusal fallback ("default"), prompt caching on the frozen
//   system prompt plus top-level auto-caching, and assistant turns passed back UNCHANGED (thinking
//   blocks included, docs/13 §6). Retries: the SDK's own (429/5xx/connection) before failure row F6.
// The API key lives in ~/PicoForge/secret.env (or ANTHROPIC_API_KEY), hot-reloaded per call; it is
// never logged. With a custom base URL (a proxy) the beta-only fields are left off.

import Anthropic from "@anthropic-ai/sdk";
import { makeLogger } from "../log.ts";
import { err, ok, type Result } from "../domain/result.ts";
import { getConfig } from "../config.ts";
import { isMockModel, mockFanStream } from "./mock/fanModel.ts";

const log = makeLogger("harness.anthropic");

// ─── Harness-side message shapes (the orchestrator never touches SDK types) ─────────────────────

/** An assistant turn exactly as the API returned it; sent back unchanged (docs/13 §6). */
export type AssistantContent = Anthropic.Beta.BetaContentBlockParam[];

export interface AnthropicMessage {
  role: "user" | "assistant";
  /** Readable form (text, tool calls, tool results) used by the harness, tests and the mock model. */
  content: MessageContent[];
  /** Assistant turns from the real API: the exact blocks to send back (thinking included). */
  raw?: AssistantContent;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: ToolResultContent[]; is_error?: boolean }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StreamCallbacks {
  onTextDelta?: (delta: string) => void;
  /** Partial tool input as it streams (preview only; nothing runs from a partial input). */
  onInputJsonDelta?: (toolUseId: string, delta: string) => void;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn";

export interface TurnResult {
  stopReason: StopReason;
  textBlocks: string[];
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** Real API only: the assistant content blocks to append unchanged. */
  raw?: AssistantContent;
  /** Present when stopReason is "refusal" (the whole fallback chain declined). */
  refusal?: { category: string | null; explanation: string | null };
}

/** A typed model failure; `code` maps to a failure-table row (server/domain/failures.ts). */
export class ModelError extends Error {
  constructor(
    readonly code:
      | "API_KEY_MISSING"
      | "API_KEY_INVALID"
      | "ANTHROPIC_RATE_LIMIT"
      | "ANTHROPIC_ERROR"
      | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

// ─── Models and effort (docs/13 §2) ──────────────────────────────────────────

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Streaming requests: never low-balled; truncation costs a repair turn (docs/13 §2). */
export const MAX_OUTPUT_TOKENS = 64_000;

export const AVAILABLE_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast, cheapest)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2 (most capable, premium)" },
];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Mode = "low" | "std" | "deep" | "raman";
/** LOW low · STD medium · DEEP high · RAMAN high. Opus 5.5 defaults to medium, so always set it. */
export const EFFORT_BY_MODE: Readonly<Record<Mode, Effort>> = {
  low: "low",
  std: "medium",
  deep: "high",
  raman: "high",
};

// ─── Client (hot-reload key + base URL per call) ─────────────────────────────

let _client: Anthropic | null = null;
let _clientKey = "";
let _clientBaseUrl = "";

function credentials(): { apiKey?: string; baseURL?: string } {
  try {
    const cfg = getConfig();
    return { apiKey: cfg.ANTHROPIC_API_KEY, baseURL: cfg.ANTHROPIC_BASE_URL };
  } catch {
    // config not loaded (tests, CLI): environment
    return {
      apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
      baseURL: Deno.env.get("ANTHROPIC_BASE_URL"),
    };
  }
}

function getClient(): Result<{ client: Anthropic; viaProxy: boolean }, ModelError> {
  const { apiKey, baseURL } = credentials();
  if (!apiKey) {
    return err(
      new ModelError("API_KEY_MISSING", "No API key. Add one in Settings → Models and keys."),
    );
  }
  const base = baseURL ?? "";
  if (!_client || _clientKey !== apiKey || _clientBaseUrl !== base) {
    _client = new Anthropic({ apiKey, maxRetries: 4, ...(baseURL ? { baseURL } : {}) });
    _clientKey = apiKey;
    _clientBaseUrl = base;
    log.info("Anthropic client created", { hasBaseUrl: !!baseURL });
  }
  return ok({ client: _client, viaProxy: !!baseURL });
}

/** SDK errors → typed ModelError, most specific first (docs/13 §2). */
function classify(e: unknown): ModelError {
  if (e instanceof Anthropic.APIUserAbortError) return new ModelError("CANCELLED", "cancelled");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ModelError(
      "API_KEY_INVALID",
      "The API key was rejected. Check it in Settings → Models and keys.",
    );
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ModelError(
      "ANTHROPIC_RATE_LIMIT",
      "Model rate limit reached after retries. Try again shortly.",
    );
  }
  if (e instanceof Anthropic.APIError) {
    return new ModelError(
      "ANTHROPIC_ERROR",
      `Model API error ${e.status ?? ""}: ${e.message}`.trim(),
    );
  }
  return new ModelError("ANTHROPIC_ERROR", e instanceof Error ? e.message : String(e));
}

/** Free key check (no tokens): retrieve the default model with the given key. */
export async function testApiKey(
  apiKey: string,
  baseURL?: string,
): Promise<Result<true, ModelError>> {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, ...(baseURL ? { baseURL } : {}) });
    await client.models.retrieve(DEFAULT_MODEL);
    return ok(true);
  } catch (e) {
    return err(classify(e));
  }
}

// ─── Request mapping ─────────────────────────────────────────────────────────

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_TYPES)[number];
function isImageMediaType(t: string): t is ImageMediaType {
  return (IMAGE_TYPES as readonly string[]).includes(t);
}

function toSdkImage(
  source: { type: "base64"; media_type: string; data: string },
): Anthropic.Beta.BetaImageBlockParam {
  // Captures are PNG; anything unexpected is sent as PNG rather than rejected mid-run.
  const media_type = isImageMediaType(source.media_type) ? source.media_type : "image/png";
  return { type: "image", source: { type: "base64", media_type, data: source.data } };
}

function toSdkBlock(c: MessageContent): Anthropic.Beta.BetaContentBlockParam {
  switch (c.type) {
    case "text":
      return { type: "text", text: c.text };
    case "tool_use":
      return { type: "tool_use", id: c.id, name: c.name, input: c.input };
    case "image":
      return toSdkImage(c.source);
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: c.tool_use_id,
        ...(c.is_error ? { is_error: true } : {}),
        content: c.content.map((r) =>
          r.type === "text" ? { type: "text", text: r.text } : toSdkImage(r.source)
        ),
      };
  }
}

function toSdkMessage(m: AnthropicMessage): Anthropic.Beta.BetaMessageParam {
  if (m.role === "assistant" && m.raw) return { role: "assistant", content: m.raw };
  return { role: m.role, content: m.content.map(toSdkBlock) };
}

function toSdkTool(t: ToolDefinition, viaProxy: boolean): Anthropic.Beta.BetaTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: { ...t.input_schema, type: "object" },
    // Large inputs (briefs, C# files) stream as generated; the tools zod-validate before running.
    ...(viaProxy ? {} : { eager_input_streaming: true }),
  };
}

function mapStop(s: Anthropic.Beta.BetaStopReason | null): StopReason {
  switch (s) {
    case "tool_use":
    case "max_tokens":
    case "refusal":
    case "pause_turn":
      return s;
    case "model_context_window_exceeded":
      return "max_tokens";
    default:
      return "end_turn"; // end_turn, stop_sequence, compaction
  }
}

// ─── Streaming one assistant turn ────────────────────────────────────────────

export interface StreamArgs {
  model: string;
  maxTokens: number;
  effort: Effort;
  system: string;
  messages: AnthropicMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

/** Stream one assistant turn. Returns a Result; never throws. */
export async function createMessageStream(
  args: StreamArgs,
  callbacks?: StreamCallbacks,
): Promise<Result<TurnResult, Error>> {
  // docs/11 §5: PICOFORGE_MODEL=mock replays a scripted fan run with token timing (no network, no key).
  if (isMockModel()) {
    try {
      return ok(await mockFanStream({ messages: args.messages, signal: args.signal }, callbacks));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
  const c = getClient();
  if (!c.ok) return c;
  const { client, viaProxy } = c.value;
  if (args.signal?.aborted) return err(new ModelError("CANCELLED", "cancelled"));

  // A tool input that cannot be parsed at all (eager streaming) or a dropped connection re-issues the
  // turn, at most twice; API errors are not retried here (the SDK already did).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stream = client.beta.messages.stream(
        {
          model: args.model,
          max_tokens: Math.min(args.maxTokens, MAX_OUTPUT_TOKENS),
          system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
          messages: args.messages.map(toSdkMessage),
          tools: args.tools.map((t) => toSdkTool(t, viaProxy)),
          output_config: { effort: args.effort },
          cache_control: { type: "ephemeral" }, // auto-cache the growing conversation each turn
          ...(viaProxy ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
        },
        { signal: args.signal },
      );
      const toolIds = new Map<number, string>();
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          toolIds.set(ev.index, ev.content_block.id);
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") callbacks?.onTextDelta?.(ev.delta.text);
          else if (ev.delta.type === "input_json_delta") {
            callbacks?.onInputJsonDelta?.(toolIds.get(ev.index) ?? "", ev.delta.partial_json);
          }
        }
      }
      const message = await stream.finalMessage();
      const textBlocks: string[] = [];
      const toolCalls: TurnResult["toolCalls"] = [];
      for (const b of message.content) {
        if (b.type === "text") textBlocks.push(b.text);
        else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, input: b.input });
      }
      const stopReason = mapStop(message.stop_reason);
      const turn: TurnResult = {
        stopReason,
        textBlocks,
        toolCalls,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        raw: message.content,
        ...(stopReason === "refusal"
          ? {
            refusal: {
              category: message.stop_details?.category ?? null,
              explanation: message.stop_details?.explanation ?? null,
            },
          }
          : {}),
      };
      log.info("model turn", {
        model: message.model,
        stopReason,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        toolCalls: toolCalls.length,
      });
      return ok(turn);
    } catch (e) {
      if (args.signal?.aborted) return err(new ModelError("CANCELLED", "cancelled"));
      if (e instanceof Anthropic.APIError || attempt === 2) return err(classify(e));
      log.warn("turn re-issued: unparseable tool input or dropped connection", {
        attempt,
        error: String(e),
      });
    }
  }
  return err(new ModelError("ANTHROPIC_ERROR", "turn failed"));
}
