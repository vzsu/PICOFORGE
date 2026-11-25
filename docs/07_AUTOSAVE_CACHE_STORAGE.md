# 07 · Autosave, cache and storage

## 1. Two kinds of data

| Kind | Examples | Where | Can be cleared? |
|---|---|---|---|
| **Source data** | Projects, variants, scene nodes, parameters and expressions, code versions, edits, pins, measurements, chat | SQLite | Only by deleting a project |
| **Derived data (cache)** | Compiled DLLs, part voxels, meshes and LODs, point clouds, baked AO, thumbnails, dense scan data, analysis fields | `~/PicoForge/cache/<kind>/<sha256>` + `cache_entries` | Yes, any time; rebuilt on demand |

Everything the user made is source data. Everything the machine computed from it is cache. Clearing cache can only cost time, never work.

## 2. Autosave (on by default, not optional)

There is no save button and no "unsaved changes" state.

| Interaction | What happens | Commit timing |
|---|---|---|
| Discrete action (boolean, hide, delete, rename) | `bus.dispatch` → one transaction | Immediately |
| Gizmo drag | Client moves the part locally every frame; one `part.transform` on pointer-up | On release |
| Slider or number scrub | Client sends preview values at up to 10 Hz (not persisted); final value on release | On release; server-side `debounceCommit` 300 ms fallback if release is missed |
| Typing in a parameter field | Validated as you type; committed on Enter, blur, or 600 ms idle | As stated |
| NURBS control point drag | Same as gizmo drag | On release |
| Agent edits | Each tool call that changes state is one command; one agent turn is one `group_id` | Per command |
| Chat messages | Persisted as they stream; final block on `chat.done` | Streamed |

**Indicator:** the bottom-left of the window shows `Saved · 2s ago` in mono `--ink-3`. While a commit is pending it shows `Saving…`. If a commit fails (disk full, database locked beyond retries) it turns `--accent`: `Not saved: disk full` with a button to open Storage. That is the only time saving is mentioned.

**Undo / redo:** `Cmd/Ctrl + Z` and `Shift + Cmd/Ctrl + Z` walk the `edits` log for the active variant. An agent turn undoes as one step. Undo is per variant and survives restarts.

**Crash safety:** WAL with `synchronous = NORMAL`; a power cut loses at most the last committed edit. The client keeps unacknowledged commands in memory and resends them after reconnect (commands carry ids, so the server deduplicates).

## 3. Cache design

- **Content-addressed.** Key = `sha256(canonicalJson(inputs))`. For part voxels: `{codeHash, partName, paramsUsedByPart, voxelMm, engineVersion, picogkVersion}`. Identical inputs never rebuild.
- **Layout.** `cache/dll/`, `cache/voxels/` (.vdb), `cache/mesh/` (.glb), `cache/points/` (.pts1), `cache/ao/`, `cache/thumb/` (.webp), `cache/scan/`, `cache/analysis/`.
- **Index.** `cache_entries` row per file with size, last use, hits, pinned.
- **Pinning.** Entries used by the currently open variants and by pinned artifacts are pinned while in use; pinned entries are never evicted.
- **Eviction.** LRU per kind when the total exceeds the tier limit. Evict to 80 % of the limit in one pass, in a background job, never during a build.

| Tier | Cache limit (default) |
|---|---|
| T0 | 2 GB |
| T1 | 5 GB |
| T2 | 10 GB |
| T3 | 25 GB |

- **Integrity.** On read, size is checked; on mismatch the entry is dropped and rebuilt. A full hash check runs only in `deno task doctor`.

## 4. Settings → Storage

```
STORAGE                                                       Total 3.4 GB
────────────────────────────────────────────────────────────────────────
Projects and history          412 MB    (source data, not a cache)
Exports                       96 MB     Open folder
────────────────────────────────────────────────────────────────────────
CACHE                                                     limit 5 GB ▾
Compiled code                 38 MB     ▮▯▯▯▯▯▯▯   Clear
Part geometry (voxels)        1.9 GB    ▮▮▮▮▮▮▯▯   Clear
Meshes and previews           640 MB    ▮▮▯▯▯▯▯▯   Clear
Point clouds                  120 MB    ▮▯▯▯▯▯▯▯   Clear
Scan processing               210 MB    ▮▯▯▯▯▯▯▯   Clear
                                                   [ Clear all cache ]
────────────────────────────────────────────────────────────────────────
Run logs older than 30 days   88 MB     Delete…   (asks to confirm)
Data folder   ~/PicoForge                Change…
```

Rules:
- Clear buttons act immediately without a confirmation dialog, because nothing irreplaceable is lost. A toast offers no undo because none is needed; it states what will rebuild.
- Pinned entries for open projects are skipped and the row says "(n in use kept)".
- "Delete run logs" removes source data and therefore asks to confirm.
- The same actions are available to the CLI: `picoforged cache stats`, `picoforged cache clear [--kind voxels]`.
- MCP agents cannot clear the cache or delete anything.

## 5. Disk-full behaviour

Before a build, the scheduler checks free space against the estimated output size (est. 3× final mesh size). If short, it evicts unpinned cache first; if still short, the run fails with `DISK_FULL` and the Storage panel opens.
