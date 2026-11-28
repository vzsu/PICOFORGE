// app/src/live/settings.ts — Settings store (docs/02 §6): loads /api/settings, autosaves every change
// (debounced PUT of only what changed), applies the selection colour as the `--select` CSS token.
// The API key is write-only: it is sent once on Save and never read back.

import { useSyncExternalStore } from "react";
import { apiFetch, isRecord, readJson } from "../api.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
export type ModeKey = "low" | "std" | "deep" | "raman";

export interface SettingsView {
  loaded: boolean;
  model: string;
  maxOutputTokens: number;
  effortByMode: Record<ModeKey, Effort>;
  fastResponses: boolean;
  selectColor: string;
  hasApiKey: boolean;
  apiBaseUrl: string;
  models: Array<{ id: string; label: string; fast: boolean }>;
  /** "saving" while a PUT is in flight; time of the last successful save. */
  save: { state: "idle" | "saving" | "error"; at: number | null };
}

export const DEFAULT_SELECT = "#0A84FF";

const INITIAL: SettingsView = {
  loaded: false,
  model: "claude-opus-5-5",
  maxOutputTokens: 64_000,
  effortByMode: { low: "low", std: "medium", deep: "high", raman: "high" },
  fastResponses: false,
  selectColor: DEFAULT_SELECT,
  hasApiKey: false,
  apiBaseUrl: "",
  models: [],
  save: { state: "idle", at: null },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const isEffort = (v: unknown): v is Effort => typeof v === "string" && (EFFORTS as readonly string[]).includes(v);

/** Server body → view fields (every field narrowed; unknown keys ignored). */
export function fromServer(body: unknown, prev: SettingsView): SettingsView {
  if (!isRecord(body) || !isRecord(body.settings)) return prev;
  const s = body.settings;
  const e = isRecord(s.effortByMode) ? s.effortByMode : {};
  const ui = isRecord(s.ui) ? s.ui : {};
  const provider = isRecord(body.provider) ? body.provider : {};
  return {
    ...prev,
    loaded: true,
    model: typeof s.model === "string" ? s.model : prev.model,
    maxOutputTokens: typeof s.maxOutputTokens === "number" ? s.maxOutputTokens : prev.maxOutputTokens,
    effortByMode: {
      low: isEffort(e.low) ? e.low : prev.effortByMode.low,
      std: isEffort(e.std) ? e.std : prev.effortByMode.std,
      deep: isEffort(e.deep) ? e.deep : prev.effortByMode.deep,
      raman: isEffort(e.raman) ? e.raman : prev.effortByMode.raman,
    },
    fastResponses: s.fastResponses === true,
    selectColor: typeof ui.selectColor === "string" && HEX.test(ui.selectColor) ? ui.selectColor : prev.selectColor,
    hasApiKey: provider.hasApiKey === true,
    apiBaseUrl: typeof provider.apiBaseUrl === "string" ? provider.apiBaseUrl : "",
  };
}

type Listener = () => void;

class SettingsStore {
  private state: SettingsView = INITIAL;
  private readonly listeners = new Set<Listener>();
  private pending: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;

  private set(next: SettingsView) {
    this.state = next;
    applySelectColor(next.selectColor);
    for (const l of this.listeners) l();
  }

  async load(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const [s, m] = await Promise.all([
        apiFetch("/api/settings").then(readJson),
        apiFetch("/api/models").then(readJson),
      ]);
      const models = isRecord(m) && Array.isArray(m.models)
        ? m.models.flatMap((x) =>
          isRecord(x) && typeof x.id === "string" && typeof x.label === "string"
            ? [{ id: x.id, label: x.label, fast: x.fast === true }]
            : []
        )
        : [];
      this.set({ ...fromServer(s, this.state), models });
    } catch {
      this.started = false; // retry on the next open
    }
  }

  /** Apply locally at once; persist after 400 ms of quiet (one PUT for a burst of edits). */
  update(patch: Partial<Pick<SettingsView, "model" | "fastResponses" | "selectColor" | "maxOutputTokens">> & {
    effort?: Partial<Record<ModeKey, Effort>>;
  }): void {
    const next = { ...this.state };
    if (patch.model !== undefined) { next.model = patch.model; this.pending.model = patch.model; }
    if (patch.fastResponses !== undefined) {
      next.fastResponses = patch.fastResponses;
      this.pending.fastResponses = patch.fastResponses;
    }
    if (patch.maxOutputTokens !== undefined) {
      next.maxOutputTokens = patch.maxOutputTokens;
      this.pending.maxOutputTokens = patch.maxOutputTokens;
    }
    if (patch.selectColor !== undefined && HEX.test(patch.selectColor)) {
      next.selectColor = patch.selectColor;
      this.pending.ui = { selectColor: patch.selectColor };
    }
    if (patch.effort) {
      next.effortByMode = { ...next.effortByMode, ...patch.effort };
      this.pending.effortByMode = {
        ...(isRecord(this.pending.effortByMode) ? this.pending.effortByMode : {}),
        ...patch.effort,
      };
    }
    this.set(next);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  private async flush(): Promise<void> {
    const body = this.pending;
    this.pending = {};
    if (Object.keys(body).length === 0) return;
    await this.put(body);
  }

  private async put(body: Record<string, unknown>): Promise<boolean> {
    this.set({ ...this.state, save: { ...this.state.save, state: "saving" } });
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.set({ ...this.state, save: { state: "idle", at: Date.now() } });
      return true;
    } catch {
      this.set({ ...this.state, save: { ...this.state.save, state: "error" } });
      return false;
    }
  }

  /** Write-only: the key goes to ~/PicoForge/secret.env and never comes back to the page. */
  async saveKey(apiKey: string, apiBaseUrl: string): Promise<boolean> {
    const body: Record<string, unknown> = { apiBaseUrl: apiBaseUrl.trim() };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const ok = await this.put(body);
    if (ok) {
      const s = await apiFetch("/api/settings").then(readJson).catch(() => null);
      this.set(fromServer(s, this.state));
    }
    return ok;
  }

  async testKey(apiKey: string, apiBaseUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await apiFetch("/api/settings/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim(), ...(apiBaseUrl.trim() ? { baseUrl: apiBaseUrl.trim() } : {}) }),
      });
      const j = await readJson(res);
      if (res.ok) return { ok: true, message: "Key works" };
      return { ok: false, message: isRecord(j) && typeof j.message === "string" ? j.message : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }
}

/** The `--select` token: hover/selection in the explorer and the viewport. */
export function applySelectColor(hex: string): void {
  if (HEX.test(hex)) globalThis.document?.documentElement.style.setProperty("--select", hex);
}

export const settingsStore = new SettingsStore();

export function useSettings(): SettingsView {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
}
