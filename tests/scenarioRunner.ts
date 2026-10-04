// Node-side scenario solver for tests: same engine code as the browser, no UI.
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/engine/graph';
import { deferredLoopStart, prepareScenario } from '../src/engine/scenario';
import { buildAdjacency, edgeTimes, solveWaves } from '../src/engine/solver';

const meta = JSON.parse(readFileSync('public/heart/conduction.json', 'utf8'));
const bin = readFileSync('public/heart/graph.bin');
export const graph = parseGraph(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const g = { nodes: meta.nodes, edges: graph.edges, elen: graph.elen, ekind: graph.ekind, edelay: graph.edelay, cls: graph.cls, edir: graph.edir };
const adj = buildAdjacency(g);

export function loadScenario(id: string): any {
  return JSON.parse(readFileSync(`src/scenarios/${id}.json`, 'utf8'));
}

export function runScenario(id: string) {
  const sc = loadScenario(id);
  const solve = (req: ReturnType<typeof prepareScenario>) =>
    solveWaves(adj, edgeTimes(g, req.velocity, req.edgeScale), meta.nodes, req.waves.map((w) => w.stimuli), req.refractory, {
      ekind: graph.ekind,
      kindDir: req.kindDir,
      decrement: req.decrement,
    });
  const starts = new Map<number, number>();
  (sc.loops ?? []).forEach((l: any, i: number) => {
    if (!l.first_after) starts.set(i, l.first_ms);
  });
  let req = prepareScenario(graph, sc, starts);
  let times = solve(req);
  if ((sc.loops ?? []).some((l: any) => l.first_after)) {
    (sc.loops ?? []).forEach((l: any, i: number) => {
      const t = deferredLoopStart(graph, times, l);
      if (t !== null) starts.set(i, t);
    });
    req = prepareScenario(graph, sc, starts);
    times = solve(req);
  }
  const win = (T: Float32Array, cls: number): [number, number] | null => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < meta.tissueNodes; i++) if (graph.cls[i] === cls && Number.isFinite(T[i])) { lo = Math.min(lo, T[i]); hi = Math.max(hi, T[i]); }
    return lo === Infinity ? null : [lo, hi];
  };
  const waves = times.map((T, w) => ({ tag: req.waves[w].tag, stim: req.waves[w].stimuli, T, a: win(T, 0), v: win(T, 1) }));
  const at = (w: number, node: string) => waves[w].T[meta.named[node]];
  return { sc, waves, at, meta };
}
