// scripts/logs.ts — `deno task logs:tail` and `deno task logs:query` (docs/dev/02 §4).
// Reads ndjson logs from ~/PicoForge/logs/*.log. Accepts both the old shape
// ({level, message, data}) and the spec shape ({lvl, msg, runId, errId}).
import { join } from "jsr:@std/path@1";

export interface Filter {
  areas?: string[];
  lvl?: string;
  run?: string;
  err?: string;
  sinceMs?: number;
  follow: boolean;
}

export interface Line {
  ts: number;
  lvl: string;
  area: string;
  msg: string;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function parseArgs(argv: string[]): Filter {
  const f: Filter = { follow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--follow" || a === "-f") f.follow = true;
    else if (a === "--area" && v) (f.areas = v.split(",")), i++;
    else if (a === "--lvl" && v) (f.lvl = v), i++;
    else if (a === "--run" && v) (f.run = v), i++;
    else if (a === "--err" && v) (f.err = v), i++;
    else if (a === "--since" && v) {
      const m = /^(\d+)([smhd])$/.exec(v);
      if (!m) throw new Error(`bad --since ${v} (use 30s, 15m, 1h, 2d)`);
      const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
      f.sinceMs = Number(m[1]) * unit;
      i++;
    }
  }
  return f;
}

export function parseLine(text: string): Line | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const raw = o as Record<string, unknown>;
  const data = typeof raw.data === "object" && raw.data !== null
    ? raw.data as Record<string, unknown>
    : {};
  const tsv = raw.ts;
  const ts = typeof tsv === "number" ? tsv : typeof tsv === "string" ? Date.parse(tsv) : NaN;
  return {
    ts,
    lvl: str(raw.lvl) ?? str(raw.level) ?? "info",
    area: str(raw.area) ?? "?",
    msg: str(raw.msg) ?? str(raw.message) ?? "",
    raw: { ...data, ...raw },
  };
}

export function filterLines(texts: string[], f: Filter, now = Date.now()): Line[] {
  const out: Line[] = [];
  for (const t of texts) {
    const l = parseLine(t);
    if (!l) continue;
    if (f.areas && !f.areas.includes(l.area)) continue;
    if (f.lvl && l.lvl !== f.lvl) continue;
    if (f.run && l.raw.runId !== f.run) continue;
    if (f.err && l.raw.errId !== f.err) continue;
    if (f.sinceMs !== undefined && !(l.ts >= now - f.sinceMs)) continue;
    out.push(l);
  }
  return out;
}

function fmt(l: Line): string {
  const t = Number.isFinite(l.ts) ? new Date(l.ts).toISOString().slice(11, 23) : "--:--:--.---";
  const { ts: _t, lvl: _l, level: _v, area: _a, msg: _m, message: _s, data: _d, ...rest } = l.raw;
  const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
  return `${t} ${l.lvl.padEnd(5)} ${l.area.padEnd(9)} ${l.msg}${extra}`;
}

function logDir(): string {
  const home = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
  return Deno.env.get("PICOFORGE_LOG_DIR") ?? join(home, "PicoForge", "logs");
}

async function readAll(dir: string): Promise<string[]> {
  const texts: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".log")) {
        texts.push(...(await Deno.readTextFile(join(dir, e.name))).split("\n"));
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return texts;
}

if (import.meta.main) {
  const mode = Deno.args[0];
  const f = parseArgs(Deno.args.slice(1));
  if (mode === "tail") f.follow = true;
  const dir = logDir();
  const lines = filterLines(await readAll(dir), f).sort((a, b) => a.ts - b.ts);
  const shown = mode === "tail" ? lines.slice(-50) : lines;
  for (const l of shown) console.log(fmt(l));
  if (!lines.length) console.error(`(no matching lines in ${dir})`);
  if (f.follow) {
    const sizes = new Map<string, number>();
    for await (const e of Deno.readDir(dir)) {
      if (e.name.endsWith(".log")) sizes.set(e.name, (await Deno.stat(join(dir, e.name))).size);
    }
    for await (const ev of Deno.watchFs(dir)) {
      for (const p of ev.paths) {
        if (!p.endsWith(".log")) continue;
        const name = p.split(/[\\/]/).pop() ?? p;
        const file = await Deno.open(p, { read: true });
        const size = (await file.stat()).size;
        const from = sizes.get(name) ?? 0;
        if (size > from) {
          await file.seek(from, Deno.SeekMode.Start);
          const buf = new Uint8Array(size - from);
          await file.read(buf);
          for (const l of filterLines(new TextDecoder().decode(buf).split("\n"), f)) {
            console.log(fmt(l));
          }
        }
        sizes.set(name, size);
        file.close();
      }
    }
  }
}
