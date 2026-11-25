# 15 · Agent usage guide (for agents that use PicoForge)

This file is written for an AI agent. It is also served as `picoforge://rules/doctrine` (shortened) and rendered for humans in `site/index.html`.

Replace `<PICOFORGE_REPO_URL>` with the repository URL and `<TOKEN>` with the token shown in PicoForge → Settings → MCP connections.

## 1. Install PicoForge

Prerequisites (check each; install what is missing, asking the human before installing system software):

| Tool | Check | Minimum |
|---|---|---|
| Deno | `deno --version` | 2.2 |
| .NET SDK | `dotnet --version` | 9.0 |
| Node.js (only to build the UI from source) | `node --version` | 20 |
| Git | `git --version` | any |

From source:

```sh
git clone <PICOFORGE_REPO_URL> picoforge
cd picoforge
deno task setup          # restores NuGet (PicoGK), builds the engine, generates the API card, ingests docs
deno task start          # starts picoforged on 127.0.0.1:7317 and opens the app window
deno run -A server/main.ts --selftest   # must exit 0
```

From a release: download `picoforged` for the platform, run it once (the first-run wizard asks for the API key and runs the self-test), then use it as below.

## 2. Connect your agent

**Recommended: stdio.** No token to copy; the client starts `picoforged --mcp`, which attaches to the running app.

Claude Code:
```sh
claude mcp add picoforge -- picoforged --mcp
# or over HTTP to a running app:
claude mcp add --transport http picoforge http://127.0.0.1:7317/mcp --header "X-PicoForge-Token: <TOKEN>"
```

Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.picoforge]
command = "picoforged"
args = ["--mcp"]
```

Gemini CLI (`~/.gemini/settings.json` or project `.gemini/settings.json`):
```json
{ "mcpServers": { "picoforge": { "command": "picoforged", "args": ["--mcp"] } } }
```

Cursor (`.cursor/mcp.json`):
```json
{ "mcpServers": { "picoforge": { "command": "picoforged", "args": ["--mcp"] } } }
```

VS Code (`.vscode/mcp.json`):
```json
{ "servers": { "picoforge": { "type": "stdio", "command": "picoforged", "args": ["--mcp"] } } }
```

`VERIFY:` each client's config syntax changes over time; check its own MCP docs if a snippet fails. After adding the server, reload MCP servers in the client (or restart the session) so the tools appear.

## 3. The working loop (follow it in order)

1. Load the prompt `forge_engineer` and read `picoforge://api/picogk-card` before writing any code.
2. `open_project` with the project name the human gave (or a sensible one).
3. If the human refers to something in the viewport, read `picoforge://session/selection` and `picoforge://session/pins`.
4. `search_docs` for a matching recipe and the relevant formulas.
5. `submit_design_brief`: category, envelope, material, process, parameters with expressions and rationale, targets, physics checks. Fix any violations it returns.
6. `define_part` once per part. Every dimension comes from `ctx.P("name")`; write the equation as a parameter expression, not a literal.
7. `assemble` with the `Design.Build` body (register parts, add ops).
8. `run_build {stage: "final"}`. If it returns a `runId`, poll `get_run`.
9. On failure, read `code` and `repairHint`; change only what the root cause needs; re-send only the failing part.
10. `inspect_geometry` to check what matters (wall thickness, key dimensions, mass).
11. Report to the human: what was built, key numbers with units and their analysis tier, anything not verified, and the next step you suggest.

## 4. Rules

- Never call a build before the brief is accepted.
- Never edit the code between the user-region markers.
- Never remove or work around a human pin; if a pin blocks the goal, explain and offer options.
- Use `baseRev` from your latest `get_scene`; on `STALE_REV`, re-read and re-apply.
- One run per variant. To try alternatives in parallel, `fork_variant`.
- Do not present estimates as measurements. A2 results are indicative.
- When you receive `NEEDS_DECISION`, stop and ask the human using the options provided.

## 5. Copy-paste prompts for humans to give their agent

**Bootstrap (install + connect):**
> Install and connect PicoForge. Check that Deno ≥ 2.2 and .NET SDK ≥ 9 are installed (ask me before installing anything). Clone `<PICOFORGE_REPO_URL>`, run `deno task setup`, start it with `deno task start`, and confirm the self-test passes. Then register the MCP server for this client using stdio (`picoforged --mcp`), reload MCP servers, and confirm the picoforge tools are listed. Finally load the `forge_engineer` prompt and summarise the working loop in five lines.

**Design something new:**
> Using the picoforge MCP server: load `forge_engineer`, open project "<name>", then design <description with sizes, loads, material, process>. Submit a brief first, define parts one at a time, assemble, run the final build, and inspect the result. Report volume, mass, minimum wall and any failed or unverified checks. Respect all pins.

**Change an existing design:**
> In picoforge project "<name>", variant "<variant>": call `get_scene`, then change <what> using `set_param` or `transform_part` with the current `baseRev`. Rebuild only what is affected, and report the before/after numbers.

**Optimise (Raman mode):**
> In picoforge project "<name>", start a RAMAN study on variant "<variant>" with goal: minimise mass, constraints: <list>. Poll `get_study` every minute, and when it stops, show me the ledger's best three rounds and which variant you recommend.

**Review:**
> Load the `forge_review` prompt for variant "<variant>" in project "<name>" and give me the review: loads, walls, overhangs, fits, mass, and the three most important fixes.

## 6. Example session (abridged)

```
→ open_project {projectName: "OneShotFly-Drone"}
← {projectId: "01JD…", variantId: "01JD…A", rev: 0, tier: "T0"}
→ search_docs {query: "fpv frame arm bending stiffness"}
→ submit_design_brief {variantId, category: "frame_fpv", envelope_mm: [240,240,40],
     material: "CF_3K_PLATE", process: "cnc_plate+print",
     parameters: [{name:"prop_d", expr:"5", unit:"in"}, {name:"arm_len", expr:"(prop_d*25.4/2)/sin(pi/4)+6"} …]}
← {accepted: true}
→ define_part {variantId, name: "plate", function_cs: "…", reads_params: ["stack","plate_t"]}
← {ok: true, draft: {volumeCm3: 21.4}}
→ define_part {name: "arms", …}
→ assemble {build_cs: "ctx.Result(ctx.Op(\"frame\", BoolOp.Union, \"plate\", \"arms\"));"}
→ run_build {stage: "final"}
← {ok: true, stats: {volumeCm3: 58.2, massG: 104.8, minWallMm: 2.1, watertight: true}}
```
