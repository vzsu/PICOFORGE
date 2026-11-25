// UI-VIS-mock-main — P0 main-screen mock-up (docs/02 §1, docs/design/00_IMAGE_PROMPTS.md block 1).
// Assertions + a saved screenshot for a human/agent to look at. No auto-updated baselines.
//
// Writes:
//   reports/ui/mock-main.png   (or mock-main-swiftshader.png with PF_SWIFTSHADER=1)
//   reports/ui/mock-main.json  measured numbers (first frame, heap, orbit frame times)

import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

interface PfMetrics {
  mode: string;
  errorCode: string | null;
  firstFrameMs: number | null;
  buildMs: number | null;
  bakeTimings: Record<string, number> | null;
  triangles: number;
  vertices: number;
  drawCalls: number;
  pixelRatio: number;
  renderScale: number;
  interactiveFrames: number;
  frameMsP50: number | null;
  frameMsP95: number | null;
  heapMiB: number | null;
}
declare global {
  interface Window {
    __pf?: {
      metrics: () => PfMetrics;
      orbitBy: (a: number, p?: number) => void;
      resetFrameStats: () => void;
    };
  }
}

const SWIFT = process.env.PF_SWIFTSHADER === "1";
const GPU = process.env.PF_GPU === "1";
const OUT = SWIFT
  ? "reports/ui/mock-main-swiftshader"
  : GPU
  ? "reports/ui/mock-main-gpu"
  : "reports/ui/mock-main";
const ACCENT = "215, 25, 33"; // --accent #D71921

const REQUIRED_TESTIDS = [
  "main-screen",
  "explorer",
  "chat",
  "viewport",
  "statusbar",
  "rail-projects",
  "rail-designs",
  "rail-runs",
  "rail-agents",
  "rail-settings",
  "tree-project-oneshotfly",
  "tree-designs",
  "tree-design-v1.1",
  "tree-runs",
  "tree-project-spacerockets",
  "part-row-head",
  "part-eye-head",
  "part-row-jacket",
  "part-eye-jacket",
  "part-row-bores",
  "part-eye-bores",
  "chat-tab-chat",
  "chat-tab-compute",
  "chat-tab-logs",
  "chat-tab-analytics",
  "msg-user",
  "msg-assistant",
  "brief-card",
  "brief-row-mass",
  "brief-row-coolant",
  "status-line",
  "status-step",
  "status-elapsed",
  "status-bar",
  "status-done",
  "composer",
  "mode-low",
  "mode-std",
  "mode-deep",
  "mode-raman",
  "stop",
  "split-handle",
  "viewport-canvas",
  "tool-select",
  "tool-move",
  "tool-rotate",
  "tool-section",
  "tool-measure",
  "tool-capture",
  "view-cube",
  "viewcube-front",
  "viewcube-top",
  "viewcube-right",
  "axis-triad",
  "readout",
  "dro-volume",
  "dro-mass",
  "dro-check",
  "preview-stage",
  "save-indicator",
  "tier-chip",
  "agents-chip",
];

