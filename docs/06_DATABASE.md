# 06 · Database

SQLite in WAL mode, one file at `~/PicoForge/picoforge.db`. The database is the source of truth for projects, designs, parameters, code and history. Generated geometry is not: it lives in the cache and can always be rebuilt.

## 1. Connection settings

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;      -- safe with WAL; a power cut loses at most the last commit
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;       -- 16 MB page cache (T0); -64000 on T2+
PRAGMA wal_autocheckpoint = 1000;
```

Boot sequence: open → `PRAGMA quick_check` → apply migrations in one transaction each → repair orphan runs (`state` not terminal → `failed`, `ENGINE_LOST`) → serve.

## 2. Existing tables (migration 0001, kept)

`migrations`, `projects`, `conversations`, `messages`, `runs`, `run_steps`, `code_versions`, `artifacts`, `kb_docs` + `kb_fts`, `settings`, `events`. Their DDL stays as in the repo.

## 3. New tables (migration 0002_parametric.sql)

```sql
CREATE TABLE variants (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES variants(id),
  name        TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,          -- bumped by every committed edit
  code_version_id TEXT REFERENCES code_versions(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX ix_variants_project ON variants(project_id, updated_at DESC);

-- Feature graph: parts, boolean ops, groups, NURBS surfaces
CREATE TABLE scene_nodes (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES scene_nodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('part','op','group','nurbs_surface','nurbs_curve','reference')),
  name        TEXT NOT NULL,                         -- stable id used in code: ctx.Part("name")
  generator   TEXT,                                  -- C# function name for parts, e.g. "Parts.Arms"
  op          TEXT CHECK (op IS NULL OR op IN ('union','subtract','intersect','offset','shell','fillet','mirror','pattern')),
  inputs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(inputs_json)),   -- ordered node ids
  trs_json    TEXT NOT NULL DEFAULT '{"t":[0,0,0],"r":[0,0,0,1],"s":[1,1,1]}' CHECK (json_valid(trs_json)),
  data_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),     -- NURBS control net, material, etc.
  visible     INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  locked      INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (variant_id, name)
);
CREATE INDEX ix_nodes_variant ON scene_nodes(variant_id, sort);

-- Parameters with expressions (08 §3)
CREATE TABLE params (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  node_id     TEXT REFERENCES scene_nodes(id) ON DELETE CASCADE,   -- NULL = design-level
  name        TEXT NOT NULL,              -- identifier used in ctx.P("name")
  expr        TEXT NOT NULL,              -- "9" or "(prop_d*25.4/2)/sin(pi/n_arms)+clearance"
  value       REAL,                       -- last evaluated value
  unit        TEXT NOT NULL DEFAULT 'mm',
  min         REAL, max REAL,
  governing   INTEGER NOT NULL DEFAULT 0 CHECK (governing IN (0,1)),  -- enforced by validator
  source      TEXT NOT NULL CHECK (source IN ('brief','user','agent','scan','emitter')),
  rationale   TEXT,
  UNIQUE (variant_id, name)
);

-- Append-only edit log: autosave, undo/redo, audit, co-editing
CREATE TABLE edits (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,           -- variant rev after this edit
  actor       TEXT NOT NULL,              -- 'user' | 'agent:internal' | 'mcp:claude-code' …
  group_id    TEXT,                       -- edits that undo together (one agent turn, one drag)
  cmd_json    TEXT NOT NULL CHECK (json_valid(cmd_json)),
  inverse_json TEXT NOT NULL CHECK (json_valid(inverse_json)),
  undone      INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0,1)),
  created_at  INTEGER NOT NULL,
  UNIQUE (variant_id, rev)
);
CREATE INDEX ix_edits_variant ON edits(variant_id, rev DESC);

-- Materialised scene state every N edits for fast load
CREATE TABLE snapshots (
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,
  state_json  TEXT NOT NULL CHECK (json_valid(state_json)),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (variant_id, rev)
);

