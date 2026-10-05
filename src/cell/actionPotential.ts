// Schematic action potentials for the cellular view. Not an ion-channel simulation: each cell type is a
// short authored shape (phases 0 to 4) whose timing comes from the activation solver, so the cell trace,
// the wavefront and the ECG always agree. Voltages and durations are textbook-level values and are
// logged as assumptions; the interface labels the view as schematic.

export type CellType = 'pacemaker' | 'atrial' | 'av_node' | 'purkinje' | 'ventricular';

export interface CellInfo {
  id: CellType;
  label: string;
  /** Named node in the activation graph whose activation times drive the trace. */
  site: string;
  /** Slow-response cells (calcium-dependent upstroke, no plateau). */
  slow: boolean;
}

export const CELLS: CellInfo[] = [
  { id: 'pacemaker', label: 'Sinus node', site: 'SAN', slow: true },
  { id: 'atrial', label: 'Atrial', site: 'RA_low', slow: false },
  { id: 'av_node', label: 'AV node', site: 'AVN_exit', slow: true },
  { id: 'purkinje', label: 'Purkinje', site: 'LAF_end', slow: false },
  { id: 'ventricular', label: 'Ventricular', site: 'V_LV_lateral', slow: false },
];
export const CELL_BY_ID = Object.fromEntries(CELLS.map((c) => [c.id, c])) as Record<CellType, CellInfo>;

interface Shape {
  /** Resting potential (maximum diastolic potential for the slow cells), mV. */
  rest: number;
  /** Potential at which the upstroke starts when the cell fires on its own, mV. */
  threshold: number;
  peak: number;
  /** Fast cells: potential at the end of phase 1, start of the plateau, and end of the plateau. */
  notch: number;
  plateauEnd: number;
  /** Drawn length of phase 0, ms (the real upstroke is faster than the strip can show for the fast cells). */
  upstroke: number;
  /** Default duration, ms; the atrial and ventricular values come from the solver constants. */
  apd: number;
  /** Fractions of the duration where phase 1 and the plateau end. */
  p1: number;
  p2: number;
}

const SHAPES: Record<CellType, Shape> = {
  pacemaker: { rest: -60, threshold: -40, peak: 10, notch: 0, plateauEnd: 0, upstroke: 40, apd: 150, p1: 0, p2: 0 },
  av_node: { rest: -65, threshold: -45, peak: 5, notch: 0, plateauEnd: 0, upstroke: 50, apd: 200, p1: 0, p2: 0 },
  atrial: { rest: -80, threshold: -65, peak: 25, notch: 5, plateauEnd: -20, upstroke: 4, apd: 190, p1: 0.07, p2: 0.5 },
  purkinje: { rest: -90, threshold: -75, peak: 30, notch: 15, plateauEnd: 5, upstroke: 4, apd: 330, p1: 0.06, p2: 0.72 },
  ventricular: { rest: -85, threshold: -70, peak: 30, notch: 10, plateauEnd: -5, upstroke: 4, apd: 280, p1: 0.06, p2: 0.72 },
};
export const V_MIN = -100;
export const V_MAX = 45;

export interface CellOpts {
  /** Length of the time axis, ms. */
  period: number;
  /** Duration of each action potential, ms (default per cell type). */
  apd?: number;
  /** The cell fires on its own (sinus node, an ectopic focus): a slow phase 4 ramp leads into each upstroke. */
  automatic?: boolean;
  /** Indices (into the activation list) of beats that carry an early afterdepolarisation / a delayed one after them. */
  ead?: number[];
  dad?: number[];
}

export interface PhaseSeg {
  t0: number;
  t1: number;
  phase: 0 | 1 | 2 | 3 | 4;
  /** Index of the action potential this belongs to, or -1 for rest. */
  ap: number;
  /** Phase 4 that is a diastolic ramp rather than a flat resting level. */
  ramp?: boolean;
}

