// GENERATED from server/domain/pts1.ts by `deno task gen:protocol`. Do not edit here.
// server/domain/pts1.ts — PTS1 binary point-cloud frame (docs/09 §4). Little-endian.
//   0  4×u8  magic "PTS1"        4 u8 version (1)        5 u8 stage (1 reference, 2 proxy, 3 draft)
//   6  u16   flags (bit0 normals, bit1 ao, bit2 last chunk)
//   8  u8 + ASCII run id   · u8 + ASCII node id (empty = whole-design proxy)
//   …  u32 n · 6×f32 bbox min xyz, max xyz · n×3×u16 positions (quantised in bbox)
//   …  n×3×i8 normals (flag) · n×u8 AO (flag)
// Pure: no project imports. app/src/protocol/pts1.ts is generated from this file (gen:protocol).
// The decoder validates every length before reading and never throws: a malformed frame comes back
// as {ok:false, reason} for the caller to drop and log (docs/09 §4).

export const PTS1_STAGE = { reference: 1, proxy: 2, draft: 3 } as const;
export type Pts1Stage = (typeof PTS1_STAGE)[keyof typeof PTS1_STAGE];

export interface Pts1Frame {
  stage: Pts1Stage;
  /** Last chunk of this stage for this node (flag bit 2). */
  last: boolean;
  runId: string;
  /** Empty for whole-design proxies. */
  nodeId: string;
  /** xyz per point. */
  positions: Float32Array;
  /** Unit normals, xyz per point (flag bit 0). */
  normals?: Float32Array;
  /** 0..1 per point (flag bit 1). */
  ao?: Float32Array;
  bboxMin: readonly [number, number, number];
  bboxMax: readonly [number, number, number];
}

export type Pts1Decoded = { ok: true; frame: Pts1Frame } | { ok: false; reason: string };

const MAGIC = [0x50, 0x54, 0x53, 0x31]; // "PTS1"
const VERSION = 1;
const FLAG_NORMALS = 1, FLAG_AO = 2, FLAG_LAST = 4;
/** Far above every tier budget (T2: 200k on screen); bounds allocation from a hostile header. */
export const PTS1_MAX_POINTS = 4_000_000;
const Q = 65535;

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/**
 * Encode one chunk. Inputs come from server code (preview/), so a bad frame is a programming error:
 * it throws RangeError, which the preview stage catches (failure row F14: the stage is skipped).
 */
export function encodePts1(f: Pts1Frame): Uint8Array {
  const n = f.positions.length / 3;
  if (!Number.isInteger(n) || n > PTS1_MAX_POINTS) {
    throw new RangeError(`PTS1: bad point count ${n}`);
  }
  if (f.normals && f.normals.length !== n * 3) throw new RangeError("PTS1: normals length");
  if (f.ao && f.ao.length !== n) throw new RangeError("PTS1: ao length");
  for (const id of [f.runId, f.nodeId]) {
    if (id.length > 255 || !isAscii(id)) throw new RangeError(`PTS1: id must be ≤ 255 ASCII chars`);
  }
  const head = 8 + 1 + f.runId.length + 1 + f.nodeId.length + 4 + 24;
  const size = head + n * 6 + (f.normals ? n * 3 : 0) + (f.ao ? n : 0);
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf.set(MAGIC, 0);
  dv.setUint8(4, VERSION);
  dv.setUint8(5, f.stage);
  dv.setUint16(
    6,
    (f.normals ? FLAG_NORMALS : 0) | (f.ao ? FLAG_AO : 0) | (f.last ? FLAG_LAST : 0),
    true,
  );
  let o = 8;
  for (const id of [f.runId, f.nodeId]) {
    dv.setUint8(o++, id.length);
    for (let i = 0; i < id.length; i++) dv.setUint8(o++, id.charCodeAt(i));
  }
  dv.setUint32(o, n, true);
  o += 4;
  for (let a = 0; a < 3; a++) dv.setFloat32(o + 4 * a, f.bboxMin[a], true);
  for (let a = 0; a < 3; a++) dv.setFloat32(o + 12 + 4 * a, f.bboxMax[a], true);
  o += 24;
  const lo = [Math.fround(f.bboxMin[0]), Math.fround(f.bboxMin[1]), Math.fround(f.bboxMin[2])];
  const span = [0, 1, 2].map((a) => Math.fround(f.bboxMax[a]) - lo[a]);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    const t = span[a] > 0 ? (f.positions[i] - lo[a]) / span[a] : 0;
    dv.setUint16(o, Math.round(Math.min(1, Math.max(0, t)) * Q), true);
    o += 2;
  }
  if (f.normals) {
    for (let i = 0; i < n * 3; i++) {
      dv.setInt8(o++, Math.round(Math.min(1, Math.max(-1, f.normals[i])) * 127));
    }
  }
  if (f.ao) {
    for (let i = 0; i < n; i++) {
      dv.setUint8(o++, Math.round(Math.min(1, Math.max(0, f.ao[i])) * 255));
    }
  }
  return buf;
}

