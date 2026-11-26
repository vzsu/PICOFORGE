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
  design: { label: string; run: string | null; running: boolean } | null;
  runsCount: number;
  parts: Array<{ id: string; name: string; visible: boolean }>;
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
    project: "Studio",
    design: run ? { label: "v1", run: `#${run.id.slice(-4).toLowerCase()}`, running } : null,
    runsCount: run ? 1 : 0,
    parts: g && s.brief ? [{ id: "result", name: s.brief.title, visible: true }] : [],
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
