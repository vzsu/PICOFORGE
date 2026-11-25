# Dev 03 · Test, analyse, fix, optimise

The loop an agent follows when a check is red, a budget regressed, or the human reports a problem.

```
 ┌────────── 1 RUN ──────────┐
 │ the narrowest command     │
 │ that shows the failure    │
 └────────────┬──────────────┘
              ▼
 ┌────────── 2 READ ─────────┐     reports/, logs:query, Playwright trace,
 │ evidence, not guesses     │     screenshot, bench JSON
 └────────────┬──────────────┘
              ▼
 ┌────────── 3 LOCATE ───────┐     codegraph: callers, impact, affected tests
 │ smallest code region      │
 └────────────┬──────────────┘
              ▼
 ┌────────── 4 REPRODUCE ────┐     a failing test that fails for this reason only
 └────────────┬──────────────┘
              ▼
 ┌────────── 5 FIX ──────────┐     smallest change; no unrelated edits
 └────────────┬──────────────┘
              ▼
 ┌────────── 6 VERIFY ───────┐     the new test, the full check, the UI if visible,
 │                           │     the bench if perf-related
 └────────────┬──────────────┘
              ▼
 ┌────────── 7 RECORD ───────┐     devlog entry with evidence and numbers
 └───────────────────────────┘
```

## 1. Run the narrowest command

| Symptom | Command |
|---|---|
| One server unit test | `deno test server/bus/tests/undo.test.ts --filter DATA-UNDO-01` |
| One UI unit test | `cd app && npx vitest run -t "CAD-EXPR"` |
| One engine test | `dotnet test engine/Kit.Tests --filter "FullyQualifiedName~Golden"` |
| One E2E flow | `npx playwright test e2e/flows/f3-edit-part.spec.ts --trace on` (trace only while debugging) |
| One bench | `deno task bench --filter ttfp` |
| A user report with an `errId` | `deno task logs:query --err <errId>` |

## 2. Read the evidence

- **Unit failure:** the assertion message and the input that produced it. For property tests, copy the shrunk counterexample into a plain test.
- **E2E failure:** open the trace (`npx playwright show-trace <zip>`); check the console errors, the last WS frames, and the screenshot at failure.
- **Bench regression:** compare `reports/bench/<new>.json` with the baseline per metric; a regression in only one tier profile points to a tier-specific path.
- **Engine failure:** `logs:query --run <runId>` across `engine` and `sandbox`; look at peak memory and the last progress line.
- **Flaky test:** run it 20 times (`--repeat-each=20` in Playwright, a loop for Deno). If it fails at least once without code change, log `FLAKY:` and fix the cause (usually a missing wait on a `data-testid` state, or non-deterministic seed). Never add retries to hide it.

## 3. Locate with codegraph

Before editing, ask:
- Where is the symbol defined, and who calls it?
- What is the impact radius of changing its signature or behaviour?
- Which tests cover the affected code?

Write the affected-tests list in the devlog. If impact touches more than one module boundary (05 §1), re-read that spec section first.

## 4–5. Reproduce, then fix

- The reproducing test must fail on the current code and pass with the fix, and its name carries the bug ID (`B-031 truncated PTS1 frame`).
- Fix the cause, not the symptom. Do not catch-and-ignore; every error path maps to the failure table.
- Do not touch unrelated code in the same commit. Note cleanups as backlog items.

## 6. Verify

- New test green, `deno task check` green.
- If the change is visible: `deno task ui:check <scenario>` and look at the screenshot; describe what you saw in the devlog.
- If perf-related: bench before and after on the same machine, three runs each, report the median.

## 7. Iterative optimisation

When the goal is "faster" or "lighter" rather than "fixed":

1. Pick one metric with a budget (12 §7). Record the baseline (median of 3).
2. Profile, don't guess:
   - Server: `deno run --inspect` + Chrome DevTools CPU profile; or timing spans in logs (`ms` fields).
   - Engine: per-step timings already logged by the sandbox; `dotnet-counters` for memory.
   - Viewport: `window.__pf.metrics()` (dev builds) for frame time, draw calls, triangles; Chrome Performance panel for long tasks.
3. Change one thing. Measure. Keep it only if the median improves beyond noise (> 3 %) and nothing else regresses.
4. Log with `PERF_REPORT_TEMPLATE`. Update the baseline only with a devlog entry that says why.
5. Stop when the budget is met with margin; record what you tried that did not help (it saves the next agent time).

## 8. When the human reports a bug

1. Ask for (or find) the `errId`, the project and the time.
2. `logs:query --err` → reproduce with a test.
3. Fix through the loop above.
4. Reply with: cause in one sentence, the fix, the test that now guards it.
