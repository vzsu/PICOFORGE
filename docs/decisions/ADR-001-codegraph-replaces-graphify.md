# ADR-001 · codegraph replaces graphify

- Status: proposed
- Date: 2026-11-25
- Deciders: human (owner), Claude (lead agent)
- Spec sections affected: docs/dev/05, CLAUDE.md "Navigating"

## Context
The old repo used graphify. Its output (`graphify-out/`) was committed, its rules lived in `AGENTS.md`, and it had a `.graphifyignore`. The new spec (dev/05) specifies codegraph MCP tools for "where is / who calls / impact". `deno task doctor` shows codegraph is installed on the dev machine.

## Options
1. **Keep graphify.** No migration work, but it contradicts CLAUDE.md, and committed graph output goes stale and causes noisy diffs.
2. **codegraph.** Matches the spec and gives incremental `codegraph sync` and MCP tools. It needs a one-time `codegraph init`.

## Decision
Use codegraph. Don't import `graphify-out/` or `.graphifyignore` (left out of the import commit). AGENTS.md now points to CLAUDE.md.

## Consequences
- `.gitignore` ignores `graphify-out/`. Run `codegraph init` once per clone.
- Signal that this was wrong: agents fall back to grep repeatedly because codegraph answers are stale or missing (track via `LESSON:` entries).
