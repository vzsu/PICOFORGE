# 05 · Architecture and reusable functions

Rule for every new unit of code: before writing it, check in order whether it needs to exist, whether it already exists here (ask codegraph), whether the standard library or platform does it, whether an installed dependency does it, and only then write the minimum that works. A unit the spec requires (validator, supervisor, sandbox) always needs to exist; the rule governs how small it is, not whether it exists.

## 1. Module map and dependency direction

```
domain  ←  db  ←  bus  ←  http / ws / mcp
   ↑        ↑      ↑
   └── harness ────┤
   └── preview ────┤
   └── scheduler ──┘──→ engine/client ──→ forge-engine (.NET)
app: protocol ← state ← features ← components/ui
                 ↑
              viewport (imperative, no React)
```

- `domain/` imports nothing from the project. Everything else may import `domain/`.
- `http/`, `ws/` and `mcp/` only translate protocols into `bus.dispatch` calls and queries. No business logic there.
- Only `harness/anthropic.ts` imports the Anthropic SDK. Only `engine/client.ts` speaks engine RPC. Only `db/` runs SQL.
- In the app, React components never touch three.js objects; they call `ViewportEngine` methods and subscribe to its status.

A lint rule (`deno lint` plugin or an import-map test) fails the build if these directions are violated.

## 2. Reusable functions: server (TypeScript)

These are the shared building blocks. New code must use them rather than re-implement them. Each has unit tests in the same folder.

| Function | Module | Contract |
|---|---|---|
| `ulid(): string` | `domain/ids.ts` | Sortable unique id |
| `ok(v)`, `err(e)`, `Result<T,E>` | `domain/result.ts` | Fallible operations return a Result, never throw across modules |
| `assertNever(x): never` | `domain/result.ts` | Exhaustive switch guard |
| `parseOrErr(schema, data)` | `domain/validate.ts` | zod parse → `Result` with a flat error list |
| `withTx(db, fn)` | `db/db.ts` | One transaction, retries `SQLITE_BUSY` 3×, never nested |
| `bus.dispatch(actor, cmd)` | `bus/bus.ts` | The only way to change scene state (04 §3) |
| `bus.query(q)` | `bus/query.ts` | Read-only scene queries for UI, agent and MCP |
| `invert(cmd, before): Command` | `bus/invert.ts` | Inverse command for undo |
| `contentKey(...parts): string` | `domain/hash.ts` | sha256 of canonical JSON; cache keys everywhere |
| `canonicalJson(v)` | `domain/hash.ts` | Sorted keys, no whitespace; required for stable hashes and prompt caching |
| `evalParams(params): Result<Map<string,number>>` | `domain/expr.ts` | Topological evaluation of parameter expressions; detects cycles (08 §3) |
| `cache.get/put/touch/evict(kind, key)` | `db/cache.ts` | Content-addressed artifact cache with LRU per tier (07) |
| `scheduler.enqueue(job, priority)` | `scheduler/queue.ts` | Tier-aware job queue; returns a handle with `cancel()` and progress |
| `emit(conversationId, frame)` | `http/ws.ts` | Seq-numbered broadcast with ring buffer |
| `log(area, level, msg, data?)` | `log.ts` | ndjson line; redacts keys by name |
| `retry(fn, policy)` | `domain/retry.ts` | Exponential backoff with jitter, cancellable via `AbortSignal` |
| `debounceCommit(key, ms, fn)` | `bus/debounce.ts` | Coalesces high-rate edits (slider scrubs) into one commit |
| `sampleProxy(category, envelope, n)` | `preview/proxy.ts` | Proxy point cloud from a brief (09 §3) |
| `encodePoints(f32, bbox): Uint8Array` | `preview/codec.ts` | Quantised `PTS1` binary frame (09 §4) |
| `hwProfile()` | `scheduler/hardware.ts` | Detect tier from RAM, cores, GPU hints from the client |

## 3. Reusable functions: app (TypeScript)

