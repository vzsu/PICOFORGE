// server/mcp/agentTools.ts — the MCP tool surface (docs/14 §3) as an adapter over the harness tools.
// docs/14 §1: adapter, not fork. Every design tool runs the same executor the internal agent uses
// (same schemas, same lint, same validation ladder); this module only adds what an external agent
// needs: a project to work in, the brief/repair state between stateless calls, the limits of
// docs/14 §9, and the frames that show the agent's work live in the open window (docs/14 §10).
//
// Until P1 adds variants, `projectId` stands in for `variantId` (one variant per project).
// Agent state lives in memory: after a server restart the agent re-submits its brief.

import { z } from "zod";
import { TOOL_MAP } from "../harness/tools/index.ts";
import type { AcceptedBrief, RunCtx, WsHub } from "../harness/tools/_base.ts";
import { type EngineApi, engineErrorSchema, engineStatsSchema } from "../engine/client.ts";
import type { ServerFrame } from "../domain/events.ts";
import { projectCreate, projectGet, projectList, projectUpdate } from "../db/repo/projects.ts";
import { conversationCreate, conversationList } from "../db/repo/conversations.ts";
import { type ContentBlock, messageCreate } from "../db/repo/messages.ts";
import { runCreate, runGet, runListForConversation, runUpdateState } from "../db/repo/runs.ts";
import { join } from "jsr:@std/path@^1.0.0";
import { fileUrl } from "../http/chatRun.ts";
import { buildRepairHint, isBudgetExhausted } from "../harness/prompts/repair.ts";
import { makeLogger } from "../log.ts";

const log = makeLogger("mcp");

// ─── Wiring ──────────────────────────────────────────────────────────────────

export interface McpDeps {
  engine?: EngineApi;
  /** Live window (captures); absent when headless. */
  hub?: WsHub;
  dataDir: string;
  /** Frame to one conversation's open windows. */
  emit: (conversationId: string, frame: ServerFrame) => void;
  /** Frame to every open window (session.focus). */
  emitAll: (frame: ServerFrame) => void;
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export interface AgentTool {
  name: string;
  /** Short, states preconditions plainly (docs/14 §3). */
  description: string;
  inputSchema: JsonSchema;
  run(args: Record<string, unknown>, deps: McpDeps, origin: string): Promise<McpToolResult>;
}

// ─── Limits (docs/14 §9) ─────────────────────────────────────────────────────

export const BUILDS_PER_BRIEF = 14;
export const BUILDS_PER_MINUTE = 6;

// ─── Per-project agent state ─────────────────────────────────────────────────

interface Workspace {
  projectId: string;
  projectName: string;
  conversationId: string;
  brief?: AcceptedBrief;
  lastArtifactId?: string;
  lastRunId?: string;
  busy: boolean;
  buildsLeft: number;
  repairs: Record<string, number>;
  /** Set when a repair budget is spent: builds wait for a decision or a new brief. */
  blockedOn?: string;
  recentBuilds: number[];
}

const workspaces = new Map<string, Workspace>();

/** Test hook: forget all agent state. */
export function resetWorkspaces(): void {
  workspaces.clear();
}

function firstConversation(projectId: string): string {
  return (conversationList(projectId)[0] ?? conversationCreate(projectId, "Main")).id;
}

/** The fields of a saved brief.json that later tools need (AcceptedBrief), validated. */
const savedBriefSchema = z.object({
  parameters: z.array(
    z.object({ name: z.string(), value: z.number(), unit: z.string() }).passthrough(),
  ),
  envelope_mm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  voxel_size_mm: z.number().positive(),
  material: z.string(),
}).passthrough();

/**
 * MCP-07: agent state survives a server restart. The newest finished run of the project whose mesh
 * is on disk becomes the last part, and its saved brief.json the accepted brief, so the agent can
 * inspect, capture, export and rebuild without starting over.
 */
function restoreFromDisk(ws: Workspace, dataDir: string): void {
  for (const r of runListForConversation(ws.conversationId)) {
    if (r.state !== "done") continue;
    const dir = join(dataDir, "runs", r.id);
    try {
      if (!Deno.statSync(join(dir, "part.stl")).isFile) continue;
    } catch {
      continue;
    }
    ws.lastRunId = r.id;
    ws.lastArtifactId = r.id;
    try {
      const b = savedBriefSchema.safeParse(
        JSON.parse(Deno.readTextFileSync(join(dir, "brief.json"))),
      );
      if (b.success) ws.brief = b.data;
    } catch { /* built before briefs were saved: the agent resubmits */ }
    return;
  }
}

function workspaceFor(projectId: string, dataDir: string): Workspace | null {
  const known = workspaces.get(projectId);
  if (known) return known;
  const p = projectGet(projectId);
  if (!p || p.archived) return null;
  const ws: Workspace = {
    projectId: p.id,
    projectName: p.name,
    conversationId: firstConversation(p.id),
    busy: false,
    buildsLeft: BUILDS_PER_BRIEF,
    repairs: {},
    recentBuilds: [],
  };
  restoreFromDisk(ws, dataDir);
  workspaces.set(p.id, ws);
  return ws;
}

// ─── Results ─────────────────────────────────────────────────────────────────

const json = (value: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 1) }],
});

