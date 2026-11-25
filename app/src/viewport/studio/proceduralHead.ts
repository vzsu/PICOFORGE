// app/src/viewport/studio/proceduralHead.ts
// Procedural cylinder-head-like part for the P0 mock-up viewport, plus the one-time bakes from
// docs/10 §4: per-vertex AO from the occupancy grid, per-vertex curvature for edge shading, and a
// top-down contact-shadow map for the floor (docs/10 §1). Pure TypeScript, no three.js, no DOM:
// it runs inside a Web Worker so the UI paints while the part builds.
//
// Units: millimetres, Y up, part sits on y = 0. Deterministic: no Math.random anywhere.

export interface HeadBuild {
  positions: Float32Array; // xyz per vertex
  normals: Float32Array; // xyz per vertex
  ao: Float32Array; // 0..1 per vertex (1 = open)
  curv: Float32Array; // -1..1 per vertex (+ convex edge, - concave)
  indices: Uint32Array;
  shadow: Uint8Array<ArrayBuffer>; // contact shadow, shadowW x shadowH, 255 = darkest
  shadowW: number;
  shadowH: number;
  shadowMinX: number;
  shadowMinZ: number;
  shadowSizeX: number;
  shadowSizeZ: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  volumeCm3: number;
  timings: { sdfMs: number; meshMs: number; aoMs: number; curvMs: number; shadowMs: number };
}

// ─── SDF primitives ─────────────────────────────────────────────────────────────

