# HANDOFF · 2026-11-26 · Claude (lead)

## Phase
P0 gate: everything green except `smoke:live` (a real model costs money; needs your approval and key).
On branch `p1-contracts`: P1 step A/B done, and at your request P6 (MCP) is pulled forward. An AI
agent (Claude Code, Cursor …) can now drive PicoForge over MCP, and the open window shows its work live.

## Works now
- `deno task check`: 147 passed / 0 failed (fmt, lint, server + app typecheck, unit/golden/drill/MCP tests).
- `deno task guide:check`: the 4 worked examples in `PICOFORGE_AGENT_GUIDE.md` build on the real engine
  through the MCP path (plate, BCC lattice, gyroid heat sink, quiet 3-inch FPV prop; all watertight).
- `npx playwright test e2e/flows/mcpLive.spec.ts`: UI-FLOW-mcp-live passes. A scripted MCP agent's
  request, plan, brief, build, capture and report all show live in the studio. Request to built part
  takes 12.4 s; the PNG capture is 237 KB; 0 console errors. Screenshot: `reports/ui/flow-mcp-live.png`.
- **Use it with Claude Code** (no Anthropic key needed in PicoForge: the agent's own model does the thinking):
  1. `deno task start` (or the headless server).
  2. `deno task mcp:connect` prints `claude mcp add --transport http picoforge http://127.0.0.1:7317/mcp --header "X-PicoForge-Token: …"`.
  3. In Claude Code: "Using the picoforge MCP server, read picoforge://guide, open project "FPV props"
     and design a quiet 3-blade propeller for a 3 inch FPV drone …" (more prompts in the guide §11).
- In-app chat with a real model: the composer mode (LOW/STD/DEEP/RAMAN) now sets the effort; the model
  and fast mode come from Settings (server side). It needs your API key, which only you enter.

## Half-done (exact files and state)
- Settings overlay in the new main screen (key field + Test, model, effort per mode, fast toggle): the
  server API is done (`/api/settings`, `/api/settings/test-key`, `/api/models` with `fast`); the UI is
  not built. The old `app/src/panels/SettingsDialog.tsx` is stale (old model list) and not mounted.
- `e2e/flows/fanMock.spec.ts` still has its own copy of the server-boot code that
  `e2e/flows/liveServer.ts` now provides.

## Next step (do this first)
1. Try the MCP flow with Claude Code (steps above). Tell me what the agent got wrong; the guide is the
   lever.
2. With your approval: enter your key yourself, then `PICOFORGE_LIVE_OK=1 deno task smoke:live`.
3. Build the Settings overlay (BACKLOG "Settings UI").

## Red items
- Failing tests: none.
- Budgets not met: first preview 17.9 s (≤ 10 s, P3); param rebuild 6.1 s (< 3 s, P2).
- Blade edges look serrated at 0.25–0.5 mm voxels (engine mesh, P2).
- Mass readout shows kg with 3 decimals, so a 1.2 g prop reads 0.001 kg (should switch to g).

## Open questions for the human
- **Rotate the leaked API key** (old `start.bat` / `conversations/15-JJULY.md` in `ChaitanyaDewangan/picoForge`).
- Approve one `smoke:live` run.
- Accept ADR-001/002/003.
- SPEC-GAPs:
  - (a) `engine.build` vs `engine.run`;
  - (b) `engine.convert` in docs/04 §5;
  - (c) "Connected" status text;
  - (d) one accent element;
  - (e) PinTarget/PinRule and `scene.patch` ops[];
  - (f) NEW: `post_message` MCP tool (not in docs/14; proposed wording in the devlog);
  - (g) NEW: `projectId` stands in for `variantId` until P1 variants exist.

## Risks noticed
- The MCP token (`PICOFORGE_MCP_TOKEN` in `~/PicoForge/secret.env`) lets anyone holding it build on
  this machine. The server binds to 127.0.0.1 and rejects foreign browser Origins.
- Agent state (accepted brief, repair counters) is in memory: after a server restart the agent must
  resubmit its brief (it gets BRIEF_REQUIRED, which tells it to).
- 8 GB RAM: the MCP e2e runs server + engine + sandbox + Chromium (works, about 60 s including the build).
