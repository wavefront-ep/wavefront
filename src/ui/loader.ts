// Loads scenario data, solves it, and derives what the interface needs: event times, ECG strip and the
// colour-map ranges. Results are cached so switching between "Normal" and "This rhythm" is instant.
import { ActivationEngine, ActivationResult } from '../engine/activation';
import { Ecg, buildEcg } from '../ecg/morphology';
import { Scenario, validateScenario } from '../scenarios/types';
import type { BeatEvent } from './playbar';

const files = import.meta.glob('../scenarios/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

// Teaching order: normal first, then block, then the reentry rhythms in the order the deck builds them up.
const ORDER = [
  'sinus_rhythm',
  // impulse formation: sinus node first, then atrial, junctional, triggered
  'sinus_bradycardia', 'sinus_tachycardia', 'sinus_pause', 'ectopic_atrial_tachycardia', 'multifocal_atrial_tachycardia', 'junctional_tachycardia', 'torsades_de_pointes',
  // conduction block: sinus node exit, AV node, bundle branches
  'sa_exit_block', 'first_degree_av_block', 'mobitz_i', 'mobitz_ii', 'complete_heart_block', 'lbbb', 'rbbb',
  // reentry and fibrillation
  'avnrt', 'wpw_preexcitation', 'avrt_orthodromic', 'antidromic_avrt', 'svt_aberrancy', 'atrial_flutter_typical', 'atrial_flutter_4to1', 'atrial_fibrillation', 'af_with_bbb', 'preexcited_af', 'vt_scar_monomorphic', 'ventricular_fibrillation',
];

export const SCENARIOS: Scenario[] = Object.values(files)
  .map((s) => {
    validateScenario(s);
    return s as Scenario;
  })
  .sort((a, b) => (ORDER.indexOf(a.id) + 100) % 100 - (ORDER.indexOf(b.id) + 100) % 100);

export const GROUPS: { id: string; name: string }[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'formation', name: 'Disorders of impulse formation' },
  { id: 'block', name: 'Disorders of impulse conduction (block)' },
  { id: 'reentry', name: 'Reentry' },
];

export interface Loaded {
  sc: Scenario;
  result: ActivationResult;
  events: BeatEvent[];
  ecg: Ecg | null;
  scopes: Record<'all' | 'atria' | 'ventricles', [number, number]>;
  constants: Record<string, number>;
}

export class ScenarioLoader {
  private cache = new Map<string, Promise<Loaded>>();

  constructor(readonly engine: ActivationEngine) {}

  get(id: string): Promise<Loaded> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.build(id);
      this.cache.set(id, p);
    }
    return p;
  }

  private async build(id: string): Promise<Loaded> {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error(`unknown scenario ${id}`);
    const engine = this.engine;
    const result = await engine.run(sc);
    const events = sc.events.flatMap((e) => {
      const t = engine.eventTime(e.at, result);
      return t === null ? [] : [{ id: e.id, label: e.label, t, caption: e.caption, ecg: e.ecg }];
    });
    const constants = { ...engine.constants, ...(sc.constants ?? {}) };
    const ecg = sc.ecg ? buildEcg(sc.ecg, engine.waveWindows(result), sc.period_ms, constants.apd_ventricular) : null;
    const span = (r: [number, number] | null): [number, number] => (r ? [Math.floor(r[0] / 10) * 10, Math.ceil(r[1] / 10) * 10] : [0, 100]);
    const first = engine.firstActivation(result);
    const a = span(first.atrial);
    const v = span(first.ventricular);
    const scopes = { all: [0, Math.max(a[1], v[1])] as [number, number], atria: a, ventricles: v };
    return { sc, result, events, ecg, scopes, constants };
  }
}
