# 01 · Platform, stack and build order

## 1. Decision: Deno, not Electron

**PicoForge v1 runs as a Deno server that opens its UI in the system browser's app window. It does not ship Electron.**

| Criterion | Deno server + system browser window | Electron |
|---|---|---|
| Fits the 8 GB / T0 floor | Reuses Edge or Chrome already on the machine; one browser engine in memory | Bundles its own Chromium and Node; a second browser engine in memory (est. 150–300 MB baseline) |
| Existing code | The server, harness, DB and tests are already Deno (63 tests) | Server would need to run inside Electron's Node or alongside it as a second runtime |
| Headless / LAN / phone use | Same binary serves a phone on the LAN, a remote laptop, or no window at all | Built around one local window |
| MCP | Same binary is the MCP server (`--mcp` for stdio, `/mcp` for HTTP) | Possible, but an extra process |
| Distribution | `deno compile` produces one executable | Installer plus auto-update tooling |
| Permissions | Deno's permission flags confine the server | Node has full access by default |

What Electron would add: native menus, a guaranteed browser version, built-in auto-update. None is needed for v1.

**Revisit trigger.** Wrap the UI in a native shell only if one of these becomes a hard requirement: guaranteed browser version on locked-down machines, native file dialogs beyond the File System Access API, or auto-update. If that happens, prefer a shell that reuses the system webview (Tauri on Windows uses WebView2, which is Chromium) over Electron, to keep the memory floor. All window code sits behind one interface so the swap is local:

```ts
// server/desktop/shell.ts
export interface DesktopShell {
  open(url: string, opts: { width: number; height: number; title: string }): Promise<void>;
  isAvailable(): Promise<boolean>;
}
// v1 implementations: ChromiumAppWindow (Edge/Chrome/Brave --app=), DefaultBrowser (fallback)
```

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Server runtime | Deno 2.x | `deno compile` for release |
| HTTP / WebSocket | Hono + `Deno.serve` | One port, default 7317, bound to 127.0.0.1 |
| Validation | zod | Every boundary, both directions |
| Database | SQLite via `node:sqlite`, WAL | FTS5 probe at boot; fallback `jsr:@db/sqlite` |
| AI | `@anthropic-ai/sdk` (npm) | Only `server/harness/anthropic.ts` imports it |
| MCP | `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps` (npm) | Adapter in `server/mcp/` |
| UI framework | React 19 + Vite | |
| Components | shadcn/ui (Base UI flavour) + Tailwind CSS v4 | Components are copied into `app/src/components/ui/` and skinned with our tokens. Base UI is shadcn's default for new projects per its July 2026 changelog. |
| 3D | three.js (pinned), `camera-controls`, `three-mesh-bvh`, `meshoptimizer` | Path tracer optional, top tier only |
| Geometry engine | .NET 9, Roslyn, PicoGK 2.x (NuGet) | Host process + disposable sandbox children |
| Tests | `deno test`, `dotnet test`, Vitest for UI units, Playwright for E2E | |
| Code navigation for agents | codegraph | See `dev/05_CODEGRAPH.md` |

**PicoGK version.** The repo pins 2.2.*. Version 2.4.0 (12 Nov 2026) adds experimental Linux support and moves 2.x into maintenance mode. Stay on 2.2 until Phase 0 is green on Windows, then try 2.4 behind a branch; `tools/DumpApi` absorbs signature changes.

## 3. Repository layout

```
picoforge/
  CLAUDE.md                  ← dev/CLAUDE.md from this pack
  BACKLOG.md                 ← ordered work items, one line each
  HANDOFF.md                 ← overwritten at end of every session
  devlog/                    ← one file per day
  docs/                      ← this pack's product/ folder + decisions/ (ADRs)
  app/                       ← React UI
    src/components/ui/       ← shadcn components (owned code)
    src/features/            ← chat/, explorer/, viewport/, inspector/, settings/, capture/
    src/viewport/            ← ViewportEngine and render passes (no React inside)
    src/state/               ← stores (scene, chat, runs, settings)
    src/protocol/            ← generated from server/domain/events.ts
  server/
    domain/                  ← zod schemas, ids, Result, commands, events
    http/  db/  harness/  engine/  mcp/  scheduler/  preview/  capture/  desktop/
  engine/                    ← .NET solution (ForgeEngine, ForgeSandbox, Kit, Kit.Tests, DumpApi)
  e2e/                       ← Playwright specs + agent-check scripts
  bench/                     ← perf benches + baselines
  reports/                   ← test, bench, e2e outputs (gitignored except baselines)
  site/                      ← agent docs page
```

## 4. Build order (test first, then engine, then UI)

Each phase ends with its gate green. A red gate blocks the next phase.

| Phase | Build | Gate |
|---|---|---|
| **P0 Make it real** | Compile the engine; generate `picogk_api.json`; wire brief params into `ctx.Params`; write the L3 validator; replace tool stubs; rotate any committed key | A real prompt yields the fan impeller as a watertight STL on a T0 machine; kill the sandbox mid-run and the app survives; cube, fan and gyroid memory and time recorded in `bench/baselines/` |
| **P1 Contracts** | `server/domain/` commands, events, scene document types; generated client types; WS binary frames for point clouds | Schema round-trip tests; fuzzed frames never crash the client |
| **P2 Parts and autosave** | Feature graph, params with expressions, `edits` log, undo/redo, per-part cache | `CAD-*` and `DATA-*` suites green |
| **P3 Progressive preview** | Intent ghost, brief proxy, draft points, blur-to-sharp mesh | `PERF-TTFP-*` green with mock model; one live-model run recorded |
| **P4 UI shell** | Layout, explorer, chat, inspector, settings, gizmo, shadcn skin | Playwright flows F1–F8 green; visual snapshots approved |
| **P5 Low-end rendering** | Baked AO and edge shading, floor, idle accumulation, tiering | `PERF-T0-*` green under CPU throttle and software GL |
| **P6 MCP** | Adapter, resources, prompts, inline view, docs site | `MCP-*` green; Claude Code and one other client build a part end to end |
| **P7 Modes and analysis** | LOW → RAMAN, scheduler, A1/A2 analysis, study ledger | Bracket benchmark gets lighter than STANDARD at equal safety factor |
| **P8 Capture** | Import, webcam, phone over USB then LAN, caliper card | Calibration object error reported per route |
| **P9 Package** | Installer, first-run wizard, hardware probe | Clean T0 machine reaches first part from the README in under 10 minutes |

Within each phase the order is: write the failing test → implement the smallest passing code → run the full check → log it (see `dev/01_DAILY_LOOP.md`).