function sdRoundBox(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number, r: number,
): number {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const qz = Math.abs(pz - cz) - hz + r;
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
  const inner = Math.min(Math.max(qx, qy, qz), 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + inner - r;
}

/** Capped cylinder: radial distance `dr` (already minus radius) and axial half-extent check. */
function capped(dr: number, axial: number, a0: number, a1: number): number {
  const mid = (a0 + a1) * 0.5;
  const da = Math.abs(axial - mid) - (a1 - a0) * 0.5;
  const ox = dr > 0 ? dr : 0, oy = da > 0 ? da : 0;
  return Math.min(Math.max(dr, da), 0) + Math.sqrt(ox * ox + oy * oy);
}

function cylY(px: number, py: number, pz: number, cx: number, cz: number, y0: number, y1: number, r: number) {
  const dx = px - cx, dz = pz - cz;
  return capped(Math.sqrt(dx * dx + dz * dz) - r, py, y0, y1);
}
function cylZ(px: number, py: number, pz: number, cx: number, cy: number, z0: number, z1: number, r: number) {
  const dx = px - cx, dy = py - cy;
  return capped(Math.sqrt(dx * dx + dy * dy) - r, pz, z0, z1);
}
function cylX(px: number, py: number, pz: number, cy: number, cz: number, x0: number, x1: number, r: number) {
  const dy = py - cy, dz = pz - cz;
  return capped(Math.sqrt(dy * dy + dz * dz) - r, px, x0, x1);
}

// ─── The head ───────────────────────────────────────────────────────────────────

const CYL_X = [-67.5, -22.5, 22.5, 67.5];
const BOSS_X = [-90, -45, 0, 45, 90];
const BOSS_Z = [-34.5, 34.5]; // boss edge stays 2.5 mm inboard of the side faces
const DECK_Y = 52;

/** Signed distance (mm) to the head. Negative inside. */
/** Polynomial smooth union; `k` is the fillet size in mm. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Smooth subtraction of `b` from `a` (machined edge break of size `k`). */
function ssub(a: number, b: number, k: number): number {
  return -smin(-a, b, k);
}

// Every edge carries a fillet or edge break (smin k ≈ 3–5 voxels; effective radius ≈ k/4) so the 1.5 mm voxel mesh
// resolves it cleanly instead of serrating a mathematically sharp edge.
export function headSdf(px: number, py: number, pz: number, band: number): number {
  // Body block with a small machined lip at the base.
  let d = sdRoundBox(px, py, pz, 0, DECK_Y / 2, 0, 108, DECK_Y / 2, 46, 2.5);
  d = smin(d, sdRoundBox(px, py, pz, 0, 3.5, 0, 112, 3.5, 50, 1.5), 2);
  // Bolt bosses standing proud of the deck, filleted into it, with rounded tops.
  for (const bx of BOSS_X) {
    for (const bz of BOSS_Z) d = smin(d, cylY(px, py, pz, bx, bz, 30, 58, 7) - 2, 7);
  }
  // Far outside: subtractions cannot bring the point back inside.
  if (d > band) return d;

  for (const bx of BOSS_X) {
    for (const bz of BOSS_Z) d = ssub(d, cylY(px, py, pz, bx, bz, 24, 70, 4.2), 3);
  }
  for (const cx of CYL_X) {
    // Combustion / valve pocket.
    d = ssub(d, cylY(px, py, pz, cx, 0, 35, 70, 19), 7);
    // Four valve throats in the pocket floor.
    d = ssub(d, cylY(px, py, pz, cx - 9, 8.5, 16, 40, 4.8), 3);
    d = ssub(d, cylY(px, py, pz, cx + 9, 8.5, 16, 40, 4.8), 3);
    d = ssub(d, cylY(px, py, pz, cx - 9, -8.5, 16, 40, 4.4), 3);
    d = ssub(d, cylY(px, py, pz, cx + 9, -8.5, 16, 40, 4.4), 3);
    // Intake port (front, +Z): rounded rectangle tunnel.
    d = ssub(d, sdRoundBox(px, py, pz, cx, 25, 41, 10, 8.5, 19, 6), 5);
    // Exhaust port (back, -Z): round tunnel.
    d = ssub(d, cylZ(px, py, pz, cx, 25, -62, -25, 9), 5);
  }
  // Cooling channels running the full length (visible on the end faces).
  d = ssub(d, cylX(px, py, pz, 10, 24, -130, 130, 4.5), 3.5);
  d = ssub(d, cylX(px, py, pz, 10, -24, -130, 130, 4.5), 3.5);
  // Shallow machined pockets on both end faces.
  d = ssub(d, sdRoundBox(px, py, pz, 111, 31, 0, 7, 12, 26, 4), 4);
  d = ssub(d, sdRoundBox(px, py, pz, -111, 31, 0, 7, 12, 26, 4), 4);
  return d;
}

// ─── Grid ───────────────────────────────────────────────────────────────────────

export interface Grid {
  nx: number; ny: number; nz: number;
  h: number;
  x0: number; y0: number; z0: number;
  f: Float32Array;
}

function sampleGrid(h: number): Grid {
  const x0 = -118, x1 = 118, y0 = -2, y1 = 64, z0 = -56, z1 = 56;
  const nx = Math.ceil((x1 - x0) / h) + 1;
  const ny = Math.ceil((y1 - y0) / h) + 1;
  const nz = Math.ceil((z1 - z0) / h) + 1;
  const f = new Float32Array(nx * ny * nz);
  const band = 3 * h;
  // Coarse pass every C samples. The SDF is 1-Lipschitz, so a fine sample within
  // C·h·√3/2 of a coarse sample whose |d| exceeds that radius plus a margin has the
  // same sign and lies far from the surface: copy the coarse value instead of evaluating.
  const C = 4;
  const cnx = Math.ceil((nx - 1) / C) + 1, cny = Math.ceil((ny - 1) / C) + 1, cnz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0, n = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) coarse[n++] = headSdf(x0 + i * C * h, y0 + j * C * h, z0 + k * C * h, Infinity);
    }
  }
  const safe = (C * h * Math.sqrt(3)) / 2 + 2 * h;
  let n = 0;
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * h;
    const ck = Math.min(cnz - 1, Math.round(k / C));
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * h;
      const cj = Math.min(cny - 1, Math.round(j / C));
      for (let i = 0; i < nx; i++) {
        const c = coarse[Math.min(cnx - 1, Math.round(i / C)) + cj * cnx + ck * cnx * cny];
        f[n++] = Math.abs(c) > safe ? c : headSdf(x0 + i * h, y, z, band);
      }
    }
  }
  return { nx, ny, nz, h, x0, y0, z0, f };
}

// ─── Surface nets mesher ────────────────────────────────────────────────────────

const CUBE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x edges
  [0, 2], [1, 3], [4, 6], [5, 7], // y edges
  [0, 4], [1, 5], [2, 6], [3, 7], // z edges
];

