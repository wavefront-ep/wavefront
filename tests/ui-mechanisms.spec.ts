import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openHeart, settle, state, waitForSim } from './helpers';

const scenario = (id: string) => JSON.parse(readFileSync(`src/scenarios/${id}.json`, 'utf8'));
const IDS = ['complete_heart_block', 'avnrt', 'wpw_preexcitation', 'avrt_orthodromic', 'atrial_flutter_typical', 'vt_scar_monomorphic'];

test('mechanisms mode: grouped picker, collapsed by default, one selection at a time', async ({ page }) => {
  await openHeart(page, 1600, 900);
  await waitForSim(page);
  await expect(page.locator('#sec-mech')).toBeHidden(); // Explore mode keeps the quiet screen
  await page.locator('.rail-btn[aria-label="Mechanisms"]').click();
  await expect(page.locator('#sec-mech')).toBeVisible();
  const heads = page.locator('.mech-head');
  expect(await heads.count()).toBe(3); // normal, block, reentry
  for (const h of await heads.all()) await expect(h).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: /Reentry/ }).click();
  expect(await page.locator('.mech-group').nth(2).locator('.vbtn').count()).toBe(5);
  await page.getByRole('button', { name: 'AV nodal reentrant tachycardia (AVNRT)' }).click();
  await page.getByRole('button', { name: 'Typical atrial flutter' }).click();
  await expect(page.locator('.mech-group .vbtn[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.mech-info .struct-name')).toHaveText('Typical atrial flutter');
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.locator('.mech-points li').first()).toBeVisible();
  await expect(page.locator('.mech-details')).toContainText('Deck:');
});

for (const id of IDS) {
  test(`scenario ${id} plays with its substrate, ECG and events, and compares with normal`, async ({ page }) => {
    const sc = scenario(id);
    const errors = await openHeart(page, 1600, 900);
    await waitForSim(page);
    await page.evaluate((id) => (window as any).epOpen(id), id);
    await expect(page.locator('.playbar')).toBeVisible();
    await expect(page.locator('.pb-title')).toContainText(sc.title.slice(0, 12));
    await settle(page, 1200);
    let s = await state(page);
    expect(s.playing).toBe(true);
    for (const m of sc.show ?? []) expect(s.visible).toContain(m); // the substrate it needs is drawn
    expect(s.visible).toContain('cs_AVN'); // the conduction system is on
    // every authored event resolved to a time and has a numbered marker on the ECG strip
    const nEvents = await page.evaluate(async (id) => (await (window as any).epEngine.loader.get(id)).events.length, id);
    expect(nEvents).toBe(sc.events.length);
    await expect(page.locator('.pb-ecg-mark')).toHaveCount(nEvents);
    await expect(page.locator('.pb-ecg path.pb-ecg-trace')).toBeVisible();
    expect(s.time).toBeGreaterThan(0);
    expect(s.time).toBeLessThan(sc.period_ms + 1);
    // normal vs this rhythm
    await page.getByRole('button', { name: 'Normal', exact: true }).click();
    await settle(page, 400);
    s = await state(page);
    for (const m of sc.show ?? []) expect(s.visible).not.toContain(m);
    await expect(page.locator('.pb-ecg-mark')).toHaveCount(8); // the sinus beat has eight events
    await page.getByRole('button', { name: 'This rhythm' }).click();
    await settle(page, 400);
    await expect(page.locator('.pb-ecg-mark')).toHaveCount(nEvents);
    expect(errors.filter((e) => !/ReadPixels|GPU stall/.test(e))).toEqual([]);
  });
}

test('leaving mechanisms mode closes the player and clears the substrate', async ({ page }) => {
  await openHeart(page, 1600, 900);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('avnrt'));
  await expect(page.locator('.playbar')).toBeVisible();
  await page.locator('.rail-btn[aria-label="Explore"]').click();
  await expect(page.locator('.playbar')).toBeHidden();
  expect((await state(page)).visible.some((n: string) => n.startsWith('sub_'))).toBe(false);
  await expect(page.getByRole('button', { name: 'Play sinus beat' })).toBeVisible();
});

test('substrate structures can be selected and are labelled schematic', async ({ page }) => {
  await openHeart(page, 1600, 900);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('wpw_preexcitation'));
  await settle(page, 800);
  await page.evaluate(() => { const s = (window as any).epHeart; s.pause(); s.select('sub_ap_left_free_wall'); });
  await expect(page.locator('#sec-structure .struct-name')).toContainText('Accessory pathway');
  await expect(page.locator('#sec-structure .struct-tag')).toContainText('Schematic');
});
