import { expect, test } from '@playwright/test';
import { CELL_BY_ID, buildCellTrace, phaseAt } from '../src/cell/actionPotential';
import { openHeart, waitForSim } from './helpers';

// ---- the action-potential model (pure functions)
test('a pacemaker cell ramps up to threshold, and a faster rate gives a steeper phase 4', () => {
  const slow = buildCellTrace('pacemaker', [0, 1400, 2800], { period: 4200 });
  const fast = buildCellTrace('pacemaker', [0, 460, 920], { period: 2400 });
  const slope = (tr: ReturnType<typeof buildCellTrace>) => {
    const r = tr.segs.find((s) => s.phase === 4 && s.ramp && s.t0 > 0)!;
    return (-40 - -60) / (r.t1 - r.t0); // mV per ms from the maximum diastolic potential to threshold
  };
  expect(slope(fast)).toBeGreaterThan(slope(slow) * 2);
  // the ramp ends at threshold, where the upstroke starts
  const r = fast.segs.find((s) => s.phase === 4 && s.ramp && s.t0 > 0)!;
  expect(fast.mv[Math.round(r.t1)]).toBeGreaterThan(-45);
  expect(fast.mv[Math.round(r.t0) + 1]).toBeLessThan(-55);
});

test('a ventricular cell sits at rest until activated, then runs phases 0 to 4 and returns to rest after its duration', () => {
  const tr = buildCellTrace('ventricular', [200], { period: 800, apd: 280 });
  expect(tr.mv[100]).toBeCloseTo(-85, 0);
  expect(Math.max(...tr.mv)).toBeGreaterThan(20); // overshoot
  expect(tr.mv[200 + 140]).toBeGreaterThan(-20); // plateau
  expect(tr.mv[200 + 281]).toBeCloseTo(-85, 0);
  expect([0, 1, 2, 3].every((p) => tr.segs.some((s) => s.phase === p))).toBe(true);
  expect(phaseAt(tr, 205).phase).toBe(1);
  expect(phaseAt(tr, 300).phase).toBe(2);
  expect(phaseAt(tr, 450).phase).toBe(3);
  expect(phaseAt(tr, 600).phase).toBe(4);
});

test('an early afterdepolarisation is a hump on the late plateau, only on the beats that carry one', () => {
  const plain = buildCellTrace('ventricular', [60], { period: 800, apd: 470 });
  const ead = buildCellTrace('ventricular', [60], { period: 800, apd: 470, ead: [0] });
  const t = Math.round(60 + 0.78 * 470);
  expect(ead.mv[t] - plain.mv[t]).toBeGreaterThan(20);
  expect(ead.mv[10]).toBe(plain.mv[10]);
});

test('the slow-response cells depolarise slowly and the fast ones quickly', () => {
  const av = buildCellTrace('av_node', [100], { period: 600 });
  const vent = buildCellTrace('ventricular', [100], { period: 600 });
  const rise = (tr: ReturnType<typeof buildCellTrace>) => tr.segs.find((s) => s.phase === 0)!.t1 - tr.segs.find((s) => s.phase === 0)!.t0;
  expect(rise(av)).toBeGreaterThan(rise(vent) * 5);
  expect(CELL_BY_ID.av_node.slow).toBe(true);
});

// ---- the interface
test('Cellular view in the top bar opens a list of cases and the strip', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Cellular view' }).click();
  await expect(page.locator('#sec-cell')).toBeVisible();
  await expect(page.locator('#sec-mech')).toBeHidden();
  await page.locator('#sec-cell').getByRole('button', { name: /Mobitz/ }).click();
  await expect(page.locator('.pb-cellrow')).toBeVisible();
  expect(page.url()).toContain('#cell=mobitz_i');
  await expect(page.locator('.pb-cell-phase')).not.toBeEmpty();
  await page.locator('.pb-cell-picker').getByRole('button', { name: 'Ventricular' }).click();
  await expect(page.locator('.pb-cell-picker button[aria-pressed="true"]')).toHaveText('Ventricular');
  await page.getByRole('button', { name: 'Hide cell view' }).click();
  await expect(page.locator('.pb-cellrow')).toBeHidden();
});

test('in Arrhythmias the strip is off but can be turned on where a case has one', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Arrhythmias' }).click();
  await page.evaluate(() => (window as any).epOpen('mobitz_i'));
  await expect(page.locator('.pb-cellrow')).toBeHidden();
  await page.getByRole('button', { name: 'Cell view', exact: true }).click();
  await expect(page.locator('.pb-cellrow')).toBeVisible();
  await page.evaluate(() => (window as any).epOpen('avnrt')); // no cellular block
  await expect(page.getByRole('button', { name: /cell view/i })).toHaveCount(0);
});

test('a cell-view link opens the case in Cellular view, and torsades shows its illustrative pair', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await page.goto('/#cell=torsades_de_pointes');
  await page.reload();
  await waitForSim(page);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Cellular view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pb-cell-legend')).toContainText('Long QT');
  await expect(page.locator('.pb-cell-note')).toContainText('not on the beat');
});
