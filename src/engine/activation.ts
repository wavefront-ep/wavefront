import { Graph, loadGraph } from './graph';
import type { Stimulus } from './solver';
import type { SolveMessage } from './solver.worker';

/** Number of activation waves carried per vertex (two vec4 attributes). */
export const NWAVE = 8;
export const UNREACHED = 1e9;

export interface ActivationResult {
  times: Float32Array[];
  solveMs: number;
}

export type EventSpec =
  | { node: string }
  | { firstTissue: 'atrial' | 'ventricular' }
  | { lastTissue: 'atrial' | 'ventricular' }
  | { firstRange: string[] }
  | { firstRegion: number };

/** Fraction of the action potential duration during which a node cannot be re-excited. */
const ERP_FRACTION = 0.9;

export class ActivationEngine {
  private worker: Worker;
  private pending = new Map<number, (r: ActivationResult) => void>();
  private nextId = 1;

  private constructor(readonly graph: Graph, worker: Worker) {
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type !== 'solved') return;
      this.pending.get(m.id)?.({ times: m.times, solveMs: m.ms });
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

  solve(waves: Stimulus[][], overrides: Partial<Record<string, number>> = {}): Promise<ActivationResult> {
    const c = { ...this.constants, ...overrides } as Record<string, number>;
    const velocity = this.graph.meta.kinds.map((k) => c[`v_${k}`]);
    const id = this.nextId++;
    const msg: SolveMessage = {
      type: 'solve',
      id,
      velocity,
      waves,
      refractoryByClass: [c.apd_atrial * ERP_FRACTION, c.apd_ventricular * ERP_FRACTION, c.apd_conduction * ERP_FRACTION],
    };
    return new Promise((res) => {
      this.pending.set(id, res);
      this.worker.postMessage(msg);
    });
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
  eventTime(spec: EventSpec, result: ActivationResult, wave = 0): number | null {
    const T = result.times[wave];
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
