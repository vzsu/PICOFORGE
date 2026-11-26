// server/mcp/server.ts — PicoForge as an MCP server (docs/14). Streamable HTTP at /mcp on the running
// app, stateless (no transport sessions: every state-changing tool takes projectId, docs/14 §2).
// Built on the SDK's low-level Server so tool schemas come straight from the harness tools
// (docs/14 §1 law 2: one schema source) instead of being re-declared for McpServer.
// VERIFY (docs/14 §2): SDK 1.32.2 negotiates protocol versions up to 2025-11-25.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AGENT_TOOLS, callAgentTool, type McpDeps } from "./agentTools.ts";
import { loadGuide } from "./guide.ts";
import { loadApiManifest, renderApiCard } from "../harness/prompts/apiCard.ts";
import { makeLogger } from "../log.ts";

const log = makeLogger("mcp");

export const MCP_SERVER_NAME = "picoforge";
const VERSION = "0.1.0";

const INSTRUCTIONS =
  "PicoForge builds real 3D parts from a design brief plus C# code on the PicoGK voxel kernel, and shows every step live in the user's PicoForge window. Before your first build read the resource picoforge://guide (or load the prompt forge_engineer): it has the working loop, the code contract, the API and worked examples. Loop: open_project → post_message(request, plan) → submit_design_brief → run_picogk → capture_viewport/inspect_geometry → post_message(report).";

const RESOURCES = [
  {
    uri: "picoforge://guide",
    name: "PicoForge agent guide",
    description:
      "Everything an agent needs: loop, brief, code contract, PicoGK/Kit API, worked examples, prompts.",
    mimeType: "text/markdown",
  },
  {
    uri: "picoforge://api/picogk-card",
    name: "PicoGK API card",
    description:
      "Exact PicoGK signatures a design file may use (generated from the installed PicoGK).",
    mimeType: "text/plain",
  },
  {
    uri: "picoforge://api/kit-card",
    name: "PicoForge.Kit API card",
    description: "Kit helper signatures (primitives, rotors, lattices, sweeps).",
    mimeType: "text/plain",
  },
] as const;

// The SDK validated these requests already; its zod/v4 types do not resolve under Deno, so the
// fields used here are re-read with our own schemas (no casts).
const callParams = z.object({
  params: z.object({ name: z.string(), arguments: z.record(z.unknown()).optional() }),
});
const readParams = z.object({ params: z.object({ uri: z.string() }) });
const promptParams = z.object({
  params: z.object({ name: z.string(), arguments: z.record(z.string()).optional() }),
});

/** Client name from the latest initialize (stateless HTTP: later calls do not carry it). */
let lastClient = "agent";

const initializeBody = z.object({
  method: z.literal("initialize"),
  params: z.object({ clientInfo: z.object({ name: z.string() }) }),
});

/**
 * Each stateless request gets a fresh Server, so `oninitialized` fires on an instance that never saw
 * `initialize`. Read the client's name from the initialize request itself.
 */
async function noteClient(req: Request): Promise<void> {
  try {
    const raw: unknown = await req.clone().json();
    for (const msg of Array.isArray(raw) ? raw : [raw]) {
      const init = initializeBody.safeParse(msg);
      if (init.success) {
        lastClient = cleanName(init.data.params.clientInfo.name);
        log.info("MCP client initialized", { client: lastClient });
      }
    }
  } catch {
    // not JSON: the transport answers with a parse error
  }
}

/** The origin label MCP work is attributed to ("mcp:<client>", docs/14 §10). */
export function currentClient(): string {
  return lastClient;
}

function cleanName(name: string | undefined): string {
  const n = (name ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return n.slice(0, 32) || "agent";
}

async function readResource(uri: string): Promise<string | null> {
  if (uri === "picoforge://guide") return await loadGuide();
  if (uri === "picoforge://api/picogk-card" || uri === "picoforge://api/kit-card") {
    const m = await loadApiManifest();
    if (!m) return "API manifest not generated yet (run engine/tools/DumpApi).";
    return renderApiCard(m, uri.endsWith("picogk-card") ? "PicoGK" : "PicoForge.Kit");
  }
  return null;
}

export function createMcpServer(deps: McpDeps): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: unknown) => {
    const { name, arguments: args } = callParams.parse(req).params;
    const r = await callAgentTool(name, args ?? {}, deps, lastClient);
    return { content: r.content, ...(r.isError ? { isError: true } : {}) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [...RESOURCES] }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req: unknown) => {
    const { uri } = readParams.parse(req).params;
    const text = await readResource(uri);
    if (text === null) throw new Error(`Unknown resource ${uri}`);
    const meta = RESOURCES.find((r) => r.uri === uri);
    return { contents: [{ uri, mimeType: meta?.mimeType ?? "text/plain", text }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{
      name: "forge_engineer",
      description: "Start a PicoForge design session: the full agent guide plus your goal.",
      arguments: [
        {
          name: "goal",
          description: "What to design, with sizes, loads, material.",
          required: false,
        },
        { name: "projectName", description: "Project to open or create.", required: false },
      ],
    }],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req: unknown) => {
    const { name, arguments: promptArgs } = promptParams.parse(req).params;
    if (name !== "forge_engineer") throw new Error(`Unknown prompt ${name}`);
    const goal = promptArgs?.goal?.trim();
    const project = promptArgs?.projectName?.trim();
    const text = [
      await loadGuide(),
      "---",
      "You are now the computational engineer for this session. Follow the loop above exactly.",
      project
        ? `Project: open_project {projectName: "${project}"}.`
        : "Project: open_project (the user's open project).",
      goal ? `Goal: ${goal}` : "Goal: ask the human what to design, then follow the loop.",
    ].join("\n\n");
    return {
      description: "PicoForge computational engineer",
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  });

  return server;
}

/** Only browsers send Origin; a page on another site must not reach the local server (rebinding). */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Handle one MCP HTTP request: a fresh server + transport per request (stateless mode). */
export async function handleMcpRequest(req: Request, deps: McpDeps): Promise<Response> {
  if (!originAllowed(req)) return new Response("Forbidden origin", { status: 403 });
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  await noteClient(req);
  const server = createMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}
