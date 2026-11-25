// e2e/flows/fanMock.spec.ts — UI-FLOW-fan-mock (P0 "Testing the app", docs/03 F1, docs/04 §9).
// Builds the app, starts the real server (mock model, real engine, fresh data dir), opens the
// studio with the boot token, sends the fan prompt and waits for the validated mesh in the
// viewport. Records timings and a screenshot in reports/ui/.

import { expect, test } from "@playwright/test";
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PF_FLOW_PORT ?? 7417);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ENGINE_BIN = join(
  ROOT,
  "engine/ForgeEngine/bin/Debug/net9.0",
  process.platform === "win32" ? "forge-engine.exe" : "forge-engine",
);
const FAN_PROMPT = "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";

let server: ChildProcess | null = null;
let token = "";
let serverLog = "";

function killTree(p: ChildProcess | null) {
  if (!p?.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" });
    } catch { /* already gone */ }
  } else p.kill("SIGKILL");
}

test.describe("UI-FLOW-fan-mock", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    execSync("npm --prefix app run build", { cwd: ROOT, stdio: "ignore" });
    const dataDir = mkdtempSync(join(tmpdir(), "pf-flow-"));
    server = spawn(process.env.DENO_BIN ?? "deno", ["run", "-A", "server/main.ts", "--headless"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        ENGINE_BIN,
        PICOFORGE_MODEL: "mock",
        PICOFORGE_MOCK_TPS: "200",
        ANTHROPIC_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onData = (b: Buffer) => {
      serverLog += b.toString();
      const m = /Token:\s+([0-9a-f-]{36})/.exec(serverLog);
      if (m) token = m[1];
    };
    server.stdout?.on("data", onData);
    server.stderr?.on("data", onData);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (token) {
        try {
          const h = await fetch(`${ORIGIN}/api/health`).then((r) => r.json());
          if (h?.engine?.status === "ok") return;
        } catch { /* not up yet */ }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`server/engine not ready in 60 s. Log tail:\n${serverLog.slice(-2000)}`);
  });

  test.afterAll(() => {
    killTree(server);
    server = null;
  });

  test("UI-FLOW-fan-mock fan prompt → brief → live status → validated mesh in the viewport", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(`${ORIGIN}/?t=${token}`);
    await expect(page.getByTestId("main-screen")).toBeVisible();
    await expect(page.getByTestId("engine-chip")).toHaveAttribute("data-engine", "ok");
    await expect(page.getByTestId("save-indicator")).toContainText("Connected", {
      timeout: 15_000,
    });
    // live mode starts empty: no mock brief, no mock status, no mock parts
    await expect(page.getByTestId("brief-card")).toHaveCount(0);
    await expect(page.getByTestId("explorer")).toHaveAttribute("data-mode", "live");
    await expect(page.getByTestId("parts-empty")).toBeVisible();

    const composer = page.getByTestId("composer");
    await composer.fill(FAN_PROMPT);
    const t0 = Date.now();
    await composer.press("Enter");

    await expect(page.getByTestId("msg-user")).toContainText("120 mm fan impeller");
    await expect(page.getByTestId("status-line")).toHaveAttribute("data-status", "live", {
      timeout: 10_000,
    });
    const tStatus = Date.now() - t0;
    await expect(page.getByTestId("stop")).toBeVisible();

    await expect(page.getByTestId("brief-card")).toBeVisible({ timeout: 30_000 });
    const tBrief = Date.now() - t0;
    await expect(page.getByTestId("brief-row-blade_count")).toContainText("7");
    await expect(page.getByTestId("brief-row-hub_radius")).toContainText("12.5");

    await expect(page.getByTestId("status-line")).toHaveAttribute("data-status", "done", {
      timeout: 120_000,
    });
    const tDone = Date.now() - t0;
    await expect(page.getByTestId("status-done-text")).toContainText("Done in");
    await expect(page.getByTestId("msg-assistant").last()).toContainText("Built and validated");

    await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", {
      timeout: 60_000,
    });
    const tMesh = Date.now() - t0;
    const vol = Number(await page.getByTestId("dro-volume").textContent());
    expect(vol).toBeGreaterThan(5);
    await expect(page.getByTestId("dro-check")).toBeVisible();
    await expect(page.getByTestId("preview-stage")).toContainText("VALIDATED");
    // accent only while live (docs/02 §2): after done, no element carries the live markers
    await expect(page.getByTestId("stop")).toHaveCount(0);
    await expect(page.locator("[data-live]:not([data-live='rail-dot'])")).toHaveCount(0);
    // done dot is --ok green (docs/02 §4)
    const dotColor = await page.locator("[data-testid='status-line'] .pf-status-dot").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(dotColor).toBe("rgb(48, 209, 88)");
    // the built part is listed in the explorer
    await expect(page.getByTestId("part-row-result")).toContainText("fan impeller");

    const metrics = await page.evaluate(() => window.__pf?.metrics() ?? null);
    mkdirSync(join(ROOT, "reports/ui"), { recursive: true });
    await page.screenshot({ path: join(ROOT, "reports/ui/flow-fan-mock.png") });
    const numbers = {
      id: "UI-FLOW-fan-mock",
      sendToStatusMs: tStatus,
      sendToBriefMs: tBrief,
      sendToDoneMs: tDone,
      sendToMeshReadyMs: tMesh,
      volumeCm3: vol,
      viewport: metrics,
      consoleErrors,
    };
    writeFileSync(join(ROOT, "reports/ui/flow-fan-mock.json"), JSON.stringify(numbers, null, 2));
    console.log(JSON.stringify(numbers));
    expect(consoleErrors).toEqual([]);
  });
});
