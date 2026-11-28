// Rail panels (docs/02 §1): Runs and Agents take the explorer slot when chosen in the rail.

import type { RunRowView } from "./view.ts";

const STATE_DOT: Record<string, string> = { done: "pf-ok", failed: "pf-fail", cancelled: "pf-muted" };

export function RunsPanel({ runs, overlay }: { runs: RunRowView[]; overlay: boolean }) {
  return (
    <aside className={`pf-explorer${overlay ? " is-overlay" : ""}`} data-testid="runs-panel" aria-label="Runs">
      <div className="pf-wordmark" aria-label="PicoForge">PICOFORGE</div>
      <div className="micro-label pf-group-label">Runs · this project</div>
      <ul className="pf-group">
        {runs.length === 0 && <li className="pf-empty" data-testid="runs-empty">No runs yet</li>}
        {runs.map((r) => (
          <li key={r.id} className="pf-run-row" data-testid={`run-row-${r.id}`} data-state={r.state}>
            <span className={`pf-run-dot ${STATE_DOT[r.state] ?? "pf-live"}`}>●</span>
            <span className="pf-run-main">
              <span className="readout">{r.short} · {r.state}{r.error ? ` · ${r.error}` : ""}</span>
              <span className="readout pf-muted">{r.when}{r.took ? ` · ${r.took}` : ""} · {r.origin}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function AgentsPanel({ agents, overlay }: { agents: string[]; overlay: boolean }) {
  return (
    <aside className={`pf-explorer${overlay ? " is-overlay" : ""}`} data-testid="agents-panel" aria-label="Agents">
      <div className="pf-wordmark" aria-label="PicoForge">PICOFORGE</div>
      <div className="micro-label pf-group-label">Agents · this session</div>
      <ul className="pf-group">
        {agents.length === 0 && (
          <li className="pf-empty" data-testid="agents-empty">
            No agent yet. Settings → MCP connections has the command for Claude Code.
          </li>
        )}
        {agents.map((a) => (
          <li key={a} className="pf-run-row" data-testid={`agent-row-${a}`}>
            <span className="pf-run-dot pf-ok">●</span>
            <span className="pf-run-main">
              <span className="readout">{a.replace(/^mcp:/, "")}</span>
              <span className="readout pf-muted">MCP · Streamable HTTP</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
