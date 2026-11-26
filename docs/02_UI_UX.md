# 02 · UI and UX

Direction in one line: **iOS layout discipline with Nothing OS restraint, on charcoal.** Calm grey surfaces, rounded grouped lists, mono numbers, and one red accent that only appears where something is live.

## 1. Layout

```
┌──────┬──────────────────┬─────────────────────────┬──────────────────────────────────────────┐
│ RAIL │ EXPLORER  20%    │ CHAT  30%               │ VIEWPORT  50%                            │
│ 56px │                  │                         │                                          │
│  ⌂   │ PROJECTS         │ [Chat|Compute|Logs|Ana] │ (◉ ✥ ⟲ ▣ ⟂ ◎)            ┌──────────┐   │
│  ▣   │ ▾ OneShotFly     │                         │                          │ VIEW CUBE│   │
│  ≡   │   ▾ Designs      │            user bubble ▸│                          └──────────┘   │
│  ◎   │     v1.1 ● #1048 │ PICOFORGE               │            3D part                       │
│  ⚙   │   ▸ Runs         │ assistant text          │      (gizmo on selected part)            │
│      │ ▸ SpaceRockets   │ ┌ BRIEF ─────────────┐  │                                          │
│      │                  │ │ param        value │  │  z                                       │
│      │ PARTS            │ └────────────────────┘  │  └ x y                                   │
│      │  head      ◉     │ ● Working on struct…    │                                          │
│      │  jacket    ◉     │   03/04 · 00:42 ───68%  │  ( VOL 412.7 cm³ · MASS 2.38 kg · ✓ )    │
│      │  bores     ○     │ ( Describe a change…  ) │  ( LOW STD DEEP RAMAN )  ITER 3/8        │
│      │                  │ ( LOW STD DEEP RAMAN ■) │                                          │
└──────┴──────────────────┴─────────────────────────┴──────────────────────────────────────────┘
 Saved · 2s ago                                                     T0 · ENGINE ● · AGENTS 1
```

- The split between chat and viewport is a drag handle (6 px hit area, 1 px line). Explorer collapses with `Cmd/Ctrl + B`.
- The **Parts** section of the explorer lists the editable parts of the current design (see 08). Clicking selects the part in the viewport; the eye toggles visibility.
- An **inspector** opens as a floating sheet on the right edge of the viewport when a part is selected: transform fields, parameters, material, code.
- Below 1100 px window width the explorer becomes an overlay; below 760 px chat and viewport become a two-tab switch.

## 2. Tokens

Implemented as CSS variables in `app/src/styles/tokens.css` and mapped into Tailwind v4 `@theme` so shadcn components use them.

```css
:root {
  /* surfaces: charcoal, never pure black */
  --bg:        #1E1E20;   /* app background, viewport backdrop base */
  --panel:     #232325;   /* rail, explorer, chat column */
  --card:      #2C2C2E;   /* grouped list cells, bubbles, composer */
  --raised:    #343437;   /* hover, selected row */
  --line:      #3A3A3D;   /* hairlines, 1px */
  /* text */
  --ink:       #EDEDED;
  --ink-2:     #A1A1A6;   /* secondary prose */
  --ink-3:     #8E8E93;   /* micro-labels, timestamps */
  /* accent and status */
  --accent:    #D71921;   /* live state, stop, active dot. Nothing else. */
  --ok:        #30D158;
  --warn:      #FFD60A;
  /* axes (gizmo, triad) */
  --axis-x: #FF453A; --axis-y: #32D74B; --axis-z: #0A84FF;
  /* data colours: scalar-field colormap low → high; analysis views only, never chrome */
  --cmap-0: #1030FF; --cmap-1: #00B8FF; --cmap-2: #20E060; --cmap-3: #FFE020; --cmap-4: #FF2010;
  /* type */
  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --font-dot:  "Doto", var(--font-mono);   /* wordmark and big numerals only */
  /* shape: iOS-style */
  --r-cell: 10px; --r-card: 14px; --r-pill: 999px;
  /* motion */
  --t-micro: 120ms ease-out;
  --t-state: 220ms cubic-bezier(.2,.7,.2,1);
  --t-cam:   480ms cubic-bezier(.2,.7,.2,1);
}
```

