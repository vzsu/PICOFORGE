# Tuned twin-blower V8 (1:2.5 scale), air + coolant cooled

Designed by **Claude Code** (claude-opus-5-5) driving PicoForge over MCP, from one prompt; built on the
PicoGK engine and validated (watertight, inside the envelope, minimum wall).

- Run: `01M8G0A1NF07QGG49VYTGWRFPM` · last change: open pipe ends (bore extended past the sweep's round cap), blower->IC->plenum charge-air passages, IC cross tubes moved to +-80/+-200
- Volume 8175.0184 cm³ · 4,252,460 triangles · voxel 0.800000011920929 mm · watertight true
- Bounding box -150.0, -142.7, -0.0 → 148.6, 142.7, 338.0 mm

Files: `brief.json` (the accepted design brief: every governing number, its rationale and the physics
checks), `design.cs` (the PicoGK code; rebuild it with `run_picogk` after submitting the brief),
`*.png` (captures the agent took to check its work). The mesh (`part.stl`) stays in
`~/PicoForge/runs/01M8G0A1NF07QGG49VYTGWRFPM/` (too large for git); download it from the app's Design files list.

## The agent's report

Built: 1:2.5 scale (0.4) PA12 model of a twin-blower 90° V8. Size 299 x 285 x 338 mm, 8175 cm3 (~8.3 kg SLS PA12), watertight, voxel 0.8 mm, thinnest wall 2.6 mm.
Parts: staggered banks, finned block and sump, heads, ribbed cam covers with coil packs, hollow 4-into-1 tubular headers, 8 hollow runners into a hollow plenum, a finned air-to-water intercooler with an internal water gallery, twin tandem roots blowers with bellmouth hats, belt drive, water pump, and rear thermostat crossover.
Coolant circuit (all real voids, open to the outside): pump > hoses > 52 mm bank ports > 12 mm water jacket around the liners > 2 transfer holes per cylinder > 2 x 28 mm head galleries > outlet hoses > thermostat > radiator neck. Charge air: hat > blower > intercooler > plenum > runners.
Full-size numbers: 6.25 L (104 x 92), PR 2.0 (1.0 bar boost), 0.616 kg/s air, ~691 kW at 6500 rpm. Coolant heat ~645 kW, so 11.9 kg/s (677 L/min) at dT 15 K. Jacket 2.0 m/s, ports 2.65 m/s (< 3 m/s), jacket D_h 24 mm. Intercooler 55 kW, 1.7 kg/s water. Blower outlet 420 K, drive ~74 kW.
Estimates only: power, heat split, VE and blower efficiency are first-order, no CFD or FEA. The air fins carry only ~3 kW (~0.5 %); the coolant does the real work. 645 kW needs ~21 kg/s of radiator air, so it suits a drag/track duty cycle, not continuous full load.
Next step: add a radiator and a low-temperature intercooler radiator, then size the pump curve against the circuit pressure drop.
