# 12 · Optimisation techniques

Optimise in this order: measure, find the largest cost, fix that one, measure again. Every item below has a bench in `bench/` and a budget in 04 §9 or 11. No optimisation lands without a before/after number in the devlog.

## 1. Latency to first visible result

| Technique | Saves | Spec |
|---|---|---|
| Client-side ghost on send | Perceived wait from the first second | 09 §2 |
| Recipe match without a model call | Seconds before any model output | 09 §2 |
| Streaming brief → proxy | Shape before code exists | 09 §2, 13 §4 |
| Recipe-first draft build | Real geometry before the model's code | 09 §3 |
| Part streaming (`define_part`) | First part while others are still being written | 13 §3 |
| Draft voxel size first | Coarse builds are much cheaper (cost scales with surface area / voxel²) | 04 §6 |
| Prompt caching with a frozen system prompt and tool list | Faster time to first token on repeat turns | 13 §5 |
| Warm Roslyn host + DLL cache by code hash | No compile for unchanged code | 05 |
| Prewarmed sandbox child | Skips process and runtime startup per job | 04 |

## 2. Rebuild cost after edits

| Technique | Effect |
|---|---|
| Per-part voxel cache keyed by the parameters each part actually reads | Changing `arm_width` rebuilds arms only |
| Dependency tracking: `ctx.P` records which parameters each part read during its last build | Exact invalidation, no guessing |
| Client-side transform during drag | Zero engine work until release |
| Booleans on cached voxels | Ops re-run without rebuilding inputs |
| Cancel superseded jobs | A new edit to the same part cancels its in-flight rebuild |
| Scheduler priority: user edits pre-empt studies | The person waiting always goes first |

## 3. Memory (8 GB floor)

| Technique | Effect |
|---|---|
| One heavy job at a time on T0; sandbox memory cap 2.5 GB | Builds cannot starve the browser |
| Voxel size chosen from a memory budget and estimated surface area, not only bounding box | Avoids out-of-memory on large thin parts |
| Pre-flight cell estimate rejects or coarsens before building | No doomed builds |
| Decimate on the server before sending | Browser never holds full-resolution meshes |
| Dispose geometry, textures and BVH on part swap | Viewport heap stays bounded |
| `node:sqlite` page cache sized per tier | 16 MB on T0 |
| Stream large results to disk, reference by URL | No large payloads in WebSocket frames except point chunks |

## 4. Rendering

| Technique | Effect |
|---|---|
| Render on demand | 0 % GPU when idle |
| Baked AO, curvature and contact shadow | Studio look without per-frame cost (10 §4) |
| Dynamic resolution during interaction | Holds frame rate on integrated GPUs |
| Idle accumulation instead of MSAA on T0 | Clean edges when still, cheap when moving |
| Quantised, meshopt-compressed GLB | Smaller downloads, faster parse |
| BVH raycasting | Selection and measuring stay instant on large meshes |
| One draw call per part, shared materials | Low driver overhead |
| Points rendered from one preallocated buffer per part | No reallocation during streaming |
| Inverted-hull selection outline on the selected mesh only | No full-screen post pass |

## 5. Server and database

| Technique | Effect |
|---|---|
| WAL, `synchronous = NORMAL`, prepared statements reused | Fast commits |
| One transaction per change; no engine or network calls inside | Short lock times |
| Snapshots every 50 edits | Fast project open |
| Ring buffer for WS resume | Reconnects without REST re-hydration |
| ndjson logs with size caps and rotation | Logs never fill the disk |
| Backpressure watermark drops only log frames | UI stays live under bursts |

## 6. Model cost and speed

| Technique | Effect |
|---|---|
| Effort per mode (13 §2) | LOW is fast and cheap; RAMAN spends where it matters |
| Prompt caching: tools → system → stable context first, volatile content last | Large share of input tokens read from cache (verify with `usage.cache_read_input_tokens`) |
| Elide nothing from history by hand; use server-side context editing or compaction | Keeps cache valid and preserved thinking intact (13 §6) |
| Numeric tuning by an optimiser, not by the model | Raman rounds without token cost for pure parameter search |
| Recipes in the knowledge base | Shorter, more reliable code |

## 7. How to measure

- `bench/ttfp.bench.ts`: send → ghost, proxy, draft, final, using the mock model with recorded token timing.
- `bench/rebuild.bench.ts`: single-parameter change → part ready, per tier profile.
- `bench/viewport.spec.ts` (Playwright): orbit fps under CPU throttle, load time for 300k and 1M triangle parts, accumulation time to converged, heap after 20 part swaps.
- `bench/engine/*.json`: build time and peak memory for cube, fan, gyroid block, cylinder head.

Results are written to `reports/bench/<date>-<sha>.json` and compared against `bench/baselines/`. Use `dev/templates/PERF_REPORT_TEMPLATE.md` when reporting a change.
