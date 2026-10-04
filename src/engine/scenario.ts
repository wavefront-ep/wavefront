// Turns a scenario (data) into a solver request: velocities, one-way blocks, per-edge scales, per-node
// refractory periods, decremental conduction, and the ordered list of waves.
import { Graph } from './graph';
import type { Decrement, Stimulus } from './solver';
import type { Scenario } from '../scenarios/types';

export interface WaveInfo {
  tag: string;
  stimuli: Stimulus[];
}

export interface SolveRequest {
  waves: WaveInfo[];
  velocity: number[];
  kindDir: number[];
  edgeScale: Float32Array;
  refractory: Float32Array;
  decrement: Decrement[];
  constants: Record<string, number>;
}

/** Fraction of the action potential duration during which a node cannot be re-excited. */
export const ERP_FRACTION = 0.9;

const DIRECTION = { both: 3, antegrade: 1, retrograde: 2, none: 0 } as const;

/** Start time of a loop that is anchored to an earlier wave (`first_after`). */
export function deferredLoopStart(graph: Graph, times: Float32Array[], loop: NonNullable<Scenario['loops']>[number]): number | null {
  if (!loop.first_after) return loop.first_ms ?? null;
  const T = times[loop.first_after.wave];
  const id = graph.meta.named[loop.first_after.node];
  const t = T?.[id];
  return t !== undefined && Number.isFinite(t) ? t + (loop.first_after.plus_ms ?? 0) : null;
}

/** `loopStarts` gives the start time of each loop (by index); loops without an entry are left out, which
 *  is how the first pass of a two-pass solve leaves out loops anchored to emergent times. */
export function prepareScenario(graph: Graph, sc: Scenario, loopStarts?: Map<number, number>): SolveRequest {
  const meta = graph.meta;
  const c = { ...meta.constants, ...(sc.constants ?? {}) } as Record<string, number>;
  const kinds = meta.kinds;
  const kindIndex = (k: string) => {
    const i = kinds.indexOf(k);
    if (i < 0) throw new Error(`scenario ${sc.id}: unknown edge kind "${k}"`);
    return i;
  };
  const velocity = kinds.map((k) => c[`v_${k}`] ?? 0);
  const kindDir = kinds.map(() => 3);
  const m = graph.elen.length;
  const edgeScale = new Float32Array(m).fill(1);
  for (const i of graph.optional) edgeScale[i] = 0;

  const maskSet = (name: string) => {
    const a = graph.masks[name];
    if (!a) throw new Error(`scenario ${sc.id}: unknown region "${name}"`);
    return new Set<number>(a);
  };
  const edgeSet = (name: string) => {
    const a = graph.edgesets[name];
    if (!a) throw new Error(`scenario ${sc.id}: unknown edge set "${name}"`);
    return a;
  };

  for (const mod of sc.modifiers ?? []) {
    if ('enable' in mod) {
      for (const i of edgeSet(mod.enable)) edgeScale[i] = 1;
    } else if ('edgeset' in mod) {
      for (const i of edgeSet(mod.edgeset)) edgeScale[i] *= mod.velocity_scale;
    } else if ('kind' in mod) {
      const k = kindIndex(mod.kind);
      if (mod.velocity_scale !== undefined) velocity[k] *= mod.velocity_scale;
      if (mod.direction) kindDir[k] = DIRECTION[mod.direction];
    } else if ('region' in mod) {
      const set = maskSet(mod.region);
      for (let i = 0; i < m; i++) {
        const a = set.has(graph.edges[2 * i]);
        const b = set.has(graph.edges[2 * i + 1]);
        if (mod.block && (a || b)) edgeScale[i] = 0;
        else if (mod.velocity_scale !== undefined && a && b) edgeScale[i] *= mod.velocity_scale;
      }
    }
  }

  const n = meta.nodes;
  const byClass = [c.apd_atrial, c.apd_ventricular, c.apd_conduction].map((v) => v * ERP_FRACTION);
  const refractory = new Float32Array(n);
  for (let i = 0; i < n; i++) refractory[i] = byClass[graph.cls[i]];
  for (const r of sc.refractory ?? []) for (const i of maskSet(r.region)) refractory[i] = r.erp_ms;

  const site = (name: string) => {
    const id = meta.named[name];
    if (id === undefined) throw new Error(`scenario ${sc.id}: unknown site "${name}"`);
    return id;
  };
  const waves: WaveInfo[] = sc.waves.map((w) => ({ tag: w.tag, stimuli: w.stimuli.map((s) => ({ node: site(s.site), time: s.time_ms })) }));
  (sc.loops ?? []).forEach((loop, li) => {
    const start = loopStarts ? loopStarts.get(li) : loop.first_ms;
    if (start === undefined) return;
    for (let k = 0; k < loop.laps; k++) {
      const t0 = start + k * loop.every_ms;
      waves.push({ tag: loop.tag, stimuli: loop.exit_sites.map((e) => ({ node: site(e.site), time: t0 + (e.offset_ms ?? 0) })) });
    }
  });
  // Waves are solved in time order so refractoriness carries forward correctly.
  waves.sort((a, b) => Math.min(...a.stimuli.map((s) => s.time)) - Math.min(...b.stimuli.map((s) => s.time)));
  if (waves.length > 16) throw new Error(`scenario ${sc.id}: ${waves.length} waves, at most 16 are carried per vertex`);

  const decrement: Decrement[] = (sc.decrement ?? []).map((d) => ({ kind: kindIndex(d.kind), max: d.max_ms, tau: d.tau_ms }));
  return { waves, velocity, kindDir, edgeScale, refractory, decrement, constants: c };
}
