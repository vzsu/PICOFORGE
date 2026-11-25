# CLAUDE.md — PicoForge

PicoForge is a local computational engineering studio: chat → design brief → PicoGK C# parts built in a sandbox → editable parts in a 3D viewport, also drivable by any agent over MCP. Specs live in `docs/` (numbered 01–15). Read the spec section before changing the code it governs.

## Commands

| Task | Command |
|---|---|
| Start of session health check | `deno task doctor` |
| Dev servers (server + Vite) | `deno task dev` |
| Production-style start | `deno task start` |
| Full check before any commit | `deno task check` |
| Engine build + tests | `deno task check:engine` |
| E2E flows and drills | `deno task e2e` (Playwright, `--trace off` unless debugging) |
| Visual snapshots | `deno task e2e:visual` |
| Perf budgets | `deno task bench` |
| One real-model build (costs money) | `deno task smoke:live` (ask the human first) |
| Agent UI check script | `deno task ui:check <scenario>` |

If a task in this table does not exist yet, creating it is part of the current phase (see `docs/01_PLATFORM_AND_STACK.md` §4).

## Map

`server/domain` types and schemas · `server/bus` command bus · `server/db` SQLite · `server/harness` internal agent · `server/mcp` MCP adapter · `server/preview` ghost/proxy/points · `server/engine` engine RPC client · `engine/` .NET host, sandbox, Kit · `app/src/features` UI · `app/src/viewport` renderer (no React inside) · `e2e/` Playwright · `bench/` budgets.

Use codegraph to find anything else (see "Navigating" below) before grepping.

## Non-negotiables

1. Every state change goes through `bus.dispatch`. No direct SQL writes from features, harness or MCP.
2. Validate every boundary with zod, both directions. No `any`, no `as` casts to silence errors, no `@ts-ignore`.
3. Every thrown error maps to a row in the failure table (`docs/04_SYSTEM_DESIGN.md` §7). New failure → add the row first.
4. Generated C# runs only in the sandbox child, after the analyzer and compile, under limits. No exceptions, including tests.
5. Only `server/harness/anthropic.ts` imports the Anthropic SDK. Only `server/engine/client.ts` speaks engine RPC.
6. Tests are never skipped, deleted or loosened to get green. Visual snapshots are never auto-updated.
7. Secrets never in code, logs, the DB or commits. Keys live in `~/PicoForge/secret.env`.
8. UI uses the tokens in `app/src/styles/tokens.css` and the shadcn components in `app/src/components/ui/`. No new colours, fonts or radii without updating `docs/02_UI_UX.md`.

## How to work (details in `docs/dev/`)

**Start of session**
1. Read `HANDOFF.md`, then today's `devlog/YYYY-MM-DD.md` (create it from `docs/dev/templates/DEVLOG_TEMPLATE.md` if missing).
2. Run `deno task doctor`. Fix red items before feature work.
3. Take the top unblocked item from `BACKLOG.md`. Write the goal and the test IDs you will add in the devlog.

**Each change (test-first)**
1. Write the failing test (ID scheme in `docs/11_TESTING_AND_DEV_CHECKS.md`). See it fail.
2. Ask codegraph for callers and impact of anything you will modify.
3. Make the smallest change that passes.
4. `deno task check` (plus `check:engine` for C#, `e2e:visual` for UI).
5. For UI work, verify in the running app with `deno task ui:check` and look at the screenshot.
6. Append a devlog entry: what changed, test IDs, numbers measured, anything surprising.
7. Commit with a message that names the test IDs.

**End of session**
1. `deno task e2e` and `deno task bench`; record results in the devlog.
2. Overwrite `HANDOFF.md` from the template: state, next step, open questions, risks.
3. Update `BACKLOG.md` (done items struck, new items added at the right priority).

## Navigating

- `codegraph` MCP tools are available in this repo. Use them first for "where is", "who calls", "what breaks if I change".
- Before modifying a function with more than two callers, check its impact and list the affected tests in the devlog.
- If the graph looks stale, run `codegraph sync` (or `codegraph status` to check).

## UI work

- Run `/unslop` on a screen after building it, but keep the fixed direction (iOS × Nothing, charcoal, one red accent, Geist + Geist Mono). It may refine spacing, hierarchy and copy; it may not change the palette or fonts.
- Add shadcn components with the CLI into `app/src/components/ui/`, then skin with tokens.
- Every interactive element gets a `data-testid` so `ui:check` scripts and Playwright can read it.

## When stuck

1. Re-read the governing spec section. 2. Ask codegraph. 3. Write the failing test that states the confusion. 4. Smallest change. 5. After two failed attempts, write a `DECISION:` entry in the devlog with the options and pick the one that adds the least code; if it changes a spec, write an ADR in `docs/decisions/`. Never widen a type, remove a validator or bypass the sandbox to get unstuck.

## Definition of done (per backlog item)

Tests named in the devlog exist and pass · `deno task check` green · UI verified with a screenshot if UI changed · budgets not regressed > 10 % · devlog entry written · spec updated if behaviour changed.
