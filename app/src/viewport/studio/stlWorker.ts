// app/src/viewport/studio/stlWorker.ts
// Bakes an engine STL off the main thread (docs/12: no long tasks on the UI thread).

import { bakeStl, StlParseError } from "./stlBake.ts";

self.onmessage = (e: MessageEvent<unknown>) => {
  const data = e.data;
  if (!(typeof data === "object" && data !== null && "stl" in data && data.stl instanceof ArrayBuffer)) return;
  const t0 = performance.now();
  try {
    const r = bakeStl(data.stl);
    const totalMs = performance.now() - t0;
    const transfer = [r.positions.buffer, r.normals.buffer, r.ao.buffer, r.curv.buffer, r.indices.buffer, r.shadow.buffer];
    self.postMessage({ ...r, totalMs }, { transfer });
  } catch (err) {
    self.postMessage({ error: err instanceof StlParseError ? "LOAD_PARSE" : "BAKE_FAILED", message: String(err) });
  }
};
