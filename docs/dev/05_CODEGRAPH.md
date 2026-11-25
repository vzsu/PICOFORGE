# Dev 05 · Codegraph: knowing what the project connects to

[codegraph](https://github.com/colbymchenry/codegraph) builds a local, pre-indexed graph of the code (symbols, calls, imports, dependencies) and serves it to agents over MCP, so an agent can find code and understand the effect of a change in a few calls instead of many file reads. It runs locally and supports both languages in this repo (TypeScript and C#, among others).

It replaces graphify, which the old repo used (`graphify-out/`, `.graphifyignore`, the graphify section of `AGENTS.md`). The switch is recorded as ADR-001 (see `templates/BACKLOG_SEED.md`).

## 1. Install and set up

From the codegraph README:

```sh
# install the CLI (pick one)
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh     # macOS / Linux
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex           # Windows PowerShell
npm i -g @colbymchenry/codegraph                                                               # if Node is present

# open a new terminal, then wire it into your agents (Claude Code and others)
codegraph install

# index this repo (creates .codegraph/ and builds the full graph)
cd picoforge
codegraph init
```

- Auto-sync is on by default: codegraph watches the project and updates the graph on file changes.
- Add `.codegraph/` to `.gitignore` (the index is local and rebuilt per machine).
- The installer writes a marker-fenced codegraph section into `CLAUDE.md`. Keep it below our own content and check it does not contradict our rules.
- Upgrade: `codegraph upgrade`. Remove from a project: `codegraph uninit`.

`VERIFY:` the following details came from a summary of the README, not its verbatim text. Confirm them with `codegraph --help` and the MCP tool list after install:
- MCP tools: `codegraph_explore` by default; `codegraph_node`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, `codegraph_status` enabled through the `CODEGRAPH_MCP_TOOLS` environment variable.
- CLI: `status`, `sync`, `index --force`, `query`, `explore`, `context`, `callers`, `callees`, `impact`, `implementations`, `cycles`, `affected`.
- Index file `.codegraph/codegraph.db`; watcher debounce `CODEGRAPH_WATCH_DEBOUNCE_MS` (default 2000).

## 2. When to use it (rules for agents in this repo)

| Situation | Ask codegraph | Then |
|---|---|---|
| "Where is X?" | explore / search | Open only the files it names |
| Before changing a function or type | callers + impact | List affected modules and tests in the devlog |
| Before changing a zod schema in `server/domain` | impact | Expect changes in server, app protocol and MCP; update all in one commit |
| Choosing which tests to run | affected (from changed files) | Run those first, then the full check |
| New module added | status | Confirm it is indexed |
| Weekly | cycles | Any new cycle is a backlog item; module directions in `docs/05` §1 must hold |
| Onboarding a new agent | explore "run pipeline from chat.send to geometry.ready" | Read the answer before touching harness or preview code |

Use grep only for literal strings (log messages, error codes, test IDs) where a symbol graph does not help.

## 3. Questions worth asking on this codebase

- "Trace a command from `bus.dispatch` to the WS `scene.patch` broadcast."
- "Which modules import `server/harness/anthropic.ts`?" (must be only the harness)
- "Which code reads `ctx.P` parameters for part `arms`?" (C# side, Kit)
- "What calls `withTx`, and do any of those callers call the engine inside it?" (forbidden)
- "Show the dependency path from `app/src/features` to three.js." (must go through `viewport/`)

## 4. Keeping the map honest

- If an answer looks wrong or stale, run `codegraph status`, then `codegraph sync` (or `index --force` for a full rebuild), and note `LESSON:` in the devlog if it misled you.
- The module-direction lint (docs/05 §1) is the enforcement; codegraph is how you see it.
