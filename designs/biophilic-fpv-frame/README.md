# Biophilic 3-inch FPV carbon frame

Designed by **Claude Code** (claude-opus-5-5) driving PicoForge over MCP, from one prompt; built on the
PicoGK engine and validated (watertight, inside the envelope, minimum wall).

- Run: `01M8FZ2H1AM284CGCHZ7PNSMKR` · last change: fillet a tall extrusion then trim to 0..t so the plate is purely Z-prismatic (no blind pockets); fillet 1.6, leaf 12
- Volume 14.1347 cm³ · 748,904 triangles · voxel 0.20000000298023224 mm · watertight true
- Bounding box -55.7, -55.7, -0.0 → 55.7, 55.7, 3.0 mm

Files: `brief.json` (the accepted design brief: every governing number, its rationale and the physics
checks), `design.cs` (the PicoGK code; rebuild it with `run_picogk` after submitting the brief),
`*.png` (captures the agent took to check its work). The mesh (`part.stl`) stays in
`~/PicoForge/runs/01M8FZ2H1AM284CGCHZ7PNSMKR/` (too large for git); download it from the app's Design files list.

## The agent's report

Built a biophilic 3" unibody bottom plate in CF_3K. It is 3 mm thick and fully Z-prismatic, so every cut-out goes through and it can be CNC-cut.
- Geometry: true-X, 125 mm motor-to-motor diagonal (62.5 mm centre to motor). Overall 111.3 x 111.3 x 3.0 mm. Watertight; minimum wall probe 2.36 mm (CF minimum is 1.5 mm).
- Props: adjacent motors are 88.4 mm apart, so 76.2 mm props have 12.2 mm tip-to-tip gap. Prop discs clear a 25.5 mm stack board by about 6.4 mm and the seed-shaped body outline by about 1.4 mm in plan view.
- Motor pads: flower pads with 4 petals, 12x12 mm M2 pattern (2.2 mm holes, 1.9 mm edge wall), 6 mm shaft relief.
- FC: 20x20 mm M2 stack holes, plus a central seed cut-out and fore/aft leaf cut-outs.
- Arms: each arm is a leaf with a tapered midrib (9 to 6 mm), curved margin veins (4.4 to 3.2 mm) and 2.4 mm lateral veins. 1.6 mm grown fillets; 6 vein openings per arm.
- Mass: 14.13 cm3 x 1.55 g/cm3 = about 21.9 g (measured volume, nominal density).
- Estimates (first-order beam theory, midrib only): 40 N crash at the motor gives 135 MPa, SF about 4.2 against 570 MPa tensile. Note that flexural and interlaminar strength of CF plate are lower than tensile. Max-thrust deflection about 0.09 mm. Not FEA; the 40 N crash load is an assumption.
- Not included: top plate, standoffs, camera mount, battery strap slots.
Next step: design the matching 2 mm top plate with strap slots and a camera cage, then check how stiff the frame is with both plates on standoffs.
