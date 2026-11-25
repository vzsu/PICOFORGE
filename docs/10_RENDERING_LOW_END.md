# 10 · Rendering: the studio look on any PC

Target look (from the reference screenshot): machined brushed aluminium, deep shadow in every pocket and port, crisp bright edges, a dark grey studio floor with a faint grid fading into the dark, a soft contact shadow, neutral reflections.

The principle that makes it cheap: **compute the expensive light once per geometry change, on the server or in one GPU pass, and store it with the mesh.** Per frame, the GPU only does simple shading plus a lookup. Path tracing is an extra for strong GPUs, never the baseline.

## 1. Where each part of the look comes from

| Visual ingredient | Expensive way | PicoForge way | Cost per frame |
|---|---|---|---|
| Dark pockets and ports | Screen-space AO or path tracing | **Baked per-vertex AO** from a coarse occupancy grid, computed in the sandbox (§4) | One attribute multiply |
| Crisp bright edges | Many lights, high-res reflections | **Baked curvature**: convex edges brightened, concave darkened (§4) | One attribute multiply |
| Metal reflections | Real-time cube maps | **Pre-filtered environment** from three.js `RoomEnvironment` through `PMREMGenerator`, built once at startup | Standard PBR lookup |
| Brushed finish | Anisotropic BRDF | Tier T2+: `MeshPhysicalMaterial.anisotropy`. T0–T1: a 256² tiling roughness/normal noise stretched along one axis, applied with object-space triplanar mapping | One texture fetch ×3 |
| Contact shadow | Shadow maps every frame | **Baked once per geometry change**: top-down orthographic depth render, two blur passes, stored as the floor texture | Zero |
| Floor grid | Geometry lines | Procedural grid in the floor shader with distance fade | A few ALU ops |
| Clean edges | High MSAA, supersampling | **Idle accumulation**: when the camera stops, accumulate 8–16 sub-pixel jittered frames | Only while idle, then stops |
| Converged "studio" image | Path tracing | T2+ only: `three-gpu-pathtracer` after idle | Off on T0–T1 |

## 2. ViewportEngine API (React talks only to this)

```ts
class ViewportEngine {
  constructor(canvas: HTMLCanvasElement, opts: { tier: Tier });
  loadPart(nodeId: string, src: { url: string; lod: "draft" | "final" }): Promise<void>;
  setPartTransform(nodeId: string, m: Matrix4): void;        // instant, client-side
  pushPoints(frame: ArrayBuffer): void;                     // PTS1 chunk
  reveal(nodeId: string, opts?: { ms?: number }): Promise<void>;
  select(ids: string[]): void;  setTool(t: Tool): void;
  setView(v: ViewName, tween?: boolean): void;  frame(ids?: string[]): void;
  setSection(s: SectionPlane | null): void;  setQuality(q: Quality): void;
  capture(req: CaptureReq): Promise<Blob>;
  status(): { fps: number; mode: "interactive" | "accumulating" | "converged" | "pathtracing";
              samples: number; tris: number; drawCalls: number; tier: Tier };
  dispose(): void;
}
```

Never throws to React; failures return typed codes (`LOAD_PARSE`, `CONTEXT_LOST`, `CAPTURE_TIMEOUT`).

## 3. Frame loop

```
on input / gizmo / turntable / resize:
    mode = interactive
    renderScale = tier.interactiveScale (dynamic: lowered if frame > 33 ms on T0)
    draw scene once (no jitter, no accumulation)

when camera idle for 300 ms:
    mode = accumulating
    for k in 1..N (N = 8 on T0, 16 on T1+), one per animation frame:
        jitter projection by Halton(2,3)[k] sub-pixel offset
        render to float target, blend: acc = acc + (frame - acc) / k
        present acc
    mode = converged; stop rendering (GPU idle)

if tier ≥ T2 and studio mode on and still idle:
    mode = pathtracing (progressive samples, stop at the settings cap)
```

- Render on demand only. A static scene costs nothing.
- Float render targets need `EXT_color_buffer_float`; fall back to half-float, then to no accumulation (MSAA only).
- Any input returns to `interactive` within one frame.

## 4. Server-side baking (in the sandbox, after meshing)

Baked values travel as GLB vertex attributes (`_AO` as normalised u8, `_CURV` as normalised i8) and in `PTS1` frames for point clouds.

