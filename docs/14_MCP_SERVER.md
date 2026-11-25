# 14 · MCP server: the whole studio as an agent tool

Any MCP client (Claude Code, Codex, Gemini CLI, Cursor, VS Code, Claude Desktop) can drive PicoForge. The external agent's model takes the place of the internal model; every rule the internal agent follows (brief first, code contract, sandbox, validation ladder, repair budgets) is enforced by the server for external agents too. The open desktop UI shows every MCP action live.

## 1. Design laws

1. **Adapter, not fork.** `server/mcp/` translates MCP requests into `bus.dispatch` calls, harness tool executors and queries. If behaviour differs between MCP and internal mode, it is a bug.
2. **One schema source.** Tool schemas come from the same zod definitions as the internal tools.
3. **No trusted clients.** External agents get the same or stricter enforcement than the internal agent.
4. **The human outranks agents.** User stop cancels agent runs; user pins bind agents; agents never move the user's camera.

## 2. Transports

| Transport | How | Auth |
|---|---|---|
| stdio | `picoforged --mcp` (spawned by the client). Connects to the running app; if none is running, starts headless | Reads the token from `~/PicoForge/secret.env` |
| Streamable HTTP | `http://127.0.0.1:7317/mcp` on the running app | `X-PicoForge-Token` header |

The MCP specification released 2026-07-28 made the HTTP transport stateless (no protocol-level session id). So PicoForge never relies on transport sessions: **every state-changing tool takes explicit `projectId`, `variantId` and `baseRev`**, and attempt counters are stored server-side per brief. `VERIFY:` routing headers and SDK behaviour against the current spec changelog before implementing; use `@modelcontextprotocol/sdk` rather than hand-rolling the transport.

## 3. Tools

