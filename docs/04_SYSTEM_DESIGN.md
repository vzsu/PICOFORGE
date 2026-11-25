# 04 · System design

## 1. Goals and their consequences

| Goal | Consequence |
|---|---|
| Never crash the app | Native geometry code runs only in disposable child processes; the server and engine host stay managed-only and supervised |
| First preview within seconds | Streaming everywhere; previews built from partial information (09); coarse-first builds |
| Never lose work | Every edit is a command committed in one SQLite transaction and appended to an event log |
| Works on 8 GB without a dedicated GPU | Scheduler enforces one heavy job at a time on T0; studio look baked on the server, not computed per frame |
| Any agent can drive it | One command bus for UI, internal agent and MCP; the MCP layer is an adapter, not a fork |

## 2. Processes

```
 Browser UI (React + three.js)        External agents (Claude Code, Codex, Gemini CLI …)
        │ HTTP + WS :7317                      │ MCP stdio (picoforged --mcp) or HTTP /mcp
        ▼                                      ▼
┌────────────────────────── picoforged (Deno) ──────────────────────────┐
│ http/ router · ws hub · static files      mcp/ adapter                │
│            └──────────────┬─────────────────┘                          │
│                     COMMAND BUS  ──►  scene store (SQLite)             │
│                           │                └── edits log, snapshots    │
│        harness/ (internal agent)   preview/ (ghost, proxy, points)     │
│        scheduler/ (tier-aware job queue)   capture/ (LAN listener)     │
└───────────────┬─────────────────────────────┬─────────────────────────┘
                │ ndjson JSON-RPC over stdio  │ child processes
        ┌───────▼────────┐             ┌───────▼──────────┐
        │ forge-engine   │             │ scan / analysis  │
        │ (.NET host)    │             │ workers (later)  │
        │ Roslyn, cache, │             └──────────────────┘
        │ sandbox pool   │
        └───────┬────────┘
                │ spawn per job, killed on any fault
        ┌───────▼────────┐
        │ forge-sandbox  │  loads PicoGK native runtime; builds parts; exports meshes, points, AO
        └────────────────┘
```

## 3. Command bus

Every state change from any actor is a typed command. This is what makes human and agent co-editing safe.

```ts
type Actor = { kind: "user" } | { kind: "agent"; origin: "internal" | `mcp:${string}` };

type Command =
  | { t: "part.transform"; nodeId: string; trs: TRS }
  | { t: "param.set"; paramId: string; expr: string }
  | { t: "op.add"; op: BoolOp; inputs: string[]; name?: string }
  | { t: "node.delete" | "node.hide" | "node.show"; nodeId: string }
  | { t: "nurbs.edit"; nodeId: string; cp: ControlPointEdit[] }
  | { t: "pin.add"; target: PinTarget; rule: PinRule }
  | { t: "variant.fork"; fromVariantId: string; name: string }
  | { t: "run.start"; variantId: string; mode: Mode; prompt?: string }
  | { t: "run.cancel"; runId: string | "all" };

interface CommandResult { editId: string; seq: number; effects: Effect[] }
```

`bus.dispatch(actor, cmd)`:
1. zod-validate the command.
2. Check permissions: agents cannot change settings, keys or another actor's pins; `run.cancel "all"` by the user overrides everything.
3. Open one transaction: apply to the scene store, append to `edits` with the inverse command, bump the variant's `rev`.
4. Commit, then broadcast `scene.patch` on WS (seq-numbered) and notify the MCP layer.
5. Schedule derived work (rebuild affected parts) through the scheduler.

Conflicts: commands carry the `rev` they were based on. A command against an older `rev` that touches the same node returns `STALE_REV` with the current value; the UI re-applies the user's intent, agents receive it as a tool error and retry.

## 4. WebSocket protocol

JSON frames for events, binary frames for bulk geometry. Every server frame has a monotonic `seq`; clients resume with `?resume=<seq>` from a 1,000-frame ring buffer, else re-hydrate over REST.

| Direction | Frame | Purpose |
|---|---|---|
| C→S | `cmd` `{id, cmd}` | Any command (3) |
| C→S | `chat.send` `{text, mode, mentions[]}` | User message |
| C→S | `viewport.capture.result` | Answer to a capture request |
| S→C | `cmd.ack` `{id, editId, seq}` / `cmd.reject` `{id, code, current}` | Command outcome |
| S→C | `scene.patch` `{variantId, rev, ops[]}` | Scene changed (any actor) |
| S→C | `chat.delta` / `chat.block` / `chat.done` | Streaming chat |
| S→C | `run.status` `{runId, stage, step, of, elapsedMs, frac}` | Drives the live status line |
| S→C | `preview.stage` `{runId, stage: ghost|proxy|draft|final}` | Preview stage changes |
| S→C | binary `PTS1` | Point cloud chunk (09 §4) |
| S→C | `part.mesh` `{nodeId, url, lod, stats}` | Mesh ready for a part |
| S→C | `geometry.ready` `{runId, variantId, stats}` | Validated result |
| S→C | `presence` `{actors[]}` | Connected agents and what they are doing |
| S→C | `error` `{errId, code, message, recoverable, action?}` | Typed failure |

Backpressure: 1 MiB queue watermark per socket. Above it, log lines and intermediate point chunks are dropped (final geometry and scene patches are never dropped).