/** A typed error with its next step (docs/14 §4). */
function fail(code: string, message: string, extra: Record<string, unknown> = {}): McpToolResult {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({ ok: false, code, message, ...extra }, null, 1),
    }],
  };
}

const projectIdSchema = z.object({ projectId: z.string().min(1) }).passthrough();
const PROJECT_ID_PROP = {
  projectId: { type: "string", description: "From open_project." },
} as const;

/** A harness tool's JSON schema (one schema source, docs/14 §1) as an MCP object schema. */
function objectSchema(s: Record<string, unknown>): JsonSchema {
  const props = s.properties;
  const req = Array.isArray(s.required) ? s.required.filter((x) => typeof x === "string") : [];
  return {
    type: "object",
    properties: typeof props === "object" && props !== null && !Array.isArray(props)
      ? { ...props }
      : {},
    ...(req.length ? { required: req } : {}),
  };
}

function withProject(schema: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: { ...PROJECT_ID_PROP, ...schema.properties },
    required: ["projectId", ...(schema.required ?? [])],
  };
}

/** Resolve the workspace, or the typed error to return. */
function workspaceArg(args: Record<string, unknown>, dataDir: string): Workspace | McpToolResult {
  const p = projectIdSchema.safeParse(args);
  if (!p.success) return fail("INVALID_INPUT", "projectId is required; call open_project first.");
  return workspaceFor(p.data.projectId, dataDir) ??
    fail("NOT_FOUND", "No such project. Call open_project to get a projectId.");
}

const isResult = (v: Workspace | McpToolResult): v is McpToolResult => "content" in v;

function without(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _drop, ...rest } = args;
  return rest;
}

function ctxFor(ws: Workspace, deps: McpDeps, runId: string, signal: AbortSignal): RunCtx {
  return {
    runId,
    projectId: ws.projectId,
    conversationId: ws.conversationId,
    signal,
    dataDir: deps.dataDir,
    ...(deps.engine ? { engineClient: deps.engine } : {}),
    ...(deps.hub ? { wsHub: deps.hub } : {}),
    ...(ws.brief ? { brief: ws.brief } : {}),
    ...(ws.lastArtifactId ? { lastArtifactId: ws.lastArtifactId } : {}),
  };
}

/** Store a message and show it in the open window with the agent's origin chip. */
function postToChat(
  ws: Workspace,
  deps: McpDeps,
  role: "user" | "assistant",
  blocks: ContentBlock[],
  origin: string,
): void {
  const msg = messageCreate(ws.conversationId, role, blocks);
  const text = blocks.map((b) => (b.t === "text" ? b.text : "")).join("\n").trim();
  if (text) {
    deps.emit(ws.conversationId, {
      type: "message.created",
      message: {
        id: msg.id,
        role,
        content: text,
        createdAt: msg.createdAt,
        origin: `mcp:${origin}`,
      },
    });
  }
}

// ─── Run-result shape from run_picogk (validated, never cast) ────────────────

const buildOk = z.object({
  ok: z.literal(true),
  artifactId: z.string(),
  stats: z.unknown(),
  files: z.record(z.string().nullable()).optional(),
  warnings: z.array(z.unknown()).optional(),
  logTail: z.array(z.unknown()).optional(),
}).passthrough();
const buildFail = z.object({
  ok: z.literal(false),
  error: engineErrorSchema.or(z.record(z.unknown())),
})
  .passthrough();

// ─── Tools ───────────────────────────────────────────────────────────────────

