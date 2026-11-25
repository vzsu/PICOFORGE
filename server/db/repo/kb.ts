// server/db/repo/kb.ts — Knowledge base repository
// DATA_SCHEMA §3 + §4.5: FTS5 search for the search_docs tool

import { z } from "zod";
import { ulid } from "../../domain/ids.ts";
import { getDb, withTx } from "../db.ts";
import { jsonCol, jsonObject } from "../rows.ts";

export const KbSourceSchema = z.enum(["picogk_api", "kit", "recipes", "physics", "picogk_docs"]);
export type KbSource = z.infer<typeof KbSourceSchema>;

export interface KbDoc {
  id: string;
  source: KbSource;
  title: string;
  section: string;
  content: string;
  metaJson: Record<string, unknown>;
}

export interface KbSearchResult {
  id: string;
  source: KbSource;
  title: string;
  section: string;
  content: string;
  score: number;
}

const KbDocRow = z.object({
  id: z.string(),
  source: KbSourceSchema,
  title: z.string(),
  section: z.string(),
  content: z.string(),
  meta_json: jsonCol(jsonObject),
}).transform((r): KbDoc => ({
  id: r.id,
  source: r.source,
  title: r.title,
  section: r.section,
  content: r.content,
  metaJson: r.meta_json,
}));

const KbHitRow = z.object({
  id: z.string(),
  source: KbSourceSchema,
  title: z.string(),
  section: z.string(),
  content: z.string(),
  score: z.number(),
});

function rowToDoc(row: unknown): KbDoc {
  return KbDocRow.parse(row);
}

export function kbDocUpsert(
  source: KbSource,
  title: string,
  section: string,
  content: string,
  meta: Record<string, unknown> = {},
): KbDoc {
  const id = ulid();
  const now = Date.now();
  // Use a deterministic hash key for upsert: source+title+section identifies the chunk
  withTx((db) => {
    // Delete old doc with same source+title+section to let trigger remove from FTS
    db.prepare("DELETE FROM kb_docs WHERE source=? AND title=? AND section=?").run(
      source,
      title,
      section,
    );
    db.prepare(
      `INSERT INTO kb_docs(id,source,title,section,content,meta_json)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, source, title, section, content, JSON.stringify({ ...meta, ingestedAt: now }));
  });
  return { id, source, title, section, content, metaJson: meta };
}

/** FTS5 search — DATA_SCHEMA §4.5: bm25 ranked, limit 6 */
export function kbSearch(query: string, limit = 6): KbSearchResult[] {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT d.id, d.source, d.title, d.section, d.content,
                bm25(kb_fts) AS score
         FROM kb_fts
         JOIN kb_docs d ON d.rowid = kb_fts.rowid
         WHERE kb_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(query, limit);
    return z.array(KbHitRow).parse(rows);
  } catch {
    // FTS5 not available or query syntax error — return empty
    return [];
  }
}

export function kbDocList(source?: KbSource): KbDoc[] {
  const db = getDb();
  const rows = source
    ? db.prepare("SELECT * FROM kb_docs WHERE source=? ORDER BY title").all(source)
    : db.prepare("SELECT * FROM kb_docs ORDER BY source,title").all();
  return rows.map(rowToDoc);
}

export function kbDocCount(): number {
  const db = getDb();
  const row = z.object({ n: z.number() }).optional().parse(
    db.prepare("SELECT COUNT(*) AS n FROM kb_docs").get(),
  );
  return row?.n ?? 0;
}
