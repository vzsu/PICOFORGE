// scripts/doctor.ts — `deno task doctor` (docs/dev/01 "Morning" step 4).
// Prints one line per check. Exit 1 if any required check is red.
import { join } from "jsr:@std/path@1";

type Status = "ok" | "red" | "skip";
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const exe = (n: string) =>
  Deno.build.os === "windows" && (n === "npm" || n === "npx") ? `${n}.cmd` : n;

async function run(cmd: string, args: string[], cwd = root): Promise<{ ok: boolean; out: string }> {
  try {
    const o = await new Deno.Command(exe(cmd), { args, cwd, stdout: "piped", stderr: "piped" })
      .output();
    const out = new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr);
    return { ok: o.success, out: out.trim() };
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message : String(e) };
  }
}

function atLeast(v: string, min: number[]): boolean {
  const parts = (/(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  for (let i = 0; i < min.length; i++) {
    if ((parts[i] ?? 0) !== min[i]) return (parts[i] ?? 0) > min[i];
  }
  return true;
}

async function version(name: string, cmd: string, args: string[], min: number[]): Promise<Check> {
  const r = await run(cmd, args);
  const v = r.out.split("\n")[0];
  if (!r.ok) return { name, status: "red", detail: `not found (${v.slice(0, 80)})` };
  return { name, status: atLeast(v, min) ? "ok" : "red", detail: `${v} (need ≥ ${min.join(".")})` };
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function picogkPackage(): Promise<Check> {
  const home = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
  const dir = join(home, ".nuget", "packages", "picogk");
  const versions: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) if (e.isDirectory) versions.push(e.name);
  } catch {
    return {
      name: "PicoGK package",
      status: "red",
      detail: "not restored (dotnet restore engine)",
    };
  }
  return { name: "PicoGK package", status: "ok", detail: versions.sort().join(", ") };
}

async function dbIntegrity(): Promise<Check> {
  const home = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
  const p = join(Deno.env.get("PICOFORGE_DATA_DIR") ?? join(home, "PicoForge"), "picoforge.db");
  if (!(await exists(p))) return { name: "DB integrity", status: "skip", detail: "no DB yet" };
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const v = row ? String(Object.values(row)[0]) : "no result";
    return { name: "DB integrity", status: v === "ok" ? "ok" : "red", detail: v };
  } finally {
    db.close();
  }
}

async function engineBuilt(): Promise<Check> {
  const candidates = [
    "engine/ForgeEngine/bin/Debug/net9.0/forge-engine.exe",
    "engine/ForgeEngine/bin/Release/net9.0/forge-engine.exe",
    "engine/ForgeEngine/bin/Debug/net9.0/forge-engine.dll",
  ];
  for (const c of candidates) {
    if (await exists(join(root, c))) return { name: "Engine build", status: "ok", detail: c };
  }
  return { name: "Engine build", status: "red", detail: "not built (deno task check:engine)" };
}

async function codegraph(): Promise<Check> {
  const r = await run("codegraph", ["status"]);
  if (!r.ok) {
    return { name: "codegraph", status: "skip", detail: "not installed (ADR-001 pending)" };
  }
  return { name: "codegraph", status: "ok", detail: r.out.split("\n")[0] };
}

async function secretsNotInRepo(): Promise<Check> {
  const bad = [".env", "secret.env"].filter((f) => f);
  const found: string[] = [];
  for (const f of bad) {
    const r = await run("git", ["ls-files", "--error-unmatch", f]);
    if (r.ok) found.push(f);
  }
  return {
    name: "Secrets not tracked",
    status: found.length ? "red" : "ok",
    detail: found.length ? `tracked: ${found.join(", ")}` : ".env / secret.env untracked",
  };
}

if (import.meta.main) {
  const checks = await Promise.all([
    version("deno", "deno", ["--version"], [2, 2]),
    version("dotnet", "dotnet", ["--version"], [9, 0]),
    version("node", "node", ["--version"], [20, 0]),
    version("git", "git", ["--version"], [2, 0]),
    picogkPackage(),
    engineBuilt(),
    dbIntegrity(),
    codegraph(),
    secretsNotInRepo(),
  ]);
  const icon = { ok: "✓", red: "✗", skip: "–" };
  for (const c of checks) console.log(`${icon[c.status]} ${c.name.padEnd(20)} ${c.detail}`);
  const red = checks.filter((c) => c.status === "red").length;
  console.log(red ? `\n${red} red item(s)` : "\nall green");
  Deno.exit(red ? 1 : 0);
}
