import type { EventSpec } from '../engine/activation';

/** Scenario data (SPEC section 6). Scenarios are data, not code, so Challenge mode and Ablation can
 *  reuse them later. Fields not needed yet (substrate loops, modifiers, ECG) are optional. */
export interface ScenarioEvent {
  id: string;
  label: string;
  at: EventSpec;
  caption: string;
}

export interface Scenario {
  id: string;
  mechanism: string;
  title: string;
  /** Slides in Dr. Hansom's deck that this scenario implements. */
  source: string;
  period_ms: number;
  stimuli: { site: string; time_ms: number }[];
  substrate?: unknown[];
  modifiers?: unknown[];
  events: ScenarioEvent[];
  teaching_points: string[];
}

export function validateScenario(s: any): asserts s is Scenario {
  const need = ['id', 'mechanism', 'title', 'source', 'period_ms', 'stimuli', 'events', 'teaching_points'];
  for (const k of need) if (!(k in s)) throw new Error(`scenario ${s?.id ?? '?'} is missing "${k}"`);
  if (!Array.isArray(s.stimuli) || !s.stimuli.length) throw new Error(`scenario ${s.id}: no stimuli`);
  for (const e of s.events) if (!e.id || !e.caption || !e.at) throw new Error(`scenario ${s.id}: bad event ${e?.id}`);
}
