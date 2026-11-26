// scripts/mcp_connect.ts — `deno task mcp:connect`: print the commands that connect an AI agent to
// the running PicoForge over MCP (docs/14 §2, docs/15 §2). The token lives in
// ~/PicoForge/secret.env (created on first use) and is printed to this terminal only, never logged.

import { join } from "jsr:@std/path@^1.0.0";
import { ensureMcpToken } from "../server/config.ts";

const home = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
const dataDir = Deno.env.get("DATA_DIR") ?? join(home, "PicoForge");
const port = Deno.env.get("PORT") ?? "7317";
const url = `http://127.0.0.1:${port}/mcp`;
const token = await ensureMcpToken(dataDir);

const json = (o: unknown) => JSON.stringify(o, null, 2);

console.log(`
PicoForge MCP server: ${url}
Start PicoForge first (deno task start). Then connect your agent:

Claude Code
  claude mcp add --transport http picoforge ${url} --header "X-PicoForge-Token: ${token}"

Cursor (.cursor/mcp.json) / VS Code (.vscode/mcp.json: use "servers" and add "type": "http")
${json({ mcpServers: { picoforge: { url, headers: { "X-PicoForge-Token": token } } } })}

Then ask the agent, for example:
  Using the picoforge MCP server, read picoforge://guide, open project "FPV props" and design a quiet
  3-blade propeller for a 3 inch FPV drone. Post my request and your plan in PicoForge, submit a
  brief, build it, look at it with capture_viewport and report the key numbers.

Keep the token private: anyone with it can build on this machine. It is stored in
${join(dataDir, "secret.env")} (PICOFORGE_MCP_TOKEN); delete that line to issue a new one.
`);
