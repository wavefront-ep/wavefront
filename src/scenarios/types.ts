import type { EventAt } from '../engine/activation';

/** Scenario data (SPEC section 6). Scenarios are data, not code, so Challenge mode and Ablation can
 *  reuse them later: a scenario declares its stimuli, the substrate it switches on, how conduction is
 *  modified, and its critical site. */
export interface ScenarioEvent {
  id: string;
  label: string;
  at: EventAt;
  caption: string;
  /** What this moment looks like on the surface ECG (shown under the caption). */
  ecg?: string;
}

export interface WaveSpec {
  /** Used by the ECG rules to decide which morphology a wave gets. */
  tag: string;
  stimuli: { site: string; time_ms: number }[];
}

/** An authored re-entry circuit: every lap sends one wave from the exit sites (SPEC 5: reentry circuits
 *  are authored loops, not emergent). */
export interface LoopSpec {
  tag: string;
  /** Start of the first lap in ms, or, for a loop that begins where an earlier wave ends up, the node
   *  and wave whose arrival time starts it (so authored timings follow the model). */
  first_ms?: number;
  first_after?: { wave: number; node: string; plus_ms?: number };
  every_ms: number;
  laps: number;
  exit_sites: { site: string; offset_ms?: number }[];
}

export type Modifier =
  | { kind: string; velocity_scale?: number; direction?: 'both' | 'antegrade' | 'retrograde' | 'none' }
  | { edgeset: string; velocity_scale: number }
  | { enable: string }
  | { region: string; block?: boolean; velocity_scale?: number };

export interface EcgRules {
  lead: string;
  /** Atrial morphology by wave tag: 'p', 'retro' or 'flutter'. */
  atrial?: Record<string, 'p' | 'retro' | 'flutter'>;
  /** Ventricular morphology by wave tag: 'narrow', 'delta' or 'wide'. */
  ventricular?: Record<string, 'narrow' | 'delta' | 'wide'>;
}

export interface Scenario {
  id: string;
  mechanism: string;
  /** Picker group. */
  group: string;
  title: string;
  /** Two-line summary shown in the picker. */
  summary: string;
  /** Slides in Dr. Hansom's deck that this scenario implements. */
  source: string;
  /** Length of the timeline in ms. */
  period_ms: number;
  waves: WaveSpec[];
  loops?: LoopSpec[];
  modifiers?: Modifier[];
  refractory?: { region: string; erp_ms: number }[];
  decrement?: { kind: string; max_ms: number; tau_ms: number }[];
  /** Overrides of the graph constants (velocities in m/s, durations in ms). */
  constants?: Record<string, number>;
  /** Substrate meshes to show (sub_* in conduction.glb). */
  show?: string[];
  /** Regions to tint on the surface (mask names). */
  highlight?: string[];
  /** The structure that, if interrupted, would end the arrhythmia (for Ablation mode later). */
  critical_site?: string;
  /** Mesh to tint as the structure the scenario is about (for example the blocked AV node). */
  select?: string;
  /** Camera for the scenario: direction from the target to the camera, distance, and a path to look at. */
  camera?: { dir: [number, number, number]; distance: number; focus?: string };
  /** Cutaway applied when the scenario opens (the camera then looks at the cut face). */
  cut?: { mode: 'fourChamber' | 'shortAxis'; offset: number };
  /** Epicardial opacity while the scenario plays (the structures sit inside the wall). */
  epi_opacity?: number;
  ecg?: EcgRules;
  events: ScenarioEvent[];
  teaching_points: string[];
}

export function validateScenario(s: any): asserts s is Scenario {
  const need = ['id', 'mechanism', 'group', 'title', 'summary', 'source', 'period_ms', 'waves', 'events', 'teaching_points'];
  for (const k of need) if (!(k in s)) throw new Error(`scenario ${s?.id ?? '?'} is missing "${k}"`);
  if (!Array.isArray(s.waves) || !s.waves.length) throw new Error(`scenario ${s.id}: no waves`);
  for (const e of s.events) if (!e.id || !e.caption || !e.at) throw new Error(`scenario ${s.id}: bad event ${e?.id}`);
}
