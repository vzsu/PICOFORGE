// server/config.ts — Environment + settings resolution (zod-validated)
// ANTHROPIC_API_KEY is never stored in SQLite, never logged (SYS_DESIGN §3.4)

import { z } from "zod";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { makeLogger } from "./log.ts";

const log = makeLogger("config");

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(7317),
  HOST: z.string().default("127.0.0.1"),
  DATA_DIR: z.string().default(
    join(
      Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".",
      "PicoForge",
    ),
  ),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ENGINE_BIN: z.string().default("forge-engine"),
  /** Never echo this value in logs or HTTP responses */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Custom base URL for Anthropic-compatible proxies (OpenCode, OpenRouter, etc.) */
  ANTHROPIC_BASE_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

// Boot-time security token — printed to console, required on all API/WS requests
// SYS_DESIGN §10: defeats drive-by localhost attacks from other browser tabs
let _bootToken: string | null = null;

export function getBootToken(): string {
  if (!_bootToken) {
    _bootToken = crypto.randomUUID();
  }
  return _bootToken;
}

interface Secrets {
  apiKey?: string;
  baseUrl?: string;
}

async function loadSecrets(dataDir: string): Promise<Secrets> {
  const result: Secrets = {};
  // Prefer env vars; fallback to ~/PicoForge/secret.env
  result.apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  result.baseUrl = Deno.env.get("ANTHROPIC_BASE_URL");
  try {
    const secretPath = join(dataDir, "secret.env");
    const text = await Deno.readTextFile(secretPath);
    if (!result.apiKey) {
      const keyMatch = text.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      result.apiKey = keyMatch?.[1]?.trim();
    }
    if (!result.baseUrl) {
      const urlMatch = text.match(/^ANTHROPIC_BASE_URL=(.+)$/m);
      result.baseUrl = urlMatch?.[1]?.trim();
    }
  } catch {
    // No secret.env yet — that's fine
  }
  return result;
}

/**
 * Persist a new API key to ~/PicoForge/secret.env and hot-reload config.
 * Key is NEVER logged. Returns true on success.
 */
/**
 * Write or update a single line in ~/PicoForge/secret.env.
 * Hot-reloads the in-memory config. Never logs secret values.
 */
async function writeSecretLine(envKey: string, value: string): Promise<boolean> {
  try {
    const cfg = getConfig();
    const secretPath = join(cfg.DATA_DIR, "secret.env");
    let existing = "";
    try {
      existing = await Deno.readTextFile(secretPath);
    } catch { /* new file */ }
    const pattern = new RegExp(`^${envKey}=.+$`, "m");
    const updated = pattern.test(existing)
      ? existing.replace(pattern, `${envKey}=${value}`)
      : existing + `\n${envKey}=${value}`;
    await Deno.writeTextFile(secretPath, updated.trim() + "\n");
    return true;
  } catch (e) {
    log.error(`Failed to write ${envKey}`, { error: String(e) });
    return false;
  }
}

export async function writeApiKey(newKey: string): Promise<boolean> {
  const ok = await writeSecretLine("ANTHROPIC_API_KEY", newKey);
  if (ok) {
    _config = { ...getConfig(), ANTHROPIC_API_KEY: newKey };
    log.info("API key updated", { hasKey: true });
  }
  return ok;
}

export async function writeBaseUrl(newUrl: string): Promise<boolean> {
  const ok = await writeSecretLine("ANTHROPIC_BASE_URL", newUrl);
  if (ok) {
    _config = { ...getConfig(), ANTHROPIC_BASE_URL: newUrl || undefined };
    log.info("API base URL updated", { hasUrl: !!newUrl });
  }
  return ok;
}

export async function clearBaseUrl(): Promise<boolean> {
  try {
    const cfg = getConfig();
    const secretPath = join(cfg.DATA_DIR, "secret.env");
    let existing = "";
    try {
      existing = await Deno.readTextFile(secretPath);
    } catch {
      return true;
    }
    const cleaned = existing.replace(/^ANTHROPIC_BASE_URL=.+\n?/m, "");
    await Deno.writeTextFile(secretPath, cleaned.trim() + "\n");
    _config = { ...cfg, ANTHROPIC_BASE_URL: undefined };
    log.info("API base URL cleared");
    return true;
  } catch (e) {
    log.error("Failed to clear base URL", { error: String(e) });
    return false;
  }
}

