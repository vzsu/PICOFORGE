// Chat column (docs/02 §4): tabs, messages, brief, live status line, floating composer.

import { useState } from "react";
import { DotGlyph } from "./Icons.tsx";
import {
  brief,
  briefCategory,
  chatTabs,
  composerPlaceholder,
  liveStatus,
  messages,
  MODE_ESTIMATE,
  MODES,
  type ChatTab,
  type Mode,
} from "../../mock/mainScreen.ts";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function ChatColumn() {
  const [tab, setTab] = useState<ChatTab>("Chat");
  const [mode, setMode] = useState<Mode>("deep");
  const [doneOpen, setDoneOpen] = useState(false);
  const [draft, setDraft] = useState("");

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

      <div className="pf-thread" data-testid="thread">
        {messages.map((m) =>
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
                <p className="pf-prose">{m.text}</p>
              </div>
            )
        )}

        <div className="pf-brief" data-testid="brief-card">
          <div className="pf-brief-head">
            <span className="micro-label">Design brief</span>
            <span className="pf-chip readout">{briefCategory}</span>
          </div>
          <ul className="pf-group">
            {brief.map((r) => (
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

        <div className="pf-status" data-testid="status-line" role="status" aria-live="polite">
          <div className="pf-status-row">
            <span className="pf-status-dot" data-live="status-dot" />
            <span className="pf-status-text">
              {liveStatus.verb} <span className="pf-shimmer">{liveStatus.phrase}</span>
            </span>
            <span className="pf-status-count readout">
              <span data-testid="status-step">{pad2(liveStatus.step)}/{pad2(liveStatus.steps)}</span>
              {" · "}
              <span data-testid="status-elapsed">{liveStatus.elapsed}</span>
            </span>
          </div>
          <div
            className="pf-bar"
            data-testid="status-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(liveStatus.progress * 100)}
          >
            <div className="pf-bar-fill" data-live="status-bar" style={{ width: `${liveStatus.progress * 100}%` }} />
          </div>
          <button
            className="pf-done readout"
            data-testid="status-done"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((o) => !o)}
          >
            {liveStatus.done.map((d) => `✓ ${d}`).join(" · ")}
            <span className={`pf-done-chev${doneOpen ? " is-open" : ""}`}>›</span>
          </button>
          {doneOpen && (
            <div className="pf-done-detail readout" data-testid="status-done-detail">
              mesh 0:09 · 214k tris{"\n"}cfd 0:21 · Δp 0.42 bar
            </div>
          )}
        </div>
      </div>

      <form
        className="pf-composer"
        data-testid="composer-form"
        onSubmit={(e) => { e.preventDefault(); setDraft(""); }}
      >
        <textarea
          className="pf-input"
          data-testid="composer"
          rows={1}
          placeholder={composerPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setDraft(""); }
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
          <button type="button" className="pf-stop" data-testid="stop" data-live="stop" aria-label="Stop run">
            <span className="pf-stop-square" />
          </button>
        </div>
      </form>
    </section>
  );
}
