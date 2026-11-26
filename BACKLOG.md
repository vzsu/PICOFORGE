# BACKLOG

Format: `- [ ] P<phase> · <item> · tests: <IDs> · spec: docs/NN §x`. Top unblocked item goes first. Mark `[in progress: <agent> <date>]` before starting.

## P0 · Make it real
- [ ] P0 · [human: rotate key] [secret scan ✓ SEC-SCAN-01] Rotate the API key that `start.bat` wrote into `.env`; remove that line; add a secret-scan check to `deno task check` · spec: docs/04 §8
- [x] P0 · (proposed, awaiting human accept) ADR-001: replace graphify with codegraph; delete `graphify-out/`, `.graphifyignore`, graphify section of AGENTS.md; `codegraph init` · spec: dev/05
- [x] P0 · (proposed, awaiting human accept) ADR-002: Deno server + system browser window, no Electron in v1 · spec: docs/01 §1
- [x] P0 · (proposed, awaiting human accept) ADR-003: new UI direction (iOS × Nothing, charcoal, red accent) supersedes old amber palette · spec: docs/02
- [x] P0 · (✓ 2026-11-25, 0 warn/0 err, 11/11 Kit tests) Install .NET 9 SDK; `dotnet build engine/PicoForge.sln -warnaserror`; fix compile errors · tests: KIT-GOLD-* · spec: docs/01 §4
- [x] P0 · (✓ 2026-11-25, 120 types/1026 members, 19 analyzer cases) Run `tools/DumpApi` → `picogk_api.json`; generate API card; reconcile Kit with real PicoGK signatures · tests: ENG-ANALYZER-*
- [x] P0 · (✓ 2026-11-25, cube 2.8–4.2 s) Engine gate: cube STL in < 6 s; kill -9 sandbox mid-run leaves host alive · tests: ENG-ISO-01
- [x] P0 · (✓ 2026-11-25 + ENG-PARAMS-01/02) Wire brief parameters into `ctx.Params` (`runPicoGK.ts` passes `params: {}` today) · tests: HARNESS-GOLD-params
- [x] P0 · (✓ 2026-11-25, GEOM-L3-01..07) Write `server/harness/validate.ts` (L3 geometry checks) · tests: HARNESS-GOLD-geometry
- [x] P0 · (✓ 2026-11-25, TOOL-SEARCH/INSPECT/EXPORT-*, ENG-INSPECT-01, ENG-CONVERT-01) Replace stubs in `searchDocs.ts`, `inspectGeometry.ts`, `exportArtifact.ts`, engine `Program.cs` inspect · tests: per tool
- [x] P0 · Add deno tasks (DEV-TASKS-01, DEV-LOGS-01 ✓ 2026-11-25): `doctor`, `start`, `check:engine`, `e2e:visual`, `ui:check`, `logs:tail`, `logs:query`, `smoke:live` · spec: dev/CLAUDE.md
- [x] P0 · (✓ 2026-11-25 bench/baselines/engine.json) Measure and record T0 baselines: cube, fan, gyroid block (time, peak memory) · spec: docs/12 §7
- [ ] P0 · [blocked: needs human approval, costs money] Live smoke: fan prompt → watertight STL with a real model, ≤ 1 repair · tests: smoke:live

- [x] P0+ · (✓ 2026-11-25, 3/3 e2e) Mock-up main screen per docs/02 + image prompt 1 (human request) · tests: UI-VIS-mock-main
- [x] P0 · (✓ 2026-11-25, lead) App end to end with mock model + real engine (deno task start → fan prompt → mesh in viewport) · tests: UI-FLOW-fan-mock, CHAT-RUN-01/02, HARNESS-MOCK-01..05, STATIC-ROOT-01, DB-RUNSTATE-01, MIGRATE-0002-01
- [x] P0 · (✓ 2026-11-25) B-002 real app typecheck in `check` (DEV-TASKS-02)
- [x] P0 · (✓ 2026-11-25) min-wall probe by EDT: fan 19.4 → 6.1 s (ENG-MINWALL-01..03, -perf)
- [x] P0 · (✓ ENG-MEM-01, ENG-MEM-02) Windows job-object memory/process limits for the sandbox · spec: docs/04 §8
- [ ] P9 · Linux sandbox limits (cgroups + seccomp) · spec: docs/04 §8
- [ ] P2 · Fan param rebuild 6.1 s vs < 3 s (est.) budget: `Stats.OfMesh` edge dictionary + double `mshAsMesh` now dominate stats (gyroid 7.9 s) · spec: docs/04 §9
- [ ] P3 · First shape preview ≤ 10 s: today mesh visible at 17.9 s (mock, SwiftShader) · tests: PERF-TTFP-02
- [ ] P2 · Smoother thin-blade edges (serrated tips at 0.5 mm voxels) — investigate engine smoothing/voxel size for blades
- [x] P0 · (✓ FAIL-F15-01, FAIL-F16-01) FAIL-F15/F16 drills for new failure rows · spec: docs/04 §7
- [ ] P1 · Repeated F15 (engine protocol errors) escalates to F5 restart · spec: docs/04 §7
- [x] P0 · (✓ server; app still has a few) Remove `as` casts in server code (SETTINGS-PATCH-01, ENG-CLIENT-TIMEOUT-01, B-006..B-009) · spec: CLAUDE.md #2
- [ ] P0 · SPEC-GAP: settle `engine.build` vs `engine.run`; add `engine.convert` to docs/04 §5

