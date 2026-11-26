// RUN-SETTINGS-01..04: Settings + the composer's mode decide model, effort and speed per run
// (docs/13 §2, docs/02 §6). The UI's mode switch used to be decorative: every run went out as STD.
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { SettingsSchema } from "../../db/repo/settings.ts";
import { resolveRunSettings } from "../runSettings.ts";
import { ClientEventSchema } from "../../domain/events.ts";

const defaults = SettingsSchema.parse({});

Deno.test("RUN-SETTINGS-01 defaults: Opus 5.5, 64k, effort by mode per docs/13, standard speed", () => {
  assertEquals(resolveRunSettings(defaults), {
    model: "claude-opus-5-5",
    maxTokens: 64_000,
    effort: "medium",
  });
  assertEquals(resolveRunSettings(defaults, "low").effort, "low");
  assertEquals(resolveRunSettings(defaults, "deep").effort, "high");
  assertEquals(resolveRunSettings(defaults, "raman").effort, "high");
});

Deno.test("RUN-SETTINGS-02 the user's effort per mode wins; a stale model id falls back", () => {
  const s = SettingsSchema.parse({
    model: "claude-sonnet-4-6",
    effortByMode: { deep: "xhigh" },
  });
  const r = resolveRunSettings(s, "deep");
  assertEquals(r.model, "claude-opus-5-5");
  assertEquals(r.effort, "xhigh");
  assertEquals(resolveRunSettings(s, "std").effort, "medium");
});

Deno.test("RUN-SETTINGS-03 fast mode only on a model that supports it", () => {
  const on = (model: string) => SettingsSchema.parse({ model, fastResponses: true });
  assertEquals(resolveRunSettings(on("claude-opus-5-5")).speed, "fast");
  assertEquals(resolveRunSettings(on("claude-fable-5-2")).speed, "fast");
  assertEquals(resolveRunSettings(on("claude-haiku-5-5")).speed, undefined);
  assertEquals(resolveRunSettings(on("claude-sonnet-5-5")).speed, undefined);
});

Deno.test("RUN-SETTINGS-04 user.message carries an optional mode; an unknown mode is rejected", () => {
  assertEquals(
    ClientEventSchema.safeParse({ type: "user.message", text: "fan", mode: "deep" }).success,
    true,
  );
  assertEquals(ClientEventSchema.safeParse({ type: "user.message", text: "fan" }).success, true);
  assertEquals(
    ClientEventSchema.safeParse({ type: "user.message", text: "fan", mode: "turbo" }).success,
    false,
  );
});
