// server/harness/tests/failureMap.test.ts — FAIL-MAP-01
// CLAUDE.md rule 3: every typed error code maps to a row of the failure table (04 §7).

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { FAILURE_ROW, failureRow } from "../../domain/failures.ts";
import { REPAIR_BUDGETS } from "../prompts/repair.ts";

/** Codes harvested from server sources: `code: "X"` literals and quoted UPPER_SNAKE codes in harness. */
async function codesInSources(): Promise<Set<string>> {
  const files = [
    "../validate.ts",
    "../orchestrator.ts",
    "../tools/runPicoGK.ts",
    "../tools/inspectGeometry.ts",
    "../tools/exportArtifact.ts",
    "../../engine/client.ts",
  ];
  const found = new Set<string>();
  for (const f of files) {
    const text = await Deno.readTextFile(new URL(f, import.meta.url));
    for (const m of text.matchAll(/code: "([A-Z][A-Z0-9_]+)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/\| "([A-Z][A-Z0-9_]+)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/unwrapEngineReply\([^)]*?"([A-Z][A-Z0-9_]+)"\)/gs)) {
      found.add(m[1]);
    }
  }
  return found;
}

Deno.test("FAIL-MAP-01: every repair-budget code maps to a failure row", () => {
  const missing = Object.keys(REPAIR_BUDGETS).filter((c) => !failureRow(c));
  assertEquals(missing, []);
});

Deno.test("FAIL-MAP-01: every error code emitted by harness/engine sources maps to a row", async () => {
  const codes = await codesInSources();
  const missing = [...codes].filter((c) => !(c in FAILURE_ROW));
  assertEquals(missing, []);
  // sanity: the harvest actually found the L3 codes
  for (const c of ["EMPTY_GEOMETRY", "BELOW_MIN_WALL", "ENGINE_PROTOCOL", "EXPORT_MISSING"]) {
    assertEquals(codes.has(c), true, `harvest missed ${c}`);
  }
});

Deno.test("FAIL-MAP-01: every failure row referenced exists in docs/04 §7", async () => {
  const doc = await Deno.readTextFile(
    new URL("../../../docs/04_SYSTEM_DESIGN.md", import.meta.url),
  );
  const rows = new Set(Object.values(FAILURE_ROW));
  const missing = [...rows].filter((r) => !doc.includes(`| ${r} |`));
  assertEquals(missing, []);
});