/** Decode one chunk. Total: returns {ok:false, reason} for anything malformed, never throws. */
export function decodePts1(input: ArrayBuffer | Uint8Array): Pts1Decoded {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = (reason: string): Pts1Decoded => ({ ok: false, reason });
  if (buf.byteLength < 8 + 2 + 4 + 24) return fail("too short");
  for (let i = 0; i < 4; i++) if (buf[i] !== MAGIC[i]) return fail("bad magic");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(4) !== VERSION) return fail(`unsupported version ${dv.getUint8(4)}`);
  const stage = dv.getUint8(5);
  if (stage !== 1 && stage !== 2 && stage !== 3) return fail(`bad stage ${stage}`);
  const flags = dv.getUint16(6, true);
  if (flags & ~(FLAG_NORMALS | FLAG_AO | FLAG_LAST)) return fail(`unknown flags ${flags}`);
  let o = 8;
  const ids: string[] = [];
  for (let k = 0; k < 2; k++) {
    if (o >= buf.byteLength) return fail("truncated id");
    const len = dv.getUint8(o++);
    if (o + len > buf.byteLength) return fail("truncated id");
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = buf[o + i];
      if (c < 0x20 || c > 0x7e) return fail("non-ASCII id");
      s += String.fromCharCode(c);
    }
    ids.push(s);
    o += len;
  }
  if (ids[0].length === 0) return fail("empty run id");
  if (o + 4 + 24 > buf.byteLength) return fail("truncated header");
  const n = dv.getUint32(o, true);
  o += 4;
  if (n > PTS1_MAX_POINTS) return fail(`point count ${n} over cap`);
  const lo = [0, 1, 2].map((a) => dv.getFloat32(o + 4 * a, true));
  const hi = [0, 1, 2].map((a) => dv.getFloat32(o + 12 + 4 * a, true));
  o += 24;
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(lo[a]) || !Number.isFinite(hi[a]) || hi[a] < lo[a]) {
      return fail("bad bbox");
    }
  }
  const hasN = (flags & FLAG_NORMALS) !== 0, hasAo = (flags & FLAG_AO) !== 0;
  const expected = o + n * 6 + (hasN ? n * 3 : 0) + (hasAo ? n : 0);
  if (expected !== buf.byteLength) return fail(`length ${buf.byteLength} ≠ ${expected}`);

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    positions[i] = lo[a] + (dv.getUint16(o, true) / Q) * (hi[a] - lo[a]);
    o += 2;
  }
  let normals: Float32Array | undefined;
  if (hasN) {
    normals = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) normals[i] = Math.max(-1, dv.getInt8(o++) / 127);
  }
  let ao: Float32Array | undefined;
  if (hasAo) {
    ao = new Float32Array(n);
    for (let i = 0; i < n; i++) ao[i] = dv.getUint8(o++) / 255;
  }
  return {
    ok: true,
    frame: {
      stage,
      last: (flags & FLAG_LAST) !== 0,
      runId: ids[0],
      nodeId: ids[1],
      positions,
      normals,
      ao,
      bboxMin: [lo[0], lo[1], lo[2]],
      bboxMax: [hi[0], hi[1], hi[2]],
    },
  };
}
