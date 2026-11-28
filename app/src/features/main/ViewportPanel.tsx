// Viewport column (docs/02 §5). React owns only the canvas element, HUD overlays and commands;
// StudioEngine owns WebGL. Camera-driven HUD (view cube, triad) is updated through refs, not state,
// so orbiting never re-renders React.

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons.tsx";
import { type RenderMode, type RenderStyle, StudioEngine, type StudioMetrics, type StudioView } from "../../viewport/StudioEngine.ts";
import type { ReadoutView } from "./view.ts";
import type { PartSelection } from "./Explorer.tsx";
import { type CaptureView, liveSession } from "../../live/session.ts";

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
  sampleCentre: () => { chroma: number; luminance: number; pixels: number };
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

interface ViewportProps {
  /** Live mode: the engine STL to show (null until the first validated build). */
  stlUrl?: string | null;
  readout: ReadoutView | null;
  live?: boolean;
  /** Hover / selection shared with the explorer; the shown part is "result" (one part per build in P0). */
  sel?: PartSelection;
  /** Settings → Appearance selection colour. */
  selectColor?: string;
}

/** Hover hit tests at most this often: a raycast over a multi-million-triangle part costs milliseconds. */
const HOVER_EVERY_MS = 60;
const PART_ID = "result";

export function ViewportPanel({ stlUrl = null, readout, live = false, sel, selectColor }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const triadRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  /** True while a new STL is being fetched (before the engine starts baking it). */
  const fetchingRef = useRef(false);
  const lastHitAt = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const hasPart = live && !!stlUrl && !!readout;
  const [mode, setMode] = useState<RenderMode>("loading");
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState("select");
  const [accum, setAccum] = useState(0);
  // Mock-up only: render looks learned from the reference images (loading point cloud, CFD view).
  const [style, setStyle] = useState<RenderStyle>("studio");

  const chooseStyle = (s: RenderStyle) => {
    if (s === style) return;
    setReady(false); // re-converges in the new look before data-viewport-ready flips back
    setStyle(s);
    engineRef.current?.setRenderStyle(s);
  };

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
    }, { initial: live ? "empty" : "head" });
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
      sampleCentre: () => engine.sampleCentre(),
    };

    // An agent's capture_viewport (docs/14 §3): wait for the newest part to finish baking, then
    // photograph it without moving the user's camera.
    const unregister = live
      ? liveSession.setCapture(async (v: CaptureView) => {
        const until = Date.now() + 9_000;
        while (Date.now() < until) {
          if (!fetchingRef.current && !engine.busy) {
            const png = engine.capture(v);
            if (png) return png;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      })
      : null;

    return () => {
      unregister?.();
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
      if (window.__pf) delete window.__pf;
    };
    // `live` is fixed for the page's lifetime (isLiveMode reads the URL once), so the engine is
    // created once; listing it keeps the dependency honest without re-creating anything.
  }, [live]);

  // Live mode: fetch and bake each new validated STL (the engine keeps T0 render-on-demand rules).
  useEffect(() => {
    const engine = engineRef.current;
    if (!live || !stlUrl || !engine) return;
    let cancelled = false;
    setReady(false);
    fetchingRef.current = true;
    void fetch(stlUrl)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => {
        if (!cancelled) engine.loadStl(buf);
      })
      .catch(() => {
        if (!cancelled) setMode("error");
      })
      .finally(() => {
        fetchingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [live, stlUrl]);

  // Selection colour and tint follow the shared selection state (explorer row or viewport).
  useEffect(() => {
    if (selectColor) engineRef.current?.setSelectColor(selectColor);
  }, [selectColor]);
  const hovered = sel?.hover === PART_ID, selected = sel?.selected === PART_ID;
  useEffect(() => {
    engineRef.current?.setHighlight(selected ? "selected" : hovered ? "hover" : "none");
  }, [hovered, selected]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sel || !hasPart || e.buttons !== 0) return; // no hover while orbiting
    const now = performance.now();
    if (now - lastHitAt.current < HOVER_EVERY_MS) return;
    lastHitAt.current = now;
    const { x, y } = pointerPos(e);
    const hit = engineRef.current?.hitTest(x, y) ?? false;
    if (hit !== hovered) sel.onHover(hit ? PART_ID : null);
  };
  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    downAt.current = pointerPos(e);
  };
  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = downAt.current;
    downAt.current = null;
    if (!sel || !hasPart || !d) return;
    const p = pointerPos(e);
    if (Math.hypot(p.x - d.x, p.y - d.y) > 4) return; // a drag orbits; only a click selects
    const hit = engineRef.current?.hitTest(p.x, p.y) ?? false;
    sel.onSelect(hit ? PART_ID : null);
  };

  const view = (v: StudioView) => engineRef.current?.setView(v);
  const stage = style === "points" ? "VALIDATING" : style === "cfd" ? "SIMULATION COMPLETE" : readout?.stage;
  const stageLine = mode === "error"
    ? "IMAGE MODE · WEBGL UNAVAILABLE"
    : readout
    ? `${stage} · T0 · ${mode === "converged" ? "8/8" : `${accum}/8`}`
    : "WAITING FOR FIRST BUILD · T0";

  return (
    <section
      className="pf-viewport"
      data-testid="viewport"
      data-viewport-ready={ready ? "true" : "false"}
      data-viewport-mode={mode}
      data-render-style={style}
      data-hover={hovered ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      aria-label="3D viewport"
    >
      <canvas
        ref={canvasRef}
        className={`pf-canvas${hovered ? " is-hover" : ""}`}
        data-testid="viewport-canvas"
        onPointerMove={onCanvasMove}
        onPointerDown={onCanvasDown}
        onPointerUp={onCanvasUp}
        onPointerLeave={() => hovered && sel?.onHover(null)}
      />
      {selected && (
        <div className="pf-selchip readout" data-testid="selected-chip">
          SELECTED · {readout ? `${readout.volumeCm3.toFixed(1)} cm³` : "part"} · Esc to clear
        </div>
      )}

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
        {readout && (
          <div className="pf-readout-main">
            <span className="pf-ro-label">VOL</span>
            <span className="pf-ro-num" data-testid="dro-volume">{readout.volumeCm3.toFixed(1)}</span>
            <span className="pf-ro-unit">cm³</span>
            {readout.massKg !== null && (
              <>
                <span className="pf-ro-sep">·</span>
                <span className="pf-ro-label">MASS</span>
                <span className="pf-ro-num" data-testid="dro-mass">
                  {readout.massKg < 1 ? readout.massKg.toFixed(3) : readout.massKg.toFixed(2)}
                </span>
                <span className="pf-ro-unit">kg</span>
              </>
            )}
            {readout.valid && <span className="pf-ro-check" data-testid="dro-check" aria-label="validated">✓</span>}
          </div>
        )}
        <div className="pf-ro-stage micro-label" data-testid="preview-stage">{stageLine}</div>
      </div>

      {style === "cfd" && (
        <div className="pf-legend" data-testid="cfd-legend" aria-label="Velocity magnitude legend">
          <div className="pf-legend-title">Velocity Magnitude<br />(m/s)</div>
          <div className="pf-legend-body">
            <div className="pf-legend-bar" aria-hidden="true" />
            <ol className="pf-legend-ticks readout">
              {["60.0", "48.0", "36.0", "24.0", "12.0", "0.0"].map((t) => <li key={t}>{t}</li>)}
            </ol>
          </div>
        </div>
      )}

      {!live && (
        <div className="pf-styles" role="radiogroup" aria-label="Render style (mock-up)">
          {([["studio", "Studio"], ["points", "Loading"], ["cfd", "CFD"]] as const).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={style === s}
              className={`pf-style${style === s ? " is-on" : ""}`}
              data-testid={`render-style-${s}`}
              title={s === "studio" ? "Studio render" : s === "points" ? "Loading look (mock)" : "CFD analysis look (mock)"}
              onClick={() => chooseStyle(s)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
