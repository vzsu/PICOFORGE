// app/src/viewport/studio/headWorker.ts
// Builds and bakes the procedural head off the main thread (docs/12: no long tasks on the UI thread).

import { buildHead } from "./proceduralHead.ts";

interface BuildRequest {
  voxelMm: number;
}

function isBuildRequest(x: unknown): x is BuildRequest {
  return typeof x === "object" && x !== null && "voxelMm" in x && typeof x.voxelMm === "number";
}

self.onmessage = (e: MessageEvent<unknown>) => {
  if (!isBuildRequest(e.data)) return;
  const t0 = performance.now();
  const r = buildHead(e.data.voxelMm);
  const totalMs = performance.now() - t0;
  const transfer = [r.positions.buffer, r.normals.buffer, r.ao.buffer, r.curv.buffer, r.indices.buffer, r.shadow.buffer];
  self.postMessage({ ...r, totalMs }, { transfer });
};