const openProject: AgentTool = {
  name: "open_project",
  description:
    "Open (or create) a PicoForge project and show it in the user's window. Without projectName, opens the project the user has open. Returns projectId for every other tool.",
  inputSchema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "Project to open or create, e.g. 'FPV props'." },
    },
  },
  run(args, deps, origin) {
    const parsed = z.object({ projectName: z.string().trim().min(1).max(80).optional() })
      .safeParse(args);
    if (!parsed.success) return Promise.resolve(fail("INVALID_INPUT", parsed.error.message));
    const name = parsed.data.projectName;
    const all = projectList();
    const project = name
      ? all.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? projectCreate(name)
      : all[0] ?? projectCreate("Studio");
    projectUpdate(project.id, {}); // most recent first: a reload opens this project too
    const ws = workspaceFor(project.id, deps.dataDir);
    if (!ws) return Promise.resolve(fail("NOT_FOUND", "Project could not be opened."));
    deps.emitAll({
      type: "session.focus",
      projectId: ws.projectId,
      projectName: ws.projectName,
      conversationId: ws.conversationId,
      origin: `mcp:${origin}`,
    });
    log.info("project opened", { client: origin, projectId: ws.projectId });
    return Promise.resolve(json({
      projectId: ws.projectId,
      projectName: ws.projectName,
      briefAccepted: !!ws.brief,
      engine: deps.engine ? "ready" : "not running",
      next: ws.brief
        ? "Brief already accepted: build with run_picogk, or resubmit the brief to change direction."
        : "Read picoforge://guide (or the forge_engineer prompt), then post_message the request, then submit_design_brief.",
    }));
  },
};

const postMessage: AgentTool = {
  name: "post_message",
  description:
    "Show a short message in the PicoForge chat so the user can follow along. kind 'request': the human's request as you received it (post it first). 'plan': what you will do. 'report': the result with key numbers.",
  inputSchema: withProject({
    type: "object",
    properties: {
      text: { type: "string", description: "Plain text, under ~1500 characters." },
      kind: { type: "string", enum: ["request", "plan", "report"] },
    },
    required: ["text"],
  }),
  run(args, deps, origin) {
    const ws = workspaceArg(args, deps.dataDir);
    if (isResult(ws)) return Promise.resolve(ws);
    const p = z.object({
      text: z.string().trim().min(1).max(4000),
      kind: z.enum(["request", "plan", "report"]).default("plan"),
    }).safeParse(without(args, "projectId"));
    if (!p.success) return Promise.resolve(fail("INVALID_INPUT", p.error.message));
    postToChat(ws, deps, p.data.kind === "request" ? "user" : "assistant", [
      { t: "text", text: p.data.text },
    ], origin);
    return Promise.resolve(json({ ok: true, shown: true }));
  },
};

/** search_docs needs no project: the knowledge base is global. */
const searchDocs: AgentTool = {
  name: "search_docs",
  description: TOOL_MAP.search_docs.description,
  inputSchema: objectSchema(TOOL_MAP.search_docs.jsonSchema),
  async run(args) {
    const r = await TOOL_MAP.search_docs.execute(args, {
      runId: "mcp-docs",
      projectId: "",
      conversationId: "",
      signal: new AbortController().signal,
    });
    return r.ok ? json(r.value) : fail("INVALID_INPUT", r.error.message);
  },
};

const submitBrief: AgentTool = {
  name: "submit_design_brief",
  description:
    "Register the design brief (required before any build). The server validates envelope, voxel budget, units, material and the physics checks the category requires; fix every violation it returns and resubmit. Every governing dimension becomes a parameter the code reads with ctx.P(name).",
  inputSchema: withProject(objectSchema(TOOL_MAP.submit_design_brief.jsonSchema)),
  async run(args, deps, origin) {
    const ws = workspaceArg(args, deps.dataDir);
    if (isResult(ws)) return ws;
    const input = without(args, "projectId");
    const ctx = ctxFor(ws, deps, ws.lastRunId ?? "mcp-brief", new AbortController().signal);
    const r = await TOOL_MAP.submit_design_brief.execute(input, ctx);
    if (!r.ok) return fail("INVALID_INPUT", r.error.message);
    const accepted = z.object({ accepted: z.boolean() }).passthrough().safeParse(r.value);
    if (accepted.success && accepted.data.accepted && ctx.brief) {
      ws.brief = ctx.brief;
      ws.buildsLeft = BUILDS_PER_BRIEF;
      ws.repairs = {};
      delete ws.blockedOn;
      deps.emit(ws.conversationId, {
        type: "chat.block",
        messageId: `brief-${Date.now()}`,
        block: { kind: "brief", brief: input },
      });
      postToChat(ws, deps, "assistant", [{ t: "brief", brief: input }], origin);
    }
    return json(r.value);
  },
};