**Ambient occlusion from a coarse occupancy grid.**
1. Build an occupancy grid `G` over the part bounds at 96³ (T0) to 160³ (T2) by sampling `Voxels.bIsInside` at cell centres (PicoGK 2.0+). `VERIFY:` timing in P0; if too slow, derive occupancy from the narrow-band SDF or from the draft voxels downsampled.
2. For each vertex `p` with normal `n`, cast 16 rays over the cosine-weighted hemisphere (fixed Hammersley directions, the same for every vertex so results are deterministic).
3. March each ray through `G` from `p + n · 1.5 cells` up to distance `D` (default 25 % of the part's bounding diagonal) with 1-cell steps; a hit before `D` adds occlusion weighted by `1 − t/D`.
4. `ao = 1 − (Σ weighted hits / 16)`, then smooth once over mesh neighbours. Stored 0–255.
Cost scales with vertex count × 16 × steps; decimate to the display mesh first, then bake (est. well under 1 s for 200k vertices on 4 cores; measured in P0).

**Curvature for edge shading.** For each vertex, average `(n_i − n_j) · (p_i − p_j) / |p_i − p_j|²` over its edge neighbours. Positive = convex (edges, ribs), negative = concave (fillets, pockets). Clamp to the 2nd–98th percentile and normalise to −1…1.

**Shader use** (`onBeforeCompile` patch on `MeshStandardMaterial`):
```glsl
float occ  = mix(1.0, aoAttr, uAoStrength);                 // uAoStrength 0.85
float edge = clamp(curvAttr, -1.0, 1.0);
diffuseColor.rgb *= occ;                                     // pockets darken
reflectedLight.indirectSpecular *= occ;                     // no reflections inside pockets
totalEmissiveRadiance += uEdgeTint * max(edge, 0.0) * 0.12; // bright machined edges
roughnessFactor = clamp(roughnessFactor - max(edge,0.0)*0.08, 0.05, 1.0);
```

## 5. Materials

| Preset | Base colour | Metalness | Roughness | Extra |
|---|---|---|---|---|
| Aluminium (default) | #B9BDC2 | 1.0 | 0.34 | Brushed noise; AO 0.85; edge tint #FFFFFF |
| Titanium | #8F918F | 1.0 | 0.40 | Brushed noise |
| Carbon / dark composite | #2A2B2D | 0.0 | 0.45 | Clearcoat 0.6 on T2+ |
| Clay (form review) | #8E8E88 | 0.0 | 0.85 | AO 1.0 |
| Resin | #3A3D3B | 0.0 | 0.45 | Clearcoat on T2+ |

Selection outline: inverted-hull outline pass on the selected mesh only (cheap) rather than a full-screen edge detection pass.

## 6. Studio scene

- Background: shader-drawn radial gradient `#26262A` centre to `#18181A` corners (charcoal, never black).
- Floor: disc of radius 6 × part diagonal; base `#1F1F21`; procedural grid 10 mm minor at 6 % and 100 mm major at 12 % opacity, faded with distance; baked contact shadow multiplied in.
- Lights: environment only on T0 (the PMREM environment does the work); T1+ adds one directional key light without shadows for a specular highlight. Lights scale with the part diagonal so a screw and an engine head sit in the same studio.
- Tone mapping: ACES Filmic, exposure 1.0, sRGB output. (AgX is the alternative to test in P5 if metals look too contrasty.)
- Camera: perspective FOV 35° by default for the hero look; orthographic toggle with `O`. Home view: azimuth 45°, elevation 30°.

## 7. Tiers

Assigned at first run by a 3-second probe (raster frames of a test scene, a float-target check, `WEBGL_debug_renderer_info` where available) and stored in settings. Downgraded at runtime by the watchdog.

| | T0 | T1 | T2 | T3 |
|---|---|---|---|---|
| Interactive render scale | 0.6–1.0 dynamic | 1.0 | 1.0 × DPR (cap 2) | full |
| MSAA | off | 4× | 4× | 4× |
| Idle accumulation frames | 8 | 16 | 16 | 32 |
| Brushed metal | triplanar noise | triplanar noise | anisotropy | anisotropy |
| Key light | none | 1, no shadow | 1 + soft shadow | 1 + soft shadow |
| Path tracing | off | off | optional | optional |
| Display triangles | ≤ 300k | ≤ 1M | ≤ 2M | ≤ 4M |
| Point budget | 30k | 80k | 200k | 400k |
| Environment map size | 128 | 256 | 512 | 1024 |

Watchdog: interactive frames over 40 ms for 2 s → lower render scale; still slow at 0.6 → drop a tier for the session (badge shows it).

## 8. Geometry delivery

- The server post-processes engine GLBs with meshoptimizer: simplify to the tier's triangle budget, quantise attributes (`KHR_mesh_quantization`), compress (`EXT_meshopt_compression`). Decoding on the client uses `MeshoptDecoder`. `VERIFY:` the `meshoptimizer` npm package runs under Deno in P0; otherwise run `gltfpack` as a child process.
- Full-resolution meshes are kept for measurement and export, not for display.
- Raycasting uses `three-mesh-bvh` on the display mesh; precise measurements go to `engine.inspect`.

## 9. No WebGL at all

On machines where WebGL cannot start (no GPU, remote desktop, locked-down VM) the viewport switches to image mode: the sandbox renders 8 turntable stills (and the 6 standard views) on the CPU after each build, using the same baked AO and curvature with a simple software rasteriser or PicoGK's bitmap rendering (`VERIFY:` PicoGK 2.0 bitmap render API via DumpApi). The viewport becomes a scrub strip with the same readout and measuring by clicking pixels mapped back to geometry. Alternatively, open the UI from another device on the network.

## 10. Image prompt for this look

The prompts that reproduce this rendering style for mock-ups are in `../00_IMAGE_PROMPTS.md`.
