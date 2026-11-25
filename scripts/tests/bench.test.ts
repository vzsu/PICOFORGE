// BENCH-CMP-01: `deno task bench` compares a fresh engine bench with bench/baselines/engine.json and
// flags any metric more than 10 % worse (docs/11 §6). Improvements and new cases never fail.
import { assertEquals } from "jsr:@std/assert@1";
import { compareBench, medianBench } from "../bench.ts";

Deno.test("BENCH-MED-01 the median of several runs is judged, so one cold or noisy run cannot fail the bench", () => {
  const runs = [
    { cases: { cube: { wallMs: 2900, sandboxPeakRssMiB: 92, triangles: 20172 } } },
    { cases: { cube: { wallMs: 2400, sandboxPeakRssMiB: 88, triangles: 20172 } } },
    { cases: { cube: { wallMs: 2450, sandboxPeakRssMiB: 90, triangles: 20172 } } },
  ];
  const m = medianBench(runs);
  assertEquals(m.cases.cube.wallMs, 2450);
  assertEquals(m.cases.cube.sandboxPeakRssMiB, 90);
  assertEquals(m.cases.cube.triangles, 20172);
  assertEquals(m.runs, 3);
});

const base = {
  cases: {
    cube: { wallMs: 1000, sandboxPeakRssMiB: 100, triangles: 20000 },
    fan: { wallMs: 6000, sandboxPeakRssMiB: 110 },
  },
};

Deno.test("BENCH-CMP-01 >10 % worse time or memory is a regression; better or equal is not", () => {
  const now = {
    cases: {
      cube: { wallMs: 1101, sandboxPeakRssMiB: 109, triangles: 99999 }, // +10.1 % time, +9 % mem
      fan: { wallMs: 5000, sandboxPeakRssMiB: 110 }, // faster
      gyroid: { wallMs: 9000, sandboxPeakRssMiB: 215 }, // new case: reported, not a regression
    },
  };
  const r = compareBench(base, now);
  assertEquals(r.regressions.map((x) => `${x.caseName}.${x.metric}`), ["cube.wallMs"]);
  assertEquals(r.rows.length, 6);
  assertEquals(r.missing, []);
});

Deno.test("BENCH-CMP-01 a baseline case missing from the run is reported", () => {
  const r = compareBench(base, { cases: { cube: { wallMs: 1000, sandboxPeakRssMiB: 100 } } });
  assertEquals(r.missing, ["fan"]);
  assertEquals(r.regressions, []);
});
