// scripts/smoke_live.ts — `deno task smoke:live` (docs/11 §5).
// One real-model build. Costs money, so it refuses to run unless the human
// approved it for this run with PICOFORGE_LIVE_OK=1. Model comes from docs/13.
if (Deno.env.get("PICOFORGE_LIVE_OK") !== "1") {
  console.error(
    "smoke:live costs API money. Ask the human first, then run:\n" +
      "  PICOFORGE_LIVE_OK=1 deno task smoke:live",
  );
  Deno.exit(2);
}
const prompt = Deno.args.join(" ") ||
  "Design a 120 mm fan impeller with 7 backward-curved blades, 25 mm hub, PLA.";
const p = new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    "server/harness/cli.ts",
    prompt,
  ],
  stdout: "inherit",
  stderr: "inherit",
});
const t0 = performance.now();
const { code } = await p.output();
console.log(`smoke:live exit ${code} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
Deno.exit(code);