-- Content-addressed cache index (files live under ~/PicoForge/cache/)
CREATE TABLE cache_entries (
  key         TEXT PRIMARY KEY,           -- sha256
  kind        TEXT NOT NULL CHECK (kind IN ('dll','voxels','mesh','mesh_lod','points','ao','thumb','scan_dense','analysis')),
  path        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1))
);
CREATE INDEX ix_cache_lru ON cache_entries(kind, pinned, last_used_at);

CREATE TABLE pins (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  target_json TEXT NOT NULL CHECK (json_valid(target_json)),   -- {nodeId, feature:'hole'|'face'|'edge', at:[x,y,z]}
  rule_json   TEXT NOT NULL CHECK (json_valid(rule_json)),     -- {keep:true} | {dim:'d', value:6.2, tol:0.1}
  created_at  INTEGER NOT NULL
);

CREATE TABLE agent_clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,              -- from MCP clientInfo
  version     TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);

CREATE TABLE studies (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('low','std','deep','raman')),
  goal_json   TEXT NOT NULL CHECK (json_valid(goal_json)),
  state       TEXT NOT NULL CHECK (state IN ('running','converged','budget','stopped','failed')),
  started_at  INTEGER NOT NULL, finished_at INTEGER
);
CREATE TABLE study_rounds (
  study_id    TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  variant_id  TEXT REFERENCES variants(id),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  tier        TEXT NOT NULL,              -- A0..A4
  pass        INTEGER NOT NULL CHECK (pass IN (0,1)),
  note        TEXT,
  PRIMARY KEY (study_id, n)
);

CREATE TABLE scans (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('import','webcam','phone_usb','phone_lan')),
  state       TEXT NOT NULL,
  scale_json  TEXT CHECK (scale_json IS NULL OR json_valid(scale_json)),
  error_mm    REAL,
  artifact_id TEXT REFERENCES artifacts(id),
  created_at  INTEGER NOT NULL
);
CREATE TABLE measurements (               -- caliper-confirmed and physical test values (A4)
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,              -- 'scan:<id>:bore_d' | 'part:<id>:mass'
  value       REAL NOT NULL, unit TEXT NOT NULL,
  method      TEXT NOT NULL,              -- 'caliper' | 'scale' | 'thermocouple' …
  created_at  INTEGER NOT NULL
);

ALTER TABLE runs ADD COLUMN variant_id TEXT REFERENCES variants(id);
ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'ui';
ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'std';
```

## 4. Rules

1. **One transaction per user-visible change.** `withTx` only; no nested transactions; no network or engine calls inside a transaction.
2. **Edits are append-only.** Undo writes `undone = 1` on the target edit and applies its inverse as a new state; it never deletes rows. Redo clears `undone`. A new edit after undo marks later undone edits as abandoned (they stay for audit).
3. **Revisions are strictly increasing per variant.** `UNIQUE(variant_id, rev)` enforces it; a conflicting writer gets `STALE_REV`.
4. **Snapshots** every 50 edits and on every validated build; loading a variant = latest snapshot + replay later edits.
5. **JSON columns are validated** by `json_valid` checks and by zod on the way in and out.
6. **Query plans are tested.** Each hot query has an `EXPLAIN QUERY PLAN` test asserting an index is used (list in 11).

## 5. Hot queries

| Query | Index |
|---|---|
| Load variant scene: nodes by variant | `ix_nodes_variant` |
| Latest snapshot ≤ rev | PK `(variant_id, rev)` |
| Edits after snapshot | `ix_edits_variant` |
| Cache eviction candidates | `ix_cache_lru` |
| Recent runs in conversation | `ix_runs_conv` |
| Docs search | `kb_fts` |

## 6. Backup and recovery

- On boot and every 30 minutes of activity, `VACUUM INTO ~/PicoForge/backups/picoforge-<date>.db` (keep 5).
- Corrupt database at boot: move it to `quarantine/`, restore the latest backup, replay nothing; tell the user which time it restored to.
- `Settings → Storage → Export all` writes a zip of the database backup plus `exports/`.

## 7. Retention

Never deleted automatically: projects, variants, params, code versions, edits, pinned artifacts, measurements. Pruned automatically: `events` older than 14 days, `run_steps` logs beyond the newest 200 runs per project, cache entries by LRU (07). Deleting a project is the only way to delete design data and requires confirmation.
