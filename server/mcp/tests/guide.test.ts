// GUIDE-01/02: the agent guide's worked examples are real. Every brief is accepted by the validator,
// every file passes the contract lint, every ctx.P name exists in its brief, and the guide documents
// every MCP tool. `deno task guide:check` builds the examples in the real engine.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { loadGuide, parseExamples } from "../guide.ts";
import { TOOL_MAP } from "../../harness/tools/index.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import type { RunCtx } from "../../harness/tools/_base.ts";

const ctx = (): RunCtx => ({
  runId: "guide",
  projectId: "p",
  conversationId: "c",
  signal: new AbortController().signal,
});

Deno.test("GUIDE-01 every example: brief accepted, contract lint passes, ctx.P names are brief parameters", async () => {
  const examples = parseExamples(await loadGuide());
  assertEquals(examples.map((e) => e.name), ["plate", "lattice", "gyroid", "prop3"]);
  for (const ex of examples) {
    const c = ctx();
    const b = await TOOL_MAP.submit_design_brief.execute(ex.brief, c);
    assert(b.ok, `${ex.name}: ${!b.ok && b.error.message}`);
    assert(c.brief, `${ex.name}: brief rejected: ${JSON.stringify(b.value)}`);

    // no engine: a file that passes L0 lint stops at ENGINE_NOT_READY, never CONTRACT_VIOLATION
    const r = await TOOL_MAP.run_picogk.execute({ code: ex.code }, c);
    assert(r.ok);
    assert(
      JSON.stringify(r.value).includes("ENGINE_NOT_READY"),
      `${ex.name}: ${JSON.stringify(r.value)}`,
    );

    const names = new Set(c.brief.parameters.map((p) => p.name));
    for (const m of ex.code.matchAll(/ctx\.Pi?\("([^"]+)"\)/g)) {
      assert(names.has(m[1]), `${ex.name}: ctx.P("${m[1]}") is not a brief parameter`);
    }
  }
});

Deno.test("GUIDE-02 the guide documents every MCP tool", async () => {
  const guide = await loadGuide();
  for (const t of AGENT_TOOLS) {
    assert(guide.includes(`\`${t.name}\``), `guide does not mention ${t.name}`);
  }
});
