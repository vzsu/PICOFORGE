# HANDOFF · 2026-11-25 13:10 · Claude (lead, solo since 10:40)

## Phase
P0 Make it real. Gate status:
- ✓ kill sandbox mid-run, host survives (ENG-ISO-01)
- ✓ cube, fan, gyroid baselines in `bench/baselines/engine.json` (re-measured after the min-wall fix)
- ✓ fan prompt → watertight STL in the app, **with the mock model** (UI-FLOW-fan-mock, `deno task smoke:mock`)
- ✗ same with a **real model**: `smoke:live` not run (costs money, needs human approval)

## Works now
- `deno task check`: 103 passed / 0 failed (fmt, lint, server + app typecheck).
- `deno task check:engine`: 0 warn / 0 err; Kit.Tests 15/15, ForgeEngine.Tests 26/26.
- `npx playwright test` (`deno task e2e`): 4 passed / 0 failed (UI-VIS-mock-main ×3, UI-FLOW-fan-mock).
- Live studio: `deno task start` → open the printed URL (`?t=<token>`) → type a prompt → brief card, live status, done state, real mesh in the viewport. `PICOFORGE_MODEL=mock` runs it with no key.
- Mock-up mode (no token, or `?mock=1`) still shows the image-prompt screen with the procedural cylinder head.

## Half-done (exact files and state)
- None in flight. Leftover empty folder `../wt-hardening` (locked `node_modules`; delete by hand).

## Next step (do this first)
1. Human approval → `PICOFORGE_LIVE_OK=1 deno task smoke:live` with the model from docs/13. Record cost and repairs.
2. Then the remaining P0 cleanups in `BACKLOG.md`: `as` casts (~125, mostly db row mappers → zod row schemas), FAIL-F15/F16 drills, ENG-MEM-01 job object.

## Red items
- Failing tests: none.
- Budgets: fan param rebuild 6.1 s vs < 3 s (est.); first shape preview 17.9 s vs ≤ 10 s (P3 work); gyroid stats 7.9 s (mesh edge dictionary).
- Flaky: none seen. Note that Playwright headless uses SwiftShader here, so frame times are pessimistic (`PF_GPU=1` for the iGPU).

## Open questions for the human
- Rotate the leaked API key (old `start.bat` / `conversations/15-JJULY.md` in `ChaitanyaDewangan/picoForge`).
- Approve one `smoke:live` run.
- Accept ADR-001/002/003 (`docs/decisions/`).
- SPEC-GAP: `engine.build` (spec) vs `engine.run` (code, both accepted); `engine.convert` missing from docs/04 §5; status-bar text before autosave exists (proposed "Connected").
- OK to open the PR `p0-make-it-real` → `main` once smoke:live is green?

## Risks noticed
- 8 GB RAM: one dotnet build and one browser at a time. The e2e flow spawns server + engine + sandbox + Chromium (works, ~20 s).
- Migration 0002 rebuilds `runs` with foreign keys off. Covered by MIGRATE-0002-01 (mutation-checked), but back up `~/PicoForge/picoforge.db` before the first launch on a machine with real history.
