import { expect, test } from '@playwright/test';
import { openHeart, settle, state, waitForSim } from './helpers';

const sim = (page: any) =>
  page.evaluate(() => {
    const { engine, result, events } = (window as any).epEngine;
    const g = engine.graph;
    const T = result.times[0];
    const first = (pred: (i: number) => boolean) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < g.meta.tissueNodes; i++) if (pred(i) && Number.isFinite(T[i])) { lo = Math.min(lo, T[i]); hi = Math.max(hi, T[i]); }
      return [lo, hi];
    };
    return {
      atrial: first((i) => g.cls[i] === 0),
      vent: first((i) => g.cls[i] === 1),
      lv: first((i) => g.region[i] === 1),
      rv: first((i) => g.region[i] === 2),
      la: first((i) => g.region[i] === 3),
      ra: first((i) => g.region[i] === 4),
      ref: g.meta.reference,
      events: events.map((e: any) => [e.id, e.t]),
      unreached: Array.from({ length: g.meta.tissueNodes }, (_, i) => T[i]).filter((t) => !Number.isFinite(t)).length,
    };
  });

test('browser solver reproduces the reference activation and normal intervals', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  const s = await sim(page);
  expect(s.unreached).toBe(0);
  // same graph, same velocities: matches the Python reference to within a millisecond
  expect(s.atrial[0]).toBeCloseTo(s.ref.atrial_ms[0], 0);
  expect(s.atrial[1]).toBeCloseTo(s.ref.atrial_ms[1], 0);
  expect(s.vent[0]).toBeCloseTo(s.ref.ventricular_ms[0], 0);
  expect(s.vent[1]).toBeCloseTo(s.ref.ventricular_ms[1], 0);
  // normal sinus intervals (SPEC 5): P about 100 ms, PR about 160 ms, QRS about 90 ms
  const pDuration = s.atrial[1] - s.atrial[0];
  const pr = s.vent[0] - s.atrial[0];
  const qrs = s.vent[1] - s.vent[0];
  expect(pDuration).toBeGreaterThan(80);
  expect(pDuration).toBeLessThan(120);
  expect(pr).toBeGreaterThan(140);
  expect(pr).toBeLessThan(180);
  expect(qrs).toBeGreaterThan(75);
  expect(qrs).toBeLessThan(115);
  // sequence: right atrium first, left atrium last; left septum / LV before RV
  expect(s.ra[0]).toBeLessThan(s.la[0]);
  expect(s.la[1]).toBeGreaterThan(s.ra[1]);
  expect(s.lv[0]).toBeLessThan(s.rv[0]);
  // events in order
  const ts = s.events.map((e: any) => e[1]);
  expect(ts).toEqual([...ts].sort((a: number, b: number) => a - b));
  expect(s.events.map((e: any) => e[0])).toEqual(['san', 'atria', 'avn', 'his', 'branches', 'purkinje', 'ventricles', 'end']);
});

test('the sinus beat plays, pauses on space, and steps between events', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Sinus beat' })).toBeEnabled();
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  await expect(page.locator('.playbar')).toBeVisible();
  await page.evaluate(() => (window as any).epHeart.setGuided(false)); // continuous playback for this check
  await settle(page, 700);
  let s = await state(page);
  expect(s.playing).toBe(true);
  expect(s.time).toBeGreaterThan(0);
  expect(s.layers.conduction).toBe(true);
  await page.keyboard.press(' ');
  s = await state(page);
  expect(s.playing).toBe(false);
  const events: [string, number][] = await page.evaluate(() => (window as any).epEngine.events.map((e: any) => [e.id, e.t]));
  await page.evaluate(() => (window as any).epHeart.setTime(0));
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).time).toBeCloseTo(events[1][1], 1);
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).time).toBeCloseTo(events[2][1], 1);
  await page.keyboard.press('ArrowLeft');
  expect((await state(page)).time).toBeCloseTo(events[1][1], 1);
  // the caption follows the playhead
  await expect(page.locator('.pb-caption')).toContainText('atrial muscle');
  await page.getByRole('button', { name: 'Close the beat player' }).click();
  await expect(page.locator('.playbar')).toBeHidden();
});

test('speed defaults to 0.05x and the control changes it', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  expect((await page.evaluate(() => (window as any).epHeart.playback.speed))).toBe(0.05);
  await page.getByRole('button', { name: '0.1×' }).click();
  expect((await page.evaluate(() => (window as any).epHeart.playback.speed))).toBe(0.1);
});

test('conduction layer: tubes appear, the wall turns see-through, and it restores', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  expect((await state(page)).visible.some((n: string) => n.startsWith('cs_'))).toBe(false);
  await page.getByLabel('Conduction system').check();
  let s = await state(page);
  expect(s.visible).toContain('cs_SAN');
  expect(s.visible).toContain('cs_AVN');
  expect(s.visible).toContain('cs_Purkinje_LV');
  expect(s.layers.epiOpacity).toBeLessThan(0.5);
  await page.getByLabel('Conduction system').uncheck();
  s = await state(page);
  expect(s.visible.some((n: string) => n.startsWith('cs_'))).toBe(false);
  expect(s.layers.epiOpacity).toBe(1);
});

test('the conduction list selects a structure and shows a schematic note where it applies', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await page.getByLabel('Conduction system').check();
  await page.locator('.cs-list').getByRole('button', { name: "Bachmann's bundle (schematic)" }).click();
  expect((await state(page)).selected).toBe('cs_Bachmann');
  await expect(page.locator('.struct-tag')).toContainText('Schematic');
  await page.locator('.cs-list').getByRole('button', { name: 'Sinoatrial node' }).click();
  await expect(page.locator('.struct-name')).toHaveText('Sinoatrial node');
});

