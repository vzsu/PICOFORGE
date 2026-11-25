// Chat column (docs/02 §4): tabs, messages, brief, live status line, floating composer.
// Renders the MainView (mock or live); the accent appears only while a run is live.

import { useEffect, useRef, useState } from "react";
import { DotGlyph } from "./Icons.tsx";
import { chatTabs, composerPlaceholder, MODE_ESTIMATE, MODES, type ChatTab, type Mode } from "../../mock/mainScreen.ts";
import type { MainView, StatusView } from "./view.ts";

const pad2 = (n: number) => String(n).padStart(2, "0");

function StatusLine({ status }: { status: StatusView }) {
  const [doneOpen, setDoneOpen] = useState(false);
  if (status.kind === "idle") return null;
  if (status.kind === "failed") {
    return (
      <div className="pf-status" data-testid="status-line" data-status="failed" role="status" aria-live="polite">
        <div className="pf-status-row">
          <span className="pf-status-dot is-still" data-live="status-dot" />
          <span className="pf-status-text">{status.sentence}</span>
        </div>
        <div className="pf-done-detail readout" data-testid="status-fail-detail">{status.detail}</div>
      </div>
    );
  }
  if (status.kind === "done") {
    return (
      <div className="pf-status" data-testid="status-line" data-status="done" role="status" aria-live="polite">
        <div className="pf-status-row">
          <span className="pf-status-dot is-ok" />
          <span className="pf-status-text" data-testid="status-done-text">Done in {status.elapsed}</span>
        </div>
        <div className="pf-done-detail readout" data-testid="status-result">{status.result}</div>
        {status.done.length > 0 && (
          <div className="pf-done readout" data-testid="status-done">{status.done.map((d) => `✓ ${d}`).join(" · ")}</div>
        )}
      </div>
    );
  }
  return (
    <div className="pf-status" data-testid="status-line" data-status="live" role="status" aria-live="polite">
      <div className="pf-status-row">
        <span className="pf-status-dot" data-live="status-dot" />
        <span className="pf-status-text">
          {status.verb} <span className="pf-shimmer">{status.phrase}</span>
        </span>
        <span className="pf-status-count readout">
          <span data-testid="status-step">{pad2(status.step)}/{pad2(status.steps)}</span>
          {" · "}
          <span data-testid="status-elapsed">{status.elapsed}</span>
        </span>
      </div>
      <div
        className="pf-bar"
        data-testid="status-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(status.progress * 100)}
      >
        <div className="pf-bar-fill" data-live="status-bar" style={{ width: `${status.progress * 100}%` }} />
      </div>
      {status.done.length > 0 && (
        <button
          className="pf-done readout"
          data-testid="status-done"
          aria-expanded={doneOpen}
          onClick={() => setDoneOpen((o) => !o)}
        >
          {status.done.map((d) => `✓ ${d}`).join(" · ")}
          <span className={`pf-done-chev${doneOpen ? " is-open" : ""}`}>›</span>
        </button>
      )}
      {doneOpen && (
        <div className="pf-done-detail readout" data-testid="status-done-detail">
          mesh 0:09 · 214k tris{"\n"}cfd 0:21 · Δp 0.42 bar
        </div>
      )}
    </div>
  );
}

export function ChatColumn({ view }: { view: MainView }) {
  const [tab, setTab] = useState<ChatTab>("Chat");
  const [mode, setMode] = useState<Mode>("deep");
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = threadRef.current;
    if (t && view.live) t.scrollTop = t.scrollHeight;
  }, [view.live, view.messages, view.brief, view.status]);

  const submit = () => {
    if (!draft.trim()) return;
    view.send(draft);
    setDraft("");
  };

  return (
    <section className="pf-chat" data-testid="chat" aria-label="Chat">
      <div className="pf-tabs" role="tablist" aria-label="Chat views">
        {chatTabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`pf-tab${tab === t ? " is-on" : ""}`}
            data-testid={`chat-tab-${t.toLowerCase()}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pf-thread" data-testid="thread" ref={threadRef}>
        {view.messages.map((m) =>
          m.role === "user"
            ? (
              <div key={m.id} className="pf-user" data-testid="msg-user">
                <div className="pf-bubble">{m.text}</div>
                <div className="pf-time readout">{m.time}</div>
              </div>
            )
            : (
              <div key={m.id} className="pf-assistant" data-testid="msg-assistant">
                <div className="pf-assistant-label micro-label"><DotGlyph /> PICOFORGE</div>
                {m.text.split("\n\n").filter(Boolean).map((p, i) => <p key={i} className="pf-prose">{p}</p>)}
              </div>
            )
        )}

        {view.brief && (
          <div className="pf-brief" data-testid="brief-card">
            <div className="pf-brief-head">
              <span className="micro-label">Design brief</span>
              <span className="pf-chip readout">{view.brief.category}</span>
            </div>
            <ul className="pf-group">
              {view.brief.rows.map((r) => (
                <li key={r.id} className="pf-brief-row" data-testid={`brief-row-${r.id}`}>
                  <span className="pf-param">{r.param}</span>
                  <span className="pf-value readout">
                    {r.check
                      ? <span className={r.check === "ok" ? "pf-ok" : "pf-fail"}>{r.check === "ok" ? "✓" : "✗"}</span>
                      : (
                        <>
                          {r.value}
                          {r.unit && <span className="pf-unit"> {r.unit}</span>}
                          {r.target && <span className="pf-target">{r.target === "up" ? "↑" : "↓"}</span>}
                        </>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <StatusLine status={view.status} />
      </div>

      <form
        className="pf-composer"
        data-testid="composer-form"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <textarea
          className="pf-input"
          data-testid="composer"
          rows={1}
          placeholder={composerPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          aria-label="Describe a change"
        />
        <div className="pf-composer-bar">
          <div className="pf-modes" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button
                type="button"
                key={m}
                role="radio"
                aria-checked={mode === m}
                className={`pf-mode${mode === m ? " is-on" : ""}`}
                data-testid={`mode-${m}`}
                title={MODE_ESTIMATE[m]}
                onClick={() => setMode(m)}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          {view.running
            ? (
              <button type="button" className="pf-stop" data-testid="stop" data-live="stop" aria-label="Stop run" onClick={view.stop}>
                <span className="pf-stop-square" />
              </button>
            )
            : (
              <button type="submit" className="pf-send" data-testid="send" aria-label="Send" disabled={!draft.trim()}>
                <span className="pf-send-arrow">↑</span>
              </button>
            )}
        </div>
      </form>
    </section>
  );
}
