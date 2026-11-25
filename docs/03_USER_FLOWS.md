# 03 · User flows and perspective

## 1. Who uses it and where

| Persona | Setting | What they need most |
|---|---|---|
| **Hobbyist engineer** (primary) | Laptop, often 8–16 GB, integrated graphics; garage or desk; phone in hand for photos | Fast visible progress, parts that fit real objects, no lost work |
| **Engineer with an agent** | Runs Claude Code, Codex or Gemini CLI; PicoForge open beside it | Agent builds, human watches and corrects; clean MCP behaviour |
| **Remote operator** | PicoForge on a desktop or server; UI opened from another device on the LAN | Same UI over the network, camera capture from the phone |

The user perspective that drives every flow: *I describe a thing, I see it start to exist within seconds, I can grab any piece of it and change it, and I never press save.*

## 2. Flows

Each flow is an acceptance script. The Playwright spec with the same ID lives in `e2e/flows/`.

### F1 · First run
1. Launch `picoforged` → app window opens; wizard dialog.
2. Step 1 API key: paste, `Test`, stored to the keyfile, never shown again.
3. Step 2 Engine: self-test builds a 10 mm cube with a mini status line; failure shows the fix (install .NET 9, restore NuGet).
4. Step 3 Hardware: 3 s probe assigns T0–T3; user can override.
5. Lands in an example project with three starter prompts.
**Pass:** cube visible, tier chip shown, settings persisted after restart.

### F2 · Prompt to part (golden path)
1. User types "Design a 5-inch FPV frame for 2306 motors and a 30.5 mm stack, as light as possible" and sends.
2. Under 1 s: the viewport shows the intent ghost (particle field, label `THINKING`).
3. The brief streams into the chat; as soon as its envelope is known the ghost becomes a proxy point cloud of the right size (`GHOST`).
4. Status line: "Working on writing geometry code", then "compiling", "building draft".
5. Draft points replace the proxy; then the draft mesh resolves through a blur into a sharp surface (`DRAFT`).
6. Final validated mesh swaps in (`VALIDATED`); readout shows volume and mass; parts appear in the explorer.
**Pass:** first shape-related preview at or under 10 s (p90, mock model); final geometry watertight; parts listed.

### F3 · Edit a part directly
1. Click the left arm in the viewport → it highlights; inspector opens; gizmo appears.
2. Drag the X arrow 4 mm → the arm moves live (client-side transform); readout updates after the background rebuild.
3. Type `arm_width = 9` in the inspector → part rebuilds; dependent values (mass) update.
4. `Cmd/Ctrl + Z` twice → back to the original.
**Pass:** each edit appears in the `edits` log within 300 ms; undo restores identical geometry hash.

### F4 · Boolean and NURBS
1. Select `frame_plate` and `vent_cutter`, right-click → Boolean ▸ Subtract.
2. A new `op` node appears in the parts list; code panel shows the generated line.
3. Add a NURBS canopy surface from the toolbar; drag control points; thicken 1.2 mm.
**Pass:** resulting code compiles and rebuilds to the same geometry hash as the live result.

### F5 · Copy the code
1. Select a part → inspector → Code → `Copy part` or `Copy full file`.
2. The copied C# includes the parameter table and equations as a header comment.
**Pass:** pasting the full file into a fresh project and running it reproduces the geometry hash.

### F6 · Change by chat
1. User: "Make the arms 15 % stiffer but keep weight under 120 g."
2. Agent submits a brief delta, regenerates only affected part functions, rebuilds.
**Pass:** untouched parts keep their cached voxels (cache hit logged); undo reverts the whole agent change as one step.

### F7 · Stop
1. During any run, press the red stop button or `Esc`.
2. All runs in the project stop, including external agents' runs; the last good geometry stays.
**Pass:** sandbox child killed within 1 s; run rows `cancelled`; no orphan processes.

### F8 · Settings and cache
1. `Cmd/Ctrl + ,` → Storage → sizes per category.
2. Clear "Preview point clouds" and "Voxel cache".
3. Reopen a project → geometry regenerates on demand.
**Pass:** projects, parameters, code and exports untouched; regenerated geometry hash matches.

### F9 · An external agent drives, the human co-edits
1. User pastes the bootstrap prompt from the docs site into Claude Code.
2. Agent connects; `AGENTS 1` chip appears; run cards carry `mcp · claude-code`.
3. While the agent builds variant B, the user pins a mounting hole on variant A.
4. User changes a pinned dimension; the agent's in-flight run on that variant fails with `BRIEF_STALE` and retries with the new value.
**Pass:** no lost events; pins enforced by the validator; agent cannot move the user's camera.

### F10 · Scan to fit
1. Capture panel → pair phone by QR (LAN with trusted certificate) or plug in USB (Android, `adb reverse`).
2. Guided capture with coverage dome; or import an OBJ/PLY/GLB from a scanning app.
3. Reconstruction runs as a background job; result registered with scale markers.
4. Caliper card asks for 3–5 measurements; confirmed values override scanned ones.
5. User prompts "Design a clamp for this tube"; the clamp is built against the scan.
**Pass:** reported scan error on the calibration object; clamp bore matches confirmed diameter within one voxel.

### F11 · Raman mode study
1. Select RAMAN, send "Minimise mass of this bracket, safety factor ≥ 2".
2. Study card fills one row per round with thumbnail and metrics; variants strip grows.
3. Stops on convergence, budget or stop.
**Pass:** ledger persisted; chosen variant loads; every number carries its analysis tier badge.

### F12 · Recover from a crash
1. Kill the engine process mid-run.
2. Toast "Engine restarted"; run card shows `ENGINE_LOST` with a Retry button; app stays responsive.
**Pass:** supervisor restarts within backoff; no data loss; retry succeeds.

## 3. Moments that matter (perspective notes for designers)

| Moment | What the user feels | Design answer |
|---|---|---|
| After pressing send | "Did it hear me?" | Ghost under 1 s, status line names the current step |
| Long build on a weak laptop | "Is it stuck?" | Elapsed counter, step `03/04`, honest ETA band for the tier |
| First sight of the part | "Is that right?" | Proxy → draft → final keeps the shape continuous; no flash to empty |
| Wanting to tweak one piece | "Do I have to explain this in words?" | Click it, drag it, type a number |
| Phone in one hand | "I can't type now" | Capture page has one shutter button and haptic ticks |
| Leaving mid-work | "Did I save?" | Saved indicator; nothing to save |