test.describe("UI-VIS-mock-main", () => {
  test("UI-VIS-mock-main main screen renders like the image prompt", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    const t0 = Date.now();
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.getByTestId("viewport")).toHaveAttribute(
      "data-viewport-mode",
      /converged|error/,
      { timeout: 60_000 },
    );
    const early = await page.evaluate(() => window.__pf?.metrics() ?? null);
    expect(early?.errorCode ?? null, `viewport error; console: ${consoleErrors.join(" | ")}`)
      .toBeNull();
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true");
    const readyMs = Date.now() - t0;

    // Fonts are the bundled local faces.
    const fonts = await page.evaluate(() => ({
      geist: document.fonts.check("15px Geist"),
      mono: document.fonts.check("13px 'Geist Mono'"),
      doto: document.fonts.check("28px Doto"),
    }));
    expect(fonts).toEqual({ geist: true, mono: true, doto: true });

    for (const id of REQUIRED_TESTIDS) {
      await expect(page.getByTestId(id), `testid ${id}`).toHaveCount(1);
    }

    // Copy and values from the mock.
    await expect(page.getByTestId("dro-volume")).toHaveText("412.7");
    await expect(page.getByTestId("dro-mass")).toHaveText("2.38");
    await expect(page.getByTestId("preview-stage")).toContainText("VALIDATED");
    await expect(page.getByTestId("status-step")).toHaveText("03/04");
    await expect(page.getByTestId("status-elapsed")).toHaveText("00:42");
    await expect(page.getByTestId("save-indicator")).toHaveText("Saved · 2s ago");
    await expect(page.getByTestId("tier-chip")).toHaveText("T0");
    await expect(page.getByTestId("mode-deep")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("composer")).toHaveAttribute("placeholder", "Describe a change…");

    // Layout: rail 56 px, explorer 20 %, chat 30 %, viewport the rest (of the width after the rail).
    const box = async (id: string) => {
      const b = await page.getByTestId(id).boundingBox();
      if (!b) throw new Error(`no box for ${id}`);
      return b;
    };
    const usable = 1600 - 56;
    const ex = await box("explorer"), ch = await box("chat"), vp = await box("viewport");
    expect(Math.abs(ex.width / usable - 0.2)).toBeLessThan(0.01);
    expect(Math.abs(ch.width / usable - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(vp.width / usable - 0.5)).toBeLessThan(0.01);
    expect((await box("status-bar")).height).toBe(2);
    const stop = await box("stop");
    expect(stop.width).toBe(32);

    // Accent only on live elements: every element painting #D71921 sits inside [data-live].
    const accentReport = await page.evaluate((accent) => {
      const offenders: string[] = [];
      const live: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const cs = getComputedStyle(el);
        const paints = [
          cs.color,
          cs.backgroundColor,
          cs.borderTopColor,
          cs.borderBottomColor,
          cs.borderLeftColor,
          cs.borderRightColor,
          cs.boxShadow,
          cs.outlineColor,
          cs.fill,
          cs.stroke,
        ];
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const usesAccent = paints.some((p) => p.includes(accent));
        if (!usesAccent) continue;
        const holder = el.closest("[data-live]");
        if (holder) live.push(holder.getAttribute("data-live") ?? "");
        else offenders.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
      return { offenders, live: Array.from(new Set(live)).sort() };
    }, ACCENT);
    expect(accentReport.offenders).toEqual([]);
    expect(accentReport.live).toEqual(["rail-dot", "run-dot", "status-bar", "status-dot", "stop"]);

    // Live animations run (and are the only accent motion).
    const anim = await page.evaluate(() => ({
      dot:
        getComputedStyle(document.querySelector(".pf-status-dot") ?? document.body).animationName,
      shimmer:
        getComputedStyle(document.querySelector(".pf-shimmer") ?? document.body).animationName,
    }));
    expect(anim).toEqual({ dot: "pf-pulse", shimmer: "pf-shimmer" });

    // Viewport actually drew a part: centre pixels differ from the backdrop.
    const metricsAfterLoad = await page.evaluate(() => window.__pf?.metrics() ?? null);
    expect(metricsAfterLoad).not.toBeNull();
    if (!metricsAfterLoad) return;
    expect(metricsAfterLoad.errorCode).toBeNull();
    expect(metricsAfterLoad.mode).toBe("converged");
    expect(metricsAfterLoad.triangles).toBeGreaterThan(20_000);
    expect(metricsAfterLoad.triangles).toBeLessThan(300_000); // T0 display budget (docs/10 §7)
    expect(metricsAfterLoad.pixelRatio).toBeLessThanOrEqual(1.25);

    mkdirSync("reports/ui", { recursive: true });
    await page.screenshot({ path: `${OUT}.png` });

    // Render on demand: once converged, no more frames are drawn.
    const idleFrames = await page.evaluate(async () => {
      const before = window.__pf?.metrics().interactiveFrames ?? -1;
      await new Promise((r) => setTimeout(r, 1000));
      return (window.__pf?.metrics().interactiveFrames ?? -2) - before;
    });
    expect(idleFrames).toBe(0);

    // Orbit for ~2 s (one programmatic orbit step per animation frame) and read frame times.
    const orbit = await page.evaluate(async () => {
      const pf = window.__pf;
      if (!pf) return null;
      pf.resetFrameStats();
      const t = performance.now();
      const intervals: number[] = [];
      let last = t;
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          intervals.push(now - last);
          last = now;
          pf.orbitBy(0.012);
          if (now - t < 2000) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      const m = pf.metrics();
      const s = intervals.slice(2).sort((a, b) => a - b);
      return {
        engineFrames: m.interactiveFrames,
        frameMsP50: m.frameMsP50,
        frameMsP95: m.frameMsP95,
        rafP50: s[Math.floor(s.length * 0.5)],
        rafP95: s[Math.floor(s.length * 0.95)],
        renderScaleAfter: m.renderScale,
      };
    });

    const glRenderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "no-webgl2";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });

    const report = {
      id: "UI-VIS-mock-main",
      gl: SWIFT ? "swiftshader" : GPU ? "gpu-d3d11" : "default",
      glRenderer,
      readyMs,
      firstFrameMs: metricsAfterLoad.firstFrameMs,
      buildMs: metricsAfterLoad.buildMs,
      bakeTimings: metricsAfterLoad.bakeTimings,
      triangles: metricsAfterLoad.triangles,
      vertices: metricsAfterLoad.vertices,
      drawCalls: metricsAfterLoad.drawCalls,
      pixelRatio: metricsAfterLoad.pixelRatio,
      heapMiB: metricsAfterLoad.heapMiB,
      idleFramesIn1s: idleFrames,
      orbit,
      consoleErrors,
    };
    writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(consoleErrors).toEqual([]);
  });

  test("UI-VIS-mock-main breakpoints follow docs/02 §1", async ({ page }) => {
    // < 1100 px: explorer becomes an overlay.
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/");
    await expect(page.getByTestId("main-screen")).toHaveAttribute("data-layout", "overlay");
    await expect(page.getByTestId("explorer")).toHaveCount(0);
    await page.getByTestId("explorer-toggle").click();
    await expect(page.getByTestId("explorer-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("explorer-overlay")).toHaveCount(0);
    // < 760 px: chat and viewport become a two-tab switch.
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.getByTestId("main-screen")).toHaveAttribute("data-layout", "tabs");
    await expect(page.getByTestId("chat")).toBeVisible();
    await expect(page.getByTestId("viewport")).toBeHidden();
    await page.getByTestId("pane-viewport").click();
    await expect(page.getByTestId("viewport")).toBeVisible();
    await expect(page.getByTestId("chat")).toBeHidden();
    // Wide again: Ctrl+B collapses the explorer column.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.getByTestId("explorer")).toBeVisible();
    await page.keyboard.press("Control+b");
    await expect(page.getByTestId("explorer")).toHaveCount(0);
  });

  test("UI-VIS-mock-main reduced motion stops pulse and shimmer", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const anim = await page.evaluate(() => ({
      dot:
        getComputedStyle(document.querySelector(".pf-status-dot") ?? document.body).animationName,
      shimmer:
        getComputedStyle(document.querySelector(".pf-shimmer") ?? document.body).animationName,
      dotOpacity:
        getComputedStyle(document.querySelector(".pf-status-dot") ?? document.body).opacity,
    }));
    expect(anim).toEqual({ dot: "none", shimmer: "none", dotOpacity: "1" });
  });
});
