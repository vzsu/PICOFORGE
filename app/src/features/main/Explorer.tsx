// Explorer column (docs/02 §1): PROJECTS tree and PARTS list as iOS inset grouped lists.

import { useState } from "react";
import { Icon } from "./Icons.tsx";
import { parts as initialParts, projects, type PartRow } from "../../mock/mainScreen.ts";
import type { ExplorerView } from "./view.ts";

/** Hover / selection of parts, shared with the viewport (docs/02 §1 "Clicking selects the part"). */
export interface PartSelection {
  hover: string | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Live explorer: every project (click to switch), this project's design and the parts it built. */
function LiveExplorer({ view, overlay, sel, files }: {
  view: ExplorerView;
  overlay: boolean;
  sel?: PartSelection;
  files: Array<{ name: string; url: string; bytes: number }>;
}) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const others = view.projects.filter((p) => p.id !== view.projectId);
  return (
    <aside className={`pf-explorer${overlay ? " is-overlay" : ""}`} data-testid="explorer" data-mode="live" aria-label="Explorer">
      <div className="pf-wordmark" aria-label="PicoForge">PICOFORGE</div>
      <div className="micro-label pf-group-label">Projects</div>
      <ul className="pf-group" role="tree">
        <li role="treeitem" aria-expanded={true}>
          <div className="pf-row" data-testid="tree-project-live">
            <span className="pf-chev"><Icon name="chevronDown" size={12} /></span>
            <span className="pf-row-text pf-strong">{view.project}</span>
          </div>
          <ul role="group">
            {view.design && (
              <li role="treeitem">
                <div className="pf-row pf-indent-2 is-selected" data-testid="tree-design-live">
                  <span className="pf-row-text readout">{view.design.label}</span>
                  <span className="pf-run">
                    {view.design.running && <span className="pf-live-dot" data-live="run-dot" aria-label="running" />}
                    {view.design.run && <span className="readout pf-muted">{view.design.run}</span>}
                  </span>
                </div>
              </li>
            )}
            <li role="treeitem">
              <div className="pf-row pf-indent-1" data-testid="tree-runs">
                <span className="pf-row-text">Runs</span>
                <span className="readout pf-muted">{view.runsCount}</span>
              </div>
            </li>
          </ul>
        </li>
        {others.map((p) => (
          <li key={p.id} role="treeitem" aria-expanded={false}>
            <button className="pf-row" data-testid={`tree-project-${p.id}`} onClick={() => view.openProject(p.id)}>
              <span className="pf-chev"><Icon name="chevronRight" size={12} /></span>
              <span className="pf-row-text">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="micro-label pf-group-label">Parts</div>
      <ul className="pf-group">
        {view.parts.length === 0 && <li className="pf-empty" data-testid="parts-empty">No parts yet</li>}
        {view.parts.map((p) => {
          const visible = !hidden[p.id];
          const state = sel?.selected === p.id ? " is-picked" : sel?.hover === p.id ? " is-hovered" : "";
          return (
            <li
              key={p.id}
              className={`pf-part${state}`}
              onMouseEnter={() => sel?.onHover(p.id)}
              onMouseLeave={() => sel?.onHover(null)}
            >
              <button
                className="pf-row pf-part-name"
                data-testid={`part-row-${p.id}`}
                aria-pressed={sel?.selected === p.id}
                onClick={() => sel?.onSelect(sel.selected === p.id ? null : p.id)}
              >
                <span className={`pf-row-text${visible ? "" : " pf-muted"}`}>{p.name}</span>
              </button>
              <button
                className="pf-eye"
                data-testid={`part-eye-${p.id}`}
                aria-pressed={visible}
                aria-label={`${visible ? "Hide" : "Show"} ${p.name}`}
                onClick={() => setHidden((h) => ({ ...h, [p.id]: visible }))}
              >
                <Icon name={visible ? "eye" : "eyeOff"} size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {files.length > 0 && (
        <>
          <div className="micro-label pf-group-label">Design files · saved</div>
          <ul className="pf-group" data-testid="design-files">
            {files.map((f) => (
              <li key={f.name}>
                <a
                  className="pf-row pf-file"
                  href={f.url}
                  download={f.name.split("/").pop()}
                  data-testid={`file-${f.name.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  <Icon name="save" size={14} />
                  <span className="pf-row-text readout">{f.name}</span>
                  <span className="readout pf-muted">{fmtBytes(f.bytes)}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

export function Explorer({ overlay = false, live = null, sel, files = [] }: {
  overlay?: boolean;
  live?: ExplorerView | null;
  sel?: PartSelection;
  files?: Array<{ name: string; url: string; bytes: number }>;
}) {
  if (live) return <LiveExplorer view={live} overlay={overlay} sel={sel} files={files} />;
  return <MockExplorer overlay={overlay} />;
}

function MockExplorer({ overlay }: { overlay: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ oneshotfly: true, designs: true, runs: false, spacerockets: false });
  const [parts, setParts] = useState<PartRow[]>(initialParts);
  const [selected, setSelected] = useState("head");
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const [p0, p1] = projects;

  return (
    <aside className={`pf-explorer${overlay ? " is-overlay" : ""}`} data-testid="explorer" aria-label="Explorer">
      <div className="pf-wordmark" aria-label="PicoForge">PICOFORGE</div>

      <div className="micro-label pf-group-label">Projects</div>
      <ul className="pf-group" role="tree">
        <li role="treeitem" aria-expanded={open.oneshotfly}>
          <button className="pf-row" data-testid="tree-project-oneshotfly" onClick={() => toggle("oneshotfly")}>
            <span className="pf-chev"><Icon name={open.oneshotfly ? "chevronDown" : "chevronRight"} size={12} /></span>
            <span className="pf-row-text pf-strong">{p0.name}</span>
          </button>
          {open.oneshotfly && (
            <ul role="group">
              <li role="treeitem" aria-expanded={open.designs}>
                <button className="pf-row pf-indent-1" data-testid="tree-designs" onClick={() => toggle("designs")}>
                  <span className="pf-chev"><Icon name={open.designs ? "chevronDown" : "chevronRight"} size={12} /></span>
                  <span className="pf-row-text">Designs</span>
                </button>
                {open.designs && p0.designs.map((d) => (
                  <button key={d.id} className="pf-row pf-indent-2 is-selected" data-testid={`tree-design-${d.id}`}>
                    <span className="pf-row-text readout">{d.label}</span>
                    <span className="pf-run">
                      <span className="pf-live-dot" data-live="run-dot" aria-label="running" />
                      <span className="readout pf-muted">{d.run}</span>
                    </span>
                  </button>
                ))}
              </li>
              <li role="treeitem" aria-expanded={open.runs}>
                <button className="pf-row pf-indent-1" data-testid="tree-runs" onClick={() => toggle("runs")}>
                  <span className="pf-chev"><Icon name={open.runs ? "chevronDown" : "chevronRight"} size={12} /></span>
                  <span className="pf-row-text">Runs</span>
                  <span className="readout pf-muted">{p0.runsCount}</span>
                </button>
              </li>
            </ul>
          )}
        </li>
        <li role="treeitem" aria-expanded={false}>
          <button className="pf-row" data-testid="tree-project-spacerockets" onClick={() => toggle("spacerockets")}>
            <span className="pf-chev"><Icon name={open.spacerockets ? "chevronDown" : "chevronRight"} size={12} /></span>
            <span className="pf-row-text">{p1.name}</span>
          </button>
        </li>
      </ul>

      <div className="micro-label pf-group-label">Parts</div>
      <ul className="pf-group">
        {parts.map((p) => (
          <li key={p.id} className={`pf-part${selected === p.id ? " is-selected" : ""}`}>
            <button className="pf-row pf-part-name" data-testid={`part-row-${p.id}`} onClick={() => setSelected(p.id)}>
              <span className={`pf-row-text${p.visible ? "" : " pf-muted"}`}>{p.name}</span>
            </button>
            <button
              className="pf-eye"
              data-testid={`part-eye-${p.id}`}
              aria-pressed={p.visible}
              aria-label={`${p.visible ? "Hide" : "Show"} ${p.name}`}
              onClick={() => setParts((ps) => ps.map((q) => (q.id === p.id ? { ...q, visible: !q.visible } : q)))}
            >
              <Icon name={p.visible ? "eye" : "eyeOff"} size={16} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
