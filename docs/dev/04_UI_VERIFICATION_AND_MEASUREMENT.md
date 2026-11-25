# Dev 04 · Checking, measuring and logging through the UI

Unit tests prove functions; this file is how an agent proves the *app* works: drive the real UI, read values off it, measure, screenshot, and log what it saw.

## 1. Hooks the app exposes for checking

### `data-testid` (always present, all builds)

| testid | Element |
|---|---|
| `composer`, `send`, `stop` | Chat input and buttons |
| `mode-low` `mode-std` `mode-deep` `mode-raman` | Mode switch |
| `status-line`, `status-step`, `status-elapsed`, `status-bar` | Live status line |
| `brief-card`, `brief-row-<param>` | Brief |
| `preview-stage` | Viewport stage label (`GHOST`…`VALIDATED`) |
| `dro-volume`, `dro-mass`, `dro-check` | Readout values (text is the mono string) |
| `part-row-<name>`, `part-eye-<name>` | Explorer parts |
| `inspector`, `param-<name>`, `xform-x|y|z` | Inspector fields |
| `save-indicator` | "Saved · 2s ago" |
| `tier-chip`, `agents-chip` | Top bar |
| `settings`, `settings-section-<id>`, `cache-clear-<kind>` | Settings |

### `window.__pf` (dev and test builds only; absent in release)

```ts
__pf.metrics(): {
  fps: number; frameMsP50: number; frameMsP95: number;
  drawCalls: number; triangles: number; points: number; heapMiB?: number;
  marks: { send?: number; ghost?: number; proxy?: number; draft?: number; validated?: number };
  tier: "T0"|"T1"|"T2"|"T3"; renderMode: string;
}
__pf.scene(): { variantId: string; rev: number; nodes: NodeSummary[]; params: Record<string, number> }
__pf.waitForStage(stage: string, timeoutMs?: number): Promise<number>   // resolves with ms since send
__pf.select(names: string[]): void
__pf.setView(view: "iso"|"front"|"top"|"right"…): Promise<void>
__pf.measure(a: MeasureTarget, b: MeasureTarget): { distanceMm: number; dx: number; dy: number; dz: number }
__pf.bbox(name?: string): { min: [number,number,number]; max: [number,number,number] }
__pf.forceConverged(): Promise<void>      // finish idle accumulation now (for deterministic screenshots)
```

## 2. `deno task ui:check <scenario>`

Starts the app with the mock model (`PICOFORGE_MODEL=mock:<script>`) and a temporary data folder, runs a Playwright scenario, and writes:

```
reports/ui-check/2026-11-24/edit-arm.png      screenshot (1600×1000, device scale factor 1)
reports/ui-check/2026-11-24/edit-arm.json     measured values, metrics, console errors, a11y summary
```

The JSON includes `expected` and `actual` for every check, and `pass`. The agent opens the PNG, looks at it, and writes in the devlog what it saw (layout, states, anything off), plus the JSON pass/fail.

Scenarios live in `e2e/ui-check/<scenario>.ts`:

| Scenario | Steps | Checks |
|---|---|---|
| `empty` | Launch | Empty-state copy, starter prompts, layout widths (explorer 20 % ± 1, chat 30 % ± 1, viewport 50 % ± 1) |
| `status-line` | Send fan prompt, pause mid-build | Dot colour is the accent token, step counter format `NN/NN · mm:ss`, bar height 2 px |
| `golden-fan` | Send fan prompt to completion | Stage sequence and marks (TTG < 1 s, TTP ≤ 10 s), readout volume equals engine stats to 0.1 cm³, parts listed |
| `edit-arm` | Select `arms`, drag gizmo +4 mm X, type `arm_width = 9` | `__pf.measure` shows +4.0 mm ± 0.05; one edit row per action; mass changed in readout |
| `boolean` | Subtract `vent_cutter` from `plate` | New op row; volume decreased by the cutter overlap within 2 % |
| `nurbs` | Add canopy, drag a control point, thicken 1.2 mm | Rebuild on release only; code panel shows the control net |
| `copy-code` | Copy full file, rebuild in fresh project | Same geometry hash |
| `settings-storage` | `Cmd/Ctrl + ,` → Storage → Clear voxel cache | Sizes drop; project unaffected; save indicator stays green |
| `t0-orbit` | 1366×768, 4× CPU throttle, orbit 5 s | fps ≥ 30 (from `__pf.metrics()`), tier chip `T0` |
| `no-webgl` | Launch with WebGL disabled | Image mode badge and stills present |

## 3. Measuring from the UI

- **Distances and positions:** `__pf.measure` and `__pf.bbox` use the display mesh through BVH raycasts; for sub-voxel accuracy, compare against `engine.inspect` values in the run report.
- **Readout values:** read `dro-*` text, parse the number, compare to the run report's stats; mismatch means the UI is showing stale or wrong data.
- **Timing:** `__pf.metrics().marks` gives the stage times since send; use these, not wall-clock waits.
- **Visual quality checks the agent should make on every UI screenshot:**
  - Only tokens in use (no stray colours); one accent element live at a time.
  - Numbers in mono; no clipped text; no overflow scrollbars where none are designed.
  - Readout and status line legible at 1366×768.
  - The part looks lit like the reference (dark pockets, bright edges); if pockets are flat grey, AO baking failed; check the `engine` log.

## 4. Simulating weak hardware

| Condition | How (test only) |
|---|---|
| Slow CPU | Chrome DevTools Protocol `Emulation.setCPUThrottlingRate {rate: 4}` |
| Small screen | Viewport 1366×768 |
| No GPU (software GL) | Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` |
| No WebGL | `--disable-webgl` (or `--disable-gpu` plus no software fallback) |
| Tight memory | Server started with `PICOFORGE_TIER=T0` and sandbox cap 2.5 GB |

Software GL is for tests only; it is not a supported user configuration (Chrome is removing automatic software fallback for WebGL).

## 5. Logging what the UI check found

Use this block in the devlog:

```md
### 16:05 · ui:check edit-arm
- Result: 6/6 checks pass (reports/ui-check/2026-11-24/edit-arm.json)
- Measured: Δx = 4.00 mm, mass 104.8 → 106.1 g, commit 120 ms after release
- Looked at screenshot: gizmo arrows correct colours; inspector X field shows 4.0; dashed outline on `frame` op until rebuild (as spec'd)
- Issue: inspector sheet overlaps view cube at 1366 px → BUG B-034
```
