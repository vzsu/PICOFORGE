// server/http/chatRun.ts — one chat turn from the WS: orchestrator → typed WS frames (docs/04 §4).
// B-003: the router used to call driveRun with ctx {wsHub} only (no engine, no data dir), so a
// browser run could never build. This module owns that wiring and emits only frames that match
// ServerEventSchema. DB writes stay in the router (onState).

import { relative } from "jsr:@std/path@^1.0.0";
import { driveRun, type RunState } from "../harness/orchestrator.ts";
import type { HistoryEntry } from "../harness/prompts/context.ts";
import { type EngineApi, engineStatsSchema } from "../engine/client.ts";
import type { ServerEvent } from "../domain/events.ts";
import { makeLogger } from "../log.ts";

const log = makeLogger("ws");

/** A server frame before the hub stamps its seq. */
export type ChatFrame = ServerEvent extends infer E ? E extends { seq: number } ? Omit<E, "seq">
  : never
  : never;

export interface ChatRunDeps {
  emit: (frame: ChatFrame) => void;
  engine?: EngineApi;
  dataDir: string;
  signal: AbortSignal;
  /** Persist run state (DB). Called for every state the orchestrator reports. */
  onState?: (runId: string, state: RunState, detail?: { code: string; detail: string }) => void;
}

export interface ChatRunArgs {
  runId: string;
  projectId: string;
  conversationId: string;
  text: string;
  history: HistoryEntry[];
}

/** `/files/<path relative to the data dir>`; null if the file is outside it. */
export function fileUrl(dataDir: string, absPath: string): string | null {
  const rel = relative(dataDir, absPath).replaceAll("\\", "/");
  if (rel.startsWith("..") || /^[A-Za-z]:/.test(rel) || rel.startsWith("/")) return null;
  return `/files/${rel}`;
}

/** Drive one run and translate orchestrator callbacks into WS frames. Never throws. */
export async function runChat(deps: ChatRunDeps, args: ChatRunArgs): Promise<RunState> {
  const { emit, dataDir } = deps;
  const { runId } = args;
  const status = (state: RunState) => {
    deps.onState?.(runId, state);
    emit({ type: "run.status", runId, state, attempt: 1 });
  };
  try {
    const result = await driveRun({
      runId,
      projectId: args.projectId,
      conversationId: args.conversationId,
      userMessage: args.text,
      history: args.history,
      signal: deps.signal,
      ctx: { dataDir, ...(deps.engine ? { engineClient: deps.engine } : {}) },
      callbacks: {
        onStateChange: (_r, state) => status(state),
        onTextDelta: (_r, delta) =>
          emit({ type: "chat.delta", messageId: runId, textDelta: delta }),
        onBrief: (_r, brief) =>
          emit({ type: "chat.block", messageId: runId, block: { kind: "brief", brief } }),
        onGeometryReady: (_r, artifactId, rawStats, files) => {
          const stats = engineStatsSchema.safeParse(rawStats);
          const stl = files?.stl;
          const url = stl ? fileUrl(dataDir, stl) : null;
          if (!stats.success || !url) {
            log.error("geometry.ready dropped: bad stats or file outside data dir", {
              runId,
              errId: "E-GEO-URL",
            });
            emit({
              type: "error",
              errId: "E-GEO-URL",
              code: "ENGINE_PROTOCOL",
              message: "The build finished but its mesh could not be served.",
              recoverable: true,
            });
            return;
          }
          const s = stats.data;
          emit({
            type: "geometry.ready",
            runId,
            artifactId,
            url,
            format: "stl",
            stats: {
              volumeCm3: s.volumeCm3,
              bbox: { min: s.bboxMin, max: s.bboxMax },
              triangles: s.triangles,
              watertight: s.watertight,
              voxelSizeMm: s.voxelSizeMm,
            },
          });
        },
        onError: (_r, code, detail) => {
          deps.onState?.(runId, "failed", { code, detail: String(detail) });
          emit({
            type: "error",
            errId: `E-${runId.slice(-6)}`,
            code,
            message: String(detail).slice(0, 400),
            recoverable: true,
          });
        },
      },
    });
    if (result.state === "done") {
      emit({ type: "chat.done", messageId: runId, usage: { inputTokens: 0, outputTokens: 0 } });
    }
    return result.state;
  } catch (e) {
    log.error("driveRun unhandled error", { runId, error: String(e), errId: "E-INTERNAL" });
    deps.onState?.(runId, "failed", { code: "INTERNAL", detail: String(e) });
    emit({ type: "run.status", runId, state: "failed", attempt: 1 });
    return "failed";
  }
}
