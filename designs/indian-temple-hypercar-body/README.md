# Scorpion-inspired GT hypercar body (1:18) with Indian temple border motifs

Designed by **Claude Code** (claude-opus-5-5) driving PicoForge over MCP, from one prompt; built on the
PicoGK engine and validated (watertight, inside the envelope, minimum wall).

- Run: `01M8G232XRYRWNNGH1V1V127RH` · last change: rev2: lower deck/rear heights for a sleeker profile and a prouder canopy; tail keypoints re-seated on the lower deck; wing below the sting apex
- Volume 200.395 cm³ · 2,514,148 triangles · voxel 0.4000000059604645 mm · watertight true
- Bounding box -56.9, -141.6, 0.0 → 56.9, 143.6, 79.5 mm

Files: `brief.json` (the accepted design brief: every governing number, its rationale and the physics
checks), `design.cs` (the PicoGK code; rebuild it with `run_picogk` after submitting the brief),
`*.png` (captures the agent took to check its work). The mesh (`part.stl`) stays in
`~/PicoForge/runs/01M8G232XRYRWNNGH1V1V127RH/` (too large for git); download it from the app's Design files list.

## The agent's report



## Note

The Claude Code session hit its usage limit right after the second build, before it posted its
report. Rev 2 (the saved design: lower deck and rear for a sleeker profile, a prouder canopy, the
wing below the sting apex) built watertight at 200.4 cm³; the `rev1-*.png` captures show the first
build from four views, and `rev2-studio.jpg` shows rev 2 in the PicoForge studio.

Features: wedge body with low ground clearance, cab-forward teardrop canopy, front "pincer" claws
with teeth on the splitter, a segmented scorpion "sting" rising into the rear wing; Indian motifs
along the border seams (beaded temple borders on the sills, spine and splitter, rosettes on the
nose, stepped temple crenellations on the wing endplates) and lotus/mandala-spoke wheels.
Full-size dimensions are in brief.json; the session stored some in metres under unit "ratio" to get
past the envelope check, which led to the `_full` naming rule (BRIEF-FULL-01).
