// DEV-TASKS-01: every task named in CLAUDE.md's command table exists in deno.json.
// DEV-LOGS-01: logs:query filters by area, level, run, errId and since.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { filterLines, parseArgs } from "../logs.ts";

const root = new URL("../../", import.meta.url);

Deno.test("DEV-TASKS-01: CLAUDE.md tasks exist in deno.json", async () => {
  const claude = await Deno.readTextFile(new URL("CLAUDE.md", root));
  const deno = JSON.parse(await Deno.readTextFile(new URL("deno.json", root)));
  const named = [...claude.matchAll(/`deno task ([a-z0-9:]+)/g)].map((m) => m[1]);
  const required = new Set([
    ...named,
    "doctor",
    "start",
    "check:engine",
    "e2e:visual",
    "ui:check",
    "logs:tail",
    "logs:query",
    "smoke:live",
  ]);
  const missing = [...required].filter((t) => !(t in deno.tasks));
  assertEquals(missing, []);
});

// DEV-TASKS-02 (B-002): `deno task check` covers the app typecheck (docs/11 §6), and the app's
// typecheck script checks a real project. `tsc --noEmit` on the references-only tsconfig.json
// checks nothing and always exits 0.
Deno.test("DEV-TASKS-02: check runs a real app typecheck", async () => {
  const deno = JSON.parse(await Deno.readTextFile(new URL("deno.json", root)));
  const app = JSON.parse(await Deno.readTextFile(new URL("app/package.json", root)));
  const check: string = deno.tasks.check;
  assert(check.includes("deno task typecheck:app"), `check does not run typecheck:app: ${check}`);
  const task: string = deno.tasks["typecheck:app"] ?? "";
  assert(task.includes("npm run typecheck"), `typecheck:app must run the app script: ${task}`);
  const script: string = app.scripts.typecheck;
  assert(
    /tsc (-b|--build)\b|tsc .*-p tsconfig\.app\.json/.test(script),
    `app typecheck must build the references or name tsconfig.app.json: ${script}`,
  );
});

const lines = [
  { ts: "2026-11-25T10:00:00.000Z", lvl: "info", area: "engine", msg: "a", runId: "R1" },
  { ts: "2026-11-25T10:30:00.000Z", lvl: "error", area: "http", msg: "b", errId: "E-1" },
  { ts: 1795565358047, level: "warn", area: "sandbox", message: "c", data: { runId: "R1" } },
].map((o) => JSON.stringify(o));
lines.push("not json");

Deno.test("DEV-LOGS-01: filter by area, level, run, err, since", () => {
  const now = Date.parse("2026-11-25T11:00:00.000Z");
  assertEquals(filterLines(lines, parseArgs(["--area", "engine,sandbox"]), now).length, 2);
  assertEquals(filterLines(lines, parseArgs(["--lvl", "error"]), now).length, 1);
  assertEquals(filterLines(lines, parseArgs(["--run", "R1"]), now).length, 2);
  assertEquals(filterLines(lines, parseArgs(["--err", "E-1"]), now).length, 1);
  const recent = filterLines(lines, parseArgs(["--since", "45m"]), now);
  assert(recent.every((l) => l.msg !== "a"));
  assertEquals(recent.length, 1);
});
