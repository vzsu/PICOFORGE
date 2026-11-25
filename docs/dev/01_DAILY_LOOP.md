# Dev 01 · The daily loop

How a working day (or one agent session) runs in this repo. The goal is that any agent or person can pick up exactly where the last one stopped, and that every change leaves evidence.

## Files that carry state between sessions

| File | Written | Read | Purpose |
|---|---|---|---|
| `CLAUDE.md` | Rarely (by humans or an approved ADR) | Every session, automatically | Standing rules |
| `BACKLOG.md` | End of session | Start of session | Ordered work items, one line each, with phase and test IDs |
| `HANDOFF.md` | Overwritten at end of session | Start of next session | Where things stand right now |
| `devlog/YYYY-MM-DD.md` | Throughout the day | Next sessions, reviews | The day's record: goals, changes, numbers, decisions |
| `docs/decisions/ADR-NNN-*.md` | When a spec-level choice is made | Anyone changing that area | Why we chose what we chose |
| `reports/` | By commands | Analysis | Test, bench and e2e outputs |

## Morning (session start), 10 minutes

```
1. git pull --rebase
2. Read HANDOFF.md → note the "Next step" and "Risks".
3. Open devlog/<today>.md (create from template). Fill "Goals" with 1–3 items from BACKLOG.md.
4. deno task doctor
   - versions: deno, dotnet, node, PicoGK package
   - DB integrity, cache integrity (fast mode)
   - codegraph status (index fresh?)
   - engine self-test (cube)
5. deno task check    → must be green before new work. If red, fixing it is the first goal.
6. For each goal, write the test IDs you plan to add under the goal in the devlog.
```

## Work blocks

Each block is one backlog item, ideally under 2 hours.

```
for each goal:
    read the governing spec section(s)
    codegraph: find the code, check callers and impact
    write failing test(s) → run → see red
    implement the smallest change → run → green
    deno task check
    if UI: deno task ui:check <scenario>; open the screenshot; compare to spec
    if perf-sensitive: deno task bench --filter <name>
    devlog entry (template "Change" block)
    commit: "<area>: <what> (TEST-IDs)"
```

Rules inside a block:
- If the change grows beyond the item, stop, split it, add the remainder to `BACKLOG.md`.
- If a test fails that you did not touch, record it as a bug in the devlog (`BUG_TEMPLATE`) before deciding whether to fix it now.
- If you find a spec gap, write `SPEC-GAP:` in the devlog and propose the text; do not invent architecture silently.

## Evening (session end), 15 minutes

```
1. deno task e2e         → record pass/fail counts and any flaky tests
2. deno task bench       → record deltas vs baseline; >10 % regression = red item in HANDOFF
3. devlog "End of day" block: done, not done, numbers, lessons
4. Overwrite HANDOFF.md from the template
5. Update BACKLOG.md
6. Commit "chore: devlog + handoff <date>" and push to the working branch
```

## Weekly (or every 5 sessions)

- Read the week's devlogs; collect repeated problems into one backlog item each.
- Re-baseline benches only if a change was intentional and explained.
- Prune `reports/` older than 30 days (keep baselines).
- Review open `SPEC-GAP` and `DECISION` entries; turn settled ones into ADRs and spec edits.
- `codegraph` cycle and hotspot check (dev/05) → backlog items for anything new.

## Working with several agents at once

- One branch or worktree per agent; one backlog item per agent; mark the item `[in progress: <agent> <date>]` in `BACKLOG.md` before starting.
- Each agent writes to the same daily devlog under its own heading (`## Agent: <name>`), appending only.
- Only one agent edits `HANDOFF.md` at session end (the one that merges last); others put their handoff notes in their devlog section.
