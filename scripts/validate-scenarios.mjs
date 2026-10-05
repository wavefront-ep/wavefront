// Build-time check of src/scenarios/*.json against the schema and against the activation graph.
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/scenarios/', import.meta.url);
const graph = JSON.parse(readFileSync(new URL('../public/heart/conduction.json', import.meta.url), 'utf8'));
const required = ['id', 'mechanism', 'group', 'title', 'summary', 'period_ms', 'waves', 'events', 'teaching_points'];
const substrateMeshes = new Set(graph.meshes);
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
  if (!(s.period_ms > 0)) fail(file, 'period_ms must be positive');
  const site = (n, where) => {
    if (!(n in graph.named)) fail(file, `${where}: unknown site "${n}"`);
  };
  let last = -Infinity;
  for (const w of s.waves ?? []) {
    if (!w.tag || !w.stimuli?.length) fail(file, 'every wave needs a tag and stimuli');
    for (const st of w.stimuli ?? []) site(st.site, 'wave');
    const t = Math.min(...(w.stimuli ?? []).map((x) => x.time_ms));
    if (t < last) fail(file, 'explicit waves must be listed in time order (loops refer to them by index)');
    last = t;
  }
  let nWaves = (s.waves ?? []).length;
  for (const l of s.loops ?? []) {
    nWaves += l.laps;
    if (!l.first_ms && !l.first_after) fail(file, 'a loop needs first_ms or first_after');
    if (l.first_after) {
      site(l.first_after.node, 'loop first_after');
      if (!(l.first_after.wave < (s.waves ?? []).length)) fail(file, 'first_after.wave must index an explicit wave');
    }
    for (const e of l.exit_sites ?? []) site(e.site, 'loop');
  }
  if (nWaves > 16) fail(file, `${nWaves} waves; at most 16 are carried per vertex`);
  for (const m of s.modifiers ?? []) {
    if ('enable' in m && !graph.edgesets.includes(m.enable)) fail(file, `unknown edge set "${m.enable}"`);
    if ('edgeset' in m && !graph.edgesets.includes(m.edgeset)) fail(file, `unknown edge set "${m.edgeset}"`);
    if ('kind' in m && !graph.kinds.includes(m.kind)) fail(file, `unknown edge kind "${m.kind}"`);
    if ('region' in m && !graph.masks.includes(m.region)) fail(file, `unknown region "${m.region}"`);
  }
  for (const r of s.refractory ?? []) if (!graph.masks.includes(r.region)) fail(file, `unknown region "${r.region}"`);
  for (const d of s.decrement ?? []) if (!graph.kinds.includes(d.kind)) fail(file, `unknown edge kind "${d.kind}"`);
  for (const h of s.highlight ?? []) if (!graph.masks.includes(h)) fail(file, `unknown highlight region "${h}"`);
  for (const m of s.labels ?? []) if (!substrateMeshes.has(m) && !/^(vein_|epi_|endo_|aorta|pulmonary_trunk|valve_)/.test(m)) fail(file, `unknown label mesh "${m}"`);
  for (const m of s.show ?? []) if (!substrateMeshes.has(m)) fail(file, `unknown substrate mesh "${m}"`);
  for (const k of Object.keys(s.constants ?? {})) if (!(k in graph.constants)) fail(file, `unknown constant "${k}"`);
  if (s.camera?.focus && !(s.camera.focus in graph.paths) && !['scar'].includes(s.camera.focus) && !(s.camera.focus in graph.purkinje)) fail(file, `unknown camera focus "${s.camera.focus}"`);
  if (s.cellular) {
    const cellTypes = ['pacemaker', 'atrial', 'av_node', 'purkinje', 'ventricular'];
    const c = s.cellular;
    const chk = (t, where) => { if (!cellTypes.includes(t)) fail(file, `cellular ${where}: unknown cell type "${t}"`); };
    chk(c.default, 'default');
    for (const t of c.types ?? []) chk(t, 'types');
    if (c.types && !c.types.includes(c.default)) fail(file, 'cellular default must be one of its types');
    for (const [t, n] of Object.entries(c.sites ?? {})) { chk(t, 'sites'); site(n, 'cellular site'); }
    for (const t of c.automatic ?? []) chk(t, 'automatic');
    for (const i of c.illustrative ?? []) { chk(i.type, 'illustrative'); if (!i.label || !(i.apd_ms > 0)) fail(file, 'cellular illustrative entries need a label and apd_ms'); }
    if (!c.note) fail(file, 'cellular needs a note');
  }
  const evIds = new Set();
  for (const e of s.events ?? []) {
    if (evIds.has(e.id)) fail(file, `duplicate event id ${e.id}`);
    evIds.add(e.id);
    if (!e.caption || !e.label) fail(file, `event ${e.id} needs a label and caption`);
    const a = e.at ?? {};
    if ('at_ms' in a) {
      if (!(a.at_ms >= 0 && a.at_ms <= s.period_ms)) fail(file, `event ${e.id}: at_ms outside the timeline`);
    } else if ('node' in a) site(a.node, `event ${e.id}`);
    else if ('firstRange' in a && !a.firstRange.every((r) => r in graph.ranges)) fail(file, `event ${e.id}: unknown range`);
    else if ('firstRegion' in a && ![1, 2, 3, 4].includes(a.firstRegion)) fail(file, `event ${e.id}: region must be 1-4`);
    else if (('firstTissue' in a || 'lastTissue' in a) && !['atrial', 'ventricular'].includes(a.firstTissue ?? a.lastTissue)) fail(file, `event ${e.id}: tissue must be atrial or ventricular`);
    else if (!['node', 'firstRange', 'firstRegion', 'firstTissue', 'lastTissue', 'at_ms'].some((k) => k in a)) fail(file, `event ${e.id}: unrecognised "at"`);
  }
}
if (failed) process.exit(1);
console.log(`scenarios ok (${ids.size})`);