function surfaceNets(g: Grid): { positions: Float32Array; indices: Uint32Array } {
  const { nx, ny, nz, h, f } = g;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const sy = nx, sz = nx * ny;
  const corner = new Float64Array(8);
  let vcount = 0;

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const b = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = f[b + (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, cnt = 0;
        for (const [a, e] of CUBE_EDGES) {
          const va = corner[a], ve = corner[e];
          if ((va < 0) === (ve < 0)) continue;
          const t = va / (va - ve);
          ax += (a & 1) + ((e & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((e >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((e >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        pos.push(g.x0 + (i + ax / cnt) * h, g.y0 + (j + ay / cnt) * h, g.z0 + (k + az / cnt) * h);
        cellVert[i + j * cx + k * cx * cy] = vcount++;
      }
    }
  }

  const positions = new Float32Array(pos);
  const idx: number[] = [];
  const cell = (i: number, j: number, k: number) => cellVert[i + j * cx + k * cx * cy];
  // Static winding (derived for a flat surface normal to each axis): x and z quads face +axis
  // in this cell order, y quads face -axis. `outwardSign` is +1 when the outside is +axis.
  // A geometric per-quad test flipped skewed quads in fillets (they rendered as dark holes).
  const AXIS_FLIP = [1, -1, 1];
  const emit = (a: number, b: number, c: number, d: number, axis: 0 | 1 | 2, outwardSign: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (outwardSign * AXIS_FLIP[axis] > 0) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b = i + j * sy + k * sz;
        const inside = f[b] < 0;
        // x edge
        if (i < cx && j > 0 && k > 0 && j < cy && k < cz && inside !== (f[b + 1] < 0)) {
          emit(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), 0, inside ? 1 : -1);
        }
        // y edge
        if (j < cy && i > 0 && k > 0 && i < cx && k < cz && inside !== (f[b + sy] < 0)) {
          emit(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k), 1, inside ? 1 : -1);
        }
        // z edge
        if (k < cz && i > 0 && j > 0 && i < cx && j < cy && inside !== (f[b + sz] < 0)) {
          emit(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), 2, inside ? 1 : -1);
        }
      }
    }
  }
  return { positions, indices: new Uint32Array(idx) };
}

/**
 * Normals from the exact SDF gradient (central differences) at each surface-nets vertex.
 * Vertices are not projected: a Newton snap flipped triangles in tight fillets (dark specks).
 * The SDF carries real fillets instead, so surface-nets positions are already smooth.
 */
function exactNormals(positions: Float32Array): Float32Array {
  const n = new Float32Array(positions.length);
  const e = 0.3; // mm
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v], y = positions[v + 1], z = positions[v + 2];
    const gx = headSdf(x + e, y, z, Infinity) - headSdf(x - e, y, z, Infinity);
    const gy = headSdf(x, y + e, z, Infinity) - headSdf(x, y - e, z, Infinity);
    const gz = headSdf(x, y, z + e, Infinity) - headSdf(x, y, z - e, Infinity);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    n[v] = gx / l; n[v + 1] = gy / l; n[v + 2] = gz / l;
  }
  return n;
}

/** Where the SDF normal disagrees with the mesh (area-weighted face normals), trust the mesh. */
export function fixNormals(positions: Float32Array, normals: Float32Array, indices: Uint32Array): number {
  const fn = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const p of [a, b, c]) { fn[p] += nx; fn[p + 1] += ny; fn[p + 2] += nz; }
  }
  let fixed = 0;
  for (let v = 0; v < positions.length; v += 3) {
    const l = Math.sqrt(fn[v] * fn[v] + fn[v + 1] * fn[v + 1] + fn[v + 2] * fn[v + 2]) || 1;
    const mx = fn[v] / l, my = fn[v + 1] / l, mz = fn[v + 2] / l;
    if (mx * normals[v] + my * normals[v + 1] + mz * normals[v + 2] < 0.3) {
      normals[v] = mx; normals[v + 1] = my; normals[v + 2] = mz;
      fixed++;
    }
  }
  return fixed;
}

// ─── Bakes (docs/10 §4) ─────────────────────────────────────────────────────────

