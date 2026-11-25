// server/db/repo/messages.ts — Message repository
// DATA_SCHEMA §3 + §5

import { z } from "zod";
import { ulid } from "../../domain/ids.ts";
import { getDb, withTx } from "../db.ts";
import { bool01, intOrNull, jsonCol } from "../rows.ts";

// ─── Content block schema (mirrors UI render + model replay) ──────────────────

export const ContentBlockSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("text"), text: z.string() }),
  z.object({ t: z.literal("brief"), brief: z.unknown() }),
  z.object({ t: z.literal("build"), runId: z.string() }),
  z.object({ t: z.literal("geometry"), artifactId: z.string() }),
  z.object({ t: z.literal("error"), code: z.string(), msg: z.string() }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ContentSchema = z.array(ContentBlockSchema);
export type Content = z.infer<typeof ContentSchema>;

// ─── Message type ─────────────────────────────────────────────────────────────

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: Content;
  createdAt: number;
  tokensIn: number | null;
  tokensOut: number | null;
  pinned: boolean;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

const MessageRow = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: MessageRoleSchema,
  content_json: jsonCol(ContentSchema),
  created_at: z.number(),
  tokens_in: intOrNull,
  tokens_out: intOrNull,
  pinned: bool01,
}).transform((r): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content_json,
  createdAt: r.created_at,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  pinned: r.pinned,
}));

function rowToMessage(row: unknown): Message {
  return MessageRow.parse(row);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function messageCreate(
  conversationId: string,
  role: MessageRole,
  content: Content,
  opts: { tokensIn?: number; tokensOut?: number } = {},
): Message {
  const now = Date.now();
  const id = ulid();
  withTx((db) => {
    db.prepare(
      `INSERT INTO messages(id,conversation_id,role,content_json,created_at,tokens_in,tokens_out,pinned)
       VALUES (?,?,?,?,?,?,?,0)`,
    ).run(
      id,
      conversationId,
      role,
      JSON.stringify(content),
      now,
      opts.tokensIn ?? null,
      opts.tokensOut ?? null,
    );
    db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now, conversationId);
  });
  return {
    id,
    conversationId,
    role,
    content,
    createdAt: now,
    tokensIn: opts.tokensIn ?? null,
    tokensOut: opts.tokensOut ?? null,
    pinned: false,
  };
}

/** Fetch last 50 messages for a conversation (DATA_SCHEMA §4.1) */
export function messageList(conversationId: string, after?: number): Message[] {
  const db = getDb();
  const rows = after
    ? db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id=? AND created_at>? ORDER BY created_at LIMIT 50",
      )
      .all(conversationId, after)
    : db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at LIMIT 50",
      )
      .all(conversationId);
  return rows.map(rowToMessage);
}

export function messageUpdateContent(
  id: string,
  content: Content,
  opts: { tokensIn?: number; tokensOut?: number } = {},
): void {
  withTx((db) => {
    db.prepare(
      `UPDATE messages SET content_json=?,tokens_in=COALESCE(?,tokens_in),tokens_out=COALESCE(?,tokens_out) WHERE id=?`,
    ).run(JSON.stringify(content), opts.tokensIn ?? null, opts.tokensOut ?? null, id);
  });
}
