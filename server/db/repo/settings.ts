// server/db/repo/settings.ts — Settings repository
// DATA_SCHEMA §3 + §5

import { z } from "zod";
import { getDb, withTx } from "../db.ts";
import { jsonCol } from "../rows.ts";

// ─── Default settings ─────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  model: z.string().default("claude-sonnet-4-6"),
  temperature: z.number().min(0).max(1).default(1.0),
  maxOutputTokens: z.number().int().min(512).max(8192).default(4096),
  maxRepairAttempts: z.number().int().min(1).max(10).default(3),
  voxelCellCapHard: z.number().default(1_500_000_000),
  voxelCellCapWarn: z.number().default(250_000_000),
  runTimeoutS: z.number().int().min(10).max(300).default(120),
  maxRssMiB: z.number().int().min(512).max(32768).default(8192),
  retention: z
    .object({
      runsPerProject: z.number().int().min(1).default(50),
      maxBytes: z.number().default(10_000_000_000),
    })
    .default({}),
  renderer: z
    .object({
      preferWebGPU: z.boolean().default(false),
      ptMaxSamples: z.number().int().default(256),
      ptEnabled: z.boolean().default(true),
    })
    .default({}),
  telemetry: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/**
 * A settings change: every field optional, no defaults, nested objects partial. Defaults belong to
 * the stored document only: SettingsSchema.partial() would fill nested defaults into a patch and
 * reset untouched siblings (SETTINGS-PATCH-01).
 */
export const SettingsPatchSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().min(512).max(8192).optional(),
  maxRepairAttempts: z.number().int().min(1).max(10).optional(),
  voxelCellCapHard: z.number().optional(),
  voxelCellCapWarn: z.number().optional(),
  runTimeoutS: z.number().int().min(10).max(300).optional(),
  maxRssMiB: z.number().int().min(512).max(32768).optional(),
  retention: z.object({
    runsPerProject: z.number().int().min(1).optional(),
    maxBytes: z.number().optional(),
  }).optional(),
  renderer: z.object({
    preferWebGPU: z.boolean().optional(),
    ptMaxSamples: z.number().int().optional(),
    ptEnabled: z.boolean().optional(),
  }).optional(),
  telemetry: z.boolean().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// ─── Queries ──────────────────────────────────────────────────────────────────

export function settingsGet(): Settings {
  const db = getDb();
  const rows = db.prepare("SELECT key,value_json FROM settings").all();
  const kv: Record<string, unknown> = {};
  for (
    const r of z.array(z.object({ key: z.string(), value_json: jsonCol(z.unknown()) })).parse(rows)
  ) {
    kv[r.key] = r.value_json;
  }
  return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...kv });
}

export function settingsSet(patch: SettingsPatch): Settings {
  const now = Date.now();
  const current = settingsGet();
  const merged = SettingsSchema.parse({
    ...current,
    ...patch,
    retention: { ...current.retention, ...patch.retention },
    renderer: { ...current.renderer, ...patch.renderer },
  });
  withTx((db) => {
    for (const [key, value] of Object.entries(merged)) {
      db.prepare(
        `INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
      ).run(key, JSON.stringify(value), now);
    }
  });
  return merged;
}
