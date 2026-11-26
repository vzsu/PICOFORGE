// app/src/viewport/studio/renderStyles.ts
// Data for the mock-up render styles (reference images IMAGES_OFui/*): surface point dust for the
// loading look, and a synthetic velocity field for the CFD look. Pure, deterministic, no three.js.
// MOCK ONLY: the field is a plausible picture, not a simulation. Live mode never shows it.

import { mulberry32 } from "./materials.ts";

/** Area-weighted random points on the triangle surface, jittered slightly off it (dust). */
export function sampleSurfacePoints(
  positions: Float32Array,
  indices: Uint32Array,
  count: number,
  seed = 1048,
  jitterMm = 0.35,
): Float32Array {
  const tris = indices.length / 3;
  const cum = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const a = 3 * indices[3 * t], b = 3 * indices[3 * t + 1], c = 3 * indices[3 * t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = total;
  }
  const out = new Float32Array(count * 3);
  if (tris === 0 || total === 0) return out;
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    // pick a triangle by area (binary search on the cumulative sum)
    const target = rnd() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const a = 3 * indices[3 * lo], b = 3 * indices[3 * lo + 1], c = 3 * indices[3 * lo + 2];
    let r1 = rnd(), r2 = rnd();
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    for (let k = 0; k < 3; k++) {
      const p = positions[a + k] + r1 * (positions[b + k] - positions[a + k]) + r2 * (positions[c + k] - positions[a + k]);
      out[3 * i + k] = p + (rnd() - 0.5) * 2 * jitterMm;
    }
  }
  return out;
}

/**
 * Plausible velocity magnitude 0..1 per vertex for the mock CFD look: slow near the floor and on
 * the flanks, faster across the deck, fastest in the deck pockets (low AO high up), with a gentle
 * wave along the part so bands are not perfectly flat. Y is up.
 */
export function syntheticVelocity(positions: Float32Array, normals: Float32Array, ao: Float32Array): Float32Array {
  const n = positions.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, positions[3 * i + 1]);
    maxY = Math.max(maxY, positions[3 * i + 1]);
  }
  const span = maxY - minY || 1;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], z = positions[3 * i + 2];
    const h = (positions[3 * i + 1] - minY) / span;
    const up = Math.max(0, normals[3 * i + 1]);
    const pocket = smooth(0.04, 0.4, 1 - ao[i]); // deck pockets and ports: low AO high up
    const wave = 0.05 * Math.sin(x * 0.045 + z * 0.03) * h;
    v[i] = Math.min(1, Math.max(0, 0.05 + 0.3 * h ** 1.5 + 0.2 * up * h * h + 0.95 * pocket * smooth(0.35, 0.95, h) + wave));
  }
  return v;
}
