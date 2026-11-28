// View model for the main screen: one shape, fed by the mock data (mock-up, UI-VIS-mock-main) or by
// the live session (server + engine). Components render only this, never the sources directly.

import { useEffect, useState } from "react";
import * as mock from "../../mock/mainScreen.ts";
import { isLiveMode, liveSession, type LiveState, useLive } from "../../live/session.ts";
import type { Mode } from "../../protocol/modes.ts";

export interface ChatMsgView {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  /** "mcp:<client>" for an agent's message: shown as a mono chip (docs/14 §10). */
  origin?: string;
}

export interface BriefRowView {
  id: string;
  param: string;
  value: string;
  unit: string;
  target?: "up" | "down";
  check?: "ok" | "fail";
}

export type StatusView =
  | { kind: "idle" }
  | {
    kind: "live";
    verb: string;
    phrase: string;
    step: number;
    steps: number;
    elapsed: string;
    progress: number;
    done: string[];
  }
  | { kind: "done"; elapsed: string; result: string; done: string[] }
  | { kind: "failed"; sentence: string; detail: string };

export interface ReadoutView {
  volumeCm3: number;
  massKg: number | null;
  valid: boolean;
  stage: string;
}

export interface ExplorerView {
  project: string;
  projectId: string | null;
  /** Every project (newest first); click to switch the window to it. */
  projects: Array<{ id: string; name: string }>;
  openProject: (id: string) => void;
  design: { label: string; run: string | null; running: boolean } | null;
  runsCount: number;
  parts: Array<{ id: string; name: string; visible: boolean }>;
}

/** Sidebar Runs panel rows. */
export interface RunRowView {
  id: string;
  short: string;
  state: string;
  origin: string;
  when: string;
  took: string;
  error: string | null;
}

export interface MainView {
  live: boolean;
  /** null = the mock-up explorer (mock data). */
  explorer: ExplorerView | null;
  messages: ChatMsgView[];
  brief: { category: string; rows: BriefRowView[] } | null;
  status: StatusView;
  running: boolean;
  readout: ReadoutView | null;
  stlUrl: string | null;
  engineOk: boolean;
  /** Connected agents: the status-bar chip. */
  agents: string;
  /** Names of agents seen this session (sidebar Agents). */
  agentNames: string[];
  runs: RunRowView[];
  /** Saved design files of the shown part (code, brief, mesh, exports). */
  files: Array<{ name: string; url: string; bytes: number }>;
  /** Status-bar save text, e.g. "Saved 14:02". */
  saved: string | null;
  connection: LiveState["connection"] | "mock";
  send: (text: string, mode?: Mode) => void;
  stop: () => void;
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const fmtDone = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

const STEPS: Record<string, { phrase: string; step: number }> = {
  queued: { phrase: "queueing the run", step: 1 },
  understanding: { phrase: "understanding the request", step: 1 },
  briefing: { phrase: "the design brief", step: 2 },
  building: { phrase: "building geometry", step: 3 },
  inspecting: { phrase: "inspecting geometry", step: 3 },
  awaiting_user: { phrase: "waiting for your answer", step: 3 },
};
const STEP_LABEL: Record<string, string> = { briefing: "brief", building: "build", inspecting: "inspect" };

const MOCK_VIEW: MainView = {
  live: false,
  explorer: null,
  messages: mock.messages,
  brief: { category: mock.briefCategory, rows: mock.brief },
  status: { kind: "live", ...mock.liveStatus },
  running: true,
  readout: { ...mock.readout },
  stlUrl: null,
  engineOk: true,
  agents: String(mock.statusBar.agents),
  agentNames: ["mcp:claude-code"],
  runs: [],
  files: [],
  saved: null,
  connection: "mock",
  send: () => {},
  stop: () => {},
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function liveView(s: LiveState, now: number): MainView {
  const run = s.run;
  const running = !!run && run.endedAt === null;
  let status: StatusView = { kind: "idle" };
  if (run && running) {
    const st = STEPS[run.state] ?? { phrase: run.state, step: 1 };
    status = {
      kind: "live",
      verb: "Working on",
      phrase: st.phrase,
      step: st.step,
      steps: 4,
      elapsed: fmtElapsed(now - run.startedAt),
      progress: (st.step - 0.5) / 4,
      done: run.stepsDone.map((d) => STEP_LABEL[d] ?? d),
    };
  } else if (run && run.state === "done") {
    const g = s.geometry;
    status = {
      kind: "done",
      elapsed: fmtDone((run.endedAt ?? now) - run.startedAt),
      result: g
        ? `VOL ${g.volumeCm3.toFixed(1)} cm³ · ${g.massKg !== null ? `MASS ${g.massKg.toFixed(3)} kg · ` : ""}${
          g.triangles.toLocaleString("en-US")
        } tris`
        : "no geometry",
      done: run.stepsDone.map((d) => STEP_LABEL[d] ?? d),
    };
  } else if (run && (run.state === "failed" || run.state === "cancelled")) {
    status = {
      kind: "failed",
      sentence: run.state === "cancelled" ? "Run stopped." : "The run failed.",
      detail: s.error ? `${s.error.code} · ${s.error.message}` : run.state.toUpperCase(),
    };
  }
  const g = s.geometry;
  // P0 builds one part per run (ctx.Part registration is P2): it is named by the brief title.
  const explorer: ExplorerView = {
    project: s.projectName ?? "Studio",
    projectId: s.projectId,
    projects: s.projects,
    openProject: (id) => void liveSession.openProject(id),
    design: run ? { label: "v1", run: `#${run.id.slice(-4).toLowerCase()}`, running } : null,
    runsCount: s.runs.length,
    parts: g ? [{ id: "result", name: s.brief?.title ?? "Part", visible: true }] : [],
  };
  return {
    live: true,
    explorer,
    messages: s.messages,
    brief: s.brief,
    status,
    running,
    readout: g ? { volumeCm3: g.volumeCm3, massKg: g.massKg, valid: g.watertight, stage: "VALIDATED" } : null,
    stlUrl: g?.url ?? null,
    engineOk: s.engine === "ok",
    agents: String(s.agents.length),
    agentNames: s.agents,
    runs: s.runs.map((r) => ({
      id: r.id,
      short: `#${r.id.slice(-4).toLowerCase()}`,
      state: r.state,
      origin: r.model.startsWith("mcp:") ? r.model : "in-app",
      when: new Date(r.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      took: r.totalMs !== null ? fmtElapsed(r.totalMs) : "",
      error: r.errorCode,
    })),
    files: s.files,
    saved: s.savedAt
      ? `Saved ${new Date(s.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : null,
    connection: s.connection,
    send: (t, m) => liveSession.send(t, m),
    stop: () => liveSession.cancel(),
  };
}

const LIVE = isLiveMode();

/** The main-screen view for this page: live when opened by the server, mock otherwise. */
export function useMainView(): MainView {
  const s = useLive();
  useEffect(() => {
    if (LIVE) void liveSession.start();
  }, []);
  const now = useNow(LIVE && !!s.run && s.run.endedAt === null);
  return LIVE ? liveView(s, now) : MOCK_VIEW;
}