| Function | Module | Contract |
|---|---|---|
| `useScene(selector)` | `state/scene.ts` | Subscribe to scene slices; re-render only on change |
| `sendCommand(cmd): Promise<CommandResult>` | `protocol/client.ts` | Optimistic apply + server ack/reject reconciliation |
| `useAutosaveStatus()` | `state/save.ts` | "Saved · 2s ago" indicator |
| `ViewportEngine` | `viewport/ViewportEngine.ts` | Imperative renderer API (10 §2) |
| `PointCloudLayer` | `viewport/layers/points.ts` | Streams `PTS1` chunks into one growing buffer |
| `RevealTransition` | `viewport/passes/reveal.ts` | Blur-to-sharp crossfade between preview stages |
| `GizmoController` | `viewport/gizmo.ts` | Wraps `TransformControls`, snapping, emits `part.transform` on release |
| `measure(a, b)` | `viewport/measure.ts` | Point/edge/face distances using BVH raycasts |
| `formatValue(v, unit)` | `lib/format.ts` | Mono-ready strings with units and significant figures |
| `copyText(s)` | `lib/clipboard.ts` | Clipboard with fallback |
| `kbd(binding, handler)` | `lib/keys.ts` | Global and viewport-scoped shortcuts with conflict detection |

## 4. Reusable functions: engine (C#)

| Member | Project | Contract |
|---|---|---|
| `Ctx.P(name)` / `Ctx.Pi(name)` | Kit | Read evaluated parameters (float / int); throws with the list of known names if missing |
| `Ctx.Part(id, Func<Voxels>)` | Kit | Registers a part; result cached by `(codeHash, id, paramsHashForPart)` |
| `Ctx.Op(id, BoolOp, params string[] inputs)` | Kit | Boolean node over registered parts |
| `Ctx.Xform(id)` | Kit | Current transform of a part from the scene document |
| `Ctx.Log(msg)`, `Ctx.Progress(frac)` | Kit | Streamed to the status line |
| `Kit.vox*` primitives, sweeps, patterns | Kit | Existing catalogue from `PICOGK_KNOWLEDGE.md` §4 |
| `Kit.Nurbs.Curve`, `Kit.Nurbs.Surface` | Kit | Rational B-splines; `mshTessellate(tolMm)`; `voxThicken(Ctx, mm)` (08 §5) |
| `Kit.FilletClose`, `Kit.RoundOpen`, `Kit.Shell` | Kit | Offset-based modifiers |
| `Stats.Of(Ctx, Voxels)` | Kit | Volume, area, bbox, triangles, watertight, min wall probe |
| `Bake.VertexAo(mesh, occupancy)` | Sandbox | Per-vertex AO from a coarse occupancy grid (10 §4) |
| `Bake.VertexCurvature(mesh)` | Sandbox | Signed curvature for edge shading |
| `Points.FromVoxels(vox, n, seed)` | Sandbox | Deterministic surface samples |

## 5. Code contract for generated designs (v2)

The model writes one static class. The emitter (08 §6) writes the same shape when the user edits by hand.

```csharp
using System.Numerics; using PicoGK; using PicoForge.Kit;

public static class Design
{
    public static void Build(Ctx ctx)
    {
        Voxels plate = ctx.Part("plate", () => Parts.Plate(ctx));
        Voxels arms  = ctx.Part("arms",  () => Parts.Arms(ctx));
        ctx.Result(ctx.Op("frame", BoolOp.Union, "plate", "arms"));
    }
}

public static class Parts
{
    // arm_len   = (prop_d * 25.4 / 2) / sin(pi / n_arms) + clearance     [mm]
    // arm_width = see brief: bending check σ = 6FL / (b h²) ≤ σy / SF
    public static Voxels Arms(Ctx ctx) { /* uses ctx.P("arm_len"), ctx.P("arm_width") … */ }
    public static Voxels Plate(Ctx ctx) { /* … */ }
}
```

Rules: every dimension comes from `ctx.P`; every part is registered with `ctx.Part`; equations used to derive values are written as comments above the function that uses them and also stored as parameter expressions (08 §3); no I/O, no threads, no reflection.
