# ADR-002 · Deno server + system browser window, no Electron in v1

- Status: proposed
- Date: 2026-11-25
- Deciders: human (owner), Claude (lead agent)
- Spec sections affected: docs/01 §1

## Context
The target floor is an 8 GB laptop with no dedicated GPU. The dev machine is exactly that: 7.3 GB usable, Ryzen 3 7320U, integrated Radeon. The server, harness, DB and tests are already Deno (65 tests green on 2026-11-25). Electron would put a second Chromium in memory (est. 150–300 MB).

## Options
1. **Deno server + Edge/Chrome `--app=` window.** One binary via `deno compile`. The same process serves MCP and LAN clients.
2. **Electron.** Native menus and auto-update, at the cost of memory and a second runtime.

## Decision
Option 1. All window code sits behind `DesktopShell` (docs/01 §1), so a later swap to a system-webview shell (Tauri/WebView2) stays local.

## Consequences
- No native menus or auto-update in v1.
- Revisit trigger (docs/01 §1): a hard need for a guaranteed browser version, native file dialogs, or auto-update.
