# BACKLOG (seed — copy to repo root as BACKLOG.md)

Format: `- [ ] P<phase> · <item> · tests: <IDs> · spec: docs/NN §x`. Top unblocked item goes first. Mark `[in progress: <agent> <date>]` before starting.

## P0 · Make it real
- [ ] P0 · Rotate the API key that `start.bat` wrote into `.env`; remove that line; add a secret-scan check to `deno task check` · spec: docs/04 §8
- [ ] P0 · ADR-001: replace graphify with codegraph; delete `graphify-out/`, `.graphifyignore`, graphify section of AGENTS.md; `codegraph init` · spec: dev/05
- [ ] P0 · ADR-002: Deno server + system browser window, no Electron in v1 · spec: docs/01 §1
- [ ] P0 · ADR-003: new UI direction (iOS × Nothing, charcoal, red accent) supersedes old amber palette · spec: docs/02
- [ ] P0 · Install .NET 9 SDK; `dotnet build engine/PicoForge.sln -warnaserror`; fix compile errors · tests: KIT-GOLD-* · spec: docs/01 §4
- [ ] P0 · Run `tools/DumpApi` → `picogk_api.json`; generate API card; reconcile Kit with real PicoGK signatures · tests: ENG-ANALYZER-*
- [ ] P0 · Engine gate: cube STL in < 6 s; kill -9 sandbox mid-run leaves host alive · tests: ENG-ISO-01
- [ ] P0 · Wire brief parameters into `ctx.Params` (`runPicoGK.ts` passes `params: {}` today) · tests: HARNESS-GOLD-params
- [ ] P0 · Write `server/harness/validate.ts` (L3 geometry checks) · tests: HARNESS-GOLD-geometry
- [ ] P0 · Replace stubs in `searchDocs.ts`, `inspectGeometry.ts`, `exportArtifact.ts`, engine `Program.cs` inspect · tests: per tool
- [ ] P0 · Add deno tasks: `doctor`, `start`, `check:engine`, `e2e:visual`, `ui:check`, `logs:tail`, `logs:query`, `smoke:live` · spec: dev/CLAUDE.md
- [ ] P0 · Measure and record T0 baselines: cube, fan, gyroid block (time, peak memory) · spec: docs/12 §7
- [ ] P0 · Live smoke: fan prompt → watertight STL with a real model, ≤ 1 repair · tests: smoke:live

## P1 · Contracts
- [ ] P1 · Command and event schemas in `server/domain/`; generated client types · tests: protocol round-trips
- [ ] P1 · `PTS1` codec (server + client) · tests: PREVIEW-CODEC-01, -02
- [ ] P1 · Command bus with permissions and `STALE_REV` · tests: DATA-REV-01

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

## Later phases
P4 UI shell · P5 low-end rendering · P6 MCP · P7 modes and analysis · P8 capture · P9 packaging — expand when P3 is green.
