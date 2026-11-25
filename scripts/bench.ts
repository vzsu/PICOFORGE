// scripts/bench.ts — `deno task bench` (docs/11 §6): measure the engine bench (cube, fan, gyroid via
// ForgeEngine.Tests' BenchBaselineTests), write reports/bench/<date>-<sha>.json, and compare it with
// bench/baselines/engine.json. Any time or memory metric > 10 % worse fails the run. Baselines change
// only by hand, with a devlog entry (docs/dev/01 "Weekly").
import { z } from "zod";

const REGRESSION = 0.10;
/** Lower is better for these; other fields (triangles, volume) are reported, never judged. */
const JUDGED = ["wallMs", "sandboxPeakRssMiB"] as const;

const benchSchema = z.object({ cases: z.record(z.record(z.unknown())) }).passthrough();
type Bench = z.infer<typeof benchSchema>;

export interface BenchRow {
  caseName: string;
  metric: string;
  base: number | null;
  now: number;
  deltaPct: number | null;
}

export interface BenchComparison {
  rows: BenchRow[];
  regressions: BenchRow[];
  missing: string[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function compareBench(base: Bench, now: Bench): BenchComparison {
  const rows: BenchRow[] = [];
  for (const [caseName, metrics] of Object.entries(now.cases)) {
    for (const metric of JUDGED) {
      const n = num(metrics[metric]);
      if (n === null) continue;
      const b = num(base.cases[caseName]?.[metric]);
      rows.push({ caseName, metric, base: b, now: n, deltaPct: b ? ((n - b) / b) * 100 : null });
    }
  }
  return {
    rows,
    regressions: rows.filter((r) => r.deltaPct !== null && r.deltaPct > REGRESSION * 100),
    missing: Object.keys(base.cases).filter((c) => !(c in now.cases)),
  };
}

/** Median of every numeric metric across runs (non-numeric fields come from the first run). */
export function medianBench(runs: Bench[]): Bench & { runs: number } {
  const first = runs[0];
  const cases: Record<string, Record<string, unknown>> = {};
  for (const [caseName, metrics] of Object.entries(first?.cases ?? {})) {
    const out: Record<string, unknown> = { ...metrics };
    for (const key of Object.keys(metrics)) {
      const vals = runs.map((r) => num(r.cases[caseName]?.[key])).filter((v): v is number =>
        v !== null
      )
        .sort((a, b) => a - b);
      if (vals.length === runs.length && vals.length > 0) {
        out[key] = vals[Math.floor(vals.length / 2)];
      }
    }
    cases[caseName] = out;
  }
  return { ...first, cases, runs: runs.length };
}

async function sh(cmd: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  const { code } = await new Deno.Command(cmd, { args, env, stdout: "inherit", stderr: "inherit" })
    .output();
  return code;
}

async function gitSha(): Promise<string> {
  const o = await new Deno.Command("git", {
    args: ["rev-parse", "--short", "HEAD"],
    stdout: "piped",
  })
    .output();
  return new TextDecoder().decode(o.stdout).trim() || "nosha";
}

if (import.meta.main) {
  const date = new Date().toISOString().slice(0, 10);
  const out = `reports/bench/${date}-${await gitSha()}.json`;
  await Deno.mkdir("reports/bench", { recursive: true });
  const build = await sh("dotnet", ["build", "engine/PicoForge.sln", "-m:1", "-v", "q"]);
  if (build !== 0) Deno.exit(build);
  // Several runs, median judged: single wall times on a T0 laptop swing ±20 % (first case pays the cold
  // compiler). The 10 % rule applies to the median, never loosened.
  const RUNS = Number(Deno.env.get("PF_BENCH_RUNS") ?? "3");
  const runs: Bench[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const runOut = out.replace(/\.json$/, `.run${i}.json`);
    const test = await sh("dotnet", [
      "test",
      "engine/ForgeEngine.Tests",
      "--no-build",
      "--filter",
      "FullyQualifiedName~Bench",
    ], { FORGE_BENCH_OUT: await Deno.realPath(".") + "/" + runOut });
    if (test !== 0) Deno.exit(test);
    runs.push(benchSchema.parse(JSON.parse(await Deno.readTextFile(runOut))));
  }
  const now = medianBench(runs);
  await Deno.writeTextFile(out, JSON.stringify(now, null, 2) + "\n");

  const base = benchSchema.parse(
    JSON.parse(await Deno.readTextFile("bench/baselines/engine.json")),
  );
  const r = compareBench(base, now);
  console.log(`\nengine bench vs bench/baselines/engine.json (report: ${out})`);
  for (const row of r.rows) {
    const d = row.deltaPct === null
      ? "new"
      : `${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)} %`;
    const flag = r.regressions.includes(row) ? "  ✗ > 10 %" : "";
    console.log(
      `  ${row.caseName.padEnd(14)} ${row.metric.padEnd(18)} ${
        String(row.base ?? "-").padStart(8)
      } → ${String(row.now).padStart(8)}  ${d}${flag}`,
    );
  }
  for (const m of r.missing) console.log(`  ✗ baseline case missing from this run: ${m}`);
  const red = r.regressions.length + r.missing.length;
  console.log(red ? `\n${red} red item(s)` : "\nno regression > 10 %");
  Deno.exit(red ? 1 : 0);
}
