import { Graph, loadGraph } from './graph';
import { SolveRequest, deferredLoopStart, prepareScenario } from './scenario';
import type { Scenario } from '../scenarios/types';
import type { SolveMessage } from './solver.worker';

/** Number of activation waves carried per vertex (four vec4 attributes). */
export const NWAVE = 16;
export const UNREACHED = 1e9;

export interface ActivationResult {
  times: Float32Array[];
  tags: string[];
  solveMs: number;
}

export type EventSpec =
  | { node: string }
  | { firstTissue: 'atrial' | 'ventricular' }
  | { lastTissue: 'atrial' | 'ventricular' }
  | { firstRange: string[] }
  | { firstRegion: number };

/** Every spec can name the wave it refers to (default 0). */
export type EventAt = EventSpec & { wave?: number };

export class ActivationEngine {
  private worker: Worker;
  private pending = new Map<number, (r: ActivationResult) => void>();
  private nextId = 1;

  private constructor(readonly graph: Graph, worker: Worker) {
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type !== 'solved') return;
      this.pending.get(m.id)?.({ times: m.times, tags: [], solveMs: m.ms });
      this.pending.delete(m.id);
    };
  }

  static async create(base: string): Promise<ActivationEngine> {
    const graph = await loadGraph(`${base}heart/conduction.json`, `${base}heart/graph.bin`);
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    const ready = new Promise<void>((res) => {
      worker.addEventListener('message', function once(e: MessageEvent) {
        if (e.data.type === 'ready') {
          worker.removeEventListener('message', once);
          res();
        }
      });
    });
    worker.postMessage({
      type: 'init',
      graph: {
        nodes: graph.meta.nodes,
        edges: graph.edges.slice(),
        elen: graph.elen.slice(),
        ekind: graph.ekind.slice(),
        edelay: graph.edelay.slice(),
        cls: graph.cls.slice(),
        edir: graph.edir.slice(),
      },
    });
    await ready;
    return new ActivationEngine(graph, worker);
  }

  get constants() {
    return this.graph.meta.constants;
  }

  velocities(): number[] {
    const c = this.constants;
    return this.graph.meta.kinds.map((k) => c[`v_${k}`]);
  }

  solve(req: SolveRequest): Promise<ActivationResult> {
    const id = this.nextId++;
    const msg: SolveMessage = {
      type: 'solve',
      id,
      velocity: req.velocity,
      waves: req.waves.map((w) => w.stimuli),
      refractory: req.refractory,
      edgeScale: req.edgeScale,
      kindDir: req.kindDir,
      decrement: req.decrement,
    };
    const tags = req.waves.map((w) => w.tag);
    return new Promise((res) => {
      this.pending.set(id, (r) => res({ ...r, tags }));
      this.worker.postMessage(msg);
    });
  }

  /** Solve a scenario. Loops anchored to an emergent time (`first_after`) take a second pass. */
  async run(sc: Scenario): Promise<ActivationResult> {
    const starts = new Map<number, number>();
    (sc.loops ?? []).forEach((l, i) => {
      if (!l.first_after && l.first_ms !== undefined) starts.set(i, l.first_ms);
    });
    let result = await this.solve(prepareScenario(this.graph, sc, starts));
    if ((sc.loops ?? []).some((l) => l.first_after)) {
      (sc.loops ?? []).forEach((l, i) => {
        const t = deferredLoopStart(this.graph, result.times, l);
        if (t !== null) starts.set(i, t);
      });
      result = await this.solve(prepareScenario(this.graph, sc, starts));
    }
    return result;
  }

  /** First and last atrial and ventricular activation of every wave (null where a wave never reaches them). */
  waveWindows(result: ActivationResult): { tag: string; a: [number, number] | null; v: [number, number] | null }[] {
    const g = this.graph;
    return result.times.map((T, w) => {
      const win = [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
      ];
      for (let i = 0; i < g.meta.tissueNodes; i++) {
        const t = T[i];
        if (!Number.isFinite(t)) continue;
        const r = win[g.cls[i]];
        if (t < r[0]) r[0] = t;
        if (t > r[1]) r[1] = t;
      }
      const f = (r: number[]): [number, number] | null => (r[0] === Infinity ? null : [r[0], r[1]]);
      return { tag: result.tags[w] ?? '', a: f(win[0]), v: f(win[1]) };
    });
  }

  /** Earliest activation of every tissue node across all waves (what the activation map colours). */
  firstActivation(result: ActivationResult): { atrial: [number, number] | null; ventricular: [number, number] | null } {
    const g = this.graph;
    const r = [
      [Infinity, -Infinity],
      [Infinity, -Infinity],
    ];
    for (let i = 0; i < g.meta.tissueNodes; i++) {
      let t = Infinity;
      for (const T of result.times) if (T[i] < t) t = T[i];
      if (!Number.isFinite(t)) continue;
      const q = r[g.cls[i]];
      if (t < q[0]) q[0] = t;
      if (t > q[1]) q[1] = t;
    }
    const f = (q: number[]): [number, number] | null => (q[0] === Infinity ? null : [q[0], q[1]]);
    return { atrial: f(r[0]), ventricular: f(r[1]) };
  }

  /** Per-vertex activation times (NWAVE per vertex) for a mesh with a stored vertex mapping. */
  vertexTimes(mesh: string, result: ActivationResult): Float32Array | null {
    const map = this.graph.maps[mesh];
    if (!map) return null;
    const n = map.idx.length / map.k;
    const out = new Float32Array(n * NWAVE).fill(UNREACHED);
    for (let w = 0; w < Math.min(NWAVE, result.times.length); w++) {
      const T = result.times[w];
      for (let i = 0; i < n; i++) {
        let s = 0;
        let ok = true;
        for (let j = 0; j < map.k; j++) {
          const t = T[map.idx[i * map.k + j]];
          if (!Number.isFinite(t)) {
            ok = false;
            break;
          }
          s += (map.w ? map.w[i * map.k + j] : 1) * t;
        }
        if (ok) out[i * NWAVE + w] = s;
      }
    }
    return out;
  }

  /** Time (ms) of a named event in wave 0, or null when it is never reached. */
  eventTime(spec: EventAt, result: ActivationResult): number | null {
    const T = result.times[spec.wave ?? 0];
    if (!T) return null;
    const g = this.graph;
    let t = Infinity;
    if ('node' in spec) t = T[g.meta.named[spec.node]];
    else if ('firstRegion' in spec) {
      for (let i = 0; i < g.meta.tissueNodes; i++) if (g.region[i] === spec.firstRegion) t = Math.min(t, T[i]);
    } else if ('firstRange' in spec) {
      for (const r of spec.firstRange) {
        const [a, b] = g.meta.ranges[r];
        for (let i = a; i < b; i++) t = Math.min(t, T[i]);
      }
    } else {
      const cls = ('firstTissue' in spec ? spec.firstTissue : spec.lastTissue) === 'atrial' ? 0 : 1;
      const first = 'firstTissue' in spec;
      t = first ? Infinity : -Infinity;
      for (let i = 0; i < g.meta.tissueNodes; i++) {
        if (g.cls[i] !== cls || !Number.isFinite(T[i])) continue;
        t = first ? Math.min(t, T[i]) : Math.max(t, T[i]);
      }
    }
    return Number.isFinite(t) ? t : null;
  }
}
