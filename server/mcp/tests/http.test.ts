// MCP-HTTP-01..03 (docs/14 §2, §5, §6, §11): the Streamable HTTP endpoint, stateless JSON mode.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { currentClient, handleMcpRequest } from "../server.ts";
import type { McpDeps } from "../agentTools.ts";

const deps: McpDeps = { dataDir: ".", emit: () => {}, emitAll: () => {} };

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
  headers: Record<string, string> = {},
) {
  return new Request("http://127.0.0.1:7317/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

async function result(res: Response): Promise<Record<string, unknown>> {
  assertEquals(res.status, 200, await res.clone().text());
  const msg = await res.json();
  assert(msg.result, JSON.stringify(msg));
  return msg.result;
}

Deno.test("MCP-HTTP-01 initialize, tools/list, resources and the forge_engineer prompt", async () => {
  const init = await result(
    await handleMcpRequest(
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1" },
      }),
      deps,
    ),
  );
  assertEquals((init.serverInfo as { name: string }).name, "picoforge");
  assert(String(init.instructions).includes("picoforge://guide"));
  assertEquals(currentClient(), "test-client"); // origin chip for later stateless calls

  const list = await result(await handleMcpRequest(rpc("tools/list"), deps));
  const tools = list.tools as Array<{ name: string; inputSchema: { required?: string[] } }>;
  const names = tools.map((t) => t.name);
  for (
    const n of [
      "open_project",
      "post_message",
      "submit_design_brief",
      "run_picogk",
      "capture_viewport",
      "export_artifact",
    ]
  ) {
    assert(names.includes(n), `missing tool ${n}`);
  }
  const run = tools.find((t) => t.name === "run_picogk");
  assertEquals(run?.inputSchema.required, ["projectId", "code"]);

  const guide = await result(
    await handleMcpRequest(rpc("resources/read", { uri: "picoforge://guide" }), deps),
  );
  const text = (guide.contents as Array<{ text: string }>)[0].text;
  assert(text.includes("The code contract"));

  const card = await result(
    await handleMcpRequest(rpc("resources/read", { uri: "picoforge://api/kit-card" }), deps),
  );
  assert((card.contents as Array<{ text: string }>)[0].text.includes("voxAxialRotor"));

  const prompt = await result(
    await handleMcpRequest(
      rpc("prompts/get", {
        name: "forge_engineer",
        arguments: { goal: "quiet 3 inch prop" },
      }),
      deps,
    ),
  );
  assert(JSON.stringify(prompt.messages).includes("quiet 3 inch prop"));
});

Deno.test("MCP-HTTP-02 a tool error comes back as an isError result, not a protocol error", async () => {
  const r = await result(
    await handleMcpRequest(rpc("tools/call", { name: "run_picogk", arguments: {} }), deps),
  );
  assertEquals(r.isError, true);
  assert(JSON.stringify(r.content).includes("INVALID_INPUT"));
});

Deno.test("MCP-HTTP-03 GET is 405 (stateless, no SSE stream); a foreign browser Origin is 403", async () => {
  const get = await handleMcpRequest(new Request("http://127.0.0.1:7317/mcp"), deps);
  assertEquals(get.status, 405);
  await get.body?.cancel();
  const evil = await handleMcpRequest(
    rpc("tools/list", {}, 1, { Origin: "https://evil.example" }),
    deps,
  );
  assertEquals(evil.status, 403);
  await evil.body?.cancel();
  const local = await handleMcpRequest(
    rpc("tools/list", {}, 1, { Origin: "http://localhost:5173" }),
    deps,
  );
  assertEquals(local.status, 200);
  await local.body?.cancel();
});