// ─── MCP token (docs/14 §2, §11) ─────────────────────────────────────────────

let _mcpToken: string | null = null;

/**
 * The token MCP clients send as `X-PicoForge-Token`. Unlike the boot token it persists in
 * `<dataDir>/secret.env` (PICOFORGE_MCP_TOKEN), so a client registered once keeps working across
 * restarts. Created on first use. Never logged.
 */
export async function ensureMcpToken(dataDir: string): Promise<string> {
  if (_mcpToken) return _mcpToken;
  const fromEnv = Deno.env.get("PICOFORGE_MCP_TOKEN");
  if (fromEnv) return (_mcpToken = fromEnv);
  const secretPath = join(dataDir, "secret.env");
  let existing = "";
  try {
    existing = await Deno.readTextFile(secretPath);
  } catch { /* first run */ }
  const found = existing.match(/^PICOFORGE_MCP_TOKEN=(\S+)\s*$/m)?.[1];
  if (found) return (_mcpToken = found);
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.writeTextFile(
    secretPath,
    `${existing.trim()}\nPICOFORGE_MCP_TOKEN=${token}\n`.trimStart(),
  );
  log.info("MCP token created in secret.env"); // never the value
  return (_mcpToken = token);
}

/** Repo root: two levels up from this file (server/config.ts). */
const REPO_ROOT = join(import.meta.dirname ?? ".", "..");

/**
 * Engine host binary: ENGINE_BIN if set; else the engine built in this repo (Release, then Debug);
 * else the bare name for a PATH lookup (packaged install, docs/01 §4 P9). B-010, CFG-ENGINE-01.
 */
export async function resolveEngineBin(
  envValue: string | undefined,
  repoRoot = REPO_ROOT,
): Promise<string> {
  if (envValue) return envValue;
  const exe = Deno.build.os === "windows" ? "forge-engine.exe" : "forge-engine";
  for (const config of ["Release", "Debug"]) {
    const p = join(repoRoot, "engine", "ForgeEngine", "bin", config, "net9.0", exe);
    try {
      if ((await Deno.stat(p)).isFile) return p;
    } catch {
      // not built in this configuration
    }
  }
  return "forge-engine";
}

export async function loadConfig(): Promise<Config> {
  if (_config) return _config;

  const raw = {
    PORT: Deno.env.get("PORT"),
    HOST: Deno.env.get("HOST"),
    DATA_DIR: Deno.env.get("DATA_DIR"),
    NODE_ENV: Deno.env.get("NODE_ENV"),
    ENGINE_BIN: await resolveEngineBin(Deno.env.get("ENGINE_BIN")),
  };

  const partial = ConfigSchema.omit({ ANTHROPIC_API_KEY: true, ANTHROPIC_BASE_URL: true }).parse(
    raw,
  );
  const secrets = await loadSecrets(partial.DATA_DIR);

  _config = ConfigSchema.parse({
    ...raw,
    ANTHROPIC_API_KEY: secrets.apiKey,
    ANTHROPIC_BASE_URL: secrets.baseUrl || undefined,
  });

  await Deno.mkdir(join(_config.DATA_DIR, "logs"), { recursive: true });
  await Deno.mkdir(join(_config.DATA_DIR, "projects"), { recursive: true });
  await Deno.mkdir(join(_config.DATA_DIR, "tmp"), { recursive: true });
  await Deno.mkdir(join(_config.DATA_DIR, "kb"), { recursive: true });

  log.info("Config loaded", {
    port: _config.PORT,
    dataDir: _config.DATA_DIR,
    env: _config.NODE_ENV,
    hasApiKey: !!_config.ANTHROPIC_API_KEY,
    hasBaseUrl: !!_config.ANTHROPIC_BASE_URL,
    // NEVER log the key or URL values
  });

  return _config;
}

export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded — call loadConfig() first");
  return _config;
}
