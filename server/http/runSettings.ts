// server/http/runSettings.ts — stored settings + the composer's mode → what one run sends to the model
// (docs/13 §2). Pure; the router reads the settings, this decides.

import type { Settings } from "../db/repo/settings.ts";
import { DEFAULT_MODEL, isKnownModel, supportsFast } from "../harness/anthropic.ts";
import type { RunSettings } from "../harness/orchestrator.ts";
import { DEFAULT_MODE, type Mode } from "../domain/modes.ts";

/**
 * - model: the stored one if it is in the catalog, else the default (a stale id would 404 or bill a
 *   model the user never picked);
 * - effort: Settings' effort for this mode (no mode → STD);
 * - speed "fast": only when the user turned it on and the model supports it (an error otherwise).
 */
export function resolveRunSettings(s: Settings, mode: Mode = DEFAULT_MODE): RunSettings {
  const model = isKnownModel(s.model) ? s.model : DEFAULT_MODEL;
  return {
    model,
    maxTokens: s.maxOutputTokens,
    effort: s.effortByMode[mode],
    ...(s.fastResponses && supportsFast(model) ? { speed: "fast" as const } : {}),
  };
}
