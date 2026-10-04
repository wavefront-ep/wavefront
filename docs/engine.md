# Activation engine and conduction system (Phase 2)

This is a schematic teaching model, not a biophysical simulation (SPEC 5). Activation times come from a
shortest-path (eikonal-style) calculation on a graph, and the shader turns times into colour.

## Pipeline

| Step | File | Output |
|---|---|---|
| Heart surface and regions | `tools/build_heart.py` | `public/heart/heart.glb`, `heart.json` |
| Anchors and conduction paths | `tools/conduction_geometry.py` | in memory |
| Graph, tubes, vertex mapping, reference solve | `tools/build_conduction.py` | `conduction.glb`, `conduction.json`, `graph.bin` |
| Browser solver (Web Worker) | `src/engine/solver.ts`, `solver.worker.ts` | activation times per node and wave |
| Colour from times | `src/engine/material.ts` | live wave and activation map shading |

`npm run assets` rebuilds all three outputs from `assets/raw/average.vtk`.

## Graph

- Tissue nodes: about 29 000 coarse nodes sampled from the tetrahedral mesh (1.7 mm spacing in atria, 3 mm in
  ventricles). Each node has a class (atrial, ventricular) and a region (LV, RV, LA, RA).
- Edges join nodes of the same class only, so atrial and ventricular muscle are never connected directly (the
  mesh has the walls touching at the AV junction). The only route to the ventricles is AV node, His, bundle
  branches, Purkinje fibres, then a junction to ventricular muscle with a 3 ms delay.
- Edge time = length / velocity + delay. Velocities (m/s) live in `conduction.json` (`constants`), the single
  source for both the Python reference and the browser.
- Waves are solved in order. A node still refractory from an earlier wave (90% of its action potential
  duration) cannot be entered, so a front that arrives early is blocked there (`solveWaves`, unit-tested in
  `tests/solver.spec.ts`). Phase 2 plays one beat; Phase 3 scenarios use several waves, edge modifiers and
  authored loops through this same function.

## Rendering

Each rendered vertex stores up to eight activation times (two `vec4` attributes). The fragment shader picks the
latest wave that has started, then colours by time since activation: amber front, coral-orange plateau,
lavender refractory tint, rest. The activation map colours by the first wave, with isochrone lines every 10 ms
and two palettes (colour-blind safe, CARTO-style).

## Normal sinus beat produced by the graph (all times from the sinus node discharge)

| Quantity | Value |
|---|---|
| Atrial activation | about 3 to 114 ms |
| AV node entry / exit | about 57 / 125 ms |
| First ventricular activation (PR from atrial onset) | about 162 ms (PR about 159) |
| Ventricular activation (QRS) | about 162 to 254 ms (about 93 ms) |
| Order | RA before LA; left septum before right; endocardium before epicardium; base last |

## ECG strip

`src/ecg/morphology.ts` builds a schematic lead II trace from the same event times: P wave over atrial
activation, Q/R/S inside the ventricular activation window, T wave from QRS end plus the action potential
duration. It shares the scrubber's time axis, lights the wave segment the playhead is in, and numbers each
sequence event on the strip. Scenarios choose a template
(`ecg.template`); only `normal_sinus` exists so far.

## Phase 3 additions

- **Directed edges.** Some edges conduct one way only (the flutter and VT rings, exits into muscle, atrium to slow
  pathway). A scenario can also set a whole edge kind to antegrade-only, retrograde-only or off (one-way block).
- **Scenario modifiers** (data): scale or block edge kinds, named edge sets (for example the isthmus), or node
  regions (for example the scar); enable optional edges (accessory pathways are off unless a scenario enables one);
  per-region refractory periods; decremental conduction on an edge kind.
- **Waves and loops.** A scenario lists explicit waves and authored loops. A loop's first lap can be anchored to
  the time an earlier wave reaches a node (`first_after`), which takes a second solve. At most 16 waves are
  carried per vertex.
- **Substrates.** `tools/substrates.py` places accessory pathway sites, the flutter ring and isthmus, crista,
  slow pathway and scar circuit from the mesh. `tools/build_conduction.py` adds them to the graph and writes the
  tubes (`sub_*`) and region masks.
- **Checking a scenario without the browser:** `npx tsx scripts/run-scenario.mts src/scenarios/avnrt.json` prints,
  for every wave, the atrial and ventricular activation windows.

## Phase 3b additions

- **Event-driven solver.** `solveWaves` runs every wave of a scenario in one simulation ordered by time. A node
  accepts an impulse only when it has recovered from its last activation, so overlapping waves compete for
  tissue and fibrillatory activity can emerge from refractoriness alone. Each wave still activates a node at
  most once.
- **Fibrillation sequences** (`scripts/build-fibrillation.mts`, inputs in `tools/af-base.json`, `vf-base.json`):
  walk forward in time, firing candidate foci wherever tissue has recovered and the resulting wave can spread.
  The output is copied into the scenario files.
- **Bundle branch blocks** use the `lbb` and `rbb` edge sets; foci use the named stimulus sites (`V_*`, `PV_*`,
  `RA_*`, `LA_*`) and the `site_*` region masks for highlighting.
- **ECG templates** now include fibrillatory baseline, VF, torsades (twisting envelope), LBBB and RBBB.

## Guided playback

Playback has a Guided switch (on by default). The sequence events of a scenario are the stops. The playhead
holds on each stop for 3 to 6.5 s (1.5 s plus 90 ms per word of the caption and ECG line), so steps a few
milliseconds apart each get their own pause. Between stops the speed is at least the distance to the next stop
divided by 2.5 s, so a long quiet stretch (a sinus pause, a block) is crossed in about 2.5 s while short
stretches still play at the chosen speed. Stepping, scrubbing or pressing Play cancels the hold. Switching Guided
off gives continuous playback at the chosen speed.
