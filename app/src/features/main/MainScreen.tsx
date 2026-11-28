// P0 main-screen mock-up (docs/02 §1). Runs on app/src/mock/mainScreen.ts; no server needed.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "./Icons.tsx";
import { Explorer, type PartSelection } from "./Explorer.tsx";
import { AgentsPanel, RunsPanel } from "./Panels.tsx";
import { SettingsOverlay } from "./SettingsOverlay.tsx";
import { settingsStore, useSettings } from "../../live/settings.ts";
import { ChatColumn } from "./ChatColumn.tsx";
import { ViewportPanel } from "./ViewportPanel.tsx";
import { statusBar } from "../../mock/mainScreen.ts";
import { useMainView } from "./view.ts";
import "./mainScreen.css";

const RAIL: ReadonlyArray<{ id: string; icon: IconName; label: string }> = [
  { id: "projects", icon: "home", label: "Projects" },
  { id: "designs", icon: "cube", label: "Designs" },
  { id: "runs", icon: "runs", label: "Runs" },
  { id: "agents", icon: "agent", label: "Agents" },
  { id: "settings", icon: "gear", label: "Settings" },
];

type Layout = "wide" | "overlay" | "tabs";
const layoutFor = (w: number): Layout => (w < 760 ? "tabs" : w < 1100 ? "overlay" : "wide");

const CHAT_MIN = 0.22, CHAT_MAX = 0.5, CHAT_DEFAULT = 0.3;

