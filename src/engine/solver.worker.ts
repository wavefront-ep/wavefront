// Runs the activation solver off the main thread. The graph is sent once; each solve request
// carries only velocities and stimuli.
import { Adjacency, SolverGraph, Stimulus, buildAdjacency, edgeTimes, solveWaves } from './solver';

export interface InitMessage {
  type: 'init';
  graph: SolverGraph;
}
export interface SolveMessage {
  type: 'solve';
  id: number;
  velocity: number[];
  waves: Stimulus[][];
  /** Refractory period in ms for each node class (0 atrial, 1 ventricular, 2 conduction). */
  refractoryByClass: number[];
  edgeScale?: Float32Array;
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
  const refr = new Float32Array(graph.nodes);
  for (let i = 0; i < graph.nodes; i++) refr[i] = m.refractoryByClass[graph.cls[i]];
  const times = solveWaves(adj, et, graph.nodes, m.waves, refr);
  (self as any).postMessage({ type: 'solved', id: m.id, times, ms: performance.now() - t0 }, times.map((t) => t.buffer));
};
