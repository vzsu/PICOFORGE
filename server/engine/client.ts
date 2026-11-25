// server/engine/client.ts — ndjson JSON-RPC client over engine host stdio
// SYS_DESIGN §4.2 — Deno side of the engine IPC
// Full implementation in M3; this module exists for type safety at M0/M1.

import { z } from "zod";
import { makeLogger } from "../log.ts";
import { err, ok, Result } from "../domain/result.ts";

const log = makeLogger("engine.client");

// ─── Wire schemas (04 §5: "ndjson, validated on both sides") ─────────────────

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Geometry stats the engine reports after a build (Kit `Stats.Of`, Runner.cs ReportStats). */
export const engineStatsSchema = z.object({
  volumeCm3: z.number(),
  areaCm2: z.number().optional(),
  bboxMin: vec3,
  bboxMax: vec3,
  triangles: z.number().int().nonnegative(),
  watertight: z.boolean(),
  voxelSizeMm: z.number().positive(),
  minWallProbeMm: z.number().nonnegative(),
  buildMs: z.number().nonnegative().optional(),
});
export type EngineStats = z.infer<typeof engineStatsSchema>;

/** Typed error payload from any engine method; extra fields ride along to the repair loop. */
export const engineErrorSchema = z.object({ code: z.string().min(1) }).passthrough();
export type EngineErrorPayload = z.infer<typeof engineErrorSchema>;

export const engineCompileResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(z.object({}).passthrough()).default([]),
  dllCached: z.boolean().optional(),
});

export const engineRunResultSchema = z.object({
  ok: z.boolean(),
  stats: engineStatsSchema.optional(),
  files: z.record(z.string().nullable()).optional(),
  log: z.array(z.string()).optional(),
  error: engineErrorSchema.optional(),
});

/** `engine.inspect {target, ops}` → measurements (04 §5). Per-op results pass through untouched. */
export const engineInspectResultSchema = z.object({
  target: z.string(),
  measurements: z.object({
    volumeCm3: z.number().optional(),
    areaCm2: z.number().optional(),
    bboxMin: vec3.optional(),
    bboxMax: vec3.optional(),
    triangles: z.number().int().nonnegative().optional(),
    watertight: z.boolean().optional(),
    minWallMm: z.number().nonnegative().optional(),
  }),
  results: z.array(z.object({ type: z.string() }).passthrough()).default([]),
});
export type EngineInspectResult = z.infer<typeof engineInspectResultSchema>;

/** `engine.export` reply: where the file landed and its size. */
export const engineExportResultSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export type EngineExportResult = z.infer<typeof engineExportResultSchema>;

export type InspectOp =
  | { type: "bbox" }
  | { type: "volume" }
  | { type: "section"; plane: "x" | "y" | "z"; offset_mm: number }
  | { type: "wall_min" }
  | { type: "ray"; origin: [number, number, number]; dir: [number, number, number] };

export interface EngineInspectRequest {
  target: string;
  ops: InspectOp[];
}

export type ExportFormat = "stl" | "3mf" | "glb" | "vdb" | "cli";

export interface EngineExportRequest {
  target: string;
  format: ExportFormat;
  outPath: string;
}

/**
 * The engine port the harness tools depend on. `EngineClient` implements it; tests inject fakes.
 * Replies are `unknown` on purpose: the engine is a process boundary, so callers run every reply
 * through `unwrapEngineReply` + a zod schema before trusting it.
 */
export interface EngineApi {
  compile(code: string, codeId?: string): Promise<unknown>;
  run(params: EngineRunParams): Promise<unknown>;
  inspect?(req: EngineInspectRequest): Promise<unknown>;
  export?(req: EngineExportRequest): Promise<unknown>;
}

/** JSON-RPC error frame from the engine (`{error:{code,message}}`). */
export class EngineRpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "EngineRpcError";
  }
}

/** One ndjson frame from the host: a reply `{id, result|error}` or a notification `{method}`. */
const rpcFrameSchema = z.object({
  id: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.unknown(), message: z.unknown() }).passthrough().optional(),
  method: z.string().optional(),
  payload: z.unknown().optional(),
}).passthrough();

const replyEnvelopeSchema = z.object({
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.unknown().optional(),
});

export type EngineReply =
  | { ok: true; value: unknown }
  | { ok: false; error: EngineErrorPayload };

/**
 * Normalise an engine reply (`Result` envelope) into value-or-typed-error.
 * Error codes map to 04 §7: RPC transport failure → ENGINE_LOST (F5),
 * malformed reply → ENGINE_PROTOCOL (F15), payload without a code → `fallbackCode`.
 */
export function unwrapEngineReply(raw: unknown, fallbackCode: string): EngineReply {
  const env = replyEnvelopeSchema.safeParse(raw);
  if (!env.success) {
    return { ok: false, error: { code: "ENGINE_PROTOCOL", detail: env.error.message } };
  }
  if (env.data.ok) return { ok: true, value: env.data.value };
  const e = env.data.error;
  if (e instanceof EngineRpcError) return { ok: false, error: { code: e.code, detail: e.message } };
  if (e instanceof Error) return { ok: false, error: { code: "ENGINE_LOST", detail: e.message } };
  const typed = engineErrorSchema.safeParse(e);
  if (typed.success) return { ok: false, error: typed.data };
  const loose = z.record(z.unknown()).safeParse(e);
  if (loose.success) return { ok: false, error: { ...loose.data, code: fallbackCode } };
  return { ok: false, error: { code: fallbackCode, detail: String(e) } };
}

