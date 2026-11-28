// app/src/live/session.ts — live studio session: REST bootstrap + WS frames → one immutable state.
// Used when the page is opened by the server (`?t=<token>`, docs/04 §8); without a token the
// main screen keeps its mock data (UI-VIS-mock-main). Every frame is narrowed with guards before
// use (CLAUDE.md #2: validate every boundary; the app has no zod, so guards are explicit).

import { useSyncExternalStore } from "react";
import { apiFetch, isRecord, pageToken, readJson } from "../api.ts";
import { WsClient, type WsEvent } from "../ws/client.ts";
import type { Mode } from "../protocol/modes.ts";

export type LiveRunState =
  | "queued"
  | "understanding"
  | "briefing"
  | "building"
  | "inspecting"
  | "awaiting_user"
  | "done"
  | "failed"
  | "cancelled";

export interface LiveMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  /** "mcp:<client>" when an agent wrote it (docs/14 §10); absent for this window's own turns. */
  origin?: string;
}

export interface LiveBriefRow {
  id: string;
  param: string;
  value: string;
  unit: string;
  check?: "ok" | "fail";
}

export interface LiveBrief {
  title: string;
  category: string;
  material: string;
  rows: LiveBriefRow[];
}

export interface LiveRun {
  id: string;
  state: LiveRunState;
  startedAt: number;
  endedAt: number | null;
  stepsDone: string[];
}

export interface LiveGeometry {
  /** The run that built it (its folder holds design.cs, brief.json, part.stl). */
  runId: string | null;
  url: string;
  volumeCm3: number;
  massKg: number | null;
  triangles: number;
  watertight: boolean;
}

export interface LiveState {
  connection: "connecting" | "ready" | "offline" | "error";
  engine: "ok" | "down" | "unknown";
  messages: LiveMessage[];
  brief: LiveBrief | null;
  run: LiveRun | null;
  geometry: LiveGeometry | null;
  error: { code: string; message: string } | null;
  /** Agents seen in this session (origins of MCP messages and focus events). */
  agents: string[];
  projectName: string | null;
  projectId: string | null;
  /** All projects, newest first (sidebar Projects). */
  projects: Array<{ id: string; name: string }>;
  /** This conversation's runs, newest first (sidebar Runs). */
  runs: LiveRunRow[];
  /** When the shown part's design files were saved (every validated build saves them). */
  savedAt: number | null;
  /** Downloadable design files of the shown part. */
  files: Array<{ name: string; url: string; bytes: number }>;
}

export interface LiveRunRow {
  id: string;
  state: string;
  model: string;
  startedAt: number;
  totalMs: number | null;
  errorCode: string | null;
}

const INITIAL: LiveState = {
  connection: "connecting",
  engine: "unknown",
  messages: [],
  brief: null,
  run: null,
  geometry: null,
  error: null,
  agents: [],
  projectName: null,
  projectId: null,
  projects: [],
  runs: [],
  savedAt: null,
  files: [],
};

/** g/cm³; mass shown only for known materials (an estimate never poses as a measurement). */
const DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  PA12: 1.01,
  Resin: 1.18,
  "Al6061-T6": 2.7,
  SS316L: 8.0,
  CF_3K_PLATE: 1.55,
};

const RUN_STATES: readonly LiveRunState[] = [
  "queued",
  "understanding",
  "briefing",
  "building",
  "inspecting",
  "awaiting_user",
  "done",
  "failed",
  "cancelled",
];

function isRunState(v: unknown): v is LiveRunState {
  return typeof v === "string" && (RUN_STATES as readonly string[]).includes(v);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clock = (t = Date.now()) =>
  new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Brief block from `chat.block` → rows for the brief card (docs/02 §4). */
export function parseBrief(block: unknown): LiveBrief | null {
  if (!isRecord(block) || block.kind !== "brief" || !isRecord(block.brief)) return null;
  const b = block.brief;
  const rows: LiveBriefRow[] = [];
  if (Array.isArray(b.parameters)) {
    for (const p of b.parameters) {
      if (!isRecord(p)) continue;
      const name = str(p.name), value = num(p.value);
      if (!name || value === null) continue;
      const unit = str(p.unit) ?? "";
      rows.push({
        id: name,
        param: name.replaceAll("_", " "),
        value: Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1),
        unit: unit === "count" ? "" : unit,
      });
    }
  }
  if (Array.isArray(b.physics_checks)) {
    for (const c of b.physics_checks) {
      if (!isRecord(c)) continue;
      const name = str(c.name);
      if (!name || typeof c.pass !== "boolean") continue;
      rows.push({ id: `check-${name}`, param: name.replaceAll("_", " "), value: "", unit: "", check: c.pass ? "ok" : "fail" });
    }
  }
  return {
    title: str(b.title) ?? "part",
    category: (str(b.category) ?? "part").replaceAll("_", " "),
    material: str(b.material) ?? "",
    rows,
  };
}

