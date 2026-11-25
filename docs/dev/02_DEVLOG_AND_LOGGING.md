# Dev 02 · Devlog and logging

Two different kinds of log, kept separate:

| Kind | For | Format | Location |
|---|---|---|---|
| **Team log** (devlog, handoff, ADRs, bug and perf reports) | People and agents working on the repo | Markdown, written by hand or by the agent | `devlog/`, `HANDOFF.md`, `docs/decisions/`, `reports/` |
| **Runtime logs** | Debugging the app | ndjson, written by the app | `~/PicoForge/logs/` |

## 1. The devlog

One file per day: `devlog/2026-11-24.md`. Append-only during the day. Created from `templates/DEVLOG_TEMPLATE.md`.

Every entry answers: what changed, how it was verified, what numbers came out, what was surprising. A good entry:

```md
### 14:20 · preview: PTS1 decoder bounds checks
- Why: PREVIEW-CODEC-02 fuzz found a crash on truncated frames (bug B-031).
- Change: decoder validates header and payload lengths before reading; malformed frames dropped + logged.
- Tests: PREVIEW-CODEC-01 ✓, PREVIEW-CODEC-02 ✓ (10,000 frames, 0 throws).
- Numbers: decode 50k pts = 1.8 ms (was 1.7 ms).
- Files: app/src/viewport/layers/points.ts, server/preview/codec.ts
- Commit: 7c1e2a9
```

Prefixes that other sessions search for:
- `BUG:` a defect found (use `BUG_TEMPLATE`), with ID `B-NNN`.
- `DECISION:` a choice made inside the spec's latitude, with the options considered.
- `SPEC-GAP:` something the spec does not cover, with proposed text.
- `FLAKY:` a test that passed and failed without a code change.
- `PERF:` a measured change against baseline (use `PERF_REPORT_TEMPLATE`).
- `LESSON:` something that would have saved time if known earlier. Repeated lessons graduate into `CLAUDE.md` through an ADR.

## 2. HANDOFF.md

Overwritten at the end of every session from `templates/HANDOFF_TEMPLATE.md`. It must let a fresh agent start without reading anything else except `CLAUDE.md`: current phase, what works, what is half-done (with file paths), the exact next step, open questions for the human, and red items (failing tests, regressions).

## 3. ADRs

`docs/decisions/ADR-NNN-short-title.md` from `templates/ADR_TEMPLATE.md` when a decision changes a spec, a dependency, a public schema, a budget, or a non-negotiable. Status: proposed → accepted (by the human) → superseded.

## 4. Runtime logs

All processes write ndjson lines, one object per line:

```json
{"ts":"2026-11-24T14:20:03.118Z","lvl":"info","area":"engine","msg":"build done",
 "runId":"01JD…","variantId":"01JD…","ms":4210,"peakMiB":1830,"errId":null}
```

| Field | Rule |
|---|---|
| `area` | One of `http ws bus db harness mcp preview engine sandbox scheduler capture viewport` |
| `lvl` | `debug info warn error` |
| `errId` | Present on every error; also shown to the user, so a screenshot can be traced to a log line |
| Ids | Include `runId`, `variantId`, `editId`, `clientName` when relevant |
| Secrets | The logger redacts fields named `*key*`, `*token*`, `authorization` and values that look like keys |

Files: `server.log`, `engine.log`, `sandbox-<runId>.log` (capped at 5,000 lines), `client.log` (the UI posts its warnings and errors to `/api/log`). Rotation at 20 MB, keep 5. Events older than 14 days are pruned from the DB `events` table.

### Reading logs

```sh
deno task logs:tail                       # all areas, pretty
deno task logs:tail --area engine,sandbox
deno task logs:query --since 1h --lvl error
deno task logs:query --run 01JD…          # everything for one run, across processes
deno task logs:query --err E-7F3A         # find the line behind a user-visible errId
```

When investigating a bug, paste the relevant `logs:query` output (trimmed) into the devlog entry.

## 5. Reports

| Path | Written by | Kept |
|---|---|---|
| `reports/test/<date>-<sha>.junit.xml` | `deno task check`, `check:engine` | 30 days |
| `reports/e2e/<date>-<sha>/` | Playwright HTML report, failure screenshots | 30 days |
| `reports/bench/<date>-<sha>.json` | `deno task bench` | 30 days |
| `bench/baselines/*.json` | Copied from a report when a baseline change is approved | Forever, in git |
| `reports/ui-check/<date>/<scenario>.png` + `.json` | `deno task ui:check` | 14 days |

`reports/` is gitignored except baselines.
