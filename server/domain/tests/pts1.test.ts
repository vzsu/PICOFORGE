// PREVIEW-CODEC-01: PTS1 encode/decode round trip within quantisation error (docs/09 §4).
// PREVIEW-CODEC-02: 10,000 fuzzed frames never throw in the decoder; malformed frames are rejected.
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { decodePts1, encodePts1, PTS1_STAGE, type Pts1Frame } from "../pts1.ts";

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleFrame(n: number, seed: number, withNormals = true, withAo = true): Pts1Frame {
  const r = rng(seed);
  const positions = new Float32Array(n * 3);
  const normals = withNormals ? new Float32Array(n * 3) : undefined;
  const ao = withAo ? new Float32Array(n) : undefined;
  for (let i = 0; i < n; i++) {
    positions[3 * i] = -60 + 120 * r();
    positions[3 * i + 1] = -60 + 120 * r();
    positions[3 * i + 2] = 26 * r();
    if (normals) {
      const x = r() - 0.5, y = r() - 0.5, z = r() - 0.5;
      const l = Math.hypot(x, y, z) || 1;
      normals.set([x / l, y / l, z / l], 3 * i);
    }
    if (ao) ao[i] = r();
  }
  return {
    stage: PTS1_STAGE.draft,
    last: true,
    runId: "01JDRUN",
    nodeId: "arms",
    positions,
    normals,
    ao,
    bboxMin: [-60, -60, 0],
    bboxMax: [60, 60, 26],
  };
}

Deno.test("PREVIEW-CODEC-01 round trip within quantisation error; ids, stage, flags kept", () => {
  const f = sampleFrame(5000, 1);
  const bytes = encodePts1(f);
  // header 8 + (1+7) + (1+4) + 4 + 24, then 6 + 3 + 1 bytes per point
  assertEquals(bytes.byteLength, 8 + 8 + 5 + 4 + 24 + 5000 * 10);
  const d = decodePts1(bytes);
  assert(d.ok, d.ok ? "" : d.reason);
  const g = d.frame;
  assertEquals([g.stage, g.last, g.runId, g.nodeId], [PTS1_STAGE.draft, true, "01JDRUN", "arms"]);
  const step = [120 / 65535, 120 / 65535, 26 / 65535];
  for (let i = 0; i < 5000 * 3; i++) {
    assert(Math.abs(g.positions[i] - f.positions[i]) <= step[i % 3] / 2 + 1e-4, `pos ${i}`);
  }
  assert(g.normals && f.normals && g.ao && f.ao);
  for (let i = 0; i < 5000 * 3; i++) {
    assert(Math.abs(g.normals[i] - f.normals[i]) <= 0.5 / 127 + 1e-6);
  }
  for (let i = 0; i < 5000; i++) assert(Math.abs(g.ao[i] - f.ao[i]) <= 0.5 / 255 + 1e-6);
});

Deno.test("PREVIEW-CODEC-01 optional attributes and empty node id (whole-design proxy)", () => {
  const f = {
    ...sampleFrame(10, 2, false, false),
    nodeId: "",
    stage: PTS1_STAGE.proxy,
    last: false,
  };
  const d = decodePts1(encodePts1(f));
  assert(d.ok);
  assertEquals([d.frame.normals, d.frame.ao, d.frame.nodeId, d.frame.last], [
    undefined,
    undefined,
    "",
    false,
  ]);
  // flat axis: positions on a plane still decode (no divide by zero)
  const flat = { ...f, bboxMin: [0, 0, 5] as const, bboxMax: [1, 1, 5] as const };
  flat.positions = new Float32Array([0, 0, 5, 1, 1, 5]);
  const e = decodePts1(encodePts1(flat));
  assert(e.ok);
  assertEquals(Array.from(e.frame.positions), [0, 0, 5, 1, 1, 5]);
});

Deno.test("PREVIEW-CODEC-02 10,000 fuzzed frames never throw; malformed frames are rejected", () => {
  const r = rng(42);
  const valid = encodePts1(sampleFrame(64, 3));
  let rejected = 0, accepted = 0;
  for (let k = 0; k < 10_000; k++) {
    let buf: Uint8Array;
    const mode = k % 4;
    if (mode === 0) {
      buf = new Uint8Array(Math.floor(r() * 200)); // random garbage
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(r() * 256);
      if (r() < 0.5 && buf.length >= 4) buf.set([0x50, 0x54, 0x53, 0x31]); // with a real magic
    } else if (mode === 1) {
      buf = valid.slice(0, Math.floor(r() * valid.length)); // truncated
    } else if (mode === 2) {
      buf = valid.slice(); // bit flips anywhere, headers included
      for (let f = 0; f < 1 + Math.floor(r() * 4); f++) {
        buf[Math.floor(r() * buf.length)] ^= 1 << Math.floor(r() * 8);
      }
    } else {
      buf = new Uint8Array(valid.length + 1 + Math.floor(r() * 16)); // trailing bytes
      buf.set(valid);
    }
    let d;
    try {
      d = decodePts1(buf);
    } catch (e) {
      throw new Error(`decoder threw on fuzz case ${k} (mode ${mode}): ${e}`);
    }
    if (d.ok) {
      accepted++;
      const n = d.frame.positions.length / 3;
      assert(Number.isInteger(n));
      if (d.frame.normals) assertEquals(d.frame.normals.length, n * 3);
      if (d.frame.ao) assertEquals(d.frame.ao.length, n);
      assert(Array.from(d.frame.positions).every(Number.isFinite));
    } else rejected++;
  }
  assert(rejected > 7000, `only ${rejected} rejected`);
  assert(accepted > 0, "bit flips inside the point payload should still decode");
});
