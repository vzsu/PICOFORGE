// server/db/repo/settings.ts — Settings repository
// DATA_SCHEMA §3 + §5

import { z } from "zod";
import { getDb, withTx } from "../db.ts";
import { jsonCol } from "../rows.ts";
import { EFFORT_BY_MODE, EffortSchema } from "../../domain/modes.ts";

// ─── Default settings ─────────────────────────────────────────────────────────

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** docs/13 §2: 64k output tokens per streamed turn (truncation costs a repair turn). */
const MAX_OUTPUT_TOKENS = 64_000;

/** Settings → Models and keys: one effort per composer mode (docs/02 §6, docs/13 §2). */
const EffortByModeSchema = z.object({
  low: EffortSchema.default(EFFORT_BY_MODE.low),
  std: EffortSchema.default(EFFORT_BY_MODE.std),
  deep: EffortSchema.default(EFFORT_BY_MODE.deep),
  raman: EffortSchema.default(EFFORT_BY_MODE.raman),
});

// No temperature: sampling parameters return a 400 on current models (migration 0003 drops it).
export const SettingsSchema = z.object({
  model: z.string().default("claude-opus-5-5"),
  maxOutputTokens: z.number().int().min(1024).max(MAX_OUTPUT_TOKENS).default(MAX_OUTPUT_TOKENS),
  effortByMode: EffortByModeSchema.default({}),
  /** Fast mode (`speed: "fast"`, premium price) on models that support it. */
  fastResponses: z.boolean().default(false),
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
  /** Appearance: hover/selection colour (docs/02: the red accent stays reserved for live state). */
  ui: z.object({ selectColor: HEX.default("#0A84FF") }).default({}),
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
  maxOutputTokens: z.number().int().min(1024).max(MAX_OUTPUT_TOKENS).optional(),
  effortByMode: z.object({
    low: EffortSchema.optional(),
    std: EffortSchema.optional(),
    deep: EffortSchema.optional(),
    raman: EffortSchema.optional(),
  }).optional(),
  fastResponses: z.boolean().optional(),
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
  ui: z.object({ selectColor: HEX.optional() }).optional(),
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
    effortByMode: { ...current.effortByMode, ...patch.effortByMode },
    retention: { ...current.retention, ...patch.retention },
    renderer: { ...current.renderer, ...patch.renderer },
    ui: { ...current.ui, ...patch.ui },
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