**Fonts.** SF Pro cannot be bundled for Windows or Linux under Apple's licence, so Geist stands in for it; Geist Mono carries every number, label and status line; Doto (a dot-matrix face) is used only for the wordmark and large readout numerals. All three are OFL-licensed and bundled locally so the app works offline.

**Type scale.**

| Role | Face | Size / line | Weight | Notes |
|---|---|---|---|---|
| Micro-label | mono | 10.5 / 1 | 500 | UPPERCASE, tracking .12em, `--ink-3` |
| Readout | mono | 13 / 1 | 500 | `tabular-nums`; every measured value |
| Body | sans | 15 / 1.55 | 400 | chat prose |
| List row | sans | 14 / 1.3 | 400 | explorer, brief rows |
| Section | sans | 17 / 1.25 | 600 | panel titles |
| Display | dot | 28 / 1 | 400 | wordmark, big readout numbers |

Only one item per panel is bold. A number never appears in the body face.

## 3. Components (shadcn mapping)

| PicoForge element | shadcn / Base UI primitive | Skin rules |
|---|---|---|
| Chat tabs, mode switch | `Tabs` / `ToggleGroup` | Pill track `--card`, selected pill `--raised`, mono labels |
| Explorer tree | `Collapsible` + list rows | iOS inset grouped rows, 36 px, chevrons 12 px |
| Brief | `Table` inside a card | Two columns, hairline separators, values mono |
| Composer | `Textarea` + `Button` | Floating pill `--card`, 1 px `--line`, focus ring 2 px `--ink-3` |
| Stop | `Button` (destructive) | 32 px red circle with white square; replaces send while anything runs |
| Settings | `Dialog` (full overlay) + `Sidebar` | Left rail sections, content right; `Cmd/Ctrl + ,` |
| Inspector | `Sheet` (non-modal) | Grouped sections: Transform, Parameters, Material, Code |
| Menus | `DropdownMenu`, `ContextMenu` | Right-click a part: Hide, Isolate, Boolean ▸, Duplicate, Copy code |
| Tooltips | `Tooltip` | 500 ms delay; values in mono |
| Toasts | `Sonner` | Only for background events (agent connected, export done). Never "Success!" |
| Command palette | `Command` | `Cmd/Ctrl + K`: projects, parts, actions |

## 4. The chat column

Hierarchy from quietest to loudest: micro-labels → timestamps → assistant prose → user bubble → the live status line.

- **User message:** right-aligned bubble `--card`, radius 18, max 85 % width, mono timestamp below in `--ink-3`. No avatar.
- **Assistant message:** no bubble. A mono label `PICOFORGE` with the dot-matrix glyph, then plain prose.
- **Brief card:** iOS inset grouped list. Header micro-label `DESIGN BRIEF` and a category chip. Rows: parameter (sans, left) and value with unit (mono, right). Target rows show ↑ or ↓. Physics checks appear as rows ending in ✓ (`--ok`) or ✗ (`--accent`). Collapses to one line after acceptance.
- **Live status line (the accent moment):**
  ```
  ● Working on structural optimisation           03/04 · 00:42
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────────  (2px)
  ✓ mesh · ✓ cfd  ›
  ```
  The dot is `--accent` with a 1.6 s opacity pulse. The phrase after "Working on" carries a slow shimmer (a moving 30 % lighter band, 2.4 s loop). The counter is mono, right-aligned. The bar is 2 px, accent on a `--line` track. Finished steps fold into one muted mono line with a disclosure chevron. With `prefers-reduced-motion`, the pulse and shimmer stop and the dot stays solid.
- **Done state:** dot becomes `--ok`, text "Done in 1m 12s", one mono result row (`VOL · MASS · Δ`), and two text buttons: `Open in viewport`, `Run RAMAN`.
- **Failure state:** dot `--accent`, one plain sentence of what failed, a mono detail line, and one action button ("Retry at 0.6 mm voxels").
- **Composer:** floating pill. Placeholder rotates through real prompts. `Enter` sends, `Shift + Enter` new line. While a run is live the input stays usable and send shows `QUEUE (n)`. Mode switch `LOW STD DEEP RAMAN` sits inside the pill with an estimated duration for this machine shown on hover. `@` opens a picker for parts, faces and pins.

