// HARNESS-REQ-01..03: the exact request body one turn sends (docs/13 §2). No network.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildRequest, type StreamArgs } from "../anthropic.ts";

const args = (over: Partial<StreamArgs> = {}): StreamArgs => ({
  model: "claude-opus-5-5",
  maxTokens: 64_000,
  effort: "high",
  system: "sys",
  messages: [{ role: "user", content: [{ type: "text", text: "fan" }] }],
  tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
  ...over,
});

Deno.test("HARNESS-REQ-01 direct: effort, 64k, caching, fallbacks, eager tool input; no sampling", () => {
  const r = buildRequest(args(), false);
  assertEquals(r.model, "claude-opus-5-5");
  assertEquals(r.max_tokens, 64_000);
  assertEquals(r.output_config, { effort: "high" });
  assertEquals(r.cache_control, { type: "ephemeral" });
  assertEquals(r.fallbacks, "default");
  assertEquals(r.betas, ["server-side-fallback-2026-07-01"]);
  assertEquals(r.tools?.[0] && "eager_input_streaming" in r.tools[0], true);
  for (const banned of ["temperature", "top_p", "top_k", "thinking", "speed"]) {
    assert(!(banned in r), `request carries ${banned}`);
  }
});

Deno.test("HARNESS-REQ-02 through a proxy the beta-only fields are left out", () => {
  const r = buildRequest(args(), true);
  assert(!("fallbacks" in r) && !("betas" in r));
  assertEquals(r.tools?.[0] && "eager_input_streaming" in r.tools[0], false);
  assertEquals(r.output_config, { effort: "high" });
});

Deno.test("HARNESS-REQ-03 speed fast is sent only for a model that supports it", () => {
  assertEquals(buildRequest(args({ speed: "fast" }), false).speed, "fast");
  assert(!("speed" in buildRequest(args({ speed: "fast", model: "claude-haiku-5-5" }), false)));
});