export function MainScreen() {
  const view = useMainView();
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [pane, setPane] = useState<"chat" | "viewport">("chat");
  const [rail, setRail] = useState("projects");
  const [chatFrac, setChatFrac] = useState(CHAT_DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const settings = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; frac: number } | null>(null);

  useEffect(() => {
    const onResize = () => setLayout(layoutFor(window.innerWidth));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (layoutFor(window.innerWidth) === "wide") setExplorerOpen((o) => !o);
        else setOverlayOpen((o) => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.key === "Escape") {
        setOverlayOpen(false);
        setSelectedPart(null); // docs/02 §5: Esc deselects
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Settings apply in live mode from the start (selection colour, model); a new part clears selection.
  useEffect(() => {
    if (view.live) void settingsStore.load();
  }, [view.live]);
  useEffect(() => {
    setSelectedPart(null);
    setHoverPart(null);
  }, [view.stlUrl]);

  const sel: PartSelection = {
    hover: hoverPart,
    selected: selectedPart,
    onHover: setHoverPart,
    onSelect: setSelectedPart,
  };
  const panel = (overlay: boolean) =>
    rail === "runs"
      ? <RunsPanel runs={view.runs} overlay={overlay} />
      : rail === "agents"
      ? <AgentsPanel agents={view.agentNames} overlay={overlay} />
      : <Explorer overlay={overlay} live={view.explorer} sel={sel} files={view.files} />;

  const onHandleDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, frac: chatFrac };
  }, [chatFrac]);
  const onHandleMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current, root = rootRef.current;
    if (!d || !root) return;
    const usable = root.clientWidth - 56;
    const next = d.frac + (e.clientX - d.x) / usable;
    setChatFrac(Math.min(CHAT_MAX, Math.max(CHAT_MIN, next)));
  }, []);
  const onHandleUp = useCallback(() => { drag.current = null; }, []);
  const onHandleKey = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -0.01 : e.key === "ArrowRight" ? 0.01 : 0;
    if (step) setChatFrac((f) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, f + step)));
  }, []);

  const showExplorerColumn = layout === "wide" && explorerOpen;
  const explorerFrac = showExplorerColumn ? 0.2 : 0;
  const chatFracEff = layout === "wide" ? chatFrac : 0.4;
  const columns = layout === "tabs"
    ? "56px 1fr"
    : `56px calc((100% - 56px) * ${explorerFrac}) calc((100% - 56px) * ${chatFracEff}) 1fr`;

  return (
    <div className={`pf-app is-${layout}`} ref={rootRef} data-testid="main-screen" data-layout={layout}>
      <div className="pf-main" style={{ gridTemplateColumns: columns }}>
        <nav className="pf-rail" aria-label="Primary">
          {RAIL.map((r) => (
            <button
              key={r.id}
              className={`pf-rail-btn${rail === r.id ? " is-on" : ""}`}
              data-testid={`rail-${r.id}`}
              aria-label={r.label}
              aria-current={rail === r.id ? "page" : undefined}
              title={r.label}
              onClick={() => {
                if (r.id === "settings") {
                  setSettingsOpen(true);
                  return;
                }
                if (layout === "wide") {
                  if (rail === r.id) setExplorerOpen((o) => !o);
                  else setExplorerOpen(true);
                } else {
                  setOverlayOpen((o) => (rail === r.id ? !o : true));
                }
                setRail(r.id);
              }}
            >
              <Icon name={r.icon} size={20} />
              {rail === r.id && <span className="pf-rail-dot" data-live="rail-dot" />}
            </button>
          ))}
          <button
            className="pf-rail-btn pf-rail-bottom"
            data-testid="explorer-toggle"
            aria-label="Toggle explorer (Ctrl+B)"
            title="Toggle explorer (Ctrl+B)"
            onClick={() => (layout === "wide" ? setExplorerOpen((o) => !o) : setOverlayOpen((o) => !o))}
          >
            <Icon name="sidebar" size={18} />
          </button>
        </nav>

        {layout !== "tabs" && <div className="pf-explorer-slot">{showExplorerColumn && panel(false)}</div>}

        {layout === "tabs"
          ? (
            <div className="pf-tabbed">
              <div className="pf-pane-switch" role="tablist" aria-label="Pane">
                {(["chat", "viewport"] as const).map((p) => (
                  <button
                    key={p}
                    role="tab"
                    aria-selected={pane === p}
                    className={`pf-tab${pane === p ? " is-on" : ""}`}
                    data-testid={`pane-${p}`}
                    onClick={() => setPane(p)}
                  >
                    {p === "chat" ? "Chat" : "Viewport"}
                  </button>
                ))}
              </div>
              <div className="pf-tabbed-body">
                <div className="pf-tabbed-pane" hidden={pane !== "chat"}><ChatColumn view={view} /></div>
                <div className="pf-tabbed-pane" hidden={pane !== "viewport"}><ViewportPanel live={view.live} stlUrl={view.stlUrl} readout={view.readout} sel={sel} selectColor={settings.selectColor} /></div>
              </div>
            </div>
          )
          : (
            <>
              <ChatColumn view={view} />
              <div className="pf-viewport-slot">
                <div
                  className="pf-split"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize chat and viewport"
                  aria-valuenow={Math.round(chatFracEff * 100)}
                  tabIndex={0}
                  data-testid="split-handle"
                  onPointerDown={onHandleDown}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  onDoubleClick={() => setChatFrac(CHAT_DEFAULT)}
                  onKeyDown={onHandleKey}
                />
                <ViewportPanel live={view.live} stlUrl={view.stlUrl} readout={view.readout} sel={sel} selectColor={settings.selectColor} />
              </div>
            </>
          )}
      </div>

      {layout !== "wide" && overlayOpen && (
        <div className="pf-overlay" data-testid="explorer-overlay" onClick={() => setOverlayOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>{panel(true)}</div>
        </div>
      )}

      {settingsOpen && <SettingsOverlay live={view.live} onClose={() => setSettingsOpen(false)} />}

      <footer className="pf-statusbar" data-testid="statusbar">
        <span className="readout pf-sb-text" data-testid="save-indicator">{view.live
            ? `${view.connection === "ready" ? "Connected" : view.connection === "connecting" ? "Connecting…" : "Offline · retrying"}${view.saved ? ` · ${view.saved}` : ""}`
            : statusBar.saved}</span>
        <span className="readout pf-sb-text">
          <span data-testid="tier-chip">{statusBar.tier}</span>
          {" · "}
          <span data-testid="engine-chip" data-engine={view.engineOk ? "ok" : "down"}>ENGINE <span className={view.engineOk ? "pf-ok" : "pf-fail"}>●</span></span>
          {" · "}
          <span data-testid="agents-chip">AGENTS {view.agents}</span>
        </span>
      </footer>
    </div>
  );
}
