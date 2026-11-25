// server/db/repo/runs.ts — Run + run_steps + code_versions + artifacts repos
// DATA_SCHEMA §3 + §5

import { z } from "zod";
import { ulid } from "../../domain/ids.ts";
import { getDb, withTx } from "../db.ts";
import {
  bool01,
  bool01OrNull,
  intOrNull,
  jsonCol,
  jsonColOrNull,
  jsonObject,
  textOrNull,
} from "../rows.ts";

// ─── Run ──────────────────────────────────────────────────────────────────────

export const RunStateSchema = z.enum([
  "queued",
  "understanding",
  "briefing",
  "building",
  "inspecting",
  "awaiting_user",
  "codegen",
  "compiling",
  "executing",
  "validating",
  "rendering",
  "done",
  "failed",
  "cancelled",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export interface Run {
  id: string;
  conversationId: string;
  messageId: string | null;
  state: RunState;
  attempt: number;
  errorCode: string | null;
  errorDetail: string | null;
  model: string;
  briefJson: unknown | null;
  limitsJson: Record<string, unknown>;
  startedAt: number;
  finishedAt: number | null;
  totalMs: number | null;
}

const RunRow = z.object({
  id: z.string(),
  conversation_id: z.string(),
  message_id: textOrNull,
  state: RunStateSchema,
  attempt: z.number(),
  error_code: textOrNull,
  error_detail: textOrNull,
  model: z.string(),
  brief_json: jsonColOrNull(z.unknown()),
  limits_json: jsonCol(jsonObject),
  started_at: z.number(),
  finished_at: intOrNull,
  total_ms: intOrNull,
}).transform((r): Run => ({
  id: r.id,
  conversationId: r.conversation_id,
  messageId: r.message_id,
  state: r.state,
  attempt: r.attempt,
  errorCode: r.error_code,
  errorDetail: r.error_detail,
  model: r.model,
  briefJson: r.brief_json ?? null,
  limitsJson: r.limits_json,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  totalMs: r.total_ms,
}));

function rowToRun(row: unknown): Run {
  return RunRow.parse(row);
}

export function runCreate(
  conversationId: string,
  model: string,
  opts: { messageId?: string; limits?: Record<string, unknown> } = {},
): Run {
  const now = Date.now();
  const id = ulid();
  withTx((db) => {
    db.prepare(
      `INSERT INTO runs(id,conversation_id,message_id,state,attempt,model,limits_json,started_at)
       VALUES (?,?,?,'queued',0,?,?,?)`,
    ).run(
      id,
      conversationId,
      opts.messageId ?? null,
      model,
      JSON.stringify(opts.limits ?? {}),
      now,
    );
  });
  return {
    id,
    conversationId,
    messageId: opts.messageId ?? null,
    state: "queued",
    attempt: 0,
    errorCode: null,
    errorDetail: null,
    model,
    briefJson: null,
    limitsJson: opts.limits ?? {},
    startedAt: now,
    finishedAt: null,
    totalMs: null,
  };
}

export function runUpdateState(
  id: string,
  state: RunState,
  opts: {
    attempt?: number;
    errorCode?: string;
    errorDetail?: string;
    briefJson?: unknown;
    messageId?: string;
  } = {},
): void {
  const now = Date.now();
  const finished = state === "done" || state === "failed" || state === "cancelled" ? now : null;
  withTx((db) => {
    const existing = z.object({ started_at: z.number() }).optional().parse(
      db.prepare("SELECT started_at FROM runs WHERE id=?").get(id),
    );
    const totalMs = finished && existing ? finished - existing.started_at : null;
    db.prepare(
      `UPDATE runs SET state=?,attempt=COALESCE(?,attempt),error_code=COALESCE(?,error_code),
       error_detail=COALESCE(?,error_detail),brief_json=COALESCE(?,brief_json),
       message_id=COALESCE(?,message_id),finished_at=COALESCE(?,finished_at),total_ms=COALESCE(?,total_ms)
       WHERE id=?`,
    ).run(
      state,
      opts.attempt ?? null,
      opts.errorCode ?? null,
      opts.errorDetail ?? null,
      opts.briefJson ? JSON.stringify(opts.briefJson) : null,
      opts.messageId ?? null,
      finished,
      totalMs,
      id,
    );
  });
}

export function runGet(id: string): Run | undefined {
  const row = getDb().prepare("SELECT * FROM runs WHERE id=?").get(id);
  return row ? rowToRun(row) : undefined;
}

export function runListForConversation(conversationId: string): Run[] {
  const rows = getDb()
    .prepare("SELECT * FROM runs WHERE conversation_id=? ORDER BY started_at DESC")
    .all(conversationId);
  return rows.map(rowToRun);
}

/** Boot orphan repair — marks any non-terminal runs as failed{ENGINE_LOST} (DATA_SCHEMA §6) */
export function repairOrphanRuns(): string[] {
  const db = getDb();
  const orphans = db
    .prepare(
      `SELECT id FROM runs WHERE state NOT IN ('done','failed','cancelled')`,
    )
    .all();
  const ids = z.array(z.object({ id: z.string() })).parse(orphans).map((r) => r.id);
  if (ids.length > 0) {
    withTx((d) => {
      d.prepare(
        `UPDATE runs SET state='failed',error_code='ENGINE_LOST',finished_at=?,total_ms=0
         WHERE state NOT IN ('done','failed','cancelled')`,
      ).run(Date.now());
    });
  }
  return ids;
}

// ─── RunStep ──────────────────────────────────────────────────────────────────

export const RunStepKindSchema = z.enum([
  "llm",
  "tool.search_docs",
  "tool.submit_design_brief",
  "tool.run_picogk",
  "tool.inspect_geometry",
  "tool.capture_viewport",
  "tool.export_artifact",
  "tool.ask_user",
  "compile",
  "execute",
  "validate",
]);
export type RunStepKind = z.infer<typeof RunStepKindSchema>;

export interface RunStep {
  id: string;
  runId: string;
  seq: number;
  kind: RunStepKind;
  title: string;
  inputJson: unknown | null;
  outputJson: unknown | null;
  ok: boolean | null;
  durationMs: number | null;
  createdAt: number;
}

const RunStepRow = z.object({
  id: z.string(),
  run_id: z.string(),
  seq: z.number(),
  kind: RunStepKindSchema,
  title: z.string(),
  input_json: jsonColOrNull(z.unknown()),
  output_json: jsonColOrNull(z.unknown()),
  ok: bool01OrNull,
  duration_ms: intOrNull,
  created_at: z.number(),
}).transform((r): RunStep => ({
  id: r.id,
  runId: r.run_id,
  seq: r.seq,
  kind: r.kind,
  title: r.title,
  inputJson: r.input_json ?? null,
  outputJson: r.output_json ?? null,
  ok: r.ok,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
}));

function rowToStep(row: unknown): RunStep {
  return RunStepRow.parse(row);
}

export function runStepCreate(
  runId: string,
  kind: RunStepKind,
  title: string,
  inputJson?: unknown,
): RunStep {
  const now = Date.now();
  const id = ulid();
  const db = getDb();
  // Get next seq
  const { next: seq } = z.object({ next: z.number() }).parse(
    db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS next FROM run_steps WHERE run_id=?").get(runId),
  );
  withTx((d) => {
    d.prepare(
      `INSERT INTO run_steps(id,run_id,seq,kind,title,input_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, runId, seq, kind, title, inputJson ? JSON.stringify(inputJson) : null, now);
  });
  return {
    id,
    runId,
    seq,
    kind,
    title,
    inputJson: inputJson ?? null,
    outputJson: null,
    ok: null,
    durationMs: null,
    createdAt: now,
  };
}

export function runStepFinish(
  id: string,
  ok: boolean,
  outputJson?: unknown,
  durationMs?: number,
): void {
  withTx((db) => {
    db.prepare(
      `UPDATE run_steps SET ok=?,output_json=?,duration_ms=? WHERE id=?`,
    ).run(ok ? 1 : 0, outputJson ? JSON.stringify(outputJson) : null, durationMs ?? null, id);
  });
}

export function runStepList(runId: string): RunStep[] {
  const rows = getDb()
    .prepare("SELECT * FROM run_steps WHERE run_id=? ORDER BY seq")
    .all(runId);
  return rows.map(rowToStep);
}

// ─── CodeVersion ──────────────────────────────────────────────────────────────

export interface CodeVersion {
  id: string;
  projectId: string;
  runId: string | null;
  parentId: string | null;
  source: string;
  sourceHash: string;
  paramsJson: Record<string, unknown>;
  compileOk: boolean | null;
  diagnosticsJson: unknown[] | null;
  createdAt: number;
}

export function codeVersionCreate(
  projectId: string,
  source: string,
  sourceHash: string,
  opts: {
    runId?: string;
    parentId?: string;
    paramsJson?: Record<string, unknown>;
  } = {},
): CodeVersion {
  const now = Date.now();
  const id = ulid();
  withTx((db) => {
    db.prepare(
      `INSERT INTO code_versions(id,project_id,run_id,parent_id,source,source_hash,params_json,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      projectId,
      opts.runId ?? null,
      opts.parentId ?? null,
      source,
      sourceHash,
      JSON.stringify(opts.paramsJson ?? {}),
      now,
    );
  });
  return {
    id,
    projectId,
    runId: opts.runId ?? null,
    parentId: opts.parentId ?? null,
    source,
    sourceHash,
    paramsJson: opts.paramsJson ?? {},
    compileOk: null,
    diagnosticsJson: null,
    createdAt: now,
  };
}

export function codeVersionSetCompileResult(
  id: string,
  compileOk: boolean,
  diagnostics: unknown[] = [],
): void {
  withTx((db) => {
    db.prepare(
      `UPDATE code_versions SET compile_ok=?,diagnostics_json=? WHERE id=?`,
    ).run(compileOk ? 1 : 0, JSON.stringify(diagnostics), id);
  });
}

/** Cache probe: find a code_version by source_hash (DATA_SCHEMA §4.4) */
export function codeVersionFindByHash(sourceHash: string): CodeVersion | undefined {
  const row = getDb()
    .prepare("SELECT * FROM code_versions WHERE source_hash=? ORDER BY created_at DESC LIMIT 1")
    .get(sourceHash);
  if (!row) return undefined;
  return CodeVersionRow.parse(row);
}

const CodeVersionRow = z.object({
  id: z.string(),
  project_id: z.string(),
  run_id: textOrNull,
  parent_id: textOrNull,
  source: z.string(),
  source_hash: z.string(),
  params_json: jsonCol(jsonObject),
  compile_ok: bool01OrNull,
  diagnostics_json: jsonColOrNull(z.array(z.unknown())),
  created_at: z.number(),
}).transform((r): CodeVersion => ({
  id: r.id,
  projectId: r.project_id,
  runId: r.run_id,
  parentId: r.parent_id,
  source: r.source,
  sourceHash: r.source_hash,
  paramsJson: r.params_json,
  compileOk: r.compile_ok,
  diagnosticsJson: r.diagnostics_json,
  createdAt: r.created_at,
}));

// ─── Artifact ─────────────────────────────────────────────────────────────────

export const ArtifactKindSchema = z.enum(["mesh", "voxels", "image", "report", "export"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export const ArtifactFormatSchema = z.enum(["stl", "glb", "vdb", "3mf", "cli", "png", "json"]);
export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;

export interface Artifact {
  id: string;
  projectId: string;
  runId: string | null;
  codeVersionId: string | null;
  kind: ArtifactKind;
  format: ArtifactFormat;
  path: string;
  sizeBytes: number;
  sha256: string;
  statsJson: Record<string, unknown>;
  pinned: boolean;
  createdAt: number;
}

const ArtifactRow = z.object({
  id: z.string(),
  project_id: z.string(),
  run_id: textOrNull,
  code_version_id: textOrNull,
  kind: ArtifactKindSchema,
  format: ArtifactFormatSchema,
  path: z.string(),
  size_bytes: z.number(),
  sha256: z.string(),
  stats_json: jsonCol(jsonObject),
  pinned: bool01,
  created_at: z.number(),
}).transform((r): Artifact => ({
  id: r.id,
  projectId: r.project_id,
  runId: r.run_id,
  codeVersionId: r.code_version_id,
  kind: r.kind,
  format: r.format,
  path: r.path,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  statsJson: r.stats_json,
  pinned: r.pinned,
  createdAt: r.created_at,
}));

function rowToArtifact(row: unknown): Artifact {
  return ArtifactRow.parse(row);
}

export function artifactCreate(
  projectId: string,
  kind: ArtifactKind,
  format: ArtifactFormat,
  path: string,
  sizeBytes: number,
  sha256: string,
  opts: {
    runId?: string;
    codeVersionId?: string;
    statsJson?: Record<string, unknown>;
  } = {},
): Artifact {
  const now = Date.now();
  const id = ulid();
  withTx((db) => {
    db.prepare(
      `INSERT INTO artifacts(id,project_id,run_id,code_version_id,kind,format,path,size_bytes,sha256,stats_json,pinned,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?)`,
    ).run(
      id,
      projectId,
      opts.runId ?? null,
      opts.codeVersionId ?? null,
      kind,
      format,
      path,
      sizeBytes,
      sha256,
      JSON.stringify(opts.statsJson ?? {}),
      now,
    );
  });
  return {
    id,
    projectId,
    runId: opts.runId ?? null,
    codeVersionId: opts.codeVersionId ?? null,
    kind,
    format,
    path,
    sizeBytes,
    sha256,
    statsJson: opts.statsJson ?? {},
    pinned: false,
    createdAt: now,
  };
}

export function artifactGet(id: string): Artifact | undefined {
  const row = getDb().prepare("SELECT * FROM artifacts WHERE id=?").get(id);
  return row ? rowToArtifact(row) : undefined;
}

export function artifactListForRun(runId: string): Artifact[] {
  const rows = getDb()
    .prepare("SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at")
    .all(runId);
  return rows.map(rowToArtifact);
}

/** Latest mesh artifact for a conversation (DATA_SCHEMA §4.2) */
export function artifactLatestMesh(conversationId: string): Artifact | undefined {
  const row = getDb()
    .prepare(
      `SELECT a.* FROM artifacts a
       JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id=? AND a.kind='mesh' AND r.state='done'
       ORDER BY a.created_at DESC LIMIT 1`,
    )
    .get(conversationId);
  return row ? rowToArtifact(row) : undefined;
}
