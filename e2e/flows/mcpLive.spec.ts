// e2e/flows/mcpLive.spec.ts — UI-FLOW-mcp-live (docs/14 §12 acceptance 2, P6 pulled forward).
// A scripted MCP agent (plain JSON-RPC over HTTP, like Claude Code) drives the real server and engine
// while the studio is open: its request, the brief, the build and the part appear live in the window,
// and capture_viewport returns a PNG of the part. No model, no API key: the agent is the test.

import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LiveServer, ROOT, startLiveServer } from "./liveServer.ts";

const PORT = Number(process.env.PF_MCP_FLOW_PORT ?? 7418);
const MCP_TOKEN = "e2e-mcp-token-0123456789abcdef";
const REQUEST = "Make a quiet 3-blade propeller for a 3 inch FPV drone.";

let srv: LiveServer | null = null;

/** The guide's prop3 example: the same brief and code an agent learns from. */
function guideExample(name: string): { brief: Record<string, unknown>; code: string } {
  const md = readFileSync(join(ROOT, "PICOFORGE_AGENT_GUIDE.md"), "utf8");
  const re = new RegExp(`<!-- example: ${name} -->\\s*\`\`\`json\\r?\\n([\\s\\S]*?)\`\`\`\\s*\`\`\`csharp\\r?\\n([\\s\\S]*?)\`\`\``);
  const m = re.exec(md);
  if (!m) throw new Error(`guide example ${name} missing`);
  return { brief: JSON.parse(m[1]), code: m[2] };
}

let rpcId = 0;
async function mcp(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${srv!.origin}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      "X-PicoForge-Token": MCP_TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  const msg = await res.json();
  expect(msg.error).toBeUndefined();
  return msg.result;
}

async function tool(name: string, args: Record<string, unknown>) {
  const r = await mcp("tools/call", { name, arguments: args });
  const text = r.content.find((c: { type: string }) => c.type === "text")?.text;
  return { raw: r, body: text ? JSON.parse(text) : null };
}

test.describe("UI-FLOW-mcp-live", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    srv = await startLiveServer(PORT, { PICOFORGE_MCP_TOKEN: MCP_TOKEN });
  });

  test.afterAll(() => {
    srv?.stop();
    srv = null;
  });

  test("UI-FLOW-mcp-live agent request → brief → build → capture, shown live in the studio", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(`${srv!.origin}/?t=${srv!.token}`);
    await expect(page.getByTestId("save-indicator")).toContainText("Connected", { timeout: 15_000 });

    // a request without the token is refused
    const anon = await fetch(`${srv!.origin}/mcp`, { method: "POST", body: "{}" });
    expect(anon.status).toBe(401);

    const init = await mcp("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "e2e-agent", version: "1.0" },
    });
    expect(init.serverInfo.name).toBe("picoforge");

    const t0 = Date.now();
    const { body: opened } = await tool("open_project", {});
    const projectId = opened.projectId;
    expect(projectId).toBeTruthy();

    await tool("post_message", { projectId, kind: "request", text: REQUEST });
    await expect(page.getByTestId("msg-user").last()).toContainText("3 inch FPV");
    await expect(page.getByTestId("msg-origin").first()).toContainText("e2e-agent");
    await tool("post_message", { projectId, kind: "plan", text: "Plan: 76.2 mm, 3 blades, 2 inch pitch, PA12." });
    await expect(page.getByTestId("msg-assistant").last()).toContainText("2 inch pitch");

    const ex = guideExample("prop3");
    const { body: brief } = await tool("submit_design_brief", { projectId, ...ex.brief });
    expect(brief.accepted).toBe(true);
    await expect(page.getByTestId("brief-card")).toBeVisible();
    await expect(page.getByTestId("brief-row-blade_count")).toContainText("3");

    const { body: built } = await tool("run_picogk", { projectId, code: ex.code });
    expect(built.ok).toBe(true);
    expect(built.stats.watertight).toBe(true);
    const tBuilt = Date.now() - t0;

    await expect(page.getByTestId("viewport")).toHaveAttribute("data-viewport-ready", "true", { timeout: 60_000 });
    const vol = Number(await page.getByTestId("dro-volume").textContent());
    expect(vol).toBeGreaterThan(0.5);
    await expect(page.getByTestId("status-line")).toHaveAttribute("data-status", "done");
    await expect(page.getByTestId("agents-chip")).toContainText("AGENTS 1");

    // the agent looks at what it built (the user's camera is not moved)
    const { raw: shot } = await tool("capture_viewport", { projectId, view: "iso" });
    const img = shot.content.find((c: { type: string }) => c.type === "image");
    expect(img?.mimeType).toBe("image/png");
    const png = Buffer.from(img.data, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(2_000);

    await tool("post_message", { projectId, kind: "report", text: `Built: ${built.stats.volumeCm3} cm³, watertight.` });
    await expect(page.getByTestId("msg-assistant").last()).toContainText("watertight");

    mkdirSync(join(ROOT, "reports/ui"), { recursive: true });
    writeFileSync(join(ROOT, "reports/ui/mcp-capture-iso.png"), png);
    await page.screenshot({ path: join(ROOT, "reports/ui/flow-mcp-live.png") });
    const numbers = { id: "UI-FLOW-mcp-live", requestToBuiltMs: tBuilt, volumeCm3: vol, capturePngBytes: png.length, consoleErrors };
    writeFileSync(join(ROOT, "reports/ui/flow-mcp-live.json"), JSON.stringify(numbers, null, 2));
    console.log(JSON.stringify(numbers));
    expect(consoleErrors).toEqual([]);
  });
});
