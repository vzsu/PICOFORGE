// e2e/flows/liveServer.ts — boot the real server (mock model, real engine, fresh data dir) for flow
// tests, read the boot token from its banner, wait for the engine. Shared by UI-FLOW-* specs.

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_BIN = join(
  ROOT,
  "engine/ForgeEngine/bin/Debug/net9.0",
  process.platform === "win32" ? "forge-engine.exe" : "forge-engine",
);

export interface LiveServer {
  origin: string;
  token: string;
  stop: () => void;
  log: () => string;
}

function killTree(p: ChildProcess | null) {
  if (!p?.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" });
    } catch { /* already gone */ }
  } else p.kill("SIGKILL");
}

export async function startLiveServer(port: number, env: Record<string, string> = {}): Promise<LiveServer> {
  const t0 = Date.now();
  execSync("npm --prefix app run build", { cwd: ROOT, stdio: "ignore" });
  console.log(`[liveServer] app built in ${Date.now() - t0} ms`);
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "pf-flow-"));
  const server = spawn(process.env.DENO_BIN ?? "deno", ["run", "-A", "server/main.ts", "--headless"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ENGINE_BIN,
      PICOFORGE_MODEL: "mock",
      PICOFORGE_MOCK_TPS: "200",
      ANTHROPIC_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let token = "";
  const onData = (b: Buffer) => {
    log += b.toString();
    const m = /Token:\s+([0-9a-f-]{36})/.exec(log);
    if (m) token = m[1];
  };
  server.stdout?.on("data", onData);
  server.stderr?.on("data", onData);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (token) {
      try {
        const h = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) })
          .then((r) => r.json());
        if (h?.engine?.status === "ok") {
          console.log(`[liveServer] server + engine ready on ${origin} after ${Date.now() - t0} ms`);
          return { origin, token, stop: () => killTree(server), log: () => log };
        }
      } catch { /* not up yet */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killTree(server);
  throw new Error(`server/engine not ready in 60 s. Log tail:\n${log.slice(-2000)}`);
}
