// SEC-FILES-01 (B-014): /files/* is unauthenticated, so it may serve only build outputs inside
// <DATA_DIR>/runs/ with an allowed extension. Before the fix it served secret.env (API key, MCP
// token) and picoforge.db, and `..\` slipped past the traversal filter.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveServable } from "../staticFiles.ts";

const DATA = "C:/data/PicoForge";

Deno.test("SEC-FILES-01 only run outputs with allowed extensions are servable", () => {
  const ok = (p: string) => resolveServable(DATA, p) !== null;
  assertEquals(ok("runs/01ABC/part.stl"), true);
  assertEquals(ok("runs/01ABC/exports/fan.3mf"), true);
  assertEquals(ok("runs/01ABC/design.cs"), true);
  assertEquals(ok("runs/01ABC/brief.json"), true);
  assertEquals(ok("secret.env"), false);
  assertEquals(ok("picoforge.db"), false);
  assertEquals(ok("runs/../secret.env"), false);
  assertEquals(ok("runs\\..\\secret.env"), false);
  assertEquals(ok("runs/..%5Csecret.env"), false);
  assertEquals(ok("runs/01ABC/../../picoforge.db"), false);
  assertEquals(ok("logs/server.log"), false);
  assertEquals(ok("runs/01ABC/.hidden.json"), false);
  assertEquals(ok("runs/01ABC/job.exe"), false);
});
