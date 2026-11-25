// CFG-ENGINE-01 (B-010): with no ENGINE_BIN set, the server must find the engine built in this repo.
// The default was the bare name "forge-engine", which is not on PATH, so `deno task start` came up
// with the engine down (the e2e flow only passed because it set ENGINE_BIN itself).
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import { resolveEngineBin } from "../config.ts";

const exe = Deno.build.os === "windows" ? "forge-engine.exe" : "forge-engine";

Deno.test("CFG-ENGINE-01 explicit ENGINE_BIN wins", async () => {
  assertEquals(await resolveEngineBin("C:/custom/engine.exe", "/nowhere"), "C:/custom/engine.exe");
});

Deno.test("CFG-ENGINE-01 no ENGINE_BIN → Release build, then Debug build, in the repo", async () => {
  const root = await Deno.makeTempDir({ prefix: "pf-engbin-" });
  const debugDir = join(root, "engine", "ForgeEngine", "bin", "Debug", "net9.0");
  await Deno.mkdir(debugDir, { recursive: true });
  await Deno.writeTextFile(join(debugDir, exe), "");
  assertEquals(await resolveEngineBin(undefined, root), join(debugDir, exe));

  const releaseDir = join(root, "engine", "ForgeEngine", "bin", "Release", "net9.0");
  await Deno.mkdir(releaseDir, { recursive: true });
  await Deno.writeTextFile(join(releaseDir, exe), "");
  assertEquals(await resolveEngineBin(undefined, root), join(releaseDir, exe));
  await Deno.remove(root, { recursive: true });
});

Deno.test("CFG-ENGINE-01 nothing built → bare name (PATH lookup, packaged install)", async () => {
  const root = await Deno.makeTempDir({ prefix: "pf-engbin-" });
  assertEquals(await resolveEngineBin(undefined, root), "forge-engine");
  await Deno.remove(root, { recursive: true });
});
