// Viewport column (docs/02 §5). React owns only the canvas element, HUD overlays and commands;
// StudioEngine owns WebGL. Camera-driven HUD (view cube, triad) is updated through refs, not state,
// so orbiting never re-renders React.

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons.tsx";
import { StudioEngine, type RenderMode, type StudioMetrics, type StudioView } from "../../viewport/StudioEngine.ts";
import { readout } from "../../mock/mainScreen.ts";

const TOOLS: ReadonlyArray<{ id: string; icon: IconName; label: string }> = [
  { id: "select", icon: "select", label: "Select" },
  { id: "move", icon: "move", label: "Move (W)" },
  { id: "rotate", icon: "rotate", label: "Rotate (E)" },
  { id: "section", icon: "section", label: "Section (S)" },
  { id: "measure", icon: "measure", label: "Measure (M)" },
  { id: "capture", icon: "capture", label: "Capture" },
];

interface PfHooks {
  metrics: () => StudioMetrics & { heapMiB: number | null };
  orbitBy: (azimuthRad: number, polarRad?: number) => void;
  resetFrameStats: () => void;
  setView: (v: StudioView) => void;
}

declare global {
  interface Window {
    __pf?: PfHooks;
  }
  interface Performance {
    memory?: { usedJSHeapSize: number };
  }
}

/** Column-major 4×4 camera world matrix → CSS matrix3d for a cube that shows world orientation. */
function cubeTransform(e: readonly number[]): string {
  const s = [1, -1, 1];
  const m: number[] = new Array(16).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m[j * 4 + i] = s[i] * s[j] * e[i * 4 + j]; // S · Rᵀ · S
  }
  m[15] = 1;
  return `matrix3d(${m.map((v) => v.toFixed(5)).join(",")})`;
}

export function ViewportPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const triadRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const [mode, setMode] = useState<RenderMode>("loading");
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState("select");
  const [accum, setAccum] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new StudioEngine(canvas, {
      onCamera: (e) => {
        if (cubeRef.current) cubeRef.current.style.transform = cubeTransform(e);
        const svg = triadRef.current;
        if (svg) {
          // World axis i in view space = row i of the rotation (column-major elements).
          (["x", "y", "z"] as const).forEach((axis, i) => {
            const vx = e[i], vy = e[4 + i];
            const line = svg.querySelector<SVGLineElement>(`[data-axis="${axis}"]`);
            const label = svg.querySelector<SVGTextElement>(`[data-axis-label="${axis}"]`);
            const x = 30 + vx * 20, y = 30 - vy * 20;
            line?.setAttribute("x2", x.toFixed(2));
            line?.setAttribute("y2", y.toFixed(2));
            label?.setAttribute("x", (30 + vx * 27).toFixed(2));
            label?.setAttribute("y", (30 - vy * 27 + 3).toFixed(2));
          });
        }
      },
      onMode: (m) => {
        setMode(m);
        setAccum(engine.getMetrics().accumFrames);
        if (m === "converged") setReady(true);
      },
    });
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    window.__pf = {
      metrics: () => ({
        ...engine.getMetrics(),
        heapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      }),
      orbitBy: (a, p) => engine.orbitBy(a, p),
      resetFrameStats: () => engine.resetFrameStats(),
      setView: (v) => engine.setView(v),
    };

    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
      if (window.__pf) delete window.__pf;
    };
  }, []);

  const view = (v: StudioView) => engineRef.current?.setView(v);
  const stageLine = mode === "error"
    ? "IMAGE MODE · WEBGL UNAVAILABLE"
    : `${readout.stage} · T0 · ${mode === "converged" ? "8/8" : `${accum}/8`}`;

  return (
    <section
      className="pf-viewport"
      data-testid="viewport"
      data-viewport-ready={ready ? "true" : "false"}
      data-viewport-mode={mode}
      aria-label="3D viewport"
    >
      <canvas ref={canvasRef} className="pf-canvas" data-testid="viewport-canvas" />

      <div className="pf-toolbar" role="toolbar" aria-label="Viewport tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`pf-tool${tool === t.id ? " is-on" : ""}`}
            data-testid={`tool-${t.id}`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            <Icon name={t.icon} size={18} />
          </button>
        ))}
      </div>

      <div className="pf-viewcube" data-testid="view-cube" aria-label="View cube">
        <div className="pf-cube" ref={cubeRef}>
          <button className="pf-face pf-face-front" data-testid="viewcube-front" onClick={() => view("front")}>Front</button>
          <button className="pf-face pf-face-top" data-testid="viewcube-top" onClick={() => view("top")}>Top</button>
          <button className="pf-face pf-face-right" data-testid="viewcube-right" onClick={() => view("right")}>Right</button>
          <div className="pf-face pf-face-back" aria-hidden="true" />
          <div className="pf-face pf-face-left" aria-hidden="true" />
          <div className="pf-face pf-face-bottom" aria-hidden="true" />
        </div>
        <button className="pf-home" data-testid="viewcube-home" aria-label="Home view" onClick={() => view("home")}>
          <Icon name="home" size={12} />
        </button>
      </div>

      <svg className="pf-triad" data-testid="axis-triad" ref={triadRef} width="60" height="60" viewBox="0 0 60 60" aria-label="Axis triad">
        <line data-axis="x" x1="30" y1="30" x2="50" y2="30" stroke="var(--axis-x)" strokeWidth="1.5" strokeLinecap="round" />
        <line data-axis="y" x1="30" y1="30" x2="30" y2="10" stroke="var(--axis-y)" strokeWidth="1.5" strokeLinecap="round" />
        <line data-axis="z" x1="30" y1="30" x2="20" y2="40" stroke="var(--axis-z)" strokeWidth="1.5" strokeLinecap="round" />
        <text data-axis-label="x" x="55" y="33" fill="var(--axis-x)">x</text>
        <text data-axis-label="y" x="30" y="6" fill="var(--axis-y)">y</text>
        <text data-axis-label="z" x="14" y="46" fill="var(--axis-z)">z</text>
      </svg>

      <div className="pf-readout" data-testid="readout">
        <div className="pf-readout-main">
          <span className="pf-ro-label">VOL</span>
          <span className="pf-ro-num" data-testid="dro-volume">{readout.volumeCm3.toFixed(1)}</span>
          <span className="pf-ro-unit">cm³</span>
          <span className="pf-ro-sep">·</span>
          <span className="pf-ro-label">MASS</span>
          <span className="pf-ro-num" data-testid="dro-mass">{readout.massKg.toFixed(2)}</span>
          <span className="pf-ro-unit">kg</span>
          <span className="pf-ro-check" data-testid="dro-check" aria-label="validated">✓</span>
        </div>
        <div className="pf-ro-stage micro-label" data-testid="preview-stage">{stageLine}</div>
      </div>
    </section>
  );
}