/** Pure reducer: one server frame → next state. */
export function reduce(s: LiveState, ev: WsEvent, now = Date.now()): LiveState {
  switch (ev.type) {
    case "run.status": {
      const runId = str(ev.runId);
      if (!runId || !isRunState(ev.state)) return s;
      const prev = s.run && s.run.id === runId ? s.run : null;
      const terminal = ev.state === "done" || ev.state === "failed" || ev.state === "cancelled";
      const stepsDone = prev ? [...prev.stepsDone] : [];
      if (prev && prev.state !== ev.state && !["queued", "understanding"].includes(prev.state)) {
        if (!stepsDone.includes(prev.state)) stepsDone.push(prev.state);
      }
      return {
        ...s,
        run: {
          id: runId,
          state: ev.state,
          startedAt: prev?.startedAt ?? now,
          endedAt: terminal ? now : null,
          stepsDone,
        },
        // a new assistant paragraph per orchestrator step keeps turns readable
        messages: breakAssistant(s.messages, runId),
        geometry: prev ? s.geometry : null,
        error: prev ? s.error : null,
      };
    }
    case "message.created": {
      const m = ev.message;
      const role = m.role === "user" || m.role === "assistant" ? m.role : null;
      if (!role || s.messages.some((x) => x.id === m.id)) return s;
      const agents = m.origin && !s.agents.includes(m.origin) ? [...s.agents, m.origin] : s.agents;
      if (role === "user" && !m.origin) {
        // the server echo of this window's own message: the local copy takes the stored id
        const i = s.messages.findIndex((x) => x.id.startsWith("u-") && x.text === m.content);
        if (i >= 0) {
          const msgs = s.messages.slice();
          msgs[i] = { ...msgs[i], id: m.id };
          return { ...s, messages: msgs };
        }
      }
      return {
        ...s,
        agents,
        messages: [...s.messages, {
          id: m.id,
          role,
          text: m.content,
          time: clock(m.createdAt),
          ...(m.origin ? { origin: m.origin } : {}),
        }],
        // an agent's new request starts a new design on screen
        ...(role === "user" && m.origin ? { brief: null, geometry: null, error: null } : {}),
      };
    }
    case "session.focus": {
      const agents = s.agents.includes(ev.origin) ? s.agents : [...s.agents, ev.origin];
      return { ...s, agents, projectName: ev.projectName, projectId: ev.projectId };
    }
    case "chat.delta": {
      const id = str(ev.messageId), d = str(ev.textDelta);
      if (!id || d === null) return s;
      const i = s.messages.findIndex((m) => m.id === id);
      if (i < 0) return { ...s, messages: [...s.messages, { id, role: "assistant", text: d, time: clock(now) }] };
      const msgs = s.messages.slice();
      msgs[i] = { ...msgs[i], text: msgs[i].text + d };
      return { ...s, messages: msgs };
    }
    case "chat.block": {
      const brief = parseBrief(ev.block);
      return brief ? { ...s, brief } : s;
    }
    case "geometry.ready": {
      const url = str(ev.url);
      const st = isRecord(ev.stats) ? ev.stats : null;
      const vol = st ? num(st.volumeCm3) : null;
      if (!url || !st || vol === null) return s;
      const rho = s.brief ? DENSITY[s.brief.material] : undefined;
      return {
        ...s,
        savedAt: now,
        geometry: {
          runId: str(ev.runId),
          url,
          volumeCm3: vol,
          massKg: rho ? (vol * rho) / 1000 : null,
          triangles: num(st.triangles) ?? 0,
          watertight: st.watertight === true,
        },
      };
    }
    case "error": {
      const code = str(ev.code) ?? "ERROR";
      return { ...s, error: { code, message: str(ev.message) ?? code } };
    }
    default:
      return s;
  }
}

/** Mark the assistant message for this run so the next delta starts a new paragraph. */
function breakAssistant(msgs: LiveMessage[], runId: string): LiveMessage[] {
  const i = msgs.findIndex((m) => m.id === runId);
  if (i < 0 || msgs[i].text === "" || msgs[i].text.endsWith("\n\n")) return msgs;
  const out = msgs.slice();
  out[i] = { ...out[i], text: out[i].text + "\n\n" };
  return out;
}

