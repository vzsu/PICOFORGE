// Settings overlay (docs/02 §6): full overlay, iOS-style list on the left, content on the right; every
// change applies at once and autosaves. Ctrl/Cmd + , opens it, Esc closes it.
// Sections built so far: Models and keys, Appearance, MCP connections, About.

import { useEffect, useState } from "react";
import { Icon } from "./Icons.tsx";
import { apiFetch, isRecord, readJson } from "../../api.ts";
import { DEFAULT_SELECT, EFFORTS, type ModeKey, settingsStore, useSettings } from "../../live/settings.ts";

type Section = "models" | "appearance" | "mcp" | "about";
const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: "models", label: "Models and keys" },
  { id: "appearance", label: "Appearance" },
  { id: "mcp", label: "MCP connections" },
  { id: "about", label: "About" },
];
const MODE_LABEL: Record<ModeKey, string> = { low: "LOW", std: "STD", deep: "DEEP", raman: "RAMAN" };
/** Selection colours (the red live accent is not offered: it stays reserved for live state). */
const SWATCHES = [DEFAULT_SELECT, "#64D2FF", "#30D158", "#BF5AF2", "#FF9F0A", "#EDEDED"];

export function SettingsOverlay({ live, onClose }: { live: boolean; onClose: () => void }) {
  const s = useSettings();
  const [section, setSection] = useState<Section>("models");

  useEffect(() => {
    if (live) void settingsStore.load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, onClose]);

  const saveText = !live
    ? "Mock-up: open PicoForge from the server to change settings"
    : s.save.state === "saving"
    ? "Saving…"
    : s.save.state === "error"
    ? "Not saved: server unreachable"
    : s.save.at
    ? `Saved ${new Date(s.save.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "Changes save automatically";

  return (
    <div className="pf-settings-backdrop" data-testid="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="pf-settings" onClick={(e) => e.stopPropagation()}>
        <nav className="pf-settings-nav" aria-label="Settings sections">
          <div className="micro-label pf-settings-title">Settings</div>
          <ul className="pf-group">
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <button
                  className={`pf-row${section === x.id ? " is-selected" : ""}`}
                  data-testid={`settings-section-${x.id}`}
                  aria-current={section === x.id ? "page" : undefined}
                  onClick={() => setSection(x.id)}
                >
                  <span className="pf-row-text">{x.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="readout pf-settings-save" data-testid="settings-save-state" data-state={s.save.state}>{saveText}</div>
        </nav>
        <section className="pf-settings-body">
          <button className="pf-settings-close" data-testid="settings-close" aria-label="Close settings (Esc)" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
          <fieldset disabled={!live} className="pf-settings-fields">
            {section === "models" && <ModelsSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "mcp" && <McpSection live={live} />}
            {section === "about" && <AboutSection live={live} />}
          </fieldset>
        </section>
      </div>
    </div>
  );
}

function ModelsSection() {
  const s = useSettings();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(s.apiBaseUrl);
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "fail"; text: string }>({ kind: "idle", text: "" });
  const fastOk = s.models.find((m) => m.id === s.model)?.fast ?? false;

  return (
    <>
      <h2 className="pf-settings-h">Models and keys</h2>
      <div className="micro-label pf-group-label">Anthropic API key</div>
      <div className="pf-group pf-settings-card">
        <div className="pf-settings-line readout" data-testid="settings-key-status">
          {s.hasApiKey ? "A key is saved in ~/PicoForge/secret.env" : "No key saved: in-app runs need one (MCP agents do not)"}
        </div>
        <input
          className="pf-settings-input"
          data-testid="settings-key"
          type="password"
          autoComplete="off"
          placeholder={s.hasApiKey ? "Enter a new key to replace it" : "sk-ant-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="API key (write-only)"
        />
        <input
          className="pf-settings-input"
          data-testid="settings-base-url"
          type="url"
          placeholder="Base URL (empty = api.anthropic.com)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          aria-label="API base URL"
        />
        <div className="pf-settings-actions">
          <button
            className="pf-settings-btn"
            data-testid="settings-key-test"
            disabled={key.trim().length < 10 || status.kind === "busy"}
            onClick={async () => {
              setStatus({ kind: "busy", text: "Testing…" });
              const r = await settingsStore.testKey(key, baseUrl);
              setStatus({ kind: r.ok ? "ok" : "fail", text: r.message });
            }}
          >
            Test
          </button>
          <button
            className="pf-settings-btn is-primary"
            data-testid="settings-key-save"
            disabled={status.kind === "busy" || (key.trim().length < 10 && baseUrl === s.apiBaseUrl)}
            onClick={async () => {
              setStatus({ kind: "busy", text: "Saving…" });
              const ok = await settingsStore.saveKey(key, baseUrl);
              setKey(""); // write-only: the field never shows a saved key
              setStatus({ kind: ok ? "ok" : "fail", text: ok ? "Saved" : "Could not save" });
            }}
          >
            Save key
          </button>
          <span className={`readout pf-settings-msg is-${status.kind}`} data-testid="settings-key-msg">{status.text}</span>
        </div>
      </div>

      <div className="micro-label pf-group-label">Model</div>
      <div className="pf-group pf-settings-card">
        <select
          className="pf-settings-input"
          data-testid="settings-model"
          value={s.model}
          onChange={(e) => settingsStore.update({ model: e.target.value })}
          aria-label="Model"
        >
          {(s.models.length ? s.models : [{ id: s.model, label: s.model, fast: false }]).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <label className="pf-settings-toggle">
          <input
            type="checkbox"
            data-testid="settings-fast"
            checked={s.fastResponses && fastOk}
            disabled={!fastOk}
            onChange={(e) => settingsStore.update({ fastResponses: e.target.checked })}
          />
          <span>Fast responses (premium price){fastOk ? "" : ": not available for this model"}</span>
        </label>
      </div>

      <div className="micro-label pf-group-label">Effort per mode</div>
      <div className="pf-group pf-settings-card">
        {(Object.keys(MODE_LABEL) as ModeKey[]).map((m) => (
          <label key={m} className="pf-settings-row">
            <span className="readout">{MODE_LABEL[m]}</span>
            <select
              className="pf-settings-input is-small"
              data-testid={`settings-effort-${m}`}
              value={s.effortByMode[m]}
              onChange={(e) => {
                const v = EFFORTS.find((x) => x === e.target.value);
                if (v) settingsStore.update({ effort: { [m]: v } });
              }}
            >
              {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        ))}
      </div>
    </>
  );
}

function AppearanceSection() {
  const s = useSettings();
  return (
    <>
      <h2 className="pf-settings-h">Appearance</h2>
      <div className="micro-label pf-group-label">Selection colour</div>
      <div className="pf-group pf-settings-card">
        <p className="pf-settings-line">Parts glow in this colour on hover and when selected. Red stays reserved for live runs.</p>
        <div className="pf-swatches" role="radiogroup" aria-label="Selection colour">
          {SWATCHES.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={s.selectColor.toLowerCase() === c.toLowerCase()}
              className={`pf-swatch${s.selectColor.toLowerCase() === c.toLowerCase() ? " is-on" : ""}`}
              data-testid={`settings-color-${c.slice(1).toLowerCase()}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => settingsStore.update({ selectColor: c })}
            />
          ))}
          <input
            type="color"
            className="pf-swatch-custom"
            data-testid="settings-color-custom"
            value={s.selectColor}
            onChange={(e) => settingsStore.update({ selectColor: e.target.value.toUpperCase() })}
            aria-label="Custom selection colour"
          />
        </div>
      </div>
    </>
  );
}

