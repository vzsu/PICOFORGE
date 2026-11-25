# 11 · Testing and dev checks

## 1. Method: test first, always

1. Write the failing test that states the behaviour (name it with the ID scheme below).
2. Run it and see it fail for the right reason.
3. Write the smallest code that passes.
4. Run the full check (`deno task check`).
5. Refactor with the tests green.
6. Log the result in today's devlog (`dev/02_DEVLOG_AND_LOGGING.md`).

A bug fix starts with a test that reproduces the bug. A test is never skipped, deleted or loosened to get green; if a test is wrong, the change to it is explained in the devlog and the commit message.

## 2. Test layers

| Layer | Tool | Location | Speed target |
|---|---|---|---|
| Unit (TS server) | `deno test` | `server/**/tests/` | Whole suite < 20 s |
| Unit (UI logic) | Vitest | `app/src/**/*.test.ts` | < 15 s |
| Unit (C# Kit, sandbox) | `dotnet test` | `engine/Kit.Tests/` | < 60 s |
| Protocol | `deno test` | `server/domain/tests/` | < 5 s |
| Golden transcripts (mock model, real engine) | `deno test` | `server/harness/tests/` | < 90 s |
| E2E flows | Playwright | `e2e/flows/` | < 5 min |
| Visual snapshots | Playwright `toHaveScreenshot` | `e2e/visual/` | < 2 min |
| Performance | `deno bench` + Playwright | `bench/` | < 5 min |
| Failure drills | Playwright + scripts | `e2e/drills/` | < 5 min |

## 3. Test catalogue (IDs are referenced from other docs)

### Data and autosave
- `DATA-AUTOSAVE-01` every command commits within 300 ms (assert `edits` row timestamp).
- `DATA-AUTOSAVE-02` slider scrub of 100 preview values produces exactly one committed edit.
- `DATA-AUTOSAVE-03` kill the server between ack and next command; restart; state equals last acked revision.
- `DATA-UNDO-01` undo/redo across 50 mixed edits returns identical scene hash at every step.
- `DATA-UNDO-02` an agent turn of 7 commands undoes as one step.
- `DATA-REV-01` two actors editing the same node: the second gets `STALE_REV` with current value.
- `DATA-SNAP-01` load from snapshot + replay equals full replay.
- `DATA-CACHE-01` clearing every cache kind leaves projects, params, code and exports byte-identical; regenerated geometry hash matches.
- `DATA-CACHE-02` LRU evicts unpinned entries only, down to 80 % of limit.
- `DATA-PLAN-*` `EXPLAIN QUERY PLAN` uses the expected index for each hot query (06 §5).

### Parameters and CAD
- `CAD-EXPR-*` parser: precedence, unary minus, functions, unknown identifier, cycle detection, range errors; property test with random expression trees vs a reference evaluator.
- `CAD-XFORM-01` gizmo drag moves the mesh client-side in the same frame; one command on release.
- `CAD-BOOL-01..03` union, subtract, intersect volumes within 2 % of analytic values for box/cylinder pairs.
- `CAD-NURBS-01` curve evaluation matches reference points for a known degree-3 curve to 1e-5.
- `CAD-NURBS-02` a flat 4×4 surface thickened 2 mm has volume = area × 2 within 2 %.
- `CAD-EQUIV-01` copied full file rebuilt in a fresh project gives the same geometry hash.
- `CAD-REGION-01` agent code that edits the user region is rejected with `BRIEF_USER_REGION`.
- `CAD-DANGLING-01` removing a part used by a user op yields `DANGLING_REF` with remap options.

### Preview
- `PERF-TTFP-01` ghost visible < 1 s after send (Playwright measures `performance.mark` from the app).
- `PERF-TTFP-02` proxy ≤ 10 s with the mock model streaming at 30 tokens/s.
- `PERF-TTFP-03` recipe-first draft for "120 mm fan impeller" ≤ 20 s.
- `PREVIEW-CODEC-01` `PTS1` encode/decode round trip within quantisation error.
- `PREVIEW-CODEC-02` 10,000 fuzzed frames never throw in the decoder.
- `PREVIEW-NOFLASH-01` sampled screenshots never show an empty viewport after the first frame of a run.

### Engine and Kit
- `KIT-GOLD-*` golden volumes (sphere, tube, extrude, revolve, loft, rotor) within 2 %.
- `ENG-ISO-01` kill -9 the sandbox mid-build; host answers `engine.ping`; run is `failed{SANDBOX_CRASH}`.
- `ENG-MEM-01` a build exceeding the T0 memory cap is killed and reported as `OOM` with a voxel-size hint.
- `ENG-BAKE-01` AO bake is deterministic (same mesh → identical bytes).
- `ENG-ANALYZER-*` each banned API is rejected with line and column.

### Agent and MCP
- `HARNESS-GOLD-*` mock-model transcripts: happy path, compile repair, runtime repair, OOM, invalid geometry, budget exhausted, refusal.
- `MCP-01` MCP Inspector lists every tool, resource and prompt; schemas validate.
- `MCP-02` `run_build` without an accepted brief → `BRIEF_REQUIRED`.
- `MCP-03` concurrent build on the same variant → `RUN_BUSY`; on another variant → allowed.
- `MCP-04` reconnecting does not reset attempt counters.
- `MCP-05` agent cannot clear cache, read settings, or move the user's camera.
- `MCP-06` user stop cancels agent runs within 1 s.

### UI
- `UI-FLOW-F1..F12` the flows in 03.
- `UI-A11Y-01` axe-core finds no serious violations on main screens.
- `UI-A11Y-02` text contrast ≥ 4.5:1 for every token pair in use.
- `UI-KEYS-01` every shortcut in 02 §7 triggers its action; no conflicts.
- `UI-VIS-*` visual snapshots of: empty state, live status line, brief card, done state, failure state, settings, storage panel, gizmo on part.

### Performance on low-end hardware
- `PERF-T0-01` orbit for 5 s under 4× CPU throttling keeps ≥ 30 fps on the reference scene (cylinder head, 300k triangles).
- `PERF-T0-02` with software GL (`--use-angle=swiftshader --enable-unsafe-swiftshader`, test only), the app starts, assigns T0, and renders the scene.
- `PERF-T0-03` server + engine idle memory under budget; one T0 build peaks under the 2.5 GB sandbox cap.
- `PERF-T0-04` with WebGL disabled, image mode renders stills after a build.

### Failure drills
`FAIL-F1..F14` one test per row of the failure table in 04 §7, each triggering the failure on purpose and asserting the user-visible result.

## 4. Deterministic visual tests

- Fixed seed for point sampling and AO directions; turntable off; accumulation forced to completion; fixed window size 1600×1000 at device scale factor 1.
- Fonts loaded before capture (`document.fonts.ready`).
- Threshold: `maxDiffPixelRatio: 0.01`. A changed snapshot is reviewed and approved in the devlog, never auto-updated.

## 5. Mock model

`server/harness/tests/mockModel.ts` replays scripted streams with realistic token timing (configurable tokens per second), including partial tool input deltas, so preview stages and timing tests run without network or cost. One live-model smoke test runs only on demand (`deno task smoke:live`) and its cost is logged.

## 6. Dev checks (what to run, when)

| Command | Runs | When |
|---|---|---|
| `deno task check` | fmt, lint, typecheck (server + app), all unit and protocol tests | Before every commit |
| `deno task check:engine` | `dotnet build -warnaserror`, `dotnet test` | When engine code changes |
| `deno task e2e` | Playwright flows + drills with `--trace off` | Before ending a session; on CI |
| `deno task e2e:visual` | Visual snapshots | When UI changes |
| `deno task bench` | Perf budgets vs `bench/baselines/*.json` | Daily and before merging perf-sensitive changes |
| `deno task doctor` | Environment, versions, DB integrity, cache integrity, codegraph status | Start of each session |
| `deno task smoke:live` | One real-model build | On demand, logs cost |

A command fails on any budget regression beyond 10 % against the baseline. Baselines change only with a devlog entry explaining why.

## 7. CI

Windows runner first (primary platform), Linux runner for server and UI. Pipeline: `check` → `check:engine` → `e2e` → `bench` (report only on PRs, gate on main). Artifacts: JUnit XML, Playwright HTML report, bench JSON, screenshots of failures.
