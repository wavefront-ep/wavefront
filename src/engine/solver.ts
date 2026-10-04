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
}

export interface Adjacency {
  start: Uint32Array;
  nbr: Uint32Array;
  edge: Uint32Array;
}

export interface Stimulus {
  node: number;
  time: number;
}

export function buildAdjacency(g: SolverGraph): Adjacency {
  const m = g.edges.length / 2;
  const deg = new Uint32Array(g.nodes + 1);
  for (let i = 0; i < m; i++) {
    deg[g.edges[2 * i] + 1]++;
    deg[g.edges[2 * i + 1] + 1]++;
  }
  for (let i = 0; i < g.nodes; i++) deg[i + 1] += deg[i];
  const start = deg;
  const fill = start.slice(0, g.nodes);
  const nbr = new Uint32Array(2 * m);
  const edge = new Uint32Array(2 * m);
  for (let i = 0; i < m; i++) {
    const a = g.edges[2 * i];
    const b = g.edges[2 * i + 1];
    nbr[fill[a]] = b;
    edge[fill[a]++] = i;
    nbr[fill[b]] = a;
    edge[fill[b]++] = i;
  }
  return { start, nbr, edge };
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
export function solveWave(adj: Adjacency, etime: Float32Array, nodes: number, stimuli: Stimulus[], recover?: Float32Array): Float32Array {
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
      const nt = t + etime[adj.edge[k]];
      if (nt < T[v]) {
        if (recover && nt < recover[v]) continue; // still refractory: blocked
        T[v] = nt;
        heap.push(nt, v);
      }
    }
  }
  return Float32Array.from(T);
}

/** Several waves in sequence with refractory blocking between them. */
export function solveWaves(
  adj: Adjacency,
  etime: Float32Array,
  nodes: number,
  waves: Stimulus[][],
  refractory: Float32Array,
): Float32Array[] {
  const recover = new Float32Array(nodes).fill(-Infinity);
  const out: Float32Array[] = [];
  for (const stim of waves) {
    const T = solveWave(adj, etime, nodes, stim, recover);
    out.push(T);
    for (let i = 0; i < nodes; i++) if (T[i] < Infinity) recover[i] = Math.max(recover[i], T[i] + refractory[i]);
  }
  return out;
}
