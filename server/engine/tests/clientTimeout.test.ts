// ENG-CLIENT-TIMEOUT-01 (B-006): every engine RPC used one fixed 30 s timeout, so a build longer
// than 30 s (the sandbox limit is runTimeoutS, default 120 s) reported a timeout while it was still
// running. engine.run must wait for its own, longer budget; quick calls keep the short one.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { EngineClient } from "../client.ts";

const fake = new URL("./fakeEngine.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

Deno.test({
  name: "ENG-CLIENT-TIMEOUT-01 engine.run outlives the quick-call timeout",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const client = new EngineClient(Deno.execPath(), {
      args: ["run", "--quiet", fake, "1500"],
      timeoutsMs: { quick: 1000, run: 10_000 },
    });
    try {
      const hello = await client.start();
      assert(hello.ok, "fake engine did not start");
      const run = await client.run({ outDir: "." });
      assert(run.ok, `engine.run failed: ${!run.ok ? run.error.message : ""}`);
      assertEquals(run.value.ok, true);
      const ping = await client.ping();
      assert(ping.ok);
    } finally {
      client.stop();
    }
  },
});
