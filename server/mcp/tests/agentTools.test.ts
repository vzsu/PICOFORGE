// MCP-01..06 (docs/14 §3, §4, §9, §10; 11 §3 enforcement drills): the agent tool surface over the
// harness tools. Fake engine, real DB, frames captured as the open window would receive them.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { openDb } from "../../db/db.ts";
import { callAgentTool, type McpDeps, type McpToolResult, resetWorkspaces } from "../agentTools.ts";
import { loadGuide, parseExamples } from "../guide.ts";
import { ServerEventSchema, type ServerFrame } from "../../domain/events.ts";
import type { EngineApi, EngineRunParams } from "../../engine/client.ts";

interface Captured {
  deps: McpDeps;
  frames: Array<{ to: string; frame: ServerFrame }>;
  engine: EngineApi & { runs: EngineRunParams[]; compiles: number };
}

function setup(dataDir: string, compileOk = true): Captured {
  const frames: Captured["frames"] = [];
  const runs: EngineRunParams[] = [];
  const engine = {
    runs,
    compiles: 0,
    compile: () => {
      engine.compiles++;
      return Promise.resolve({
        ok: true as const,
        value: compileOk ? { ok: true, diagnostics: [] } : {
          ok: false,
          diagnostics: [{
            id: "CS0103",
            line: 12,
            col: 9,
            message: "The name 'fTip' does not exist",
          }],
        },
      });
    },
    async run(p: EngineRunParams) {
      runs.push(p);
      await Deno.mkdir(p.outDir, { recursive: true });
      const stl = join(p.outDir, "part.stl");
      await Deno.writeFile(stl, new Uint8Array(84));
      return {
        ok: true as const,
        value: {
          ok: true,
          files: { stl },
          stats: {
            volumeCm3: 4.1,
            bboxMin: [-38.1, -38.1, 0],
            bboxMax: [38.1, 38.1, 12],
            triangles: 150_000,
            watertight: true,
            voxelSizeMm: 0.25,
            minWallProbeMm: 1.0,
          },
        },
      };
    },
  };
  return {
    frames,
    engine,
    deps: {
      engine,
      dataDir,
      emit: (to, frame) => frames.push({ to, frame }),
      emitAll: (frame) => frames.push({ to: "*", frame }),
    },
  };
}

const body = (r: McpToolResult): Record<string, unknown> => {
  const t = r.content[0];
  assert(t.type === "text");
  return JSON.parse(t.text);
};

async function freshDb(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "pf_mcp_" });
  await openDb(dir);
  resetWorkspaces();
  return dir;
}

async function propExample() {
  const ex = parseExamples(await loadGuide()).find((e) => e.name === "prop3");
  assert(ex, "guide example prop3 missing");
  return ex;
}

Deno.test("MCP-01 open_project creates once, reopens by name, and focuses the open window", async () => {
  const dir = await freshDb();
  const c = setup(dir);
  const a = body(await callAgentTool("open_project", { projectName: "FPV props" }, c.deps, "test"));
  const b = body(await callAgentTool("open_project", { projectName: "fpv PROPS" }, c.deps, "test"));
  assertEquals(a.projectId, b.projectId);
  const focus = c.frames.filter((f) => f.frame.type === "session.focus");
  assertEquals(focus.length, 2);
  assertEquals(focus[0].to, "*");
  c.frames.forEach((f, i) => assert(ServerEventSchema.safeParse({ ...f.frame, seq: i }).success));
});

Deno.test("MCP-02 run_picogk before a brief → BRIEF_REQUIRED, the engine is never called", async () => {
  const dir = await freshDb();
  const c = setup(dir);
  const { projectId } = body(await callAgentTool("open_project", {}, c.deps, "test"));
  const r = await callAgentTool(
    "run_picogk",
    { projectId, code: "public static class Design {}" },
    c.deps,
    "test",
  );
  assertEquals(r.isError, true);
  assertEquals(body(r).code, "BRIEF_REQUIRED");
  assertEquals(c.engine.compiles, 0);
});

