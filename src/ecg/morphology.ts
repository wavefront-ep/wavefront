// Schematic lead II strip generated from the activation times of the model (SPEC 6: "generate it
// from event times using morphology templates"). It illustrates timing, not a recording: amplitudes
// are fixed, the T wave comes from a uniform action potential duration, and nothing here is derived
// from a body-surface model.
import type { EcgRules } from '../scenarios/types';

export interface WaveWindow {
  tag: string;
  /** First and last atrial activation of this wave, or null if the atria are not activated. */
  a: [number, number] | null;
  /** First and last ventricular activation, or null. */
  v: [number, number] | null;
}

export interface Ecg {
  /** One sample per millisecond, arbitrary units (a normal R wave is about 1). */
  samples: Float32Array;
  /** Wave segments that light up while the playhead is inside them. */
  segments: { kind: 'P' | 'QRS' | 'T' | 'F'; range: [number, number] }[];
}

const g = (x: number, mu: number, sigma: number) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);

export function buildEcg(rules: EcgRules, waves: WaveWindow[], duration: number, apdVentricular: number): Ecg {
  const samples = new Float32Array(duration + 1);
  const segments: Ecg['segments'] = [];
  const add = (f: (x: number) => number, from: number, to: number) => {
    for (let x = Math.max(0, Math.floor(from)); x <= Math.min(duration, Math.ceil(to)); x++) samples[x] += f(x);
  };

  // ---- atrial deflections
  const flutter: WaveWindow[] = [];
  for (const w of waves) {
    if (!w.a) continue;
    const shape = rules.atrial?.[w.tag] ?? 'p';
    const [a0, a1] = w.a;
    const mid = (a0 + a1) / 2;
    const sig = Math.max(8, (a1 - a0) / 5);
    if (shape === 'p') {
      add((x) => 0.14 * g(x, mid, sig), a0 - 30, a1 + 30);
      segments.push({ kind: 'P', range: [a0, a1] });
    } else if (shape === 'retro') {
      add((x) => -0.13 * g(x, mid, sig), a0 - 30, a1 + 30);
      segments.push({ kind: 'P', range: [a0, a1] });
    } else flutter.push(w);
  }
  // Flutter waves: a continuous sawtooth, one tooth per atrial cycle (slow downstroke, quick return).
  flutter.sort((p, q) => p.a![0] - q.a![0]);
  flutter.forEach((w, i) => {
    const start = w.a![0];
    const next = flutter[i + 1]?.a![0];
    const cycle = next !== undefined ? next - start : i > 0 ? start - flutter[i - 1].a![0] : 200;
    add(
      (x) => {
        const ph = (x - start) / cycle;
        return ph < 0.8 ? -0.2 * (ph / 0.8) : -0.2 * (1 - (ph - 0.8) / 0.2);
      },
      start,
      start + cycle,
    );
    segments.push({ kind: 'F', range: [start, start + cycle] });
  });

  // ---- ventricular deflections
  for (const w of waves) {
    if (!w.v) continue;
    const shape = rules.ventricular?.[w.tag] ?? 'narrow';
    const [v0, v1] = w.v;
    const D = Math.max(40, v1 - v0);
    const tEnd = v0 + D + apdVentricular * 0.9;
    const tPeak = tEnd - 60;
    const lo = v0 - 20;
    if (shape === 'narrow') {
      add((x) => -0.12 * g(x, v0 + 0.1 * D, 0.05 * D) + 1.0 * g(x, v0 + 0.38 * D, 0.09 * D) - 0.26 * g(x, v0 + 0.68 * D, 0.08 * D), lo, v1 + 20);
      add((x) => 0.3 * g(x, tPeak, x < tPeak ? 42 : 28), v1, tEnd + 40);
    } else if (shape === 'delta') {
      // slurred upstroke (the delta wave), then a broader R wave
      add((x) => 0.4 * g(x, v0 + 0.14 * D, 0.13 * D) + 0.8 * g(x, v0 + 0.5 * D, 0.14 * D) - 0.15 * g(x, v0 + 0.85 * D, 0.07 * D), lo, v1 + 20);
      add((x) => 0.22 * g(x, tPeak, x < tPeak ? 42 : 28), v1, tEnd + 40);
    } else {
      // wide, monomorphic, with a discordant (opposite) T wave
      add((x) => 0.85 * g(x, v0 + 0.4 * D, 0.2 * D) - 0.3 * g(x, v0 + 0.82 * D, 0.1 * D), lo, v1 + 20);
      add((x) => -0.3 * g(x, tPeak - 10, x < tPeak ? 45 : 30), v1, tEnd + 40);
    }
    segments.push({ kind: 'QRS', range: [v0, v1] });
    segments.push({ kind: 'T', range: [v1 + 25, tEnd] });
  }
  return { samples, segments };
}