test('activation map is only offered on the last tour step', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await expect(page.getByText('Activation display')).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: 'Guided tour' }).click();
  await expect(page.locator('.pb-legend')).toBeHidden();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect((await state(page)).style).toBe('map');
  await expect(page.locator('.pb-legend')).toBeVisible();
  await expect(page.locator('.pb-legend')).toContainText('ms');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect((await state(page)).style).toBe('live');
  await expect(page.locator('.app.drawer-open')).toHaveCount(1); // the last step opens the Layers and views panel
  await page.getByRole('button', { name: 'Next: sinus beat' }).click();
  expect((await state(page)).style).toBe('live'); // the beat opens as a live wave, not the map
});

test('guided tour walks nine steps and ends cleanly', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Guided tour' }).click();
  await expect(page.locator('.pb-tour-count')).toHaveText('1 of 9');
  const titles: string[] = [];
  for (let i = 0; i < 9; i++) {
    titles.push(await page.locator('.pb-tour-title').innerText());
    await expect(page.locator('.pb-tour-count')).toHaveText(`${i + 1} of 9`);
    if (i < 8) await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  expect(new Set(titles).size).toBe(9);
  await page.getByRole('button', { name: 'Next: sinus beat' }).click(); // the tour leads into the sinus beat
  await expect(page.locator('.pb-ecgrow')).toBeVisible();
  await expect(page.locator('.topbar').getByRole('button', { name: 'Sinus beat' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next: arrhythmias' }).click(); // and the sinus beat into the arrhythmias
  await expect(page.locator('.topbar').getByRole('button', { name: 'Arrhythmias' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sec-mech')).toBeVisible();
});

test('scenario data is validated', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  const ok = await page.evaluate(async () => {
    const { validateScenario } = await import('/src/scenarios/types.ts');
    try {
      validateScenario({ id: 'x' });
      return 'accepted';
    } catch (e: any) {
      return e.message;
    }
  });
  expect(ok).toContain('missing');
});

test('very slow speeds are available', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  for (const s of [0.02, 0.05]) {
    await page.getByRole('button', { name: `${s}×` }).click();
    expect(await page.evaluate(() => (window as any).epHeart.playback.speed)).toBe(s);
  }
});

test('four-chamber cut keeps the conduction system in view and labelled', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await page.getByLabel('Conduction system').check();
  await page.getByLabel('Labels').check();
  await page.getByRole('button', { name: 'Four-chamber cut' }).click();
  await settle(page, 2500);
  expect((await state(page)).cut.offset).toBeCloseTo(-0.26, 2);
  const labels = await page.locator('.overlay text').allTextContents();
  for (const l of ['SA node', 'AV node', 'His bundle', 'Left bundle branch', 'Right bundle branch']) expect(labels).toContain(l);
});

test('ECG strip: waves, event markers and cursor follow the beat', async ({ page }) => {
  await openHeart(page, 1600, 900);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  await expect(page.locator('.pb-ecg svg path.pb-ecg-trace')).toBeVisible();
  await expect(page.locator('.pb-ecg-mark')).toHaveCount(8);
  await expect(page.locator('.pb-ecg-val')).toHaveCount(0); // no interval readouts
  // the P wave segment lights up during atrial activation and the QRS segment during ventricular activation
  await page.evaluate(() => { const s = (window as any).epHeart; s.pause(); s.setTime(60); });
  expect(await page.locator('.pb-ecg-seg.on').count()).toBe(1);
  const left60 = await page.locator('.pb-ecg-cursor').evaluate((e: HTMLElement) => parseFloat(e.style.left));
  expect(left60).toBeCloseTo(6, 0);
  await page.evaluate(() => (window as any).epHeart.setTime(200));
  const on = await page.locator('.pb-ecg-seg').evaluateAll((els) => els.map((e) => e.classList.contains('on')));
  expect(on).toEqual([false, true, false]);
  // the "On the ECG" line follows the current event; flat PR segment for the His bundle
  await page.evaluate(() => (window as any).epHeart.setTime(128));
  await expect(page.locator('.pb-ecgnote')).toContainText('flat');
  // markers jump to their event
  await page.locator('.pb-ecg-mark').nth(6).click();
  const events: [string, number][] = await page.evaluate(() => (window as any).epEngine.events.map((e: any) => [e.id, e.t]));
  expect((await state(page)).time).toBeCloseTo(events[6][1], 1);
  // the strip can be hidden
  await page.getByRole('button', { name: 'Hide ECG' }).click();
  await expect(page.locator('.pb-ecgnote')).toBeHidden();
});

test('top bar offers the route (tour, sinus beat, arrhythmias) and layers up front', async ({ page }) => {
  await openHeart(page);
  await waitForSim(page);
  const bar = page.locator('.topbar');
  await expect(bar.getByRole('button', { name: 'Guided tour' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Sinus beat' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Arrhythmias' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Cutaway' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Layers and views' })).toBeVisible();
  await bar.getByRole('button', { name: 'Layers and views' }).click();
  await expect(page.locator('.app.drawer-open')).toHaveCount(1);
  await bar.getByRole('button', { name: 'Guided tour' }).click();
  await expect(page.locator('.overlay text')).toHaveCount(6); // step 1 names only the chambers, great arteries and apex it shows
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await settle(page, 1800);
  const names = await page.locator('.overlay text').allTextContents();
  expect(names.length).toBeLessThanOrEqual(3);
  expect(names).toContain('SA node');
});
