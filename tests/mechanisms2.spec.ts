import { expect, test } from '@playwright/test';
import { graph, runScenario } from './scenarioRunner';

const width = (w: [number, number] | null) => (w ? w[1] - w[0] : 0);
const first = (w: any, region: number) => {
  let lo = Infinity;
  for (let i = 0; i < graph.meta.tissueNodes; i++) if (graph.region[i] === region && Number.isFinite(w.T[i])) lo = Math.min(lo, w.T[i]);
  return lo;
};
const mean = (w: any, region: number) => {
  let s = 0, n = 0;
  for (let i = 0; i < graph.meta.tissueNodes; i++) if (graph.region[i] === region && Number.isFinite(w.T[i])) { s += w.T[i]; n++; }
  return s / n;
};
const rr = (waves: any[]) => {
  const v = waves.filter((w) => w.v).map((w) => w.v[0]);
  return v.slice(1).map((t, i) => t - v[i]);
};
const sd = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};

test('sinus node rate disorders: bradycardia, tachycardia, pause, exit block', () => {
  const brady = runScenario('sinus_bradycardia').waves;
  expect(brady[1].stim[0].time - brady[0].stim[0].time).toBeGreaterThan(1000); // below 60 per minute
  for (const w of brady) expect(w.v).not.toBeNull(); // conduction itself is normal
  const tachy = runScenario('sinus_tachycardia').waves;
  expect(tachy[1].stim[0].time - tachy[0].stim[0].time).toBeLessThan(600); // above 100 per minute
  for (const w of tachy) expect(w.v).not.toBeNull();
  const pause = runScenario('sinus_pause').waves;
  expect(pause[2].stim[0].time - pause[1].stim[0].time).toBeGreaterThan(1500);
  const exit = runScenario('sa_exit_block').waves;
  const pp = exit[1].stim[0].time - exit[0].stim[0].time;
  expect(exit[2].stim[0].time - exit[1].stim[0].time).toBe(2 * pp); // the pause is a multiple of the P-P interval
});

test('first-degree AV block: every beat conducts with a long PR', () => {
  const waves = runScenario('first_degree_av_block').waves;
  for (const w of waves) {
    expect(w.v).not.toBeNull();
    expect(w.v![0] - w.a![0]).toBeGreaterThan(260);
  }
});

test('Mobitz I: PR lengthens, a beat is dropped, then PR resets', () => {
  const w = runScenario('mobitz_i').waves;
  const pr = (i: number) => (w[i].v ? w[i].v![0] - w[i].a![0] : null);
  expect(pr(0)).toBeLessThan(pr(1)!);
  expect(w[2].v).toBeNull(); // dropped
  expect(w[2].a).not.toBeNull(); // the P wave is still there
  expect(pr(3)).toBeLessThan(pr(1)!); // reset after the pause
  expect(w[5].v).toBeNull(); // and it repeats
});

test('Mobitz II: constant PR, then a sudden block below the AV node', () => {
  const { waves, at } = runScenario('mobitz_ii');
  const prs = [0, 1, 2, 3].map((i) => waves[i].v![0] - waves[i].a![0]);
  expect(Math.max(...prs) - Math.min(...prs)).toBeLessThan(6);
  expect(waves[4].v).toBeNull();
  expect(Number.isFinite(at(4, 'AVN_exit'))).toBe(true); // conducted through the AV node...
  expect(at(4, 'His_proximal')).toBe(Infinity); // ...and blocked in the His-Purkinje system
  expect(waves[5].v).not.toBeNull();
});

test('bundle branch blocks: wide QRS, the blocked ventricle activated last', () => {
  const normal = runScenario('sinus_rhythm').waves[0];
  const l = runScenario('lbbb').waves[0];
  const r = runScenario('rbbb').waves[0];
  expect(width(l.v)).toBeGreaterThan(width(normal.v) + 50);
  expect(width(r.v)).toBeGreaterThan(width(normal.v) + 50);
  expect(mean(l, 1)).toBeGreaterThan(mean(l, 2)); // LBBB: left ventricle later than right
  expect(mean(r, 2)).toBeGreaterThan(mean(r, 1)); // RBBB: right ventricle later than left
});