Deno.test("MCP-03 request → brief → build: brief card, run states, geometry.ready in the open window", async () => {
  const dir = await freshDb();
  const c = setup(dir);
  const ex = await propExample();
  const { projectId } = body(
    await callAgentTool("open_project", { projectName: "FPV props" }, c.deps, "claude-code"),
  );
  await callAgentTool(
    "post_message",
    { projectId, kind: "request", text: "quiet 3 blade prop for 3 inch fpv" },
    c.deps,
    "claude-code",
  );
  const brief = body(
    await callAgentTool("submit_design_brief", { projectId, ...ex.brief }, c.deps, "claude-code"),
  );
  assertEquals(brief.accepted, true, JSON.stringify(brief));
  const built = await callAgentTool(
    "run_picogk",
    { projectId, code: ex.code },
    c.deps,
    "claude-code",
  );
  assertEquals(built.isError, undefined, JSON.stringify(body(built)));
  const out = body(built);
  assertEquals(out.ok, true);
  assertEquals(c.engine.runs[0].params?.blade_count, 3); // brief parameters reach ctx.P
  assertEquals(c.engine.runs[0].voxelMm, 0.25);

  const types = c.frames.filter((f) => f.to !== "*").map((f) => f.frame.type);
  // brief and geometry are stored for history but have no chat text: the card and viewport show them
  assertEquals(types, [
    "message.created",
    "chat.block",
    "run.status",
    "geometry.ready",
    "run.status",
  ]);
  const req = c.frames.find((f) => f.frame.type === "message.created")?.frame;
  assert(req?.type === "message.created" && req.message.role === "user");
  assertEquals(req.message.origin, "mcp:claude-code");
  const geo = c.frames.find((f) => f.frame.type === "geometry.ready")?.frame;
  assert(geo?.type === "geometry.ready");
  assertEquals(geo.url, `/files/runs/${out.runId}/part.stl`);
  c.frames.forEach((f, i) =>
    assert(ServerEventSchema.safeParse({ ...f.frame, seq: i }).success, f.frame.type)
  );
});

Deno.test("MCP-04 compile repairs: repairHint each time, then NEEDS_DECISION once the budget is spent", async () => {
  const dir = await freshDb();
  const c = setup(dir, false);
  const ex = await propExample();
  const { projectId } = body(await callAgentTool("open_project", {}, c.deps, "test"));
  await callAgentTool("submit_design_brief", { projectId, ...ex.brief }, c.deps, "test");
  const codes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = body(await callAgentTool("run_picogk", { projectId, code: ex.code }, c.deps, "test"));
    codes.push(String(r.code));
    if (r.code === "COMPILE_ERROR") assert(String(r.repairHint).includes("REPAIR CONTEXT"));
  }
  assertEquals(codes, ["COMPILE_ERROR", "COMPILE_ERROR", "COMPILE_ERROR", "COMPILE_ERROR"]);
  const blocked = body(
    await callAgentTool("run_picogk", { projectId, code: ex.code }, c.deps, "test"),
  );
  assertEquals(blocked.code, "NEEDS_DECISION");
  assert(Array.isArray(blocked.options) && blocked.options.length >= 2);
  assertEquals(c.engine.compiles, 4); // the blocked call never reached the engine
  // a new accepted brief clears the block
  await callAgentTool("submit_design_brief", { projectId, ...ex.brief }, c.deps, "test");
  assertEquals(
    body(await callAgentTool("run_picogk", { projectId, code: ex.code }, c.deps, "test")).code,
    "COMPILE_ERROR",
  );
});

Deno.test("MCP-05 builds per minute are capped with NEEDS_DECISION", async () => {
  const dir = await freshDb();
  const c = setup(dir);
  const ex = await propExample();
  const { projectId } = body(await callAgentTool("open_project", {}, c.deps, "test"));
  await callAgentTool("submit_design_brief", { projectId, ...ex.brief }, c.deps, "test");
  for (let i = 0; i < 6; i++) {
    assertEquals(
      body(await callAgentTool("run_picogk", { projectId, code: ex.code }, c.deps, "test")).ok,
      true,
    );
  }
  assertEquals(
    body(await callAgentTool("run_picogk", { projectId, code: ex.code }, c.deps, "test")).code,
    "NEEDS_DECISION",
  );
});

Deno.test("MCP-06 bad input is a typed error, never a throw; unknown tools are rejected", async () => {
  const dir = await freshDb();
  const c = setup(dir);
  assertEquals(body(await callAgentTool("run_picogk", {}, c.deps, "test")).code, "INVALID_INPUT");
  assertEquals(body(await callAgentTool("rm_rf", {}, c.deps, "test")).code, "INVALID_INPUT");
  assertEquals(
    body(await callAgentTool("inspect_geometry", { projectId: "nope", ops: [] }, c.deps, "test"))
      .code,
    "NOT_FOUND",
  );
  const { projectId } = body(await callAgentTool("open_project", {}, c.deps, "test"));
  assertEquals(
    body(await callAgentTool("export_artifact", { projectId, format: "stl" }, c.deps, "test")).code,
    "NO_PART",
  );
});
