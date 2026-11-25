// server/harness/tests/searchDocs.test.ts — TOOL-SEARCH-01..03
// search_docs: FTS5 bm25 over kb_fts (db/repo/kb.ts); falls back to the archive docs when the
// KB has no hit (or no DB is open), so the agent always gets real reference text.

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { z } from "zod";
import { searchDocsTool } from "../tools/searchDocs.ts";
import type { RunCtx } from "../tools/_base.ts";
import { openDb } from "../../db/db.ts";
import { kbDocUpsert } from "../../db/repo/kb.ts";

const CTX: RunCtx = {
  runId: "run-search",
  projectId: "p",
  conversationId: "c",
  signal: new AbortController().signal,
};

const hitsSchema = z.array(
  z.object({ title: z.string(), section: z.string(), content: z.string(), source: z.string() })
    .strict(),
);

function hits(r: Awaited<ReturnType<typeof searchDocsTool.execute>>) {
  assertEquals(r.ok, true);
  if (!r.ok) throw r.error;
  return hitsSchema.parse(r.value);
}

Deno.test("TOOL-SEARCH-01: FTS5 KB search ranks the relevant recipe first", async () => {
  await openDb(await Deno.makeTempDir({ prefix: "pf_search_" }));
  kbDocUpsert(
    "recipes",
    "Axial fan impeller",
    "blades",
    "Blade count 5-9; check tip speed v = omega r below 120 m/s; blade thickness >= 3 voxels.",
  );
  kbDocUpsert("recipes", "L bracket", "ribs", "Bending stress sigma = M c / I with fillet ribs.");
  kbDocUpsert("physics", "Gear Lewis", "bending", "Lewis bending formula for spur gear teeth.");

  const found = hits(await searchDocsTool.execute({ query: "fan blade tip speed", k: 3 }, CTX));

  assertEquals(found[0].title, "Axial fan impeller");
  assertStringIncludes(found[0].content, "tip speed");
});

Deno.test("TOOL-SEARCH-02: FTS syntax in the query cannot break the search", async () => {
  const found = hits(
    await searchDocsTool.execute({ query: 'bending" AND (NEAR stress* -', k: 5 }, CTX),
  );
  assertEquals(found.length > 0, true);
  assertEquals(found.some((h) => h.title === "L bracket"), true);
});

Deno.test("TOOL-SEARCH-03: no KB hit → archive docs answer with real reference text", async () => {
  const found = hits(await searchDocsTool.execute({ query: "voxBuild code contract", k: 2 }, CTX));
  assertEquals(found.length, 2);
  assertStringIncludes(found.map((h) => h.content).join("\n"), "voxBuild");
});