const runPicogk: AgentTool = {
  name: "run_picogk",
  description:
    "Compile and build one complete C# design file (the code contract in picoforge://guide). Requires an accepted brief for this project, else BRIEF_REQUIRED. On success the part appears in the user's viewport and you get volume, bbox, triangles, watertight. On failure you get a typed code and a repairHint: fix the root cause and send the FULL corrected file.",
  inputSchema: withProject(objectSchema(TOOL_MAP.run_picogk.jsonSchema)),
  async run(args, deps, origin) {
    const ws = workspaceArg(args, deps.dataDir);
    if (isResult(ws)) return ws;
    if (!ws.brief) {
      return fail("BRIEF_REQUIRED", "No accepted brief for this project.", {
        next: "Call submit_design_brief and fix its violations first.",
      });
    }
    if (ws.busy) {
      return fail("RUN_BUSY", "A build is already running for this project.", {
        next: "Wait for it to finish (get_run with lastRunId), then retry.",
        lastRunId: ws.lastRunId,
      });
    }
    if (ws.blockedOn) {
      return fail("NEEDS_DECISION", `The repair budget for ${ws.blockedOn} is spent.`, {
        options: [
          "Simplify the design (drop the feature that keeps failing) and resubmit the brief",
          "Coarsen voxel_size_mm or shrink the envelope and resubmit the brief",
          "Ask the human which requirement can relax",
        ],
      });
    }
    if (ws.buildsLeft <= 0) {
      return fail("NEEDS_DECISION", `${BUILDS_PER_BRIEF} builds used for this brief.`, {
        options: ["Ask the human how to proceed", "Resubmit a simpler brief"],
      });
    }
    const now = Date.now();
    ws.recentBuilds = ws.recentBuilds.filter((t) => now - t < 60_000);
    if (ws.recentBuilds.length >= BUILDS_PER_MINUTE) {
      return fail("NEEDS_DECISION", `More than ${BUILDS_PER_MINUTE} builds in a minute.`, {
        options: ["Wait a minute before the next build"],
      });
    }
    ws.recentBuilds.push(now);
    ws.buildsLeft--;
    ws.busy = true;

    const run = runCreate(ws.conversationId, `mcp:${origin}`);
    const status = (state: "building" | "done" | "failed") =>
      deps.emit(ws.conversationId, { type: "run.status", runId: run.id, state, attempt: 1 });
    runUpdateState(run.id, "building");
    status("building");
    try {
      const ctx = ctxFor(ws, deps, run.id, new AbortController().signal);
      const r = await TOOL_MAP.run_picogk.execute(without(args, "projectId"), ctx);
      if (!r.ok) {
        runUpdateState(run.id, "failed", {
          errorCode: "INVALID_INPUT",
          errorDetail: r.error.message,
        });
        status("failed");
        return fail("INVALID_INPUT", r.error.message);
      }
      const done = buildOk.safeParse(r.value);
      if (done.success) {
        const stats = engineStatsSchema.safeParse(done.data.stats);
        const stl = done.data.files?.stl;
        const url = stl ? fileUrl(deps.dataDir, stl) : null;
        ws.lastArtifactId = done.data.artifactId;
        ws.lastRunId = run.id;
        runUpdateState(run.id, "done");
        if (stats.success && url) {
          const s = stats.data;
          deps.emit(ws.conversationId, {
            type: "geometry.ready",
            runId: run.id,
            artifactId: done.data.artifactId,
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
        }
        status("done");
        postToChat(
          ws,
          deps,
          "assistant",
          [{ t: "geometry", artifactId: done.data.artifactId }],
          origin,
        );
        return json({
          ok: true,
          runId: run.id,
          artifactId: done.data.artifactId,
          stats: done.data.stats,
          warnings: done.data.warnings ?? [],
          logTail: (done.data.logTail ?? []).slice(-12),
          buildsLeftForBrief: ws.buildsLeft,
        });
      }
      // Failure from the ladder: typed code + repair hint (docs/14 §4)
      ws.lastRunId = run.id;
      const failed = buildFail.safeParse(r.value);
      const error = failed.success ? failed.data.error : { code: "ENGINE_PROTOCOL" };
      const code = typeof error.code === "string" ? error.code : "RUNTIME_ERROR";
      const attempt = (ws.repairs[code] ?? 0) + 1;
      ws.repairs[code] = attempt;
      runUpdateState(run.id, "failed", {
        errorCode: code,
        errorDetail: JSON.stringify(error).slice(0, 2000),
      });
      status("failed");
      deps.emit(ws.conversationId, {
        type: "error",
        errId: `E-${run.id.slice(-6)}`,
        code,
        message: `Agent build failed (${code}); the agent is repairing it.`,
        recoverable: true,
      });
      if (isBudgetExhausted(code, attempt)) ws.blockedOn = code;
      return fail(code, "Build failed.", {
        runId: run.id,
        error,
        repairHint: buildRepairHint({ errorCode: code, attempt, payload: error }),
        ...(ws.blockedOn
          ? { next: "Repair budget spent: the next build returns NEEDS_DECISION." }
          : {}),
      });
    } finally {
      ws.busy = false;
    }
  },
};

/** inspect_geometry / export_artifact / capture_viewport work on the project's last good part. */
function onLastPart(name: "inspect_geometry" | "export_artifact" | "capture_viewport"): AgentTool {
  const tool = TOOL_MAP[name];
  return {
    name,
    description:
      `${tool.description} Works on the project's last successful build (NO_PART otherwise).`,
    inputSchema: withProject(objectSchema(tool.jsonSchema)),
    async run(args, deps) {
      const ws = workspaceArg(args, deps.dataDir);
      if (isResult(ws)) return ws;
      if (!ws.lastArtifactId || !ws.lastRunId) {
        return fail("NO_PART", "Nothing built yet in this project.", {
          next: "Call run_picogk first.",
        });
      }
      const ctx = ctxFor(ws, deps, ws.lastRunId, new AbortController().signal);
      const r = await tool.execute(without(args, "projectId"), ctx);
      if (!r.ok) return fail("INVALID_INPUT", r.error.message);
      if (name === "capture_viewport") return captureContent(r.value);
      return json(r.value);
    },
  };
}

const captureBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    source: z.object({ data: z.string(), media_type: z.string() }),
  }),
]);

