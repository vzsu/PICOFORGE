// server/harness/tools/searchDocs.ts — tool 5.1
// LLM_HARNESS §5.1: FTS5 bm25 over kb_fts, returns [{title, section, content}]
// Primary: SQLite FTS5 via db/repo/kb.ts. Fallback (no DB open, or no KB hit): keyword search
// over the archive spec docs, so the agent gets real reference text before the KB is ingested.

import { err, makeDef, ok, type ToolModule, z } from "./_base.ts";
import { kbSearch } from "../../db/repo/kb.ts";

const zodInput = z.object({
  query: z.string().min(1).max(512),
  k: z.number().int().min(1).max(8).default(5),
});

type Input = z.infer<typeof zodInput>;

const jsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    k: { type: "integer", minimum: 1, maximum: 8, default: 5 },
  },
  required: ["query"],
};

export interface DocHit {
  title: string;
  section: string;
  content: string;
  source: string;
}

/** Hits are pasted into the model context: keep each one bounded. */
const MAX_HIT_CHARS = 1500;

/** Query → lowercase word tokens (≥ 2 chars, max 8). Strips every FTS5 operator character. */
export function queryTokens(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
  return [...new Set(words)].slice(0, 8);
}

/** Tokens → FTS5 MATCH expression: each token quoted, OR-ed, so bm25 ranks by coverage. */
function ftsQuery(tokens: string[]): string {
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

function clip(text: string): string {
  return text.length > MAX_HIT_CHARS ? `${text.slice(0, MAX_HIT_CHARS)}…` : text;
}

/** FTS5 search; `null` when no DB is open (headless runs, tests without a DB). */
function searchKb(tokens: string[], k: number): DocHit[] | null {
  try {
    return kbSearch(ftsQuery(tokens), k).map((r) => ({
      title: r.title,
      section: r.section,
      content: clip(r.content),
      source: r.source,
    }));
  } catch {
    return null;
  }
}

// ─── Archive docs fallback ───────────────────────────────────────────────────

interface DocSection {
  title: string;
  section: string;
  content: string;
  lower: string;
}

const ARCHIVE_DIR = new URL("../../../docs/archive/", import.meta.url);
let archiveCache: DocSection[] | null = null;

/** Split each archive markdown file into `##`/`###` sections (loaded once, ~200 KB). */
async function archiveSections(): Promise<DocSection[]> {
  if (archiveCache) return archiveCache;
  const out: DocSection[] = [];
  try {
    for await (const entry of Deno.readDir(ARCHIVE_DIR)) {
      if (!entry.isFile || !/\.md$/i.test(entry.name)) continue;
      const text = await Deno.readTextFile(new URL(entry.name, ARCHIVE_DIR));
      const title = entry.name.replace(/\.md$/i, "");
      let section = "intro";
      let buf: string[] = [];
      const flush = () => {
        const content = buf.join("\n").trim();
        if (content) out.push({ title, section, content, lower: content.toLowerCase() });
        buf = [];
      };
      for (const line of text.split(/\r?\n/)) {
        const h = /^#{2,3}\s+(.*)$/.exec(line);
        if (h) {
          flush();
          section = h[1].trim();
        }
        buf.push(line);
      }
      flush();
    }
  } catch {
    // Docs not shipped alongside the binary: the fallback simply has nothing to offer
  }
  archiveCache = out;
  return out;
}

/** Rank by number of distinct query tokens present, then by total occurrences. */
async function searchArchive(tokens: string[], k: number): Promise<DocHit[]> {
  const scored: Array<{ s: DocSection; covered: number; freq: number }> = [];
  for (const s of await archiveSections()) {
    let covered = 0;
    let freq = 0;
    for (const t of tokens) {
      const n = s.lower.split(t).length - 1;
      if (n > 0) covered++;
      freq += n;
    }
    if (covered > 0) scored.push({ s, covered, freq });
  }
  scored.sort((a, b) => b.covered - a.covered || b.freq - a.freq);
  return scored.slice(0, k).map(({ s }) => ({
    title: s.title,
    section: s.section,
    content: clip(s.content),
    source: "docs",
  }));
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const searchDocsTool: ToolModule<Input> = {
  name: "search_docs",
  description:
    "Full-text search over the local PicoGK/Kit API reference, engineering recipes (turbine, bracket, heat exchanger, gear, enclosure...), and the physics formula pack. Use before coding anything unfamiliar. Query with 2-6 keywords.",
  zodInput,
  jsonSchema,
  def: makeDef(
    "search_docs",
    "Full-text search over the local PicoGK/Kit API reference, engineering recipes (turbine, bracket, heat exchanger, gear, enclosure...), and the physics formula pack. Use before coding anything unfamiliar. Query with 2-6 keywords.",
    jsonSchema,
  ),

  async execute(input) {
    try {
      const parsed = zodInput.safeParse(input);
      if (!parsed.success) return err(new Error(`search_docs validation: ${parsed.error.message}`));
      const { query, k } = parsed.data;

      const tokens = queryTokens(query);
      if (tokens.length === 0) return ok([]);

      const kbHits = searchKb(tokens, k);
      if (kbHits && kbHits.length > 0) return ok(kbHits);
      return ok(await searchArchive(tokens, k));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  },
};
