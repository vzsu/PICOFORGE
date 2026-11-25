# 09 · Progressive preview: something visible within seconds

The user must never stare at an empty viewport. A request moves through five visible stages; each replaces the last without a flash to empty.

```
send ─► GHOST ──► REFERENCE ──► PROXY ──────► DRAFT POINTS ──► DRAFT MESH ──► VALIDATED
        <1 s      <1 s if a     ≤10 s p90     per part, as     blur → sharp   final swap
        particles recipe        right size    each part
                  matches       and type      builds
```

## 1. Honest timing

The language model is the slowest step. Writing 150–300 lines of geometry code takes tens of seconds (est., depends on model, effort and output speed). So the ≤ 10 s promise is met by stages that do not wait for code:

| Metric | Definition | Budget |
|---|---|---|
| TTG | Send → ghost particles on screen | < 1 s, always |
| TTP | Send → first shape-related points (reference or proxy) | ≤ 10 s, p90, mock model; live model measured and reported |
| TTD | Send → first real part geometry (draft points) | ≤ 20 s p90 when a recipe matches; ≤ 45 s p90 otherwise (est., measured in P3) |
| TTF | Send → validated result | Reported per mode, no fixed budget |

Each stage label in the readout (`GHOST`, `REFERENCE`, `PROXY`, `DRAFT`, `VALIDATED`) tells the user exactly what they are looking at. A proxy is never presented as the design.

## 2. Stages

### Stage 0 · Ghost (client only, < 1 s)
On send, the viewport shows about 4,000 particles in a soft cloud at the scene centre with a slow vertex-shader drift (no CPU work per frame), label `THINKING`. If a part is already on screen, the ghost appears around it instead.

### Stage 1 · Reference (server, no model, < 1 s)
`preview/recipes.ts` matches the prompt against the recipe catalogue with FTS5 (BM25 over titles and keywords, no model call). Above the confidence threshold, it sends that recipe's pre-computed point cloud (built during `deno task setup`), scaled to any size mentioned in the prompt, at 30 % opacity, label `REFERENCE`.

### Stage 2 · Proxy from the streaming brief (≤ 10 s)
Brief tool input streams token by token (13 §4: `eager_input_streaming`). A tolerant incremental JSON parser reads the partial brief; as soon as `category` and `envelope_mm` exist, `sampleProxy()` builds a template signed-distance function for that category at those dimensions and samples 20–50k surface points (est. < 50 ms). As more fields arrive (blade count, arm count, bore count) the proxy updates. The partial input is validated before use; malformed fragments are ignored, not executed.

| Category | Template SDF |
|---|---|
| `rotor` | Hub cylinder + n radial blades as twisted slabs |
| `frame_fpv` | Centre plate + n arms + motor pads |
| `bracket` | L-section with fillet |
| `enclosure` | Hollow rounded box |
| `engine_head` | Block with n bore cylinders and port channels |
| `nozzle` | Revolved bell or aerospike profile |
| `heat_exchanger` | Shell cylinder with core region |
| `generic` | Rounded box at envelope |

### Stage 3 · Draft points, part by part
Two ways to real geometry early:

1. **Recipe-first build.** When a recipe matched in stage 1 and the brief has its required parameters, the server builds the recipe's code with those parameters immediately (no code generation), at draft voxel size. This is real geometry from proven code, labelled `DRAFT · RECIPE`. The model's own design replaces it when ready.
2. **Part streaming.** The agent defines parts one at a time (`define_part`, 13 §3). Each part is compiled and built at draft voxel size (max dimension / 64) as soon as its function arrives, and its surface points stream to the viewport. The design fills in piece by piece.

### Stage 4 · Draft mesh with blur-to-sharp reveal
At draft mesh resolution (/150 on T0) each part is meshed, decimated, and revealed:
- Render the new mesh to an off-screen target (half resolution on T0).
- Over 700 ms (ease-out), blur radius goes from 12 px to 0 with a two-pass separable Gaussian, mesh opacity goes 0 → 1, and the point layer fades 1 → 0.
- After the transition, the mesh renders normally and the off-screen target is released.
- With `prefers-reduced-motion`, a 150 ms crossfade replaces the blur.

### Stage 5 · Validated
The final build (full voxel size, validation ladder passed) swaps in with a 250 ms crossfade. Parts appear in the explorer and become editable. The readout switches to `VALIDATED`.

## 3. Point-cloud rendering

- One growing `BufferGeometry` per part with preallocated capacity; chunks append without reallocations.
- Custom point shader: screen-space size attenuated by distance, round sprite with soft edge, colour = base grey × (0.35 + 0.65 · max(0, n·l)) × ao. Normal and AO are optional attributes; without them, colour by depth.
- Point budget per tier: T0 30k, T1 80k, T2 200k (total on screen). The server decimates to the budget it is told at connect time.

## 4. Binary frame `PTS1`

Sent as a WebSocket binary message. Little-endian.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 × u8 | magic `PTS1` |
| 4 | u8 | version (1) |
| 5 | u8 | stage (1 reference, 2 proxy, 3 draft) |
| 6 | u16 | flags (bit0 normals, bit1 ao, bit2 last chunk) |
| 8 | u8 + bytes | run id length + ASCII |
| … | u8 + bytes | node id length + ASCII (empty for whole-design proxies) |
| … | u32 | point count `n` |
| … | 6 × f32 | bbox min xyz, max xyz |
| … | n × 3 × u16 | positions quantised in bbox |
| … | n × 3 × i8 | normals (if flag) |
| … | n × u8 | AO (if flag) |

50,000 points with normals and AO = 500 KB (est.). The decoder validates lengths before reading; a malformed frame is dropped and logged, never thrown.

## 5. Failure behaviour

If a stage fails (no recipe match, brief without envelope, draft build error), the viewport stays on the previous stage and the status line continues; nothing flashes. A failed final build leaves the last draft on screen with the readout `DRAFT · FAILED VALIDATION` and the failure card in chat.

## 6. Tests (see 11)

`PERF-TTFP-01` ghost < 1 s · `PERF-TTFP-02` proxy ≤ 10 s with mock model streaming at 30 tokens/s · `PERF-TTFP-03` recipe-first draft for the fan prompt · `PREVIEW-CODEC-*` round-trip and fuzz · `PREVIEW-NOFLASH-01` screenshot sequence never contains an empty viewport after the first frame.
