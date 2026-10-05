// Produces the Phase 2 review package in review/phase2. Run: npx playwright test tests/review2.spec.ts
import { test } from '@playwright/test';
import { openHeart, settle, waitForSim } from './helpers';

const OUT = 'review/phase2';
test.describe.configure({ mode: 'serial' });

const setup = async (page: any, w = 1600, h = 900) => {
  await openHeart(page, w, h);
  await waitForSim(page);
};
const at = async (page: any, t: number) => {
  await page.evaluate((t: number) => { const s = (window as any).epHeart; s.pause(); s.setTime(t); }, t);
  await settle(page, 350);
};

test('sinus beat on the opaque surface: atria, then ventricles (anterior and posterior)', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const s = (window as any).epHeart; s.layers.conduction = false; s.layers.epiOpacity = 1; s.applyLayers(); });
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  await page.evaluate(() => { const s = (window as any).epHeart; s.layers.conduction = false; s.layers.epiOpacity = 1; s.applyLayers(); });
  for (const t of [10, 30, 50, 70, 90, 165, 180, 195, 210, 225, 240, 255, 300]) {
    await at(page, t);
    await page.screenshot({ path: `${OUT}/wave_anterior_${String(t).padStart(3, '0')}ms.png` });
  }
  await page.evaluate(() => (window as any).epHeart.setView('posterior', false));
  for (const t of [20, 60, 95, 185, 215, 245]) {
    await at(page, t);
    await page.screenshot({ path: `${OUT}/wave_posterior_${String(t).padStart(3, '0')}ms.png` });
  }
});

test('sinus beat with the conduction system (events, anterior)', async ({ page }) => {
  await setup(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  const events: [string, number][] = await page.evaluate(() => (window as any).epEngine.events.map((e: any) => [e.id, e.t]));
  for (const [id, t] of events) {
    await at(page, t + 3);
    await page.screenshot({ path: `${OUT}/event_${id}.png` });
  }
});

test('conduction system anatomy with labels, six views', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await page.getByLabel('Conduction system').check();
  await page.getByLabel('Labels').check();
  await page.getByRole('button', { name: 'Layers and views' }).click();
  for (const v of ['anterior', 'right', 'left', 'posterior', 'superior', 'inferior']) {
    await page.evaluate((v) => (window as any).epHeart.setView(v, false), v);
    await settle(page, 900);
    await page.screenshot({ path: `${OUT}/conduction_${v}.png` });
  }
  await page.evaluate(() => { const s = (window as any).epHeart; s.setView('anterior', false); s.setCut('fourChamber', 0, true); });
  await settle(page, 1400);
  await page.screenshot({ path: `${OUT}/conduction_fourchamber_cut.png` });
  await page.evaluate(() => { const s = (window as any).epHeart; s.setCut('shortAxis', 0, true); });
  await settle(page, 1400);
  await page.screenshot({ path: `${OUT}/conduction_shortaxis_cut.png` });
});

test('guided tour', async ({ page }) => {
  await setup(page);
  await page.locator('.topbar').getByRole('button', { name: 'Guided tour' }).click();
  await page.mouse.move(800, 20);
  for (let i = 1; i <= 8; i++) {
    await settle(page, 1500);
    await page.screenshot({ path: `${OUT}/tour_${i}.png` });
    if (i < 8) await page.getByRole('button', { name: 'Next' }).click();
  }
});

test('layouts with the player', async ({ page }) => {
  for (const [name, w, h] of [['laptop_1366x768', 1366, 768], ['fullhd_1920x1080', 1920, 1080], ['ipad_portrait', 768, 1024], ['ipad_landscape', 1024, 768], ['phone', 390, 844]] as const) {
    await setup(page, w, h);
    await page.screenshot({ path: `${OUT}/layout_${name}_default.png` });
    await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
    await at(page, 190);
    await page.screenshot({ path: `${OUT}/layout_${name}_player.png` });
    await page.getByRole('button', { name: 'Layers and views' }).click();
    await settle(page, 500);
    await page.screenshot({ path: `${OUT}/layout_${name}_player_drawer.png` });
  }
});
