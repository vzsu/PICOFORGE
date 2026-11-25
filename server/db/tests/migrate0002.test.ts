// MIGRATE-0002-01: migration 0002 (runs table rebuild) on a populated 0001 database keeps every
// child row. With foreign keys ON, `DROP TABLE runs` cascades and deletes run_steps; the runner
// must switch them off around a `-- pf:foreign-keys-off` migration.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { DatabaseSync } from "node:sqlite";
import { applyMigrationFile } from "../db.ts";

const dir = new URL("../migrations/", import.meta.url);

Deno.test("MIGRATE-0002-01 runs rebuild keeps run_steps and widens the state CHECK", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);",
  );
  applyMigrationFile(db, "0001_init.sql", await Deno.readTextFile(new URL("0001_init.sql", dir)));
  const now = Date.now();
  db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES ('p','P',${now},${now})`);
  db.exec(
    `INSERT INTO conversations(id,project_id,created_at,updated_at) VALUES ('c','p',${now},${now})`,
  );
  db.exec(
    `INSERT INTO runs(id,conversation_id,state,model,started_at) VALUES ('r','c','done','m',${now})`,
  );
  db.exec(
    `INSERT INTO run_steps(id,run_id,seq,kind,title,created_at) VALUES ('s','r',1,'llm','t',${now})`,
  );

  applyMigrationFile(
    db,
    "0002_run_states.sql",
    await Deno.readTextFile(new URL("0002_run_states.sql", dir)),
  );

  assertEquals(db.prepare("SELECT id FROM run_steps").all(), [{ id: "s" }]);
  db.exec("UPDATE runs SET state = 'understanding' WHERE id = 'r'");
  assertEquals(db.prepare("SELECT state FROM runs").all(), [{ state: "understanding" }]);
  assertEquals(db.prepare("PRAGMA foreign_keys").get(), { foreign_keys: 1 });
  db.close();
});
