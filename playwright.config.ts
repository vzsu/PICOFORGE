// Root Playwright config (docs/11, docs/dev/04). Chromium only, 1600×1000 at DSF 1, trace off.
// Deno tasks call: `npx playwright test --config=playwright.config.ts [e2e/visual] [--grep <scenario>]`.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PF_VITE_PORT ?? 5173);
const SWIFTSHADER = process.env.PF_SWIFTSHADER === "1";
// PF_GPU=1: full Chromium (new headless) on the real GPU via ANGLE/D3D11, for perf numbers.
// Default headless shell renders WebGL with SwiftShader (software) on this machine.
const GPU = process.env.PF_GPU === "1";

export default defineConfig({
  testDir: "e2e",
  outputDir: "reports/e2e",
  fullyParallel: false,
  workers: 1, // 8 GB machines: one browser at a time
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: SWIFTSHADER
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"]
        : GPU
        ? ["--enable-precise-memory-info", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"]
        : ["--enable-precise-memory-info", "--ignore-gpu-blocklist"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 1,
        ...(GPU ? { channel: "chromium" } : {}),
      },
    },
  ],
  webServer: {
    command: `npm --prefix app run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