const engineHelloSchema = z.object({
  version: z.string(),
  picogkVersion: z.string().optional(),
  dotnet: z.string().optional(),
  symbolTableHash: z.string().optional(),
}).passthrough();
export type EngineHelloResult = z.infer<typeof engineHelloSchema>;

export type EngineCompileResult = z.infer<typeof engineCompileResultSchema>;

const enginePingSchema = z.object({}).passthrough();

/** RPC timeouts. `run` must cover the sandbox's own limit (runTimeoutS, default 120 s) — B-006. */
export interface EngineTimeouts {
  quick: number;
  run: number;
}
const DEFAULT_TIMEOUTS: EngineTimeouts = { quick: 30_000, run: 330_000 };

export interface EngineRunParams {
  code?: string;
  codeId?: string;
  runId?: string;
  /** Evaluated brief parameters; the part code reads them via `ctx.P(name)` (08 §3). */
  params?: Record<string, number>;
  /** Voxel size from the accepted brief (`voxel_size_mm`); the engine defaults to 0.5 mm. */
  voxelMm?: number;
  limits?: { timeoutS?: number; maxRssMiB?: number; maxCells?: number };
  exports?: string[];
  outDir: string;
}

export type EngineRunResult = z.infer<typeof engineRunResultSchema>;

export type EnginePingResult = z.infer<typeof enginePingSchema>;

/**
 * Client for the forge-engine host process.
 * Communicates via ndjson JSON-RPC over stdio.
 * Stub for M1 — full process management in M3.
 */
export class EngineClient implements EngineApi {
  private _process: Deno.ChildProcess | null = null;
  private _seq = 0;
  private _pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private _ready = false;
  private readonly args: string[];
  private readonly timeouts: EngineTimeouts;

  constructor(
    private readonly engineBin: string,
    opts: { args?: string[]; timeoutsMs?: Partial<EngineTimeouts> } = {},
  ) {
    this.args = opts.args ?? [];
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeoutsMs };
  }

  async start(): Promise<Result<EngineHelloResult, Error>> {
    try {
      const cmd = new Deno.Command(this.engineBin, {
        args: this.args,
        stdin: "piped",
        stdout: "piped",
        stderr: "inherit",
      });
      this._process = cmd.spawn();
      this._readLoop();
      const hello = await this.callParsed("engine.hello", {}, engineHelloSchema);
      if (!hello.ok) return hello;
      this._ready = true;
      log.info("Engine connected", { version: hello.value.version });
      return hello;
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async ping(): Promise<Result<EnginePingResult, Error>> {
    return await this.callParsed("engine.ping", {}, enginePingSchema);
  }

  async compile(code: string, codeId?: string): Promise<Result<EngineCompileResult, Error>> {
    return await this.callParsed("engine.compile", { code, codeId }, engineCompileResultSchema);
  }

  async run(params: EngineRunParams): Promise<Result<EngineRunResult, Error>> {
    return await this.callParsed("engine.run", params, engineRunResultSchema, this.timeouts.run);
  }

  /** `engine.inspect {target, ops}` → measurements (04 §5). */
  async inspect(req: EngineInspectRequest): Promise<Result<EngineInspectResult, Error>> {
    return await this.callParsed("engine.inspect", req, engineInspectResultSchema);
  }

  /** Mesh export of a built target into `outPath` (host method `engine.convert`). */
  async export(req: EngineExportRequest): Promise<Result<EngineExportResult, Error>> {
    return await this.callParsed("engine.convert", req, engineExportResultSchema);
  }

  private async callParsed<S extends z.ZodTypeAny>(
    method: string,
    params: unknown,
    schema: S,
    timeoutMs = this.timeouts.quick,
  ): Promise<Result<z.infer<S>, Error>> {
    try {
      const raw = await this.call(method, params, timeoutMs);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return err(new EngineRpcError("ENGINE_PROTOCOL", `${method}: ${parsed.error.message}`));
      }
      return ok(parsed.data);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async cancel(runId: string): Promise<void> {
    try {
      await this.call("engine.cancel", { runId });
    } catch { /* best effort */ }
  }

  get isReady(): boolean {
    return this._ready;
  }

  private async call(
    method: string,
    params: unknown,
    timeoutMs = this.timeouts.quick,
  ): Promise<unknown> {
    if (!this._process) throw new Error("Engine not started");
    const id = String(++this._seq);
    const frame = JSON.stringify({ id, method, params }) + "\n";
    const writer = this._process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(frame));
    writer.releaseLock();
    return new Promise<unknown>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`Engine RPC timeout: ${method} after ${timeoutMs} ms`));
        }
      }, timeoutMs);
    });
  }

  private async _readLoop(): Promise<void> {
    if (!this._process) return;
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of this._process.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = rpcFrameSchema.parse(JSON.parse(line));
          if (msg.id && this._pending.has(msg.id)) {
            const { resolve, reject } = this._pending.get(msg.id)!;
            this._pending.delete(msg.id);
            if (msg.error) {
              reject(new EngineRpcError(String(msg.error.code), String(msg.error.message)));
            } else {
              resolve(msg.result);
            }
          } else if (msg.method) {
            // Notification (run.log, run.progress)
            log.debug("Engine notification", { method: msg.method, payload: msg.payload });
          }
        } catch { /* skip malformed frames */ }
      }
    }
  }

  stop(): void {
    this._ready = false;
    try {
      this._process?.kill();
    } catch { /* process may already be dead */ }
    this._process = null;
  }
}
