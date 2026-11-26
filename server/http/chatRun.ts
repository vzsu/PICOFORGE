// server/http/chatRun.ts — one chat turn from the WS: orchestrator → typed WS frames (docs/04 §4).
// B-003: the router used to call driveRun with ctx {wsHub} only (no engine, no data dir), so a
// browser run could never build. This module owns that wiring and emits only frames that match
// ServerEventSchema. DB writes stay in the router (onState).

import { relative } from "jsr:@std/path@^1.0.0";
import { driveRun, type RunSettings, type RunState } from "../harness/orchestrator.ts";
import type { HistoryEntry } from "../harness/prompts/context.ts";
import { type EngineApi, engineStatsSchema } from "../engine/client.ts";
import type { ServerFrame } from "../domain/events.ts";
import type { ContentBlock, Message } from "../db/repo/messages.ts";
import type { WsHub } from "../harness/tools/_base.ts";
import { makeLogger } from "../log.ts";

const log = makeLogger("ws");

/** A server frame before the hub stamps its seq. */
export type ChatFrame = ServerFrame;

export interface ChatRunDeps {
  emit: (frame: ChatFrame) => void;
  engine?: EngineApi;
  /** WS hub for capture_viewport / ask_user; absent when headless. */
  hub?: WsHub;
  dataDir: string;
  signal: AbortSignal;
  /** Persist run state (DB). Called for every state the orchestrator reports. */
  onState?: (runId: string, state: RunState, detail?: { code: string; detail: string }) => void;
  /** Persist the reply (DB), once per run, so the next turn sees it in its history. */
  onAssistant?: (blocks: ContentBlock[]) => void;
}

export interface ChatRunArgs {
  runId: string;
  projectId: string;
  conversationId: string;
  text: string;
  history: HistoryEntry[];
  /** Model, effort, speed for this run (server/http/runSettings.ts); absent → docs/13 defaults. */
  settings?: Partial<RunSettings>;
}

/** One stored block as text the model can read back on the next turn. */
function blockText(b: ContentBlock): string {
  switch (b.t) {
    case "text":
      return b.text;
    case "brief":
      return `[design brief accepted] ${JSON.stringify(b.brief)}`;
    case "geometry":
      return `[part built: artifact ${b.artifactId}]`;
    case "build":
      return `[build run ${b.runId}]`;
    case "error":
      return `[error ${b.code}] ${b.msg}`;
  }
}

/**
 * Stored conversation → model history. Leaves out the message being answered (the orchestrator
 * appends it) and system rows; briefs and errors keep their content as text, so a follow-up such
 * as "make it 140 mm" has the previous parameters to work from.
 */
export function historyFromMessages(messages: Message[], answeringId: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const m of messages) {
    if (m.id === answeringId || m.role === "system") continue;
    const blocks = m.content.map((b) => ({ type: "text" as const, text: blockText(b) }))
      .filter((b) => b.text.length > 0);
    if (blocks.length > 0) out.push({ role: m.role, blocks });
  }
  return out;
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
  // The reply as it will be stored: streamed text, the accepted brief, the built part, an error.
  let replyText = "";
  let briefBlock: ContentBlock | null = null;
  let geometryBlock: ContentBlock | null = null;
  let errorBlock: ContentBlock | null = null;
  const saveReply = () => {
    const blocks: ContentBlock[] = [];
    if (replyText.trim()) blocks.push({ t: "text", text: replyText.trim() });
    for (const b of [briefBlock, geometryBlock, errorBlock]) if (b) blocks.push(b);
    if (blocks.length > 0) deps.onAssistant?.(blocks);
  };
  try {
    const result = await driveRun({
      runId,
      projectId: args.projectId,
      conversationId: args.conversationId,
      userMessage: args.text,
      history: args.history,
      signal: deps.signal,
      ...(args.settings ? { settings: args.settings } : {}),
      ctx: {
        dataDir,
        ...(deps.engine ? { engineClient: deps.engine } : {}),
        ...(deps.hub ? { wsHub: deps.hub } : {}),
      },
      callbacks: {
        onStateChange: (_r, state) => status(state),
        onTextDelta: (_r, delta) => {
          replyText += delta;
          emit({ type: "chat.delta", messageId: runId, textDelta: delta });
        },
        onBrief: (_r, brief) => {
          briefBlock = { t: "brief", brief };
          emit({ type: "chat.block", messageId: runId, block: { kind: "brief", brief } });
        },
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
          geometryBlock = { t: "geometry", artifactId };
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
          errorBlock = { t: "error", code, msg: String(detail).slice(0, 400) };
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
    saveReply();
    if (result.state === "done") {
      emit({ type: "chat.done", messageId: runId, usage: { inputTokens: 0, outputTokens: 0 } });
    }
    return result.state;
  } catch (e) {
    log.error("driveRun unhandled error", { runId, error: String(e), errId: "E-INTERNAL" });
    errorBlock = { t: "error", code: "INTERNAL", msg: "The run stopped on an internal error." };
    saveReply();
    deps.onState?.(runId, "failed", { code: "INTERNAL", detail: String(e) });
    emit({ type: "run.status", runId, state: "failed", attempt: 1 });
    return "failed";
  }
}
