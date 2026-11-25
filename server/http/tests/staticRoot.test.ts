// STATIC-ROOT-01 (B-004): the server serves the folder Vite builds into. They disagreed
// (vite outDir ../server/public, router root ./app/dist), so `deno task start` served 404 at "/".
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { STATIC_ROOT } from "../router.ts";

Deno.test("STATIC-ROOT-01 router static root equals the Vite build outDir", async () => {
  const vite = await Deno.readTextFile(new URL("../../../app/vite.config.ts", import.meta.url));
  const outDir = /outDir:\s*"([^"]+)"/.exec(vite)?.[1];
  // outDir is relative to app/; the router root is relative to the repo root (cwd of `deno task start`)
  const fromRoot = outDir
    ? `./${new URL(outDir, "file:///repo/app/").pathname.replace("/repo/", "")}`
    : null;
  assertEquals(STATIC_ROOT, fromRoot);
});