/** 16 cosine-weighted Hammersley directions in tangent space (z = normal). Same for every vertex. */
function hammersleyDirs(count: number): Float64Array {
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    let bits = i, rev = 0;
    for (let b = 0; b < 16; b++) { rev = (rev << 1) | (bits & 1); bits >>= 1; }
    const u = (i + 0.5) / count, w = rev / 65536;
    const r = Math.sqrt(u), phi = 2 * Math.PI * w;
    out[3 * i] = r * Math.cos(phi);
    out[3 * i + 1] = r * Math.sin(phi);
    out[3 * i + 2] = Math.sqrt(Math.max(0, 1 - u));
  }
  return out;
}

export function bakeAo(g: Grid, positions: Float32Array, normals: Float32Array, indices: Uint32Array, diag: number): Float32Array {
  const RAYS = 16;
  const dirs = hammersleyDirs(RAYS);
  const D = diag * 0.25;
  const step = g.h * 1.25;
  const steps = Math.ceil(D / step);
  const { nx, ny, nz, f } = g;
  const vc = positions.length / 3;
  const ao = new Float32Array(vc);
  for (let v = 0; v < vc; v++) {
    const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2];
    const n0 = normals[3 * v], n1 = normals[3 * v + 1], n2 = normals[3 * v + 2];
    // Tangent frame.
    const tx0 = Math.abs(n0) < 0.9 ? 1 : 0, ty0 = Math.abs(n0) < 0.9 ? 0 : 1;
    let t0 = ty0 * n2, t1 = -tx0 * n2, t2 = tx0 * n1 - ty0 * n0; // a × n with a = (tx0,ty0,0)
    const tl = Math.sqrt(t0 * t0 + t1 * t1 + t2 * t2) || 1;
    t0 /= tl; t1 /= tl; t2 /= tl;
    const b0 = n1 * t2 - n2 * t1, b1 = n2 * t0 - n0 * t2, b2 = n0 * t1 - n1 * t0;
    // Start 1.5 cells off the surface; in tight concave fillets that point can still be inside
    // the solid, so walk further out along the normal (up to 4 cells) until it is free.
    const occAt = (x: number, y: number, z: number) => {
      const i = Math.round((x - g.x0) / g.h), j = Math.round((y - g.y0) / g.h), k = Math.round((z - g.z0) / g.h);
      return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && f[i + j * nx + k * nx * ny] < 0;
    };
    let off = 1.5 * g.h;
    while (off < 4 * g.h && occAt(px + n0 * off, py + n1 * off, pz + n2 * off)) off += 0.5 * g.h;
    const sx = px + n0 * off, syy = py + n1 * off, szz = pz + n2 * off;
    let occ = 0;
    for (let r = 0; r < RAYS; r++) {
      const a = dirs[3 * r], b = dirs[3 * r + 1], c = dirs[3 * r + 2];
      const dx = t0 * a + b0 * b + n0 * c, dy = t1 * a + b1 * b + n1 * c, dz = t2 * a + b2 * b + n2 * c;
      for (let s = 1; s <= steps; s++) {
        const t = s * step;
        const x = sx + dx * t, y = syy + dy * t, z = szz + dz * t;
        if (y < 0) { occ += 1 - t / D; break; } // studio floor occludes too
        const i = Math.round((x - g.x0) / g.h), j = Math.round((y - g.y0) / g.h), k = Math.round((z - g.z0) / g.h);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
          if (y > g.y0 + (ny - 1) * g.h) break; // above the grid: open sky
          continue;
        }
        if (f[i + j * nx + k * nx * ny] < 0) { occ += 1 - t / D; break; }
      }
    }
    ao[v] = 1 - occ / RAYS;
  }
  // Smooth once over mesh neighbours.
  const sum = new Float32Array(vc), cnt = new Uint16Array(vc);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    sum[a] += ao[b] + ao[c]; cnt[a] += 2;
    sum[b] += ao[a] + ao[c]; cnt[b] += 2;
    sum[c] += ao[a] + ao[b]; cnt[c] += 2;
  }
  const out = new Float32Array(vc);
  for (let v = 0; v < vc; v++) {
    if (!cnt[v]) { out[v] = ao[v]; continue; }
    const avg = sum[v] / cnt[v];
    // Despeckle: a lone vertex far darker than its ring is a sampling outlier, not a pocket.
    out[v] = ao[v] < avg - 0.3 ? avg : (ao[v] + avg) * 0.5;
  }
  return out;
}