function captureContent(value: unknown): McpToolResult {
  const blocks = z.array(captureBlock).safeParse(value);
  if (!blocks.success) return fail("ENGINE_PROTOCOL", "capture returned an unexpected shape");
  return {
    content: blocks.data.map((b): McpContent =>
      b.type === "text"
        ? { type: "text", text: b.text }
        : { type: "image", data: b.source.data, mimeType: b.source.media_type }
    ),
  };
}

const getRun: AgentTool = {
  name: "get_run",
  description: "State of a build run: state, error code and detail, timing.",
  inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  run(args) {
    const p = z.object({ runId: z.string() }).safeParse(args);
    if (!p.success) return Promise.resolve(fail("INVALID_INPUT", p.error.message));
    const run = runGet(p.data.runId);
    if (!run) return Promise.resolve(fail("NOT_FOUND", "No such run."));
    return Promise.resolve(json({
      runId: run.id,
      state: run.state,
      errorCode: run.errorCode,
      errorDetail: run.errorDetail,
      totalMs: run.totalMs,
    }));
  },
};

export const AGENT_TOOLS: readonly AgentTool[] = [
  openProject,
  postMessage,
  searchDocs,
  submitBrief,
  runPicogk,
  onLastPart("inspect_geometry"),
  onLastPart("capture_viewport"),
  onLastPart("export_artifact"),
  getRun,
];

/** Dispatch one tools/call. Never throws: an unexpected error is a typed INTERNAL result. */
export async function callAgentTool(
  name: string,
  args: Record<string, unknown>,
  deps: McpDeps,
  origin: string,
): Promise<McpToolResult> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) return fail("INVALID_INPUT", `Unknown tool ${name}.`);
  log.info("tool call", { client: origin, tool: name }); // never the payload
  try {
    return await tool.run(args, deps, origin);
  } catch (e) {
    const errId = crypto.randomUUID();
    log.error("MCP tool failed", { errId, tool: name, error: String(e) });
    return fail("INTERNAL", "The tool failed unexpectedly.", { errId });
  }
}
