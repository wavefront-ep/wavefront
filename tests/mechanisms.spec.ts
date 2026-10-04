import { expect, test } from '@playwright/test';
import { runScenario } from './scenarioRunner';

const width = (w: [number, number] | null) => (w ? w[1] - w[0] : 0);

test('complete heart block: atria and ventricles beat independently', () => {
  const { waves } = runScenario('complete_heart_block');
  const sinus = waves.filter((w) => w.tag === 'sinus');
  const escape = waves.filter((w) => w.tag === 'escape');
  expect(sinus.length).toBe(4);
  expect(escape.length).toBe(2);
  for (const w of sinus) {
    expect(w.a).not.toBeNull();
    expect(w.v).toBeNull(); // no atrial impulse crosses the block
  }
  for (const w of escape) {
    expect(w.a).toBeNull(); // the escape rhythm does not conduct back to the atria
    expect(width(w.v)).toBeLessThan(110); // junctional escape: narrow QRS
  }
  const rateAtria = sinus[1].stim[0].time - sinus[0].stim[0].time;
  const rateVent = escape[1].stim[0].time - escape[0].stim[0].time;
  expect(rateVent).toBeGreaterThan(rateAtria * 1.5); // ventricular rate is the slower one (about 40 per minute)
});

test('AVNRT: a premature beat blocks in the fast pathway, goes down the slow one and starts a circuit', () => {
  const { waves, at, meta } = runScenario('avnrt');
  const [sinus, pac, ...laps] = waves;
  // normal beat takes the fast route
  expect(sinus.v![0] - sinus.a![0]).toBeLessThan(180);
  // the premature beat reaches the ventricles much later than the fast route would allow: slow pathway
  const slowPassage = at(1, 'AVN_exit') - pac.stim[0].time;
  expect(slowPassage).toBeGreaterThan(250);
  // sustained tachycardia: every lap activates both atria and ventricles
  expect(laps.length).toBeGreaterThanOrEqual(6);
  for (const w of laps) {
    expect(w.a).not.toBeNull();
    expect(w.v).not.toBeNull();
    expect(width(w.v)).toBeLessThan(110); // narrow QRS
  }
  // regular cycle length near 330 ms
  const cl = laps[1].stim[0].time - laps[0].stim[0].time;
  expect(cl).toBeGreaterThan(300);
  expect(cl).toBeLessThan(360);
  // atria and ventricles are activated together: the next atrial activation starts inside this ventricular window
  for (let k = 0; k < laps.length - 1; k++) {
    const nextA = laps[k + 1].a![0];
    expect(nextA).toBeGreaterThan(laps[k].v![0] - 60);
    expect(nextA).toBeLessThan(laps[k].v![1] + 60);
  }
  expect(meta.edgesets).toContain('ap_left_free_wall'); // substrates exist in the graph
});

test('WPW: the accessory pathway pre-excites the ventricle', () => {
  const normal = runScenario('sinus_rhythm').waves[0];
  const wpw = runScenario('wpw_preexcitation').waves[0];
  expect(wpw.v![0]).toBeLessThan(normal.v![0] - 40); // short PR
  expect(width(wpw.v)).toBeGreaterThan(width(normal.v) + 25); // wider QRS from fusion
});

test('orthodromic AVRT: down the AV node, up the pathway, narrow QRS, atria activated eccentrically', () => {
  const { waves, at } = runScenario('avrt_orthodromic');
  const [sinus, pac, ...laps] = waves;
  expect(width(sinus.v)).toBeLessThan(110); // concealed pathway: normal narrow QRS
  expect(sinus.v![0] - sinus.a![0]).toBeGreaterThan(140); // no pre-excitation
  expect(at(1, 'AP_left_free_wall_ventricular')).toBeGreaterThan(pac.v![0]); // ventricle first, then the pathway
  expect(laps.length).toBeGreaterThanOrEqual(6);
  for (const w of laps) {
    expect(w.v).not.toBeNull();
    expect(width(w.v)).toBeLessThan(110);
    // the atria are activated from the pathway end: the first atrial tissue is the stimulus site itself
    expect(w.a![0]).toBeCloseTo(w.stim[0].time, 0);
  }
});

test('typical flutter: a circuit of about 300 per minute with 2:1 AV conduction', () => {
  const { waves, at } = runScenario('atrial_flutter_typical');
  expect(waves.length).toBe(9);
  for (const w of waves) expect(width(w.a)).toBeGreaterThan(100); // every lap activates most of the atria
  const conducted = waves.map((w) => w.v !== null);
  // alternate waves reach the ventricles
  for (let i = 1; i < conducted.length; i++) expect(conducted[i]).toBe(!conducted[i - 1]);
  expect(waves[1].stim[0].time - waves[0].stim[0].time).toBe(200);
  // the wavefront crosses the isthmus slowly: well after the start, before the lap completes
  const cti = at(0, 'Flutter_cti_end');
  expect(cti).toBeGreaterThan(30);
  expect(cti).toBeLessThan(190);
});

test('scar VT: identical wide complexes, no atrial capture, scar does not conduct', () => {
  const { waves, at, meta } = runScenario('vt_scar_monomorphic');
  const vt = waves.filter((w) => w.tag === 'vt');
  expect(vt.length).toBe(7);
  const widths = vt.map((w) => width(w.v));
  for (const x of widths) expect(x).toBeGreaterThan(130); // wide
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(4); // monomorphic: every lap the same
  for (const w of vt) expect(w.a).toBeNull();
  for (const w of waves.filter((w) => w.tag === 'sinus')) expect(w.v).toBeNull(); // AV dissociation
  // the circuit takes a long time to reach its exit
  expect(at(1, 'VT_exit') - vt[0].stim[0].time).toBeGreaterThan(150);
  expect(meta.masks).toContain('scar_core');
});