## 5. The viewport

- Top-left floating pill toolbar of 36 px circular icon buttons: Select, Move, Rotate, Section, Measure, Capture. Active tool gets `--raised` fill.
- View cube top-right (84 px, rounded faces, labels Front/Top/Right in sans). Click a face to tween, drag to orbit.
- Axis triad bottom-left in the axis colours.
- Readout pill bottom-centre in Doto numerals: `VOL 412.7 cm³ · MASS 2.38 kg · ✓`. A second line shows preview stage (`GHOST`, `DRAFT`, `VALIDATED`), tier and accumulation progress.
- Transform gizmo on the selected part (see 08). Agent annotations appear as a small accent ring with a label, never moving the user's camera unless *Follow agent* is on.

**Viewport looks.** Three looks share one baked mesh (docs/10). *Studio*: machined aluminium (default). *Loading*: translucent x-ray where silhouettes and machined creases glow, with surface point dust (T0 budget 30k points), and readout `VALIDATING`. *Analysis*: a scalar field (e.g. velocity magnitude) as the `--cmap-*` colormap on the still-shaded metal, a vertical legend top-left (title in sans, ticks in mono), and readout `SIMULATION COMPLETE`. Until P3 (preview) and P7 (analysis) produce real data, Loading and Analysis exist only in the mock-up, behind a `Studio · Loading · CFD` switch bottom-right. Live mode never shows a synthetic field. Reference images: `IMAGES_OFui/LOADING_POINTCLOUD_UI.png`, `CFD_SCREEN_UI.png`.

Viewport keys: `F` frame, `O` ortho/perspective, `1–6` standard views, `W` move, `E` rotate, `R` scale, `S` section, `M` measure, `H` hide, `Alt + H` show all, `Space` turntable, `Esc` deselect (or stop if nothing is selected and a run is live).

## 6. Settings (`Cmd/Ctrl + ,`)

Full overlay, left list in the iOS Settings pattern, content on the right, every change applies instantly and autosaves.

| Section | Contents |
|---|---|
| General | Units, default material, language, launch behaviour |
| Models and keys | Model, effort per mode, fast-response toggle, API key (write-only field with Test button) |
| MCP connections | Server status, token (reveal and rotate), copyable config per client, connected agents with revoke |
| Hardware | Detected tier, override, memory cap for builds, preview point budget |
| Rendering | Quality (Auto / Low / Medium / High / Studio), path tracing toggle (T2+), turntable default |
| Capture | Paired devices, certificate trust helper, USB route instructions |
| Modes and budgets | Max rounds and time per mode, analysis tiers allowed |
| Storage | Disk use by category with a Clear button per cache category (see 07); data location; export all |
| Shortcuts | Read-only list, searchable |
| About | Versions of app, engine, PicoGK, MCP spec |

## 7. Global shortcuts

`Cmd/Ctrl + ,` settings · `Cmd/Ctrl + K` command palette · `Cmd/Ctrl + B` explorer · `Cmd/Ctrl + J` console · `Cmd/Ctrl + Enter` send · `Cmd/Ctrl + Z` / `Shift + Z` undo/redo · `Esc` stop or close · `Cmd/Ctrl + C` on a selected part copies its code.

## 8. UX rules

1. Something moves in the viewport within 1 second of sending (09).
2. Estimates are never shown like measurements: estimates carry `~` and the analysis tier badge.
3. A weak machine is never an error. The UI says "draft resolution on T0" and offers "refine later".
4. Errors say what happened, then the one button that fixes it. No apologies, no dead ends.
5. Chrome never celebrates. The readout changing is the feedback.
6. Every control is keyboard reachable; focus ring 2 px; contrast at least 4.5:1 for text (`--ink-3` on `--panel` measures about 5.2:1 (est.); verify with the contrast test in 11).
