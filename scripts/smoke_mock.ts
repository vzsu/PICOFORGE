// scripts/smoke_mock.ts - `deno task smoke:mock`: the fan prompt through the mock model and the
// REAL engine (no network, no cost). Proves brief -> params -> compile -> sandbox build -> L3 ->
// served STL. Prints timings; exit 0 only when geometry.ready arrives with a watertight mesh.
import { join } from "jsr:@std/path@^1.0.0";
import { EngineClient } from "../server/engine/client.ts";
import { type ChatFrame, runChat } from "../server/http/chatRun.ts";

Deno.env.set("PICOFORGE_MODEL", "mock");
if (!Deno.env.get("PICOFORGE_MOCK_TPS")) Deno.env.set("PICOFORGE_MOCK_TPS", "200");

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const exe = Deno.build.os === "windows" ? "forge-engine.exe" : "forge-engine";
const bin = Deno.env.get("ENGINE_BIN") ?? join(root, "engine/ForgeEngine/bin/Debug/net9.0", exe);
const dataDir = await Deno.makeTempDir({ prefix: "pf-smoke-" });
const prompt = Deno.args.join(" ") ||
  "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";

const engine = new EngineClient(bin);
const t0 = performance.now();
const hello = await engine.start();
if (!hello.ok) {
  console.error(`engine did not start (${bin}): ${hello.error.message}`);
  Deno.exit(1);
}
const tEngine = performance.now() - t0;
const marks: Record<string, number> = {};
const frames: ChatFrame[] = [];
const t1 = performance.now();
const state = await runChat({
  emit: (f) => {
    frames.push(f);
    const key = f.type === "run.status" ? `status:${f.state}` : f.type;
    marks[key] ??= Math.round(performance.now() - t1);
    if (f.type === "error") console.error(`error frame: ${f.code} ${f.message}`);
  },
  engine,
  dataDir,
  signal: new AbortController().signal,
}, {
  runId: `smoke-${Date.now()}`,
  projectId: "smoke",
  conversationId: "smoke",
  text: prompt,
  history: [],
});
const total = Math.round(performance.now() - t1);
engine.stop();

const geo = frames.find((f) => f.type === "geometry.ready");
console.log(JSON.stringify(
  {
    state,
    engineStartMs: Math.round(tEngine),
    totalMs: total,
    marks,
    geometry: geo && geo.type === "geometry.ready" ? { url: geo.url, stats: geo.stats } : null,
    dataDir,
  },
  null,
  2,
));
Deno.exit(geo && geo.type === "geometry.ready" && geo.stats.watertight ? 0 : 1);
