# HANDOFF · 2026-11-25 (end of session) · Claude (lead)

## Phase
P0 Make it real. Gate status:
- ✓ kill the sandbox mid-run and the host survives (ENG-ISO-01); over-memory builds are killed and reported OOM (ENG-MEM-01) and run inside a Windows job object (ENG-MEM-02)
- ✓ cube, fan and gyroid time and peak memory in `bench/baselines/engine.json` (cube 2.5 s / 88 MiB, fan 6.1 s / 111 MiB, gyroid 9.3 s / 215 MiB)
- ✓ fan prompt → watertight STL inside the app with the **mock** model and the real engine (UI-FLOW-fan-mock; `deno task smoke:mock`)
- ✗ the same with a **real** model: `smoke:live` not run (costs money; needs your approval)

## Works now
- `deno task check`: 107 passed / 0 failed (fmt, lint, server + app typecheck, unit/golden/drill tests).
- `deno task check:engine`: 0 warnings / 0 errors; Kit.Tests 15/15, ForgeEngine.Tests 28/28.
- `deno task e2e`: 4 passed / 0 failed (UI-VIS-mock-main ×3, UI-FLOW-fan-mock).
- `deno task start`, then open the printed `http://localhost:7317/?t=<token>`: live studio. Prompt → brief card → live status → done → real mesh in the T0 viewport. `PICOFORGE_MODEL=mock` needs no key.
- Without a token (or with `?mock=1`): the image-prompt mock-up with the procedural cylinder head.
- No `as` casts or lint suppressions in server code.

## Half-done (exact files and state)
- Nothing in flight.
- Known gaps, all in `BACKLOG.md`:
  - The pre-P0 amber UI is still in the tree (`app/src/chat`, `panels`, `state/chatStore.ts`, `viewport/ViewportEngine.ts`); nothing on the main path imports it.
  - `deno task bench` isn't wired to real benches.
  - Linux sandbox limits aren't done.

## Next step (do this first)
1. With your approval: `PICOFORGE_LIVE_OK=1 deno task smoke:live` (model from docs/13). Record cost and repair count in the devlog. If green, the P0 gate is green; then open the PR `p0-make-it-real` → `main`.
2. Do not start P1 until you confirm the gate.

## Red items
- Failing tests: none.
- Budgets (docs/04 §9) that are not met yet:
  - First shape preview: mesh visible 17.9 s after send, budget ≤ 10 s (P3 progressive preview).
  - Fan param rebuild: 6.1 s, budget < 3 s (est.); P2 per-part cache, plus `Stats.OfMesh` cost.
- Flaky: none seen in 6 full e2e runs.

## Open questions for the human
- **Rotate the leaked API key** (it was in the old `start.bat` / `conversations/15-JJULY.md` in `ChaitanyaDewangan/picoForge`). It is not in this repo.
- Approve one `smoke:live` run.
- Accept ADR-001/002/003 (`docs/decisions/`).
- SPEC-GAP decisions:
  - (a) `engine.build` (spec) vs `engine.run` (code); both work now.
  - (b) add `engine.convert` to docs/04 §5.
  - (c) status-bar text before autosave exists: proposed "Connected".
  - (d) whether "one accent element" (docs/02) means one element or one live concept: the live status dot, bar, stop button and run dot all use it while a run is live.

## Risks noticed
- Migration 0002 rebuilds the `runs` table (foreign keys off, then `foreign_key_check`). It is mutation-tested, but back up `~/PicoForge/picoforge.db` before the first launch on a machine with real history.
- 8 GB RAM: run at most one dotnet build and one browser at a time. The e2e flow runs server + engine + sandbox + Chromium together (works, about 20 s).
- Blade tips look serrated at 0.5 mm voxels (engine mesh, not the renderer). This is a P2 item.
