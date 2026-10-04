// Eikonal-style activation on the conduction graph: Dijkstra over edge times (length / velocity
// + delay). Pure functions with no DOM or Three.js dependency, so they run in a worker.
//
// Waves are solved in order. A node that is still refractory from an earlier wave cannot be
// entered: a front that arrives before the node has recovered is blocked there.

export interface SolverGraph {
  nodes: number;
  edges: Uint32Array; // pairs
  elen: Float32Array;
  ekind: Uint8Array;
  edelay: Float32Array;
  cls: Uint8Array;
  /** 0 both ways, 1 first to second node only, 2 second to first only. */
  edir: Uint8Array;
}

export interface Adjacency {
  start: Uint32Array;
  nbr: Uint32Array;
  edge: Uint32Array;
  /** 1 when the entry traverses its edge first-to-second, 2 when second-to-first. */
  bit: Uint8Array;
}

/** Per edge kind: which directions may conduct (bit 1: first to second, bit 2: second to first). */
export type KindDirection = ArrayLike<number>;

/** Rate-dependent (decremental) slowing: the sooner a node is excited after it recovers, the longer the
 *  delay added on entry. extra = max * exp(-recoveryInterval / tau). */
export interface Decrement {
  kind: number;
  max: number;
  tau: number;
}

export interface Stimulus {
  node: number;
  time: number;
}

export function buildAdjacency(g: SolverGraph): Adjacency {
  const m = g.edges.length / 2;
  const deg = new Uint32Array(g.nodes + 1);
  for (let i = 0; i < m; i++) {
    const d = g.edir[i];
    if (d !== 2) deg[g.edges[2 * i] + 1]++;
    if (d !== 1) deg[g.edges[2 * i + 1] + 1]++;
  }
  for (let i = 0; i < g.nodes; i++) deg[i + 1] += deg[i];
  const start = deg;
  const fill = start.slice(0, g.nodes);
  const total = start[g.nodes];
  const nbr = new Uint32Array(total);
  const edge = new Uint32Array(total);
  const bit = new Uint8Array(total);
  for (let i = 0; i < m; i++) {
    const a = g.edges[2 * i];
    const b = g.edges[2 * i + 1];
    const d = g.edir[i];
    if (d !== 2) {
      nbr[fill[a]] = b;
      bit[fill[a]] = 1;
      edge[fill[a]++] = i;
    }
    if (d !== 1) {
      nbr[fill[b]] = a;
      bit[fill[b]] = 2;
      edge[fill[b]++] = i;
    }
  }
  return { start, nbr, edge, bit };
}

/** Edge traversal time in ms for the given per-kind velocities (m/s = mm/ms). */
export function edgeTimes(g: SolverGraph, velocity: ArrayLike<number>, scale?: Float32Array): Float32Array {
  const m = g.elen.length;
  const t = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const v = velocity[g.ekind[i]] * (scale ? scale[i] : 1);
    t[i] = v > 0 ? g.elen[i] / v + g.edelay[i] : Infinity;
  }
  return t;
}

class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const keys = this.keys;
    const vals = this.vals;
    const k0 = keys[0];
    const v0 = vals[0];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return [k0, v0];
  }
}

/** One wave from `stimuli`. `recover[i]` is the earliest time node i can be excited again. */
export interface WaveOptions {
  ekind: Uint8Array;
  kindDir?: KindDirection;
  decrement?: Decrement[];
}

export function solveWave(
  adj: Adjacency,
  etime: Float32Array,
  nodes: number,
  stimuli: Stimulus[],
  recover?: Float32Array,
  opts?: WaveOptions,
): Float32Array {
  const decr = new Map<number, Decrement>();
  for (const d of opts?.decrement ?? []) decr.set(d.kind, d);
  // Float64 while solving: the heap keys are doubles, and rounding the stored time to float32
  // would make a node look stale when it is popped and skip expanding it.
  const T = new Float64Array(nodes).fill(Infinity);
  const heap = new MinHeap();
  for (const s of stimuli) {
    if (recover && s.time < recover[s.node]) continue; // stimulus falls in a refractory period
    if (s.time < T[s.node]) {
      T[s.node] = s.time;
      heap.push(s.time, s.node);
    }
  }
  while (heap.size) {
    const [t, u] = heap.pop();
    if (t > T[u]) continue;
    for (let k = adj.start[u]; k < adj.start[u + 1]; k++) {
      const v = adj.nbr[k];
      const e = adj.edge[k];
      if (opts?.kindDir && !(opts.kindDir[opts.ekind[e]] & adj.bit[k])) continue; // one-way block
      let nt = t + etime[e];
      if (recover && nt < recover[v]) continue; // still refractory: blocked
      if (decr.size) {
        const d = decr.get(opts!.ekind[e]);
        if (d && recover) nt += d.max * Math.exp(-(nt - recover[v]) / d.tau); // decremental conduction
      }
      if (nt < T[v]) {
        T[v] = nt;
        heap.push(nt, v);
      }
    }
  }
  return Float32Array.from(T);
}

/**
 * Several waves in one event-driven simulation. Events (time, node, wave) are processed in global time
 * order; a node accepts an event only when it has recovered from its last activation, whichever wave
 * caused it. Waves therefore compete for tissue: where two fronts meet, the later one is blocked, and a
 * wave that starts while an earlier one is still spreading is held back only where that wave has
 * already passed. This is what lets overlapping wavelets (fibrillation) emerge from refractoriness.
 * Each wave still activates a node at most once.
 */
export function solveWaves(
  adj: Adjacency,
  etime: Float32Array,
  nodes: number,
  waves: Stimulus[][],
  refractory: Float32Array,
  opts?: WaveOptions,
): Float32Array[] {
  const decr = new Map<number, Decrement>();
  for (const d of opts?.decrement ?? []) decr.set(d.kind, d);
  const recover = new Float64Array(nodes).fill(-Infinity);
  const T: Float32Array[] = waves.map(() => new Float32Array(nodes).fill(Infinity));
  const tent: Float64Array[] = waves.map(() => new Float64Array(nodes).fill(Infinity));
  const heap = new MinHeap();
  const key = (node: number, w: number) => w * nodes + node;
  waves.forEach((stim, w) => {
    for (const s of stim) {
      if (s.time < tent[w][s.node]) {
        tent[w][s.node] = s.time;
        heap.push(s.time, key(s.node, w));
      }
    }
  });
  while (heap.size) {
    const [t, k] = heap.pop();
    const w = Math.floor(k / nodes);
    const u = k - w * nodes;
    if (T[w][u] < Infinity || t > tent[w][u]) continue; // already activated in this wave, or a stale entry
    if (t < recover[u]) continue; // refractory: blocked
    T[w][u] = t;
    recover[u] = t + refractory[u];
    for (let q = adj.start[u]; q < adj.start[u + 1]; q++) {
      const v = adj.nbr[q];
      if (T[w][v] < Infinity) continue;
      const e = adj.edge[q];
      if (opts?.kindDir && !(opts.kindDir[opts.ekind[e]] & adj.bit[q])) continue; // one-way block
      let nt = t + etime[e];
      if (nt < recover[v]) continue; // v will still be refractory when the front arrives
      if (decr.size) {
        const d = decr.get(opts!.ekind[e]);
        if (d) nt += d.max * Math.exp(-(nt - recover[v]) / d.tau); // decremental conduction
      }
      if (nt < tent[w][v]) {
        tent[w][v] = nt;
        heap.push(nt, key(v, w));
      }
    }
  }
  return T;
}
