# HANDOFF · 2026-11-25 06:30 · Claude (lead)

## Phase
P0 Make it real. Gate status:
- ✓ kill sandbox mid-run, host survives (ENG-ISO-01)
- ✓ cube, fan, gyroid baselines in `bench/baselines/engine.json`
- ✗ real prompt → fan watertight STL with a live model: `smoke:live` not run, needs human approval (costs money)

## Works now
- `deno task check`: 92 passed / 0 failed. `deno task check:engine`: 0 warn / 0 err, 37/37 tests. `deno task e2e`: 3/3 (UI-VIS-mock-main).
- Engine builds headless on PicoGK 2.2.0: cube 2.8–4.2 s, fan 19.4 s, gyroid 12.6 s.
- Brief params reach `Ctx.P`. L3 validator, search/inspect/export tools, and the secret scan are real and tested.
- Mock-up main screen matching docs/02 + image prompt 1 (`app/src/features/main/`, `app/src/viewport/StudioEngine.ts`). Screenshot: `reports/ui/mock-main.png` (gitignored; regenerate with `deno task ui:check mock-main`).

## Half-done (exact files and state)
- Branch `p0-fullstack` (worktree `../wt-fullstack`): mock-model server mode, main screen wired to the live server, `UI-FLOW-fan-mock`.
- Branch `p0-hardening` (worktree `../wt-hardening`): B-002 real app typecheck, min-wall probe perf, job-object limits (ENG-MEM-01).

## Next step (do this first)
1. Merge `p0-fullstack` and `p0-hardening` into `p0-make-it-real`; run check, check:engine, e2e myself; look at `reports/ui/flow-fan-mock.png`.
2. With human approval: `PICOFORGE_LIVE_OK=1 deno task smoke:live` (model per docs/13).

## Red items
- Failing tests: none.
- Budget regressions: fan rebuild 19.4 s vs < 3 s param-change budget; min-wall probe is 74–91 % of it (hardening agent working on it).
- App typecheck was a no-op (B-002); 4 old TS errors in panels.

## Open questions for the human
- Rotate the leaked API key from the old `start.bat` / `conversations/15-JJULY.md`.
- Accept ADR-001/002/003 (`docs/decisions/`).
- Approve one `smoke:live` run (costs money).
- SPEC-GAP: method name `engine.build` (spec) vs `engine.run` (code). Both work now; which one goes in docs/04 §5?

## Risks noticed
- On this machine Playwright's default headless browser uses SwiftShader, so its frame times are pessimistic. Use `PF_GPU=1` for real iGPU numbers.
- 8 GB RAM: run at most one dotnet build and one browser at a time.
