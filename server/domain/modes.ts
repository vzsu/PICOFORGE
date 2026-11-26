// server/domain/modes.ts — run modes and model effort (docs/13 §2, §8). Wire contract: the composer
// sends a mode with each message, Settings stores one effort per mode. Self-contained (zod only) so
// `deno task gen:protocol` can copy it to app/src/protocol/.

import { z } from "zod";

export const ModeSchema = z.enum(["low", "std", "deep", "raman"]);
export type Mode = z.infer<typeof ModeSchema>;
export const MODES: readonly Mode[] = ModeSchema.options;

/** `output_config.effort` values the Messages API accepts. */
export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;
export const EFFORTS: readonly Effort[] = EffortSchema.options;

/** docs/13 §2: LOW low · STD medium · DEEP high · RAMAN high. Opus 5.5 defaults to medium, so the
 * harness always sends it. */
export const EFFORT_BY_MODE: Readonly<Record<Mode, Effort>> = {
  low: "low",
  std: "medium",
  deep: "high",
  raman: "high",
};

/** A message sent without a mode runs as STD. */
export const DEFAULT_MODE: Mode = "std";
