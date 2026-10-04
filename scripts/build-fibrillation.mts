// Developer tool: find a fibrillatory sequence of focal stimuli. Walking forward in time, a candidate
// stimulus is accepted only if its site has recovered (so it really fires) and the resulting wave has
// room to spread: this yields irregular, partial, fragmented activation from refractoriness alone.
//   npx tsx scripts/build-fibrillation.mts atrial|ventricular
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGraph } from '../src/engine/graph.ts';
import { prepareScenario } from '../src/engine/scenario.ts';
import { buildAdjacency, edgeTimes, solveWaves } from '../src/engine/solver.ts';

const kind = process.argv[2] ?? 'atrial';
const meta = JSON.parse(readFileSync('public/heart/conduction.json', 'utf8'));
const bin = readFileSync('public/heart/graph.bin');
const graph = parseGraph(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const g = { nodes: meta.nodes, edges: graph.edges, elen: graph.elen, ekind: graph.ekind, edelay: graph.edelay, cls: graph.cls, edir: graph.edir };
const adj = buildAdjacency(g);
const base = JSON.parse(readFileSync(kind === 'atrial' ? 'tools/af-base.json' : 'tools/vf-base.json', 'utf8'));
const sites: string[] = base.candidate_sites;
const minGap: number = base.min_gap_ms;
const minReach: number = base.min_reach_nodes;
const wanted = 16;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const chosen: { site: string; time_ms: number }[] = [];
const solveFor = (list: { site: string; time_ms: number }[]) => {
  const sc = { ...base, waves: list.map((s) => ({ tag: base.tag, stimuli: [s] })), loops: [] };
  const req = prepareScenario(graph, sc);
  return solveWaves(adj, edgeTimes(g, req.velocity, req.edgeScale), meta.nodes, req.waves.map((w) => w.stimuli), req.refractory, { ekind: graph.ekind, kindDir: req.kindDir, decrement: req.decrement });
};
const cls = kind === 'atrial' ? 0 : 1;
let last = -1e9;
let gap = 0;
let prevSite = '';
for (let t = 0; t <= base.max_ms && chosen.length < wanted; t += 6) {
  if (t - last < gap) continue;
  for (const site of [...sites].sort(() => rnd() - 0.5)) {
    if (site === prevSite) continue;
    const trial = [...chosen, { site, time_ms: t }];
    const T = solveFor(trial)[trial.length - 1];
    let reach = 0;
    for (let i = 0; i < meta.tissueNodes; i++) if (graph.cls[i] === cls && Number.isFinite(T[i])) reach++;
    if (reach >= minReach) {
      chosen.push({ site, time_ms: t });
      last = t;
      prevSite = site;
      gap = minGap + rnd() * (base.jitter_ms ?? 0);
      break;
    }
  }
}
console.log(JSON.stringify(chosen));
writeFileSync(`/tmp/${kind}-seq.json`, JSON.stringify(chosen));