| Group | Tool | Input (abridged) | Result |
|---|---|---|---|
| Project | `open_project` | `projectName?`, `projectId?` | ids, default variant, defaults, hardware tier |
| | `get_scene` | `variantId` | nodes, params (expr + value), pins, `rev` |
| | `fork_variant` | `variantId`, `name` | new `variantId` |
| Knowledge | `search_docs` | `query` | ranked chunks |
| Design | `submit_design_brief` | `variantId`, brief | accepted / violations |
| | `define_part` | `variantId`, `name`, `function_cs`, `reads_params[]` | compile result, draft stats |
| | `assemble` | `variantId`, `build_cs` | compile result |
| | `run_build` | `variantId`, `stage` | stats or typed error; returns `runId` early for long builds |
| | `run_picogk` | `variantId`, `code` | Whole-file path for agents that prefer one file |
| Edit | `set_param` | `variantId`, `name`, `expr`, `baseRev` | new `rev`, affected parts |
| | `transform_part` | `variantId`, `node`, `trs`, `baseRev` | new `rev` |
| | `add_op` | `variantId`, `op`, `inputs[]`, `baseRev` | new node, new `rev` |
| Inspect | `get_run` | `runId` | state, stage, stats, warnings, log tail |
| | `inspect_geometry` | `target`, `ops[]` | measurements |
| | `capture_viewport` | `variantId`, `view` | PNG, or text description when headless |
| Study | `start_study` / `get_study` / `stop_study` | `variantId`, `mode`, goals | handle, ledger, state |
| Output | `export_artifact` | `variantId`, `format` (stl, 3mf, glb), `parts?` | file URL |
| Collaboration | `annotate` | `variantId`, `at`, `text` | annotation id (shown as a pointer in the user's viewport) |

Tool descriptions stay short (under ~150 tokens each) and state their preconditions plainly, for example: "Requires an accepted design brief for this variant; otherwise returns BRIEF_REQUIRED."

## 4. Errors (all typed, all with a next step)

| Code | Meaning | What the agent should do |
|---|---|---|
| `BRIEF_REQUIRED` | No accepted brief for this variant | Call `submit_design_brief` |
| `BRIEF_STALE` | The user changed a governing value or pin during the run | Call `get_scene`, rebuild with current values |
| `STALE_REV` | `baseRev` is behind | Re-read with `get_scene`, re-apply the intent |
| `RUN_BUSY` | A run is active on this variant | Wait (`get_run`) or `fork_variant` |
| `NEEDS_DECISION` | Repair budget or rate limit reached; `options[]` attached | Relay the options to the human |
| `FORBIDDEN` | Action not allowed for agents, or client revoked | Do not retry |
| `INVALID_INPUT` | Input failed schema validation | Fix the input |
| Ladder codes | `COMPILE_ERROR`, `RUNTIME_ERROR`, `OOM`, `EMPTY_GEOMETRY`, `BELOW_MIN_WALL`, `PIN_VIOLATED` … | Follow `repairHint` in the payload |

## 5. Resources

```
picoforge://rules/doctrine                          working loop, code contract, conventions
picoforge://api/picogk-card                         generated from the installed PicoGK version
picoforge://api/kit-card                            Kit signatures
picoforge://kb/recipes/{category}                   recipe pages
picoforge://kb/physics                              formula pack
picoforge://kb/materials                            materials table (JSON)
picoforge://project/{p}/variant/{v}/scene           scene document
picoforge://project/{p}/variant/{v}/brief           accepted brief
picoforge://project/{p}/variant/{v}/code            current design file
picoforge://project/{p}/variant/{v}/last-run        last run report
picoforge://session/selection                       what the human has selected right now
picoforge://session/pins                            human pins and keep-out volumes
picoforge://hardware/profile                        tier and limits
```

## 6. Prompts

- `forge_engineer {projectName, goal}`: the bootstrap doctrine; first line tells the agent to read the API card.
- `forge_repair {runId}`: the repair template for a failed run.
- `forge_review {variantId}`: a structured critique checklist (loads, walls, overhangs, fits, mass).

## 7. Live view inside the agent's window (MCP Apps)

MCP Apps (the official UI extension, stable spec 2026-01-26) lets a server ship an HTML view under a `ui://` URI that supporting hosts render in a sandboxed iframe; the view can call the server's tools through the host. Hosts listed as supporting it include Claude, Claude Desktop, VS Code GitHub Copilot, Goose and Postman; support varies.

- Resource `ui://picoforge/viewport` (`text/html;profile=mcp-app`): a slim build of `ViewportEngine` at the T0 profile (raster, baked shading, no path tracing).
- Linked from `run_build`, `get_scene` and `capture_viewport` through tool metadata. `VERIFY:` exact `_meta` field names and the `App` class methods in `@modelcontextprotocol/ext-apps` before implementing.
- Geometry reaches the view through a tool call via the host bridge (`get_mesh {artifactId, lod}` returning a quantised GLB, capped at 2 MB (est.)), not by fetching `127.0.0.1`, which the iframe's content policy may block.
- Hosts without MCP Apps still get the text result, and the desktop UI updates as usual.

## 8. Long-running work

- Builds that finish within about 20 s return their result directly and send progress notifications if the client supplied a progress token.
- Longer builds and studies return a handle (`runId` / `studyId`) immediately; the agent polls `get_run` / `get_study`. This works in every client. The Tasks extension may be added where supported.

## 9. Enforcement and limits

| Limit | Default |
|---|---|
| Compile / runtime / geometry repairs per brief | 3 / 2 / 2 |
| Build-type tool calls per brief | 14 |
| Builds per minute per client | 6 |
| Concurrent runs per variant | 1 (fork a variant to parallelise) |

Exceeding a limit returns `NEEDS_DECISION` with options, never a silent failure.

## 10. Presence and attribution

- Each client is recorded in `agent_clients` from its `clientInfo`; the top bar shows `AGENTS n`; Settings → MCP connections lists them with a Revoke button.
- Every run, edit and annotation carries `origin` (`mcp:claude-code` etc.) and shows a small mono chip in the UI.
- Agent edits undo as one group per tool call.

## 11. Security

Localhost bind and token for HTTP; stdio inherits the token from the keyfile. Agents can never: read or write settings or keys, clear the cache, delete projects, see file-system paths (only artifact URLs), run code outside the contract, remove a human's pin, or move the human's camera. All MCP calls are logged with area `mcp` and client name, without payload secrets.

## 12. Acceptance (phase P6 gate)

1. MCP Inspector lists every tool, resource and prompt; schemas validate.
2. Claude Code and one other client each: load `forge_engineer` → `open_project` → brief → parts → assemble → final build → part visible in the open desktop UI with origin chip → STL exported. No code changes between clients.
3. Enforcement drills `MCP-01..06` (11 §3) pass.
4. On a host with MCP Apps, the inline view shows the part.
