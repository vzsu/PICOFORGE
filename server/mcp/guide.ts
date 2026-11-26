// server/mcp/guide.ts — the one-file agent guide (PICOFORGE_AGENT_GUIDE.md): served as the MCP
// resource picoforge://guide and the forge_engineer prompt. Its worked examples are executable:
// GUIDE-01 validates every brief and lints every file; `deno task guide:check` builds them for real.

const GUIDE_URL = new URL("../../PICOFORGE_AGENT_GUIDE.md", import.meta.url);

let cached: string | null = null;

export async function loadGuide(): Promise<string> {
  cached ??= await Deno.readTextFile(GUIDE_URL);
  return cached;
}

export interface GuideExample {
  name: string;
  /** Parsed JSON brief (validated by the brief tool, not here). */
  brief: Record<string, unknown>;
  code: string;
}

const EXAMPLE =
  /<!-- example: ([\w-]+) -->\s*```json\r?\n([\s\S]*?)```\s*```csharp\r?\n([\s\S]*?)```/g;

/** Every `<!-- example: name -->` followed by a ```json brief and a ```csharp design file. */
export function parseExamples(markdown: string): GuideExample[] {
  const out: GuideExample[] = [];
  for (const m of markdown.matchAll(EXAMPLE)) {
    const brief: unknown = JSON.parse(m[2]);
    if (typeof brief !== "object" || brief === null || Array.isArray(brief)) {
      throw new Error(`guide example ${m[1]}: brief is not a JSON object`);
    }
    out.push({ name: m[1], brief: { ...brief }, code: m[3] });
  }
  return out;
}
