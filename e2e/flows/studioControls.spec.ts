// e2e/flows/studioControls.spec.ts — UI-FLOW-studio-controls: the studio's everyday controls on the real
// server + engine (mock model):
// - SAVE-RUN-01 / SAVE-OPEN-01: a build saves design.cs + brief.json + part.stl; a reload brings the
//   part back with its files.
// - SEL-HOVER-01 / SEL-PICK-01: hovering the part tints it in the selection colour (blue by default),
//   a click selects it (explorer row + chip), Esc clears.
// - SETTINGS-01: Ctrl+, opens Settings; a colour change autosaves and survives a reload.
// - RAIL-01: Runs and Agents panels open from the rail.

import { expect, type Page, test } from "@playwright/test";
import { type LiveServer, startLiveServer } from "./liveServer.ts";

const PORT = Number(process.env.PF_CONTROLS_PORT ?? 7419);
const FAN_PROMPT = "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";
let srv: LiveServer | null = null;

async function centreChroma(page: Page): Promise<number> {
  return await page.evaluate(() => window.__pf?.sampleCentre().chroma ?? -1);
}

async function hoverCentre(page: Page) {
  const box = await page.getByTestId("viewport-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const x = box.x + box.width / 2, y = box.y + box.height * 0.45;
  await page.mouse.move(x - 40, y);
  await page.mouse.move(x, y, { steps: 4 });
  return { x, y };
}

test.describe("UI-FLOW-studio-controls", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    srv = await startLiveServer(PORT);
  });
  test.afterAll(() => {
    srv?.stop();
    srv = null;
  });

  test("save + reopen, hover/select in the selection colour, settings autosave, rail panels", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${srv!.origin}/?t=${srv!.token}`);
    await expect(page.getByTestId("save-indicator")).toContainText("Connected", { timeout: 15_000 });

    // build one part (mock model, real engine)
    await page.getByTestId("composer").fill(FAN_PROMPT);
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", { timeout: 120_000 });

    // SAVE-RUN-01: the design is saved and listed
    await expect(page.getByTestId("design-files")).toContainText("design.cs");
    await expect(page.getByTestId("design-files")).toContainText("brief.json");
    await expect(page.getByTestId("design-files")).toContainText("part.stl");
    await expect(page.getByTestId("save-indicator")).toContainText("Saved");
    const csUrl = await page.getByTestId("file-design-cs").getAttribute("href");
    const cs = await (await fetch(`${srv!.origin}${csUrl}`)).text();
    expect(cs).toContain("public static class Design");

    // SEL-HOVER-01: hover tints the part blue (chroma rises) and the explorer row follows
    const before = await centreChroma(page);
    const p = await hoverCentre(page);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-hover", "true");
    await expect(page.locator(".pf-part.is-hovered")).toHaveCount(1);
    await expect.poll(() => centreChroma(page)).toBeGreaterThan(before + 3);

    // SEL-PICK-01: click selects, Esc clears
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("selected-chip")).toBeVisible();
    await expect(page.getByTestId("part-row-result")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-selected", "false");

    // SETTINGS-01: Ctrl+, opens Settings; colour autosaves
    await page.keyboard.press("Control+Comma");
    await expect(page.getByTestId("settings-overlay")).toBeVisible();
    await expect(page.getByTestId("settings-model")).toHaveValue("claude-opus-5-5");
    await page.getByTestId("settings-section-appearance").click();
    await page.getByTestId("settings-color-30d158").click();
    await expect(page.getByTestId("settings-save-state")).toContainText("Saved", { timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);

    // RAIL-01
    await page.getByTestId("rail-runs").click();
    await expect(page.getByTestId("runs-panel")).toBeVisible();
    await expect(page.locator("[data-testid^=run-row-][data-state=done]")).toHaveCount(1);
    await page.getByTestId("rail-agents").click();
    await expect(page.getByTestId("agents-panel")).toBeVisible();
    await page.getByTestId("rail-projects").click();

    // SAVE-OPEN-01: reload brings back the part, its files and the chosen colour
    await page.reload();
    await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", { timeout: 60_000 });
    await expect(page.getByTestId("design-files")).toContainText("design.cs");
    const sel = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--select").trim());
    expect(sel.toUpperCase()).toBe("#30D158");
    expect(errors).toEqual([]);
  });
});
