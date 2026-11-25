-- pf:foreign-keys-off
-- Migration 0002: runs.state accepts every RunStateSchema value (server/db/repo/runs.ts).
-- B-005: 0001's CHECK allowed only the old pipeline states, so the orchestrator's first state
-- ("understanding") failed every server-side run. SQLite cannot alter a CHECK, so the table is
-- rebuilt with the documented 12-step procedure: the runner turns foreign keys off outside the
-- transaction, runs this file, checks PRAGMA foreign_key_check, commits, turns them back on.
-- Child rows (run_steps, code_versions, artifacts) keep their run_id values; nothing cascades.

CREATE TABLE runs_new (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT    REFERENCES messages(id) ON DELETE SET NULL,
  state           TEXT    NOT NULL CHECK (state IN (
    'queued','understanding','briefing','building','inspecting','awaiting_user',
    'codegen','compiling','executing','validating','rendering',
    'done','failed','cancelled'
  )),
  attempt         INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  error_detail    TEXT,
  model           TEXT    NOT NULL,
  brief_json      TEXT    CHECK (brief_json IS NULL OR json_valid(brief_json)),
  limits_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(limits_json)),
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  total_ms        INTEGER
);

INSERT INTO runs_new (id, conversation_id, message_id, state, attempt, error_code, error_detail,
  model, brief_json, limits_json, started_at, finished_at, total_ms)
SELECT id, conversation_id, message_id, state, attempt, error_code, error_detail,
  model, brief_json, limits_json, started_at, finished_at, total_ms
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX IF NOT EXISTS ix_runs_conv
  ON runs(conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_runs_state
  ON runs(state) WHERE state IN ('queued','understanding','briefing','building','executing');