test('ectopic, junctional and multifocal atrial rhythms', () => {
  const eat = runScenario('ectopic_atrial_tachycardia').waves;
  for (const w of eat) {
    expect(w.v).not.toBeNull(); // 1:1 conduction
    expect(width(w.v)).toBeLessThan(110);
  }
  const jn = runScenario('junctional_tachycardia').waves;
  for (const w of jn) expect(w.v![0]).toBeLessThan(w.a![0]); // ventricles first, atria backwards
  const mat = runScenario('multifocal_atrial_tachycardia');
  expect(new Set(mat.waves.map((w) => w.stim[0].node)).size).toBeGreaterThanOrEqual(4); // several foci
  expect(sd(rr(mat.waves))).toBeGreaterThan(30); // irregular
});

test('atrial fibrillation: fragmented atrial activity and an irregularly irregular ventricular rhythm', () => {
  const waves = runScenario('atrial_fibrillation').waves;
  expect(waves.length).toBe(16);
  expect(waves.filter((w) => width(w.a) < 100 && w.a).length).toBeGreaterThanOrEqual(2); // partial wavelets
  const r = rr(waves);
  expect(r.length).toBeGreaterThanOrEqual(5);
  expect(sd(r)).toBeGreaterThan(25);
  for (const w of waves.filter((w) => w.v)) expect(width(w.v)).toBeLessThan(110); // narrow QRS
});

test('pre-excited AF: wide, fast, irregular; AF with BBB: wide, irregular, same shape', () => {
  const pe = runScenario('preexcited_af').waves;
  const conducted = pe.filter((w) => w.v);
  expect(conducted.length).toBeGreaterThanOrEqual(7);
  const widths = conducted.map((w) => width(w.v));
  expect(widths.filter((x) => x > 120).length).toBeGreaterThanOrEqual(3); // pre-excited complexes
  expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(40); // complex shape varies beat to beat
  expect(Math.min(...rr(pe).filter((x) => x > 0))).toBeLessThan(300);
  const bbb = runScenario('af_with_bbb').waves.filter((w) => w.v);
  for (const w of bbb) expect(width(w.v)).toBeGreaterThan(130);
  expect(sd(rr(runScenario('af_with_bbb').waves))).toBeGreaterThan(25);
});

test('antidromic AVRT and SVT with aberrancy', () => {
  const anti = runScenario('antidromic_avrt').waves;
  expect(anti.length).toBe(7);
  for (const w of anti) {
    expect(w.v).not.toBeNull();
    expect(width(w.v)).toBeGreaterThan(130); // wide
    expect(w.a![0]).toBeLessThan(w.v![0]); // atria are activated first (from the AV node end)
  }
  const svt = runScenario('svt_aberrancy').waves;
  for (const w of svt.slice(2)) expect(width(w.v)).toBeGreaterThan(130); // aberrant conduction in the tachycardia
});

test('flutter 4:1, torsades and VF', () => {
  const f = runScenario('atrial_flutter_4to1').waves;
  f.forEach((w, i) => expect(w.v !== null).toBe(i % 4 === 0)); // one conducted wave in four
  const t = runScenario('torsades_de_pointes').waves;
  const tdp = t.filter((w) => w.tag === 'tdp' && w.v);
  expect(tdp.length).toBeGreaterThanOrEqual(4);
  for (const w of t.filter((w) => w.tag === 'sinus')) expect(w.v).toBeNull(); // AV dissociation
  const sites = new Set(tdp.map((w) => w.stim[0].node));
  expect(sites.size).toBeGreaterThanOrEqual(3); // a moving focus gives changing morphology
  const vf = runScenario('ventricular_fibrillation').waves;
  let overlapping = 0;
  for (let i = 0; i < vf.length - 1; i++) if (vf[i].v && vf[i + 1].v && vf[i].v![1] > vf[i + 1].v![0]) overlapping++;
  expect(overlapping).toBeGreaterThanOrEqual(10); // wavelets overlap in time
  for (const w of vf) expect(w.a).toBeNull();
});
