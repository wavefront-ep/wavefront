// Build-time check of src/scenarios/*.json against the schema and against the activation graph.
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/scenarios/', import.meta.url);
const graph = JSON.parse(readFileSync(new URL('../public/heart/conduction.json', import.meta.url), 'utf8'));
const required = ['id', 'mechanism', 'title', 'source', 'period_ms', 'stimuli', 'events', 'teaching_points'];
let failed = 0;
const fail = (file, msg) => {
  console.error(`scenario ${file}: ${msg}`);
  failed++;
};

const ids = new Set();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const s = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  for (const k of required) if (!(k in s)) fail(file, `missing "${k}"`);
  if (ids.has(s.id)) fail(file, `duplicate id ${s.id}`);
  ids.add(s.id);
  if (typeof s.source !== 'string' || !s.source.trim()) fail(file, 'source must name the slides it implements');
  if (!(s.period_ms > 0)) fail(file, 'period_ms must be positive');
  for (const st of s.stimuli ?? []) if (!(st.site in graph.named)) fail(file, `unknown stimulus site "${st.site}"`);
  const evIds = new Set();
  for (const e of s.events ?? []) {
    if (evIds.has(e.id)) fail(file, `duplicate event id ${e.id}`);
    evIds.add(e.id);
    if (!e.caption || !e.label) fail(file, `event ${e.id} needs a label and caption`);
    const a = e.at ?? {};
    if ('node' in a && !(a.node in graph.named)) fail(file, `event ${e.id}: unknown node "${a.node}"`);
    else if ('firstRange' in a && !a.firstRange.every((r) => r in graph.ranges)) fail(file, `event ${e.id}: unknown range`);
    else if ('firstRegion' in a && ![1, 2, 3, 4].includes(a.firstRegion)) fail(file, `event ${e.id}: region must be 1-4`);
    else if (('firstTissue' in a || 'lastTissue' in a) && !['atrial', 'ventricular'].includes(a.firstTissue ?? a.lastTissue)) fail(file, `event ${e.id}: tissue must be atrial or ventricular`);
    else if (!['node', 'firstRange', 'firstRegion', 'firstTissue', 'lastTissue'].some((k) => k in a)) fail(file, `event ${e.id}: unrecognised "at"`);
  }
}
if (failed) process.exit(1);
console.log(`scenarios ok (${ids.size})`);