/** Stored messages (GET /api/conversations/:id/messages) → chat lines and the latest brief. */
export function fromHistory(body: unknown): { messages: LiveMessage[]; brief: LiveBrief | null } {
  const messages: LiveMessage[] = [];
  let brief: LiveBrief | null = null;
  const list = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  for (const m of list) {
    if (!isRecord(m) || !Array.isArray(m.content)) continue;
    const id = str(m.id), role = m.role === "user" || m.role === "assistant" ? m.role : null;
    if (!id || !role) continue;
    const lines: string[] = [];
    for (const b of m.content) {
      if (!isRecord(b)) continue;
      if (b.t === "text" && typeof b.text === "string") lines.push(b.text);
      if (b.t === "error" && typeof b.msg === "string") lines.push(`⚠ ${b.msg}`);
      if (b.t === "brief") brief = parseBrief({ kind: "brief", brief: b.brief }) ?? brief;
    }
    if (lines.length) {
      messages.push({ id, role, text: lines.join("\n\n"), time: clock(num(m.createdAt) ?? Date.now()) });
    }
  }
  return { messages, brief };
}

/** Views an agent may ask for (ViewportCaptureRequestEvent.view). */
export type CaptureView = "iso" | "front" | "top" | "right" | "current";
type CaptureFn = (view: CaptureView) => Promise<string | null>;

function parseFiles(v: unknown): LiveState["files"] {
  return Array.isArray(v)
    ? v.flatMap((f) => {
      if (!isRecord(f)) return [];
      const name = str(f.name), url = str(f.url), bytes = num(f.bytes);
      return name && url && bytes !== null ? [{ name, url, bytes }] : [];
    })
    : [];
}

// ─── Store ──────────────────────────────────────────────────────────────────

type Listener = () => void;

class LiveSession {
  private state: LiveState = INITIAL;
  private readonly listeners = new Set<Listener>();
  private ws: WsClient | null = null;
  private convId: string | null = null;
  private started = false;
  private captureFn: CaptureFn | null = null;

  /** The viewport registers how to photograph the part (capture_viewport). Returns unregister. */
  setCapture(fn: CaptureFn): () => void {
    this.captureFn = fn;
    return () => {
      if (this.captureFn === fn) this.captureFn = null;
    };
  }

  private async answerCapture(requestId: string, view: CaptureView): Promise<void> {
    let png: string | null = null;
    try {
      png = (await this.captureFn?.(view)) ?? null;
    } catch {
      png = null;
    }
    this.ws?.send({
      type: "viewport.capture.result",
      requestId,
      ...(png ? { pngBase64: png } : { error: "no part in the viewport" }),
    });
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.state;

  private set(next: LiveState) {
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const health = await readJson(await apiFetch("/api/health"));
      const eng = isRecord(health) && isRecord(health.engine) ? str(health.engine.status) : null;
      this.set({ ...this.state, engine: eng === "ok" ? "ok" : eng ? "down" : "unknown" });
      await this.loadProjects();
      await this.openProject(this.state.projects[0]?.id ?? null);
    } catch (e) {
      this.set({ ...this.state, connection: "error", error: { code: "BOOT", message: String(e) } });
    }
  }

  /** Projects for the sidebar, newest first. */
  async loadProjects(): Promise<void> {
    const list = await readJson(await apiFetch("/api/projects"));
    const projects = isRecord(list) && Array.isArray(list.projects)
      ? list.projects.flatMap((p) => {
        const id = isRecord(p) ? str(p.id) : null, name = isRecord(p) ? str(p.name) : null;
        return id && name ? [{ id, name }] : [];
      })
      : [];
    this.set({ ...this.state, projects });
  }

  /** Switch the window to a project (null: the first one, created on first launch). */
  async openProject(projectId: string | null): Promise<void> {
    const convId = await this.conversation(projectId);
    const pid = this.projectOf ?? projectId;
    const name = this.state.projects.find((p) => p.id === pid)?.name ?? "Studio";
    this.set({
      ...this.state,
      projectId: pid,
      projectName: name,
      messages: [],
      brief: null,
      geometry: null,
      run: null,
      error: null,
      savedAt: null,
      files: [],
      runs: [],
    });
    await this.attach(convId);
  }

  /** The last saved part of this conversation back in the viewport (SAVE-OPEN-01). */
  private async restorePart(convId: string): Promise<void> {
    const j = await readJson(await apiFetch(`/api/conversations/${convId}/latest-part`));
    const p = isRecord(j) && isRecord(j.part) ? j.part : null;
    const st = p && isRecord(p.stats) ? p.stats : null;
    const url = p ? str(p.url) : null, vol = st ? num(st.volumeCm3) : null;
    if (!p || !st || !url || vol === null || this.convId !== convId || this.state.geometry) return;
    const material = str(st.material);
    const rho = material ? DENSITY[material] : undefined;
    this.set({
      ...this.state,
      savedAt: num(p.savedAt),
      files: parseFiles(p.files),
      geometry: {
        runId: str(p.runId),
        url,
        volumeCm3: vol,
        massKg: rho ? (vol * rho) / 1000 : null,
        triangles: num(st.triangles) ?? 0,
        watertight: st.watertight === true,
      },
    });
  }