export interface CellTrace {
  type: CellType;
  /** One sample per ms. */
  mv: Float32Array;
  segs: PhaseSeg[];
  acts: number[];
  apd: number;
  /** [start, end] of the stretch between an action potential's end and the next activation. */
  gaps: [number, number][];
  automatic: boolean;
  ead: number[];
  dad: number[];
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/** Membrane potential at `t` ms after the upstroke starts. */
function apAt(s: Shape, slow: boolean, apd: number, startV: number, t: number): number {
  const up = s.upstroke;
  if (t < 0) return startV;
  if (t < up) return startV + (s.peak - startV) * smooth(t / up);
  if (slow) return s.peak + (s.rest - s.peak) * smooth(clamp01((t - up) / (apd - up)));
  const t1 = Math.max(up + 2, s.p1 * apd);
  const t2 = s.p2 * apd;
  if (t < t1) return s.peak + (s.notch - s.peak) * (1 - Math.pow(1 - (t - up) / (t1 - up), 2));
  if (t < t2) return s.notch + (s.plateauEnd - s.notch) * ((t - t1) / (t2 - t1));
  return s.plateauEnd + (s.rest - s.plateauEnd) * smooth(clamp01((t - t2) / (apd - t2)));
}

/** Build the potential trace for one cell from the times (ms) at which the solver activates it. */
export function buildCellTrace(type: CellType, activations: number[], o: CellOpts): CellTrace {
  const info = CELL_BY_ID[type];
  const s = SHAPES[type];
  const apd = o.apd ?? s.apd;
  const automatic = o.automatic ?? type === 'pacemaker';
  const n = Math.max(2, Math.ceil(o.period) + 1);
  const mv = new Float32Array(n).fill(s.rest);
  const segs: PhaseSeg[] = [];
  const acts = [...activations].sort((a, b) => a - b);
  const ead = o.ead ?? [];
  const dad = o.dad ?? [];
  const gaps: [number, number][] = [];
  const startV = automatic ? s.threshold : s.rest;
  const put = (t: number, v: number) => {
    const i = Math.round(t);
    if (i >= 0 && i < n) mv[i] = v;
  };

  // phase 4 ramps and rest
  const ramp = (from: number, to: number) => {
    if (to - from < 2) return;
    for (let t = Math.max(0, Math.ceil(from)); t <= to && t < n; t++) put(t, s.rest + (startV - s.rest) * Math.pow(clamp01((t - from) / (to - from)), 1.7));
    segs.push({ t0: from, t1: to, phase: 4, ap: -1, ramp: true });
  };
  const interval = acts.length > 1 ? acts[1] - acts[0] : o.period;
  acts.forEach((t0, i) => {
    const prevEnd = i === 0 ? Math.max(0, t0 - Math.max(0, interval - apd)) : acts[i - 1] + apd;
    if (automatic) ramp(Math.max(prevEnd, 0), t0);
    for (let t = Math.max(0, Math.floor(t0)); t < Math.min(n, t0 + apd + 1); t++) put(t, apAt(s, info.slow, apd, startV, t - t0));
    const t1 = s.p1 * apd;
    const t2 = s.p2 * apd;
    const up = s.upstroke;
    segs.push({ t0, t1: t0 + up, phase: 0, ap: i });
    if (!info.slow) {
      segs.push({ t0: t0 + up, t1: t0 + Math.max(up + 2, t1), phase: 1, ap: i });
      segs.push({ t0: t0 + Math.max(up + 2, t1), t1: t0 + t2, phase: 2, ap: i });
      segs.push({ t0: t0 + t2, t1: t0 + apd, phase: 3, ap: i });
    } else {
      segs.push({ t0: t0 + up, t1: t0 + apd, phase: 3, ap: i });
    }
    if (ead.includes(i)) {
      // early afterdepolarisation: a hump on the late plateau / early phase 3
      const c = t0 + 0.78 * apd;
      const w = 0.035 * apd;
      for (let t = Math.floor(c - 4 * w); t <= c + 4 * w; t++) if (t >= 0 && t < n) mv[t] += 30 * Math.exp(-(((t - c) / w) ** 2)) * (t < t0 + apd ? 1 : 0.6);
    }
    if (dad.includes(i)) {
      // delayed afterdepolarisation: a small hump after repolarisation, in phase 4
      const c = t0 + apd + 60;
      for (let t = Math.floor(c - 60); t <= c + 60; t++) if (t >= 0 && t < n) mv[t] += 10 * Math.exp(-(((t - c) / 25) ** 2));
    }
    const next = acts[i + 1];
    if (next !== undefined && next - (t0 + apd) > 2) gaps.push([t0 + apd, next]);
  });
  // after the last action potential: back to rest, or on towards the next cycle when the cell fires itself
  const last = acts.length ? acts[acts.length - 1] + apd : 0;
  if (automatic && acts.length && o.period - last > 20) ramp(last, o.period);
  if (!acts.length) segs.push({ t0: 0, t1: o.period, phase: 4, ap: -1 });
  return { type, mv, segs, acts, apd, gaps, automatic, ead, dad };
}

/** The phase a cell is in at time `t` (rest counts as phase 4). */
export function phaseAt(tr: CellTrace, t: number): { phase: 0 | 1 | 2 | 3 | 4; ap: number; ramp: boolean } {
  for (const sg of tr.segs) if (t >= sg.t0 && t < sg.t1 && sg.phase !== 4) return { phase: sg.phase, ap: sg.ap, ramp: false };
  for (const sg of tr.segs) if (sg.phase === 4 && t >= sg.t0 && t < sg.t1) return { phase: 4, ap: -1, ramp: !!sg.ramp };
  return { phase: 4, ap: -1, ramp: false };
}

/** One line per phase: what moves across the membrane. Textbook-level, schematic. */
export function phaseText(type: CellType, phase: number, ramp: boolean, afterdepolarisation = false): string {
  if (afterdepolarisation) return 'An afterdepolarisation: a second, unwanted depolarising bump, here caused by inward current while the membrane is still repolarising.';
  if (CELL_BY_ID[type].slow) {
    switch (phase) {
      case 0:
        return 'Phase 0: a slow upstroke carried by Ca²⁺ entering through L-type channels (not fast Na⁺). This is why conduction here is slow.';
      case 3:
        return 'Phase 3: repolarisation as K⁺ leaves the cell and the Ca²⁺ channels close.';
      default:
        return ramp
          ? 'Phase 4: no stable resting potential. The funny current (inward Na⁺) and Ca²⁺ entry slowly depolarise the cell to threshold; its slope sets the rate.'
          : 'Phase 4: slow diastolic depolarisation brings the cell to threshold on its own.';
    }
  }
  switch (phase) {
    case 0:
      return 'Phase 0: rapid upstroke as fast Na⁺ channels open and Na⁺ rushes in.';
    case 1:
      return 'Phase 1: brief early repolarisation as Na⁺ channels close and transient K⁺ current leaves the cell.';
    case 2:
      return 'Phase 2: the plateau. Ca²⁺ entering through L-type channels balances K⁺ leaving; this holds the cell refractory.';
    case 3:
      return 'Phase 3: repolarisation as K⁺ outflow exceeds Ca²⁺ entry and the membrane returns to rest.';
    default:
      return ramp
        ? 'Phase 4: this cell is depolarising on its own towards threshold (abnormal automaticity).'
        : 'Phase 4: resting potential, held near the K⁺ equilibrium by the inward-rectifier K⁺ current. The cell can fire again once it has recovered.';
  }
}