- [ ] P4 · Port or delete the pre-P0 amber UI (chat/, panels/, state/chatStore.ts, viewport/ViewportEngine.ts, ViewportPane.tsx, GpuProbe.ts); it still has `as` casts · spec: docs/02, CLAUDE.md #2
- [x] P0 · (✓ BENCH-CMP-01, BENCH-MED-01) Wire `deno task bench` to real benches, median of 3 · spec: docs/11 §6
- [ ] P5 · UI perf benches (PERF-T0-*, PERF-TTFP-*) into `deno task bench` · spec: docs/11 §3

## P1 · Contracts
- [ ] P1 · [in progress: lead 2026-11-26] Command and event schemas in `server/domain/`; generated client types (✓ PROTO-GEN-01, events validated client-side; commands pending SPEC-GAP pins + scene.patch ops) · tests: protocol round-trips
- [x] P1 · (✓ 2026-11-26) `PTS1` codec (server + client via gen:protocol) · tests: PREVIEW-CODEC-01, -02
- [ ] P1 · Command bus with permissions and `STALE_REV` · tests: DATA-REV-01

- [x] P0+ · (✓ 2026-11-26) Mock-up viewport looks from reference images: Loading (x-ray + point dust), CFD (colormap + legend) · tests: UI-VIS-mock-points, UI-VIS-mock-cfd

## P2 · Parts and autosave
- [ ] P2 · Migration 0002 · tests: DATA-PLAN-*
- [ ] P2 · Expression engine · tests: CAD-EXPR-*
- [ ] P2 · Edits log, undo/redo, snapshots · tests: DATA-UNDO-*, DATA-SNAP-01
- [ ] P2 · Kit `ctx.Part` / `ctx.Op` / per-part cache · tests: CAD-BOOL-*, DATA-CACHE-*
- [ ] P2 · Emitter + user region + code panel · tests: CAD-EQUIV-01, CAD-REGION-01

## P3 · Progressive preview
- [ ] P3 · Ghost, recipe match, proxy from streaming brief · tests: PERF-TTFP-01, -02
- [ ] P3 · Recipe-first draft and part streaming · tests: PERF-TTFP-03
- [ ] P3 · Reveal transition, no-flash guarantee · tests: PREVIEW-NOFLASH-01

## P6 · MCP (pulled forward on the human's request, 2026-11-26)
- [x] P6 · (✓ 2026-11-26) Streamable HTTP `/mcp`, stateless; tools open_project, post_message, search_docs, submit_design_brief, run_picogk, inspect_geometry, capture_viewport, export_artifact, get_run; limits and typed errors (docs/14 §4, §9) · tests: MCP-01..06, MCP-HTTP-01..03
- [x] P6 · (✓ 2026-11-26) One-file agent guide `PICOFORGE_AGENT_GUIDE.md` as `picoforge://guide` + `forge_engineer`; examples built for real · tests: GUIDE-01/02, `deno task guide:check`
- [x] P6 · (✓ 2026-11-26) Live view: session.focus, origin chips, AGENTS n, chat history on open, capture from the new viewport · tests: UI-FLOW-mcp-live
- [ ] P6 · stdio transport (`picoforged --mcp` attaching to the running app) · spec: docs/14 §2
- [ ] P6 · variantId / get_scene / set_param / fork_variant / define_part / assemble (needs P1 command bus + P2 parts) · spec: docs/14 §3
- [ ] P6 · Agent state survives restarts (brief + counters in DB, per brief) · spec: docs/14 §2
- [ ] P6 · `agent_clients` table, Settings → MCP connections (token reveal/rotate, revoke) · spec: docs/14 §10, docs/02 §6
- [ ] P6 · Message origin stored in the DB (chips survive reload) · spec: docs/14 §10
- [ ] P6 · MCP Apps inline viewport (`ui://picoforge/viewport`) · spec: docs/14 §7
- [ ] P6 · Acceptance with a second client (Codex or Cursor) · spec: docs/14 §12

## Settings UI
- [ ] P4 · Settings overlay "Models and keys" in the new main screen (write-only key + Test, model, effort per mode, fast toggle); server side done (RUN-SETTINGS-*) · spec: docs/02 §6

## Later phases
P4 UI shell · P5 low-end rendering · P7 modes and analysis · P8 capture · P9 packaging — expand when P3 is green.
