// server/db/rows.ts — zod helpers for SQLite rows (CLAUDE.md #2: validate every boundary, no `as`).
// A row that fails its schema is a corrupt or out-of-date database: failure row F8 (docs/04 §7).

import { z } from "zod";

function parseJsonText(s: string, ctx: z.RefinementCtx): unknown {
  try {
    const v: unknown = JSON.parse(s);
    return v;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "column is not valid JSON" });
    return z.NEVER;
  }
}

/** TEXT column holding JSON, parsed and validated with `schema`. */
export function jsonCol<T extends z.ZodTypeAny>(schema: T) {
  return z.string().transform(parseJsonText).pipe(schema);
}

/** Nullable TEXT JSON column; NULL or "" → null. */
export function jsonColOrNull<T extends z.ZodTypeAny>(schema: T) {
  return z.string().nullable().transform((s, ctx) => (s ? parseJsonText(s, ctx) : null)).pipe(
    schema.nullable(),
  );
}

/** INTEGER 0/1 column → boolean. */
export const bool01 = z.number().int().transform((n) => n !== 0);

/** Nullable INTEGER 0/1 column → boolean | null. */
export const bool01OrNull = z.number().int().nullable().transform((
  n,
) => (n === null ? null : n !== 0));

export const textOrNull = z.string().nullable();
export const intOrNull = z.number().nullable();
export const jsonObject = z.record(z.unknown());
