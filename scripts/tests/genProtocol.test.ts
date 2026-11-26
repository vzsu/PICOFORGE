// PROTO-GEN-01: app/src/protocol/* is generated from server/domain/* (docs/01 §3) and up to date, so the
// client validates frames with the very schemas the server emits with (CLAUDE.md #2, both directions).
import { assertEquals } from "jsr:@std/assert@1";
import { generated, PROTOCOL_FILES } from "../gen_protocol.ts";

const root = new URL("../../", import.meta.url);

Deno.test("PROTO-GEN-01 generated client protocol matches server/domain (run deno task gen:protocol)", async () => {
  for (const name of PROTOCOL_FILES) {
    const src = await Deno.readTextFile(new URL(`server/domain/${name}`, root));
    const out = await Deno.readTextFile(new URL(`app/src/protocol/${name}`, root));
    assertEquals(out, generated(name, src), `app/src/protocol/${name} is stale`);
  }
});
