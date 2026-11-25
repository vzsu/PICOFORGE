// app/src/viewport/studio/stlBake.ts
// Turns an engine STL (binary, Z-up, mm) into the same baked buffers the procedural head uses
// (docs/10 §4): welded indexed mesh, vertex normals, AO, curvature, contact shadow. Runs in a
// worker, once per mesh. Occupancy for AO/shadow comes from ray-parity voxelisation of the mesh.

import {
  bakeAo,
  bakeContactShadow,
  bakeCurvature,
  type Grid,
  type HeadBuild,
} from "./proceduralHead.ts";

export class StlParseError extends Error {}

/** Binary STL → triangle soup in the studio frame (Y-up, part centred on x/z, resting on y = 0). */
export function parseBinaryStl(buf: ArrayBuffer): Float32Array {
  if (buf.byteLength < 84) throw new StlParseError("STL too short");
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 !== buf.byteLength) throw new StlParseError(`not a binary STL (${n} triangles, ${buf.byteLength} bytes)`);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(o + v * 12, true);
      const y = dv.getFloat32(o + v * 12 + 4, true);
      const z = dv.getFloat32(o + v * 12 + 8, true);
      // Z-up (engine) → Y-up (studio): (x, y, z) → (x, z, −y)
      out[t * 9 + v * 3] = x;
      out[t * 9 + v * 3 + 1] = z;
      out[t * 9 + v * 3 + 2] = -y;
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < out.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], out[i + a]);
      max[a] = Math.max(max[a], out[i + a]);
    }
  }
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, y0 = min[1];
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= cx;
    out[i + 1] -= y0;
    out[i + 2] -= cz;
  }
  return out;
}

/** Merge identical vertices (the engine writes an unwelded soup) so normals and AO can smooth. */
export function weld(soup: Float32Array): { positions: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const pos: number[] = [];
  const indices = new Uint32Array(soup.length / 3);
  const q = (v: number) => Math.round(v * 1e4);
  for (let i = 0, vi = 0; i < soup.length; i += 3, vi++) {
    const key = `${q(soup[i])},${q(soup[i + 1])},${q(soup[i + 2])}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = pos.length / 3;
      map.set(key, idx);
      pos.push(soup[i], soup[i + 1], soup[i + 2]);
    }
    indices[vi] = idx;
  }
  return { positions: new Float32Array(pos), indices };
}

/** Area-weighted vertex normals. */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const p of [a, b, c]) {
      n[p] += nx;
      n[p + 1] += ny;
      n[p + 2] += nz;
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}

/** Enclosed volume (divergence theorem), cm³. */
export function meshVolumeCm3(positions: Float32Array, indices: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
    v += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
      positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return Math.abs(v / 6) / 1000;
}

/**
 * Occupancy grid by ray parity: for every (y, z) row a ray along +x collects the x of each
 * triangle crossing; sorted crossings pair into inside spans. f = −1 inside, +1 outside.
 */
export function voxelise(positions: Float32Array, indices: Uint32Array, h: number): Grid {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  const m = 2 * h;
  const x0 = min[0] - m, y0 = min[1] - m, z0 = min[2] - m;
  const nx = Math.ceil((max[0] - min[0] + 2 * m) / h) + 1;
  const ny = Math.ceil((max[1] - min[1] + 2 * m) / h) + 1;
  const nz = Math.ceil((max[2] - min[2] + 2 * m) / h) + 1;
  const rows: number[][] = Array.from({ length: ny * nz }, () => []);
  // Tiny offsets keep sample rays off shared edges and vertices (no double counting).
  const ey = 1.37e-4 * h, ez = 2.11e-4 * h;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
    const ay = positions[a + 1], az = positions[a + 2];
    const by = positions[b + 1], bz = positions[b + 2];
    const cy = positions[c + 1], cz = positions[c + 2];
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0 - ey) / h));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0 - ey) / h));
    const k0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0 - ez) / h));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0 - ez) / h));
    const det = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
    if (det === 0) continue; // triangle parallel to the ray
    for (let k = k0; k <= k1; k++) {
      const pz = z0 + k * h + ez;
      for (let j = j0; j <= j1; j++) {
        const py = y0 + j * h + ey;
        // barycentric coordinates of (py, pz) in the triangle's yz projection
        const u = ((py - ay) * (cz - az) - (cy - ay) * (pz - az)) / det;
        const v = ((by - ay) * (pz - az) - (py - ay) * (bz - az)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = positions[a] + u * (positions[b] - positions[a]) + v * (positions[c] - positions[a]);
        rows[j + k * ny].push(x);
      }
    }
  }
  const f = new Float32Array(nx * ny * nz).fill(1);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const xs = rows[j + k * ny];
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil((xs[s] - x0) / h));
        const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / h));
        for (let i = i0; i <= i1; i++) f[i + j * nx + k * nx * ny] = -1;
      }
    }
  }
  return { nx, ny, nz, h, x0, y0, z0, f };
}

/** STL bytes → baked buffers, same shape as the procedural head build. */
export function bakeStl(buf: ArrayBuffer): HeadBuild {
  const now = () => performance.now();
  let t = now();
  const { positions, indices } = weld(parseBinaryStl(buf));
  const normals = vertexNormals(positions, indices);
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
  const maxDim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  t = now();
  const g = voxelise(positions, indices, Math.max(0.5, maxDim / 110)); // T0 occupancy (docs/10 §4)
  const sdfMs = now() - t;
  t = now();
  const ao = bakeAo(g, positions, normals, indices, diag);
  const aoMs = now() - t;
  t = now();
  const curv = bakeCurvature(positions, normals, indices);
  const curvMs = now() - t;
  t = now();
  const sh = bakeContactShadow(g);
  const shadowMs = now() - t;

  return {
    positions,
    normals,
    ao,
    curv,
    indices,
    ...sh,
    bboxMin: min,
    bboxMax: max,
    volumeCm3: meshVolumeCm3(positions, indices),
    timings: { sdfMs, meshMs, aoMs, curvMs, shadowMs },
  };
}
