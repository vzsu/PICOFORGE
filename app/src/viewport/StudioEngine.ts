// app/src/viewport/StudioEngine.ts
// T0 studio renderer for the P0 mock-up (docs/10). Imperative, no React inside.
// - Part geometry + AO + curvature + contact shadow are built and baked ONCE in a worker.
// - Render on demand: nothing is drawn while the camera is still and converged.
// - Interactive frames at a dynamic render scale (0.6–1.0) × pixel ratio capped at 1.25.
// - When idle for 300 ms: 8 Halton-jittered frames accumulate into a half-float target
//   (docs/10 §3), then the GPU stops.

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  HalfFloatType,
  Matrix4,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import CameraControls from "camera-controls";
import type { HeadBuild } from "./studio/proceduralHead.ts";
import {
  makeAluminium,
  makeBackgroundTexture,
  makeBlendMaterial,
  makeBrushTexture,
  makeFloorMaterial,
  makePresentMaterial,
  makeShadowTexture,
} from "./studio/materials.ts";

CameraControls.install({
  THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster },
});

export type StudioView = "home" | "front" | "top" | "right";
export type RenderMode = "loading" | "interactive" | "accumulating" | "converged" | "error";

export interface StudioMetrics {
  tier: "T0";
  mode: RenderMode;
  firstFrameMs: number | null;
  buildMs: number | null;
  bakeTimings: HeadBuild["timings"] | null;
  triangles: number;
  vertices: number;
  drawCalls: number;
  renderScale: number;
  pixelRatio: number;
  accumFrames: number;
  interactiveFrames: number;
  frameMsP50: number | null;
  frameMsP95: number | null;
  volumeCm3: number | null;
  errorCode: string | null;
}

export interface StudioCallbacks {
  /** Camera world matrix (column-major 4×4) after each interactive frame, for HUD overlays. */
  onCamera?: (rot: readonly number[]) => void;
  onMode?: (mode: RenderMode) => void;
}

const T0 = {
  maxPixelRatio: 1.25,
  minScale: 0.6,
  accumFrames: 8,
  idleMs: 300,
  slowFrameMs: 33,
  envSigma: 0.04,
  voxelMm: 1.5,
};

const HALTON: ReadonlyArray<readonly [number, number]> = (() => {
  const h = (i: number, b: number) => {
    let f = 1, r = 0;
    while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
    return r;
  };
  return Array.from({ length: 16 }, (_, i) => [h(i + 1, 2) - 0.5, h(i + 1, 3) - 0.5] as const);
})();

function isHeadBuild(x: unknown): x is HeadBuild & { totalMs: number } {
  return typeof x === "object" && x !== null &&
    "positions" in x && x.positions instanceof Float32Array &&
    "normals" in x && x.normals instanceof Float32Array &&
    "ao" in x && x.ao instanceof Float32Array &&
    "curv" in x && x.curv instanceof Float32Array &&
    "indices" in x && x.indices instanceof Uint32Array &&
    "shadow" in x && x.shadow instanceof Uint8Array &&
    "totalMs" in x && typeof x.totalMs === "number";
}