  async refreshRuns(): Promise<void> {
    const convId = this.convId;
    if (!convId) return;
    const j = await readJson(await apiFetch(`/api/conversations/${convId}/runs`)).catch(() => null);
    const runs = isRecord(j) && Array.isArray(j.runs)
      ? j.runs.flatMap((r) => {
        if (!isRecord(r)) return [];
        const id = str(r.id), state = str(r.state), startedAt = num(r.startedAt);
        return id && state && startedAt !== null
          ? [{ id, state, model: str(r.model) ?? "", startedAt, totalMs: num(r.totalMs), errorCode: str(r.errorCode) }]
          : [];
      })
      : [];
    if (this.convId === convId) this.set({ ...this.state, runs });
  }

  private async refreshFiles(runId: string): Promise<void> {
    const j = await readJson(await apiFetch(`/api/runs/${runId}/files`)).catch(() => null);
    if (this.state.geometry?.runId === runId) {
      this.set({ ...this.state, files: parseFiles(isRecord(j) ? j.files : null) });
    }
  }

  /** Load a conversation's history and stream its frames. */
  private async attach(convId: string): Promise<void> {
    this.ws?.destroy();
    this.convId = convId;
    try {
      const h = fromHistory(await readJson(await apiFetch(`/api/conversations/${convId}/messages`)));
      this.set({ ...this.state, messages: h.messages, brief: h.brief });
      await this.restorePart(convId);
      await this.refreshRuns();
    } catch {
      // history is a convenience; the live stream still works
    }
    this.ws = new WsClient(convId);
    this.ws.onStatus((up) => this.set({ ...this.state, connection: up ? "ready" : "offline" }));
    this.ws.on((ev) => {
      if (ev.type === "viewport.capture.request") {
        void this.answerCapture(ev.requestId, ev.view);
        return;
      }
      this.set(reduce(this.state, ev));
      if (ev.type === "geometry.ready") void this.refreshFiles(ev.runId);
      if (ev.type === "run.status" && ["done", "failed", "cancelled"].includes(ev.state)) {
        void this.refreshRuns();
      }
      // An MCP agent opened another project: follow it (docs/14 §10)
      if (ev.type === "session.focus" && ev.conversationId !== this.convId) {
        this.set({
          ...this.state,
          messages: [],
          brief: null,
          geometry: null,
          run: null,
          error: null,
          savedAt: null,
          files: [],
          runs: [],
          connection: "connecting",
        });
        void this.loadProjects().then(() => this.attach(ev.conversationId));
      }
    });
    this.ws.connect();
  }

  private projectOf: string | null = null;

  /** A project's first conversation; with no project, the first project (created on first launch). */
  private async conversation(wanted: string | null): Promise<string> {
    let projectId = wanted;
    if (!projectId) {
      const created = await readJson(
        await apiFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Studio" }),
        }),
      );
      projectId = isRecord(created) && isRecord(created.project) ? str(created.project.id) : null;
    }
    if (!projectId) throw new Error("no project");
    this.projectOf = projectId;
    if (!this.state.projects.some((p) => p.id === projectId)) await this.loadProjects();
    const convs = await readJson(await apiFetch(`/api/projects/${projectId}/conversations`));
    let convId = isRecord(convs) && Array.isArray(convs.conversations) && isRecord(convs.conversations[0])
      ? str(convs.conversations[0].id)
      : null;
    if (!convId) {
      const created = await readJson(
        await apiFetch(`/api/projects/${projectId}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Main" }),
        }),
      );
      convId = isRecord(created) && isRecord(created.conversation) ? str(created.conversation.id) : null;
    }
    if (!convId) throw new Error("no conversation");
    return convId;
  }

  /** `mode` picks the effort for this run from Settings (docs/13 §2); absent → STD. */
  send(text: string, mode?: Mode): void {
    const t = text.trim();
    if (!t || !this.ws) return;
    this.set({
      ...this.state,
      messages: [...this.state.messages, { id: `u-${Date.now()}`, role: "user", text: t, time: clock() }],
      brief: null,
      geometry: null,
      error: null,
    });
    this.ws.send({ type: "user.message", text: t, ...(mode ? { mode } : {}) });
  }

  cancel(): void {
    const run = this.state.run;
    if (run && run.endedAt === null) this.ws?.send({ type: "run.cancel", runId: run.id });
  }
}

export const liveSession = new LiveSession();

/** Live mode: opened by the server with a token, unless `?mock=1` forces the mock-up. */
export function isLiveMode(): boolean {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  return pageToken() !== "" && q.get("mock") !== "1";
}

export function useLive(): LiveState {
  return useSyncExternalStore(liveSession.subscribe, liveSession.getSnapshot);
}
