// server/harness/tools/_base.ts — shared types for all tool modules
// LLM_HARNESS §5: "one module per tool: {name, zodInput, jsonSchema, execute}"

import { z } from "npm:zod@^3.23.0";
import { resolve } from "jsr:@std/path@^1.0.0";
import { ToolDefinition } from "../anthropic.ts";
import { err, ok, Result } from "../../domain/result.ts";
import type { EngineApi } from "../../engine/client.ts";
import type { ServerFrame } from "../../domain/events.ts";

/** Canonical capture views (ViewportCaptureRequestEvent.view). */
export type CaptureView = "iso" | "front" | "top" | "right" | "current";

/** The WS hub the tools talk to (server/http/ws.ts `wsHub`). */
export interface WsHub {
  requestCapture(
    conversationId: string,
    view: CaptureView,
    timeoutMs: number,
  ): Promise<string | null>;
  sendToConversation(conversationId: string, frame: ServerFrame): Promise<void>;
}

export type { ToolDefinition };
export { err, ok, z };
export type { Result };

/** The parts of an accepted design brief that later tools need (set by submit_design_brief). */
export interface AcceptedBrief {
  parameters: Array<{ name: string; value: number; unit: string }>;
  envelope_mm: { x: number; y: number; z: number };
  voxel_size_mm: number;
  material: string;
}

/** Every run context the tools need (engine, db, ws hub refs). */
export interface RunCtx {
  runId: string;
  projectId: string;
  conversationId: string;
  signal: AbortSignal;
  // Injected by orchestrator before calling tools
  engineClient?: EngineApi; // only engine/client.ts speaks engine RPC
  db?: unknown; // DB from db/db.ts — typed in M3
  wsHub?: WsHub; // server/http/ws.ts; absent when headless (capture/ask degrade gracefully)
  /** Root under which run folders live (`<dataDir>/runs/<runId>`). Defaults to ".". */
  dataDir?: string;
  brief?: AcceptedBrief; // set by submit_design_brief on acceptance
  lastArtifactId?: string; // set by run_picogk on success
}

/** Run folder for a run: `<dataDir>/runs/<runId>` (forward slashes; served under `/files/`). */
export function runFolder(ctx: Pick<RunCtx, "dataDir" | "runId">): string {
  return `${ctx.dataDir ?? "."}/runs/${ctx.runId}`;
}

/**
 * The engine `target` for the last validated part: its run folder (the engine resolves
 * part.vdb / part.stl inside it), absolute. B-013: the tools sent the artifact id, which the engine
 * cannot resolve ("INSPECT_TARGET: Target not found").
 */
export function artifactTarget(ctx: Pick<RunCtx, "dataDir" | "lastArtifactId">): string | null {
  if (!ctx.lastArtifactId) return null;
  return resolve(ctx.dataDir ?? ".", "runs", ctx.lastArtifactId).replaceAll("\\", "/");
}

/** Shape every tool module must export. */
export interface ToolModule<TInput> {
  name: string;
  description: string;
  zodInput: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  jsonSchema: ToolDefinition["input_schema"];
  /** Input is untrusted model output: every tool zod-parses it first. */
  execute(input: unknown, ctx: RunCtx): Promise<Result<unknown, Error>>;
  /** Assembled Anthropic-format tool definition. */
  readonly def: ToolDefinition;
}

/** Build the ToolDefinition from module fields (call at module bottom). */
export function makeDef(
  name: string,
  description: string,
  schema: ToolDefinition["input_schema"],
): ToolDefinition {
  return { name, description, input_schema: schema };
}
