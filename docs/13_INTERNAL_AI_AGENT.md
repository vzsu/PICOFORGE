# 13 · Internal AI agent (the harness)

The harness is a deterministic state machine around the model. The model does two jobs only: write a structured design brief, and write part functions under the code contract. Everything else (validation, compiling, building, checking geometry, repair limits) is code.

API facts in this file were current for the Claude API as of November 2026. Re-check model ids and beta flags against the live docs before implementing; `server/harness/anthropic.ts` is the only file that touches the SDK.

## 1. State machine

```
queued → briefing → defining_parts ⇄ building_draft → assembling → building_final → validating → done
             │              │                │                │               │
             └──────────────┴────────────────┴────────────────┴───────────────┴──► failed(code)
                                       ▲  bounded repair loop  │
any state ── user stop ──► cancelled
```

Legal transitions live in one table in `orchestrator.ts`; an illegal transition is a failing test.

## 2. Model configuration

| Setting | Default | Notes |
|---|---|---|
| Model | `claude-opus-5-5` | Selectable in Settings → Models and keys |
| Thinking | Adaptive (always on for this model; omit the parameter) | `{type:"disabled"}` is rejected on Opus 5.5 |
| Effort by mode | LOW `low` · STD `medium` · DEEP `high` · RAMAN `high` | Opus 5.5 defaults to `medium`, so the harness always sets it explicitly |
| Streaming | Always | Needed for preview stages and long outputs |
| `max_tokens` | 64,000 when streaming | Never low-balled; truncation costs a repair turn |
| Tool choice | `auto` | Forced tool choice (`any` / `tool`) returns a 400 on Opus 5.5; the system prompt names the expected tool instead |
| Strict tools | `strict: true` with `additionalProperties: false` | Guarantees schema-valid arguments on completed calls |
| Refusals | Check `stop_reason === "refusal"` before reading content | Server-side fallback enabled by default (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); a Settings toggle turns it off |
| Fast responses | Off | Optional `speed: "fast"` on Opus 5.5 at premium price; user's choice in Settings |

The SDK's typed errors (`RateLimitError`, `APIError` and subclasses) are handled most-specific first; retryable errors use the SDK's built-in retries before failure row F6.

## 3. Tools

All tools are defined once with zod in `server/harness/tools/*` and emitted as both Anthropic tool schemas and MCP tool schemas (14).

| Tool | Purpose | Notes |
|---|---|---|
| `search_docs {query}` | FTS over PicoGK API card, Kit, recipes, physics pack, code versions | Cheap; encouraged before writing code |
| `submit_design_brief {category, envelope_mm, material, process, parameters[], targets[], checks[]}` | The required first step; validated by the brief validator | Streams early for the proxy preview (09) |
| `define_part {name, function_cs, reads_params[]}` | One part function; compiled and draft-built on arrival | Part streaming |
| `assemble {build_cs}` | The `Design.Build` body: registering parts and ops | Triggers final build |
| `run_build {stage: "draft"|"final"}` | Explicit rebuild | Returns stats or a typed error |
| `inspect_geometry {target, ops[]}` | Measurements, slices, min wall | Used for self-checks |
| `capture_viewport {view}` | PNG from the user's viewport (or text fallback when headless) | |
| `ask_user {question, options[]}` | 2–4 options; first is recommended | Only when the budget is exhausted or the brief is ambiguous |

`run_picogk {code}` (whole file at once) stays available for compatibility; it maps onto `define_part` × n + `assemble` internally.

## 4. Streaming tool input

