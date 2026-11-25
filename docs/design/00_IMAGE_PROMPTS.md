# Image prompts

Paste a block into an image model. The first block is the main screen; the others are moments in the same product, written as iterations of the first.

## 1. Main screen (UI + rendering look)

```
A high-fidelity desktop application UI screenshot, 16:9, 2560x1440, clean dark mode in charcoal grey (#1E1E20), never pure black, for a computational engineering studio called PICOFORGE. The design fuses the iOS 17 UI kit (continuous rounded corners, inset grouped list cells, pill segmented controls, generous spacing) with Nothing OS restraint (monochrome palette, dot-matrix numerals for the wordmark and large readouts, circular and pill-shaped controls, thin outline icons, a single red accent #D71921 used only where something is live). Typography is a strict pairing: a clean geometric sans-serif (Geist style) for prose and list text, a light monospace (Geist Mono style) for labels, numbers, timestamps and status lines; tiny uppercase mono micro-labels in muted grey #8E8E93 with wide letter spacing, 15 px soft-white body text #EDEDED, only one bold item per panel. Layout from left to right: a 56 px icon-only rail with five thin outline icons and a tiny red dot on the active one; a project explorer taking 20 percent of the width, drawn as iOS inset grouped lists of projects, design variants, build runs with small mono run numbers and status dots, and a PARTS section listing head, water jacket, bores with eye toggles; a chat column taking 30 percent, starting with a pill segmented control (Chat, Compute, Logs, Analytics), a right-aligned user bubble in #2C2C2E with a tiny mono timestamp, a bubble-less assistant reply under a small mono label "PICOFORGE", a design brief as an inset grouped list with parameter names in sans and values in mono with small up and down arrows, then the single accent moment: one line "Working on structural optimisation" with a small glowing red dot, the words "structural optimisation" carrying a subtle shimmer, a right-aligned mono counter "03/04 · 00:42", and under it a hair-thin 2 px red progress line at 68 percent; finished steps folded into one muted mono line "✓ mesh · ✓ cfd"; at the bottom a floating pill composer with placeholder "Describe a change…", a mono segmented control LOW STD DEEP RAMAN with DEEP selected, and a small red circular stop button with a white square. The right 50 percent is the 3D viewport: a perspective three-quarter view of a CNC-machined aluminium V8 cylinder head with valve pockets, ports, bolt bosses and internal cooling channels, rendered in a real-time studio style: brushed aluminium with fine directional streaks, strong baked ambient occlusion darkening every pocket and port, crisp bright highlights on convex machined edges, neutral soft-box reflections, sitting on a dark grey studio floor #1F1F21 with a faint 10 mm grid that fades into darkness and a soft contact shadow, background a subtle radial charcoal gradient; a floating pill toolbar of circular outline icon buttons at the top left, a small rounded view cube labelled Front Top Right at the top right, a thin red green blue axis triad at the bottom left, and a bottom-centre readout pill in white dot-matrix numerals "VOL 412.7 cm³ · MASS 2.38 kg" with a small green check and a tiny mono label "VALIDATED". A thin status bar along the bottom edge reads "Saved · 2s ago" on the left and "T0 · ENGINE ● · AGENTS 1" on the right. Calm, sparse, lots of negative space, flat Dribbble-quality product UI shot, sharp legible text, no glassmorphism, no purple, no drop shadows on panels, no borders heavier than 1 px.
```

## 2. Progressive preview moment

```
Same PICOFORGE UI, same layout, palette and typography. The viewport shows the moment a design resolves: the lower half of an FPV drone frame is already a sharp brushed-carbon and aluminium mesh, while the upper arms are still a dense grey point cloud of tiny round dots that dissolves into a soft blur where it meets the solid surface. The readout pill shows the mono label "DRAFT" instead of VALIDATED. In the chat column the status line reads "Working on building draft" with the red dot and the counter "02/04 · 00:09". The explorer parts list shows plate and arms, with arms greyed as still building.
```

## 3. Direct editing with the gizmo

```
Same PICOFORGE UI. The left arm of the FPV frame is selected with a thin white outline; a CAD transform gizmo sits on it with three slim arrows in red, green and blue and small square plane handles; a tiny mono tooltip near the cursor reads "Δx +4.0 mm". A floating iOS-style inspector sheet on the right edge of the viewport, in #2C2C2E with 14 px corners, shows grouped sections TRANSFORM (X 4.0, Y 0.0, Z 0.0 in mono fields), PARAMETERS (arm_width = 9 mm, arm_len = (prop_d*25.4/2)/sin(pi/n_arms)+clearance = 95.8 mm), and a CODE row with "Copy part" and "Copy file" text buttons. The rest of the frame shows a dashed outline because the boolean result is rebuilding.
```

## 4. Settings and storage

```
Same PICOFORGE app with a full-window settings overlay in the iOS Settings pattern on charcoal: a left list of sections (General, Models and keys, MCP connections, Hardware, Rendering, Capture, Modes and budgets, Storage, Shortcuts, About) with Storage selected, and on the right an inset grouped list: "Projects and history 412 MB", "Exports 96 MB", then a CACHE group with rows Compiled code 38 MB, Part geometry 1.9 GB, Meshes and previews 640 MB, Point clouds 120 MB, Scan processing 210 MB, each with a thin grey usage bar and a "Clear" text button, and a single "Clear all cache" pill button at the bottom. Mono numbers, sans labels, no accent colour except a tiny red dot on the window's close control.
```

## 5. Rendering reference only (for checking the viewport look)

```
Product render of a CNC-machined aluminium V8 cylinder head, three-quarter perspective view, brushed aluminium with fine directional streaks, deep ambient occlusion in every pocket, port and bolt hole, crisp bright highlights along convex machined edges, neutral studio reflections from soft boxes, sitting on a dark charcoal studio floor with a faint millimetre grid fading into darkness and a soft contact shadow, subtle radial charcoal background, no other objects, sharp focus, real-time engine look rather than a photograph.
```
