// Runs the activation solver off the main thread. The graph is sent once; each solve request
// carries only velocities and stimuli.
import { Adjacency, Decrement, SolverGraph, Stimulus, buildAdjacency, edgeTimes, solveWaves } from './solver';

export interface InitMessage {
  type: 'init';
  graph: SolverGraph;
}
export interface SolveMessage {
  type: 'solve';
  id: number;
  velocity: number[];
  waves: Stimulus[][];
  /** Refractory period in ms of every node. */
  refractory: Float32Array;
  edgeScale?: Float32Array;
  kindDir: number[];
  decrement: Decrement[];
}

let graph: SolverGraph | null = null;
let adj: Adjacency | null = null;

self.onmessage = (e: MessageEvent<InitMessage | SolveMessage>) => {
  const m = e.data;
  if (m.type === 'init') {
    graph = m.graph;
    adj = buildAdjacency(graph);
    (self as any).postMessage({ type: 'ready' });
    return;
  }
  if (!graph || !adj) return;
  const t0 = performance.now();
  const et = edgeTimes(graph, m.velocity, m.edgeScale);
  const times = solveWaves(adj, et, graph.nodes, m.waves, m.refractory, { ekind: graph.ekind, kindDir: m.kindDir, decrement: m.decrement });
  (self as any).postMessage({ type: 'solved', id: m.id, times, ms: performance.now() - t0 }, times.map((t) => t.buffer));
};