export function bakeCurvature(positions: Float32Array, normals: Float32Array, indices: Uint32Array): Float32Array {
  const vc = positions.length / 3;
  const acc = new Float32Array(vc), cnt = new Uint16Array(vc);
  const edge = (i: number, j: number) => {
    const dx = positions[3 * i] - positions[3 * j], dy = positions[3 * i + 1] - positions[3 * j + 1],
      dz = positions[3 * i + 2] - positions[3 * j + 2];
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-9) return;
    const k = ((normals[3 * i] - normals[3 * j]) * dx + (normals[3 * i + 1] - normals[3 * j + 1]) * dy +
      (normals[3 * i + 2] - normals[3 * j + 2]) * dz) / l2;
    acc[i] += k; cnt[i]++;
    acc[j] += k; cnt[j]++;
  };
  for (let t = 0; t < indices.length; t += 3) {
    edge(indices[t], indices[t + 1]);
    edge(indices[t + 1], indices[t + 2]);
    edge(indices[t + 2], indices[t]);
  }
  const raw = new Float32Array(vc);
  for (let v = 0; v < vc; v++) raw[v] = cnt[v] ? acc[v] / cnt[v] : 0;
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(vc * 0.02)], hi = sorted[Math.floor(vc * 0.98)];
  const scale = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  const out = new Float32Array(vc);
  for (let v = 0; v < vc; v++) out[v] = Math.max(-1, Math.min(1, raw[v] / scale));
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(Math.max(x, 0), w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / win;
      s += src[y * w + Math.min(x + r + 1, w - 1)] - src[y * w + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(Math.max(y, 0), h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / win;
      s += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
  return out;
}

export function bakeContactShadow(g: Grid) {
  const margin = 60; // mm around the part
  const cell = 2; // mm per texel
  const minX = g.x0 - margin, minZ = g.z0 - margin;
  const sizeX = (g.nx - 1) * g.h + 2 * margin, sizeZ = (g.nz - 1) * g.h + 2 * margin;
  const w = Math.ceil(sizeX / cell), h = Math.ceil(sizeZ / cell);
  const foot = new Float32Array(w * h);
  const jMax = Math.ceil((6 - g.y0) / g.h); // occupancy within 6 mm of the floor
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const x = minX + (tx + 0.5) * cell, z = minZ + (ty + 0.5) * cell;
      const i = Math.round((x - g.x0) / g.h), k = Math.round((z - g.z0) / g.h);
      if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) continue;
      for (let j = 0; j <= jMax && j < g.ny; j++) {
        if (g.f[i + j * g.nx + k * g.nx * g.ny] < 0) { foot[ty * w + tx] = 1; break; }
      }
    }
  }
  let tight = boxBlur(foot, w, h, 3);
  tight = boxBlur(tight, w, h, 3);
  let wide = boxBlur(foot, w, h, 9);
  wide = boxBlur(wide, w, h, 9);
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = Math.round(255 * Math.min(1, 0.65 * tight[p] + 0.55 * wide[p]));
  return { shadow: out, shadowW: w, shadowH: h, shadowMinX: minX, shadowMinZ: minZ, shadowSizeX: w * cell, shadowSizeZ: h * cell };
}

// ─── Entry ──────────────────────────────────────────────────────────────────────

export function buildHead(voxelMm: number): HeadBuild {
  const now = () => performance.now();
  let t = now();
  const g = sampleGrid(voxelMm);
  const sdfMs = now() - t;

  t = now();
  const { positions, indices } = surfaceNets(g);
  const normals = exactNormals(positions);
  fixNormals(positions, normals, indices);
  const meshMs = now() - t;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[v + a]);
      max[a] = Math.max(max[a], positions[v + a]);
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  t = now();
  const ao = bakeAo(g, positions, normals, indices, diag);
  const aoMs = now() - t;

  t = now();
  const curv = bakeCurvature(positions, normals, indices);
  const curvMs = now() - t;

  t = now();
  const sh = bakeContactShadow(g);
  const shadowMs = now() - t;

  let inside = 0;
  for (let p = 0; p < g.f.length; p++) if (g.f[p] < 0) inside++;
  const volumeCm3 = (inside * g.h * g.h * g.h) / 1000;

  return {
    positions, normals, ao, curv, indices,
    ...sh,
    bboxMin: min, bboxMax: max, volumeCm3,
    timings: { sdfMs, meshMs, aoMs, curvMs, shadowMs },
  };
}
