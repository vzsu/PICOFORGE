// UI-VIS-mock-points, UI-VIS-mock-cfd — mock-up render styles learned from the human's reference images
// (IMAGES_OFui/LOADING_POINTCLOUD_UI.png, CFD_SCREEN_UI.png). Mock only: no solver, no live data.
//   points: translucent x-ray with glowing crease edges + surface point dust, readout VALIDATING
//   cfd:    jet colormap of a synthetic velocity field + "Velocity Magnitude (m/s)" legend 0–60,
//           readout SIMULATION COMPLETE
// Assertions + saved screenshots (reports/ui/mock-points.png, mock-cfd.png). No auto-updated baselines.

import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

interface StyleMetrics {
  mode: string;
  renderStyle: string;
  points: number;
  errorCode: string | null;
}
declare global {
  interface Window {
    __pf?: { metrics: () => StyleMetrics; sampleCentre: () => Sample };
  }
}

interface Sample {
  chroma: number;
  luminance: number;
  pixels: number;
}

/** Mean chroma/luminance of the part pixels around the canvas centre (engine renders + reads). */
async function centreColour(page: Page): Promise<Sample> {
  return await page.evaluate(() => window.__pf?.sampleCentre() ?? { chroma: 0, luminance: 0, pixels: 0 });
}

async function openMock(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", {
    timeout: 60_000,
  });
}

async function switchTo(page: Page, style: "studio" | "points" | "cfd") {
  await page.getByTestId(`render-style-${style}`).click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-render-style", style);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", {
    timeout: 30_000,
  });
}

test.describe("UI-VIS-mock render styles", () => {
  test.beforeEach(() => mkdirSync("reports/ui", { recursive: true }));

  test("UI-VIS-mock-points loading style: x-ray edges + point dust, VALIDATING", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openMock(page);
    await expect(page.getByTestId("render-style-studio")).toHaveAttribute("aria-checked", "true");
    await switchTo(page, "points");
    const m = await page.evaluate(() => window.__pf?.metrics() ?? null);
    expect(m?.renderStyle).toBe("points");
    expect(m?.points ?? 0).toBeGreaterThan(10_000); // T0 point budget is 30k (docs/09 §3)
    expect(m?.points ?? 0).toBeLessThanOrEqual(30_000);
    await expect(page.getByTestId("preview-stage")).toContainText("VALIDATING");
    await expect(page.getByTestId("cfd-legend")).toHaveCount(0);
    const c = await centreColour(page);
    expect(c.pixels).toBeGreaterThan(500); // the part is drawn
    expect(c.chroma).toBeLessThan(12); // greyscale x-ray, no tint
    await page.screenshot({ path: "reports/ui/mock-points.png" });
    writeFileSync("reports/ui/mock-points.json", JSON.stringify({ metrics: m, centre: c }, null, 2));
    expect(errors).toEqual([]);
  });

  test("UI-VIS-mock-cfd analysis style: jet colormap + legend 0–60 m/s, SIMULATION COMPLETE", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openMock(page);
    await switchTo(page, "cfd");
    const legend = page.getByTestId("cfd-legend");
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("Velocity Magnitude");
    await expect(legend).toContainText("(m/s)");
    for (const t of ["60.0", "48.0", "36.0", "24.0", "12.0", "0.0"]) await expect(legend).toContainText(t);
    await expect(page.getByTestId("preview-stage")).toContainText("SIMULATION COMPLETE");
    const c = await centreColour(page);
    expect(c.pixels).toBeGreaterThan(500);
    expect(c.chroma).toBeGreaterThan(60); // saturated colormap, not grey aluminium
    await page.screenshot({ path: "reports/ui/mock-cfd.png" });
    writeFileSync("reports/ui/mock-cfd.json", JSON.stringify({ centre: c }, null, 2));

    // back to studio: legend gone, stage back to VALIDATED
    await switchTo(page, "studio");
    await expect(page.getByTestId("cfd-legend")).toHaveCount(0);
    await expect(page.getByTestId("preview-stage")).toContainText("VALIDATED");
    expect(errors).toEqual([]);
  });
});
