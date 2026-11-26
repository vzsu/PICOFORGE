// HARNESS-PROMPT-01 (B-012): the system prompt a real run sends carries the PicoGK + Kit API card from
// engine/picogk_api.json. driveRun called buildSystemPrompt() with no manifest, so the model saw
// "(picogk_api.json not loaded — run DumpApi)" and had to guess every kernel symbol.
// HARNESS-PROMPT-02: every Ctx member the prompt tells the model to use exists in the manifest.
import { assert, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { systemPromptForRun } from "../prompts/system.ts";
import { loadApiManifest } from "../prompts/apiCard.ts";

Deno.test("HARNESS-PROMPT-01 run system prompt carries the real API card, curated and bounded", async () => {
  const p = await systemPromptForRun();
  assert(!p.includes("not loaded"), "API card missing from the run prompt");
  assertStringIncludes(p, "### Voxels");
  assertStringIncludes(p, "### Kit"); // PicoForge.Kit helpers
  assertStringIncludes(p, "voxAxialRotor");
  assertStringIncludes(p, "float P(string name)");
  // banned surface is not advertised (analyzer rejects it anyway)
  for (const banned of ["### Viewer", "### Library", "SaveToVdbFile", "### OpenVdbFile"]) {
    assert(!p.includes(banned), `card advertises banned ${banned}`);
  }
  const approxTokens = Math.ceil(p.length / 4);
  assert(approxTokens < 12_000, `system prompt ~${approxTokens} tokens`);
});

Deno.test("HARNESS-PROMPT-02 Ctx members named in the prompt exist in the manifest", async () => {
  const p = await systemPromptForRun();
  const m = await loadApiManifest();
  assert(m, "engine/picogk_api.json not readable");
  const ctx = m.types.find((t) => t.fullName === "PicoForge.Kit.Ctx");
  assert(ctx, "Ctx missing from manifest");
  const named = [...p.matchAll(/ctx\.([A-Za-z_]\w*)/g)].map((x) => x[1]);
  assert(named.length > 0);
  for (const member of new Set(named)) {
    assert(
      ctx.members.some((mm) => mm.name === member),
      `prompt tells the model to use ctx.${member}, which Ctx does not have`,
    );
  }
});