Set `eager_input_streaming: true` on every tool so long inputs (briefs, C# functions) stream as they are generated instead of arriving in one burst. Consequences the harness must handle:

- Partial JSON is parsed with a tolerant parser for **preview only** (09 §2). Nothing is executed from a partial input.
- Before executing a completed tool call, the full input is validated with zod. A failure is returned as an error `tool_result` (`is_error: true`, code `INVALID_INPUT`), never executed.
- Check `stop_reason` before running tools: `max_tokens` or `refusal` means the last tool input may be incomplete; do not run it.
- Catch only the SDK's JSON parse error around partial parsing, never its API errors.

## 5. Prompt layout and caching

Order matters because caching is a prefix match:

```
tools (fixed order, generated from zod, canonical JSON)          ← cache breakpoint
system: doctrine + code contract + PicoGK API card + Kit card     ← cache breakpoint
messages: project defaults, accepted brief, history …
latest user turn / tool results                                  (volatile, last)
```

- The system prompt contains no timestamps, ids or per-request values.
- Tool definitions are emitted in a fixed order with canonical JSON.
- Mid-conversation operator instructions (repair context, budget notices, mode changes) are appended as `{role: "system"}` messages in `messages` rather than edits to the top-level system prompt, so the cached prefix survives.
- Verify cache behaviour in `bench/agent.bench.ts` via `usage.cache_read_input_tokens`; zero across repeated turns means something in the prefix is changing.

## 6. History rules (append-only)

Current Claude models tie thinking blocks to the conversation that produced them. Editing or reordering earlier messages can invalidate them. So:

- The harness never rewrites earlier messages. Assistant content (including thinking blocks) is passed back unchanged.
- To bound context, use server-side mechanisms (context editing to clear old tool results, or compaction for very long sessions), not manual elision.
- One design task = one conversation. A new task starts a new conversation seeded with a short written summary of the variant (accepted brief, parameter table, part list, last stats).
- The previous repo spec's "rebuild messages per turn and elide old code bodies" approach is replaced by these rules.

## 7. Validation ladder and repair

| Rung | Codes | Payload to the model |
|---|---|---|
| L0 lint | `CONTRACT_VIOLATION`, `BANNED_API`, `UNKNOWN_SYMBOL`, `BRIEF_USER_REGION` | Rule, line, column, did-you-mean |
| L1 compile | `COMPILE_ERROR` | First 12 diagnostics |
| L2 build | `RUNTIME_ERROR`, `TIMEOUT`, `OOM`, `SANDBOX_CRASH` | Exception, top 5 frames, last 30 log lines, resource hint |
| L3 geometry | `EMPTY_GEOMETRY`, `NOT_WATERTIGHT`, `ENVELOPE_EXCEEDED`, `BELOW_MIN_WALL`, `BRIEF_MISMATCH`, `PIN_VIOLATED` | Measured numbers vs required |

Repair budgets per brief: compile 3, runtime 2, geometry 2. Repairs are per part where possible (only the failing `define_part` is re-sent). Budget exhausted → the model is told to stop and call `ask_user` with two concrete simplifications. Every attempt is a `code_versions` row linked by `parent_id`.

## 8. Modes

| Mode | Loop | Analysis | Stop |
|---|---|---|---|
| LOW | brief → parts → final, compile repairs only | A0 formulas | First valid build |
| STD | Full ladder with repairs | A0 + A1 metrics | First valid build |
| DEEP | 3–6 variants on the main design choices, built and compared | A0–A2 | Best variant chosen with reasons |
| RAMAN | Propose (model) → tune (numeric optimiser, no tokens) → build → analyse → score → critique, repeated | A0–A2, A3 if available | Targets met with margin, < 2 % gain over 3 rounds, budget, or stop |

For RAMAN the harness may set a task budget (beta `task-budgets-2026-03-13`, `output_config.task_budget`) so the model paces itself; the hard limits (rounds, wall time) are enforced by the harness regardless.

## 9. System prompt outline

1. Role: computational engineer working inside PicoForge; part functions only; the harness builds and checks.
2. Working loop: understand → `submit_design_brief` → `define_part` per part → `assemble` → read results → repair or finish.
3. Code contract (05 §5) and the user-region rule.
4. API card and Kit card (generated from `picogk_api.json` and Kit reflection; never hand-written).
5. Engineering doctrine: derive dimensions from the physics pack; state equations as parameter expressions; never hard-code a brief value inside a function.
6. Tone with the user: short, plain, numbers in units, no apologies.

Target size under 9k tokens (asserted by `systemPrompt.test.ts`).

## 10. Tests

`HARNESS-GOLD-*` (11 §3) cover every path in the state machine with the mock model, including streaming partial inputs, a refusal, `max_tokens` mid tool call, and an invalid completed tool input.
