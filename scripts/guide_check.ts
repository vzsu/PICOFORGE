// scripts/guide_check.ts — `deno task guide:check`: build every worked example in
// PICOFORGE_AGENT_GUIDE.md through the MCP tool path (open_project → submit_design_brief → run_picogk)
// on the real engine, in a throwaway data dir. Proves the guide an agent learns from is correct.
// Exit 1 if any example is rejected or fails the validation ladder.

import { openDb } from "../server/db/db.ts";
import { EngineSupervisor } from "../server/engine/supervisor.ts";
import { resolveEngineBin } from "../server/config.ts";
import { callAgentTool, type McpDeps, type McpToolResult } from "../server/mcp/agentTools.ts";
import { loadGuide, parseExamples } from "../server/mcp/guide.ts";

function body(r: McpToolResult): Record<string, unknown> {
  const t = r.content[0];
  return t?.type === "text" ? JSON.parse(t.text) : {};
}

const dataDir = await Deno.makeTempDir({ prefix: "pf_guide_" });
await openDb(dataDir);
const supervisor = new EngineSupervisor(await resolveEngineBin(Deno.env.get("ENGINE_BIN")));
await supervisor.start();
const engine = supervisor.client;
if (!engine) {
  console.error("engine did not start: build it with deno task check:engine");
  Deno.exit(1);
}
const deps: McpDeps = { engine, dataDir, emit: () => {}, emitAll: () => {} };

let failed = 0;
for (const ex of parseExamples(await loadGuide())) {
  const t0 = performance.now();
  const { projectId } = body(
    await callAgentTool("open_project", { projectName: `guide-${ex.name}` }, deps, "guide-check"),
  );
  const brief = body(
    await callAgentTool("submit_design_brief", { projectId, ...ex.brief }, deps, "guide-check"),
  );
  if (brief.accepted !== true) {
    failed++;
    console.log(`✗ ${ex.name}: brief rejected ${JSON.stringify(brief.violations)}`);
    continue;
  }
  const built = body(
    await callAgentTool("run_picogk", { projectId, code: ex.code }, deps, "guide-check"),
  );
  const ms = Math.round(performance.now() - t0);
  if (built.ok !== true) {
    failed++;
    console.log(`✗ ${ex.name}: ${built.code} ${JSON.stringify(built.error).slice(0, 1500)}`);
    continue;
  }
  const s = built.stats as Record<string, unknown>;
  console.log(
    `✓ ${ex.name}: ${s.volumeCm3} cm³, bbox ${JSON.stringify(s.bboxMin)}..${
      JSON.stringify(s.bboxMax)
    }, ` +
      `${s.triangles} tris, watertight ${s.watertight}, min wall ${s.minWallProbeMm} mm, ${ms} ms`,
  );
}
await supervisor.stop();
console.log(failed ? `\n${failed} example(s) failed` : "\nall guide examples build");
Deno.exit(failed ? 1 : 0);
