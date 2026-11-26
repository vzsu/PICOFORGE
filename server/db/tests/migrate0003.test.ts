// MIGRATE-0003-01: legacy settings rows (pre-P0 defaults) are removed so the docs/13 defaults apply;
// a model chosen from the current catalog and a deliberate token limit survive.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { DatabaseSync } from "node:sqlite";
import { applyMigrationFile } from "../db.ts";

const dir = new URL("../migrations/", import.meta.url);
const read = (n: string) => Deno.readTextFile(new URL(n, dir));

async function migratedTo0002(): Promise<DatabaseSync> {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);",
  );
  applyMigrationFile(db, "0001_init.sql", await read("0001_init.sql"));
  applyMigrationFile(db, "0002_run_states.sql", await read("0002_run_states.sql"));
  return db;
}

function put(db: DatabaseSync, key: string, value: unknown) {
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)").run(
    key,
    JSON.stringify(value),
    1,
  );
}

function keys(db: DatabaseSync): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of db.prepare("SELECT key, value_json FROM settings ORDER BY key").all()) {
    out[String(r.key)] = String(r.value_json);
  }
  return out;
}

Deno.test("MIGRATE-0003-01 legacy model, temperature and 4096-token rows are dropped", async () => {
  const db = await migratedTo0002();
  put(db, "model", "claude-sonnet-4-6");
  put(db, "temperature", 1);
  put(db, "maxOutputTokens", 4096);
  put(db, "runTimeoutS", 120);
  applyMigrationFile(db, "0003_settings_models.sql", await read("0003_settings_models.sql"));
  assertEquals(keys(db), { runTimeoutS: "120" });
  db.close();
});

Deno.test("MIGRATE-0003-02 a catalog model and a chosen token limit are kept", async () => {
  const db = await migratedTo0002();
  put(db, "model", "claude-haiku-5-5");
  put(db, "maxOutputTokens", 16000);
  applyMigrationFile(db, "0003_settings_models.sql", await read("0003_settings_models.sql"));
  assertEquals(keys(db), { maxOutputTokens: "16000", model: '"claude-haiku-5-5"' });
  db.close();
});