export class StudioEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly cb: StudioCallbacks;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 1, 20000);
  private readonly controls: CameraControls;
  private readonly pmrem: PMREMGenerator;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly worker: Worker;
  private readonly t0 = performance.now();

  private part: Mesh | null = null;
  private partSphere = new Sphere(new Vector3(0, 26, 0), 130);
  private mode: RenderMode = "loading";
  private raf: number | null = null;
  private lastFrameAt = 0;
  private lastInputAt = 0;
  private renderScale = 1;
  private frameTimes: number[] = [];
  private slowStreak = 0;
  private accumK = 0;
  private accumOk = false;
  private accRT: WebGLRenderTarget | null = null;
  private frameRT: WebGLRenderTarget | null = null;
  private readonly blendMat = makeBlendMaterial();
  private readonly presentMat = makePresentMaterial();
  private readonly quadScene = new Scene();
  private readonly quad: Mesh;
  private readonly quadCam = new PerspectiveCamera();
  private disposed = false;
  private needsDraw = true;
  private metrics: StudioMetrics = {
    tier: "T0", mode: "loading", firstFrameMs: null, buildMs: null, bakeTimings: null,
    triangles: 0, vertices: 0, drawCalls: 0, renderScale: 1, pixelRatio: 1, accumFrames: 0,
    interactiveFrames: 0, frameMsP50: null, frameMsP95: null, volumeCm3: null, errorCode: null,
  };

  constructor(canvas: HTMLCanvasElement, cb: StudioCallbacks = {}) {
    this.canvas = canvas;
    this.cb = cb;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // T0: MSAA off, idle accumulation instead (docs/10 §7)
      alpha: false,
      powerPreference: "default",
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // ACES is applied inside the aluminium shader only, so token colours stay exact.
    this.renderer.toneMapping = NoToneMapping;
    this.accumOk = this.renderer.extensions.has("EXT_color_buffer_half_float") ||
      this.renderer.extensions.has("EXT_color_buffer_float");

    // Environment built once (docs/10 §1).
    this.pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const envRT = this.pmrem.fromScene(room, T0.envSigma);
    room.dispose();
    this.scene.environment = envRT.texture;
    this.disposables.push(envRT);

    const bg = makeBackgroundTexture();
    this.scene.background = bg;
    this.disposables.push(bg);

    this.quad = new Mesh(new PlaneGeometry(2, 2), this.presentMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // Camera + controls (docs/10 §6: FOV 35°, home azimuth 45°, elevation 30°).
    this.controls = new CameraControls(this.camera, canvas);
    this.controls.smoothTime = 0.12;
    this.controls.draggingSmoothTime = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 3000;
    this.controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
    this.controls.mouseButtons.right = CameraControls.ACTION.TRUCK;
    this.controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
    this.controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    this.controls.addEventListener("control", () => this.input());
    this.controls.addEventListener("update", () => this.request());
    this.controls.addEventListener("wake", () => this.input());
    this.setView("home", false);

    this.resize();

    // Build + bake the part off the main thread.
    this.worker = new Worker(new URL("./studio/headWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<unknown>) => this.onBuilt(e.data);
    this.worker.onerror = () => this.fail("BUILD_WORKER");
    this.worker.postMessage({ voxelMm: T0.voxelMm });

    canvas.addEventListener("webglcontextlost", this.onContextLost);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  setView(v: StudioView, tween = true): void {
    // Aim a little below the part centre so it sits above the bottom readout pill.
    const c = this.partSphere.center.clone();
    c.y -= this.partSphere.radius * 0.12;
    const r = this.fitDistance();
    const dir: Record<StudioView, [number, number]> = {
      home: [Math.PI / 4, Math.PI / 6],
      front: [0, 0.02],
      right: [Math.PI / 2, 0.02],
      top: [0, Math.PI / 2 - 0.001],
    };
    const [az, el] = dir[v];
    const smooth = tween && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    void this.controls.setLookAt(
      c.x + r * Math.cos(el) * Math.sin(az), c.y + r * Math.sin(el), c.z + r * Math.cos(el) * Math.cos(az),
      c.x, c.y, c.z, smooth,
    );
    this.input();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
    this.input();
  }

  getMetrics(): StudioMetrics {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
    return {
      ...this.metrics,
      mode: this.mode,
      renderScale: this.renderScale,
      pixelRatio: this.renderer.getPixelRatio(),
      frameMsP50: pct(0.5),
      frameMsP95: pct(0.95),
    };
  }

  resetFrameStats(): void {
    this.frameTimes = [];
    this.metrics.interactiveFrames = 0;
  }

  /** Programmatic orbit for tests and turntable: rotate by radians, instantly. */
  orbitBy(azimuthRad: number, polarRad = 0): void {
    void this.controls.rotate(azimuthRad, polarRad, false);
    this.input();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.worker.terminate();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.controls.dispose();
    this.part?.geometry.dispose();
    for (const d of this.disposables) d.dispose();
    this.accRT?.dispose();
    this.frameRT?.dispose();
    this.blendMat.dispose();
    this.presentMat.dispose();
    this.quad.geometry.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }

  /** Distance that frames the part's bounding sphere in the narrower FOV axis. */
  private fitDistance(): number {
    const halfV = (this.camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    return (this.partSphere.radius * 0.98) / Math.sin(Math.min(halfV, halfH));
  }

  // ─── Build result ────────────────────────────────────────────────────────────

  private onBuilt(data: unknown): void {
    if (this.disposed) return;
    if (!isHeadBuild(data)) { this.fail("LOAD_PARSE"); return; }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(data.positions, 3));
    geom.setAttribute("normal", new BufferAttribute(data.normals, 3));
    geom.setAttribute("aAo", new BufferAttribute(data.ao, 1));
    geom.setAttribute("aCurv", new BufferAttribute(data.curv, 1));
    geom.setIndex(new BufferAttribute(data.indices, 1));
    geom.computeBoundingSphere();
    geom.computeBoundingBox();

    const brush = makeBrushTexture();
    const { material } = makeAluminium(brush);
    this.disposables.push(brush, material);
    this.part = new Mesh(geom, material);
    this.scene.add(this.part);

    const box = geom.boundingBox ?? new Box3();
    box.getBoundingSphere(this.partSphere);
    const diag = box.min.distanceTo(box.max);

    const shadowTex: Texture = makeShadowTexture(data.shadow, data.shadowW, data.shadowH);
    const floorMat = makeFloorMaterial({
      shadow: shadowTex,
      shadowMin: new Vector2(data.shadowMinX, data.shadowMinZ),
      shadowSize: new Vector2(data.shadowSizeX, data.shadowSizeZ),
      radius: 6 * diag,
    });
    const floorGeom = new CircleGeometry(6 * diag, 96);
    floorGeom.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeom, floorMat);
    floor.renderOrder = -1;
    this.scene.add(floor);
    this.disposables.push(shadowTex, floorMat, floorGeom);

    this.camera.near = diag * 0.02;
    this.camera.far = diag * 40;
    this.camera.updateProjectionMatrix();

    this.metrics.buildMs = data.totalMs;
    this.metrics.bakeTimings = data.timings;
    this.metrics.triangles = data.indices.length / 3;
    this.metrics.vertices = data.positions.length / 3;
    this.metrics.volumeCm3 = data.volumeCm3;
    this.setView("home", false);
  }

  private fail(code: string): void {
    this.metrics.errorCode = code;
    this.setMode("error");
  }

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.fail("CONTEXT_LOST");
  };

  // ─── Frame loop (render on demand) ──────────────────────────────────────────

  private input(): void {
    this.lastInputAt = performance.now();
    this.accumK = 0;
    this.needsDraw = true;
    this.request();
  }

  private request(): void {
    if (this.raf !== null || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    this.raf = null;
    if (this.disposed || this.mode === "error") return;
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 60;
    const moved = this.controls.update(dt);
    if (moved) { this.needsDraw = true; this.accumK = 0; this.lastInputAt = now; }

    if (this.needsDraw) {
      this.drawInteractive(now);
      this.needsDraw = false;
      this.request();
    } else if (this.part && now - this.lastInputAt >= T0.idleMs) {
      if (this.renderScale < 1) { this.renderScale = 1; this.applyPixelRatio(); }
      if (this.accumOk && this.accumK < T0.accumFrames) {
        this.drawAccum();
        this.request();
      } else {
        this.setMode("converged"); // GPU idle from here
      }
    } else {
      this.request(); // waiting for idle threshold
    }
    this.lastFrameAt = now;
  };

  private drawInteractive(now: number): void {
    // Dynamic resolution (docs/10 §3): frames over 33 ms lower the render scale.
    if (this.lastFrameAt && this.mode === "interactive") {
      const ft = now - this.lastFrameAt;
      if (ft < 250) {
        this.frameTimes.push(ft);
        if (this.frameTimes.length > 600) this.frameTimes.shift();
        this.metrics.interactiveFrames++;
        this.slowStreak = ft > T0.slowFrameMs ? this.slowStreak + 1 : 0;
        if (this.slowStreak >= 8 && this.renderScale > T0.minScale) {
          this.renderScale = Math.max(T0.minScale, this.renderScale - 0.1);
          this.slowStreak = 0;
          this.applyPixelRatio();
        }
      }
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.afterDraw();
    this.setMode(this.part ? "interactive" : "loading");
  }

  private ensureTargets(): void {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    if (this.accRT && this.accRT.width === size.x && this.accRT.height === size.y) return;
    this.accRT?.dispose();
    this.frameRT?.dispose();
    this.accRT = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, depthBuffer: false });
    this.frameRT = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, depthBuffer: true });
  }

  private drawAccum(): void {
    this.ensureTargets();
    if (!this.accRT || !this.frameRT) return;
    const k = this.accumK + 1;
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const [jx, jy] = HALTON[this.accumK % HALTON.length];
    this.camera.setViewOffset(size.x, size.y, jx, jy, size.x, size.y);
    this.renderer.setRenderTarget(this.frameRT);
    this.renderer.render(this.scene, this.camera);
    this.camera.clearViewOffset();

    this.blendMat.uniforms.tFrame.value = this.frameRT.texture;
    this.blendMat.uniforms.uWeight.value = 1 / k;
    this.quad.material = this.blendMat;
    this.renderer.setRenderTarget(this.accRT);
    this.renderer.autoClear = false;
    this.renderer.render(this.quadScene, this.quadCam);
    this.renderer.autoClear = true;

    this.presentMat.uniforms.tAcc.value = this.accRT.texture;
    this.quad.material = this.presentMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);

    this.accumK = k;
    this.metrics.accumFrames = k;
    this.setMode(k >= T0.accumFrames ? "converged" : "accumulating");
  }

  private afterDraw(): void {
    if (this.metrics.firstFrameMs === null && this.part) {
      this.metrics.firstFrameMs = performance.now() - this.t0;
    }
    if (this.cb.onCamera) this.cb.onCamera(this.camera.matrixWorld.elements);
  }

  private applyPixelRatio(): void {
    const pr = Math.min(window.devicePixelRatio || 1, T0.maxPixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), false);
  }

  private setMode(m: RenderMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.metrics.mode = m;
    this.cb.onMode?.(m);
  }
}
