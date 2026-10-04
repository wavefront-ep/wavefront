// Developer tool: solve a scenario in Node and print what each wave does.
//   node --experimental-strip-types scripts/run-scenario.mts src/scenarios/avnrt.json
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/engine/graph.ts';
import { deferredLoopStart, prepareScenario } from '../src/engine/scenario.ts';
import { buildAdjacency, edgeTimes, solveWaves } from '../src/engine/solver.ts';

const meta = JSON.parse(readFileSync('public/heart/conduction.json', 'utf8'));
const bin = readFileSync('public/heart/graph.bin');
const graph = parseGraph(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const sc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const g = { nodes: meta.nodes, edges: graph.edges, elen: graph.elen, ekind: graph.ekind, edelay: graph.edelay, cls: graph.cls, edir: graph.edir };
const t0 = performance.now();
const adj = buildAdjacency(g);
const run = (req: ReturnType<typeof prepareScenario>) => solveWaves(adj, edgeTimes(g, req.velocity, req.edgeScale), meta.nodes, req.waves.map((w) => w.stimuli), req.refractory, { ekind: graph.ekind, kindDir: req.kindDir, decrement: req.decrement });
// Two passes when a loop is anchored to an emergent time (first_after)
const starts = new Map<number, number>();
(sc.loops ?? []).forEach((l: any, i: number) => { if (!l.first_after) starts.set(i, l.first_ms); });
let req = prepareScenario(graph, sc, starts);
let times = run(req);
if ((sc.loops ?? []).some((l: any) => l.first_after)) {
  (sc.loops ?? []).forEach((l: any, i: number) => { const t = deferredLoopStart(graph, times, l); if (t !== null) starts.set(i, t); });
  req = prepareScenario(graph, sc, starts);
  times = run(req);
}
console.log(`${sc.id}: ${req.waves.length} waves solved in ${(performance.now() - t0).toFixed(0)} ms`);
const win = (T: Float32Array, pred: (i: number) => boolean) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < meta.tissueNodes; i++) if (pred(i) && Number.isFinite(T[i])) { lo = Math.min(lo, T[i]); hi = Math.max(hi, T[i]); }
  return lo === Infinity ? '      -      ' : `${lo.toFixed(0).padStart(5)}-${hi.toFixed(0).padEnd(5)}`;
};
const nm = (n: string) => (meta.named[n] !== undefined ? ` ${n} ${Number.isFinite(times[0][0]) ? '' : ''}` : '');
console.log('wave tag        stimulus        atrial        ventricular   | named nodes: AVN_entry AVN_exit His_proximal');
times.forEach((T, w) => {
  const st = req.waves[w].stimuli.map((s) => s.time.toFixed(0)).join(',');
  const f = (n: string) => (Number.isFinite(T[meta.named[n]]) ? T[meta.named[n]].toFixed(0) : '-');
  const extra = (process.argv[3] ?? '').split(',').filter(Boolean).map((n) => `${n}=${f(n)}`).join(' ');
  console.log(`${String(w).padStart(2)} ${req.waves[w].tag.padEnd(10)} ${st.padEnd(12)} A ${win(T, (i) => graph.cls[i] === 0)}  V ${win(T, (i) => graph.cls[i] === 1)} | ${f('AVN_entry')} ${f('AVN_exit')} ${f('His_proximal')} ${extra}`);
});
void nm;