function McpSection({ live }: { live: boolean }) {
  const [info, setInfo] = useState<{ url: string; token: string; claudeCode: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!live) return;
    void apiFetch("/api/mcp/connect").then(readJson).then((j) => {
      if (isRecord(j) && typeof j.url === "string" && typeof j.token === "string" && typeof j.claudeCode === "string") {
        setInfo({ url: j.url, token: j.token, claudeCode: j.claudeCode });
      }
    }).catch(() => {});
  }, [live]);
  const shown = info ? (reveal ? info.claudeCode : info.claudeCode.replace(info.token, "•".repeat(12))) : "";
  return (
    <>
      <h2 className="pf-settings-h">MCP connections</h2>
      <p className="pf-settings-line">
        AI agents (Claude Code, Cursor, …) drive PicoForge over MCP; their work shows live here. Keep the
        token private: anyone holding it can run builds on this machine.
      </p>
      <div className="micro-label pf-group-label">Claude Code</div>
      <div className="pf-group pf-settings-card">
        <code className="pf-settings-code readout" data-testid="mcp-command">{info ? shown : "…"}</code>
        <div className="pf-settings-actions">
          <button className="pf-settings-btn" data-testid="mcp-reveal" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide token" : "Reveal token"}
          </button>
          <button
            className="pf-settings-btn"
            data-testid="mcp-copy"
            disabled={!info}
            onClick={() => {
              if (!info) return;
              void navigator.clipboard?.writeText(info.claudeCode).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy command"}
          </button>
        </div>
      </div>
      <div className="micro-label pf-group-label">Endpoint</div>
      <div className="pf-group pf-settings-card">
        <div className="pf-settings-line readout">{info?.url ?? "…"} · header X-PicoForge-Token · guide picoforge://guide</div>
      </div>
    </>
  );
}

function AboutSection({ live }: { live: boolean }) {
  const [engine, setEngine] = useState<string>("…");
  useEffect(() => {
    if (!live) return;
    void apiFetch("/api/health").then(readJson).then((h) => {
      const e = isRecord(h) && isRecord(h.engine) ? h.engine : null;
      setEngine(e ? `${typeof e.version === "string" ? e.version : "?"} (${typeof e.status === "string" ? e.status : "?"})` : "unknown");
    }).catch(() => setEngine("unreachable"));
  }, [live]);
  return (
    <>
      <h2 className="pf-settings-h">About</h2>
      <div className="pf-group pf-settings-card">
        <div className="pf-settings-row"><span>Engine</span><span className="readout" data-testid="about-engine">{engine}</span></div>
        <div className="pf-settings-row"><span>Geometry kernel</span><span className="readout">PicoGK 2.2.0</span></div>
        <div className="pf-settings-row"><span>MCP</span><span className="readout">Streamable HTTP, stateless</span></div>
      </div>
    </>
  );
}
