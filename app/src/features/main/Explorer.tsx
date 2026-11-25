// Explorer column (docs/02 §1): PROJECTS tree and PARTS list as iOS inset grouped lists.

import { useState } from "react";
import { Icon } from "./Icons.tsx";
import { parts as initialParts, projects, type PartRow } from "../../mock/mainScreen.ts";

export function Explorer({ overlay = false }: { overlay?: boolean }) {
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
