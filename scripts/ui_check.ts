// scripts/ui_check.ts — `deno task ui:check <scenario>` (docs/dev/04).
// Runs the Playwright spec(s) whose title matches the scenario and prints
// where the screenshots landed (reports/ui/). Smallest version: delegates to
// Playwright with --grep.
const scenario = Deno.args[0];
if (!scenario) {
  console.error("usage: deno task ui:check <scenario>   e.g. mock-main");
  Deno.exit(2);
}
const npx = Deno.build.os === "windows" ? "npx.cmd" : "npx";
const { code } = await new Deno.Command(npx, {
  args: [
    "playwright",
    "test",
    "--config=playwright.config.ts",
    "--trace",
    "off",
    "--grep",
    scenario,
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
console.log(`ui:check ${scenario}: exit ${code}; screenshots in reports/ui/`);
Deno.exit(code);