## 5. Engine RPC (Deno ↔ forge-engine)

ndjson, one object per line, validated on both sides.

| Method | Purpose |
|---|---|
| `engine.hello` | Versions, symbol-table hash |
| `engine.compile {code, codeId}` | Roslyn compile with analyzers; DLL cached by hash |
| `engine.build {codeId, params, parts?, voxelMm, stage, limits, exports}` | Build all or selected parts at a stage (`draft` or `final`) |
| `engine.samplePoints {partCacheKey, count}` | Surface points from cached voxels |
| `engine.inspect {target, ops}` | Measurements, slices, min wall |
| `engine.cancel {jobId}` | Kill the child |
| `engine.ping` | Liveness, memory |

Notifications: `job.log`, `job.progress {frac, step}`, `job.partReady {nodeId, cacheKey, mesh, points}`.

## 6. Scheduler

One queue per machine, aware of the hardware tier.

| Tier | Heavy slots | Sandbox memory cap | Draft voxel | Final voxel |
|---|---|---|---|---|
| T0 (8 GB, integrated GPU) | 1 | 2.5 GB | max dim / 64 for points, / 150 for mesh | / 250 |
| T1 (16 GB) | 1–2 | 6 GB | / 64, / 200 | / 400 |
| T2 (32 GB, dedicated GPU) | 3 | 12 GB | / 96, / 300 | / 600 |
| T3 (workstation) | configurable | configurable | configurable | configurable |

Priorities: user-initiated preview > user edit rebuild > agent run > study round > cache warmup. A user edit pre-empts a running study round (the round is re-queued, not lost).

## 7. Failure model

Each row has a detector, a containment boundary, a recovery and a user-visible result. Every `throw` in the code maps to one row (or a new row is added first).

| # | Failure | Containment | Recovery | User sees |
|---|---|---|---|---|
| F1 | Generated code fails to compile | Never executed | Repair loop (13) | Status line "fixing a compile error (1/3)" |
| F2 | Exception during build | Sandbox only | Repair with stack + logs | Same |
| F3 | Native crash, out of memory, timeout | Child killed | Typed error with resource hint | Plain sentence + "Retry at coarser voxels" |
| F4 | Geometry invalid (empty, leaky, too thin, outside envelope) | — | Repair with measured numbers | Failed check and its numbers |
| F5 | Engine host dies | Supervisor | Restart with backoff; orphan runs → failed | Toast + retry button |
| F6 | Model API error or rate limit | — | SDK retries, then surface | "Model unavailable, retrying" |
| F7 | WebSocket drop | Client buffers commands | Reconnect + seq resume | Small status chip |
| F8 | SQLite busy or corrupt | WAL, busy timeout | Retry tx; corrupt → quarantine and restore from last snapshot | Recovery dialog |
| F9 | WebGL context lost | Viewport only | Re-init, reload, drop a tier | 1.5 s "restoring viewport" veil |
| F10 | No WebGL at all | — | Image-strip fallback (10 §9) | Badge "image mode" |
| F11 | Disk full | Write fails cleanly | Offer cache clear | Storage dialog |
| F12 | Bad or expired API key | — | Focus key field in settings | Inline prompt |
| F13 | Stale revision from an agent | Command rejected | Agent retries with current value | Nothing (agent-side) |
| F14 | Preview stage fails | Preview only, run continues | Skip to next stage | Stage label skips |
| F15 | Engine reply fails its schema, or an inspect/export call fails | Reply discarded, nothing applied | Typed tool error to the agent; repeated → treat as F5 | "Inspect/export failed" sentence + retry |
| F16 | Agent tool misuse (tool out of order, tool budget spent) | Tool not executed | Typed tool error; budget spent → `ask_user` | Nothing, or the ask_user card |

Code → row mapping lives in `server/domain/failures.ts` (test `FAIL-MAP-01`).

## 8. Security

- Server binds 127.0.0.1. Every REST, WS and MCP-over-HTTP request requires `X-PicoForge-Token` (printed in the app window and shown in Settings → MCP).
- The LAN capture listener is a separate port that accepts only paired devices and only frame uploads.
- Generated C# is hostile input: analyzer bans (`System.IO`, `System.Net`, `System.Reflection.Emit`, `System.Diagnostics`, threading except `Interlocked`, `unsafe`, `DllImport`, `Environment`, `AppDomain`), then compile, then run in a child with no network, cwd set to its run folder, no inherited secrets, and OS-level limits (Windows job object with memory and process limits; on Linux, namespaces and seccomp). The analyzer is a filter, not the sandbox; both are required.
- Agents cannot read settings, keys or files outside artifact URLs.

## 9. Performance budgets (release gate, measured by `deno task bench`)

| Metric | Budget |
|---|---|
| Send → intent ghost visible | < 1 s |
| Send → first shape-related preview (p90, mock model) | ≤ 10 s |
| Gizmo drag → part moves on screen | same frame (client-side transform) |
| Parameter change → rebuilt part (single part, T0, typical) | < 3 s (est.) |
| Edit → committed to DB | < 300 ms |
| Cold start → interactive UI | < 2.5 s |
| Idle server memory | < 180 MiB |
| T0 viewport orbit | ≥ 30 fps at dynamic resolution |
