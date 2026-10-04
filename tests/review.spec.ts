// Produces the Phase 1 review package in review/phase1. Run with: npx playwright test tests/review.spec.ts
import { test } from '@playwright/test';
import { openHeart, settle } from './helpers';

const OUT = 'review/phase1';
const presets = ['anterior', 'posterior', 'left', 'right', 'superior', 'inferior', 'rao', 'lao'];

test.describe.configure({ mode: 'serial' });

test('view presets, plain and labelled (1920x1080)', async ({ page }) => {
  await openHeart(page, 1920, 1080);
  for (const id of presets) {
    await page.evaluate((v) => (window as any).epHeart.setView(v), id);
    await settle(page, 1300);
    await page.screenshot({ path: `${OUT}/view_${id}.png` });
  }
  await page.keyboard.press('l');
  for (const id of presets) {
    await page.evaluate((v) => (window as any).epHeart.setView(v, false), id);
    await settle(page, 700);
    await page.screenshot({ path: `${OUT}/view_${id}_labels.png` });
  }
});

test('layer states (1920x1080)', async ({ page }) => {
  await openHeart(page, 1920, 1080);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await settle(page, 500);
  await page.screenshot({ path: `${OUT}/state_drawer_open.png` });
  await page.getByLabel('Epicardial opacity').fill('0.3');
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/state_epi_transparent.png` });
  await page.getByLabel('Epicardial surface').uncheck();
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/state_epi_off.png` });
  await page.getByLabel('Epicardial surface').check();
  await page.getByLabel('Epicardial opacity').fill('1');
  await page.getByLabel('Great vessels').uncheck();
  await page.getByLabel('Right atrium').uncheck();
  await page.getByLabel('Right ventricle').uncheck();
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/state_vessels_off_right_heart_off.png` });
});

test('cutaways (1920x1080)', async ({ page }) => {
  await openHeart(page, 1920, 1080);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  for (const [name, file] of [['Four-chamber cut', 'fourchamber'], ['Short-axis cut', 'shortaxis']] as const) {
    await page.getByRole('button', { name }).click();
    await settle(page, 1400);
    await page.screenshot({ path: `${OUT}/cut_${file}.png` });
    await page.getByLabel('Cut plane position').fill('0.12');
    await settle(page, 400);
    await page.screenshot({ path: `${OUT}/cut_${file}_plus12mm.png` });
    await page.getByLabel('Cut plane position').fill('-0.12');
    await settle(page, 400);
    await page.screenshot({ path: `${OUT}/cut_${file}_minus12mm.png` });
  }
  await page.getByRole('button', { name: 'Four-chamber cut' }).click();
  await page.getByLabel('Cut plane position').fill('0');
  await page.keyboard.press('l');
  await settle(page, 1400);
  await page.screenshot({ path: `${OUT}/cut_fourchamber_labels.png` });
});

test('selection and structure note', async ({ page }) => {
  await openHeart(page, 1920, 1080);
  await page.mouse.click(1000, 600);
  await settle(page, 500);
  await page.screenshot({ path: `${OUT}/state_selected.png` });
});

test('present layout: chrome hidden', async ({ page }) => {
  await openHeart(page, 1920, 1080);
  await page.keyboard.press('h');
  await settle(page, 500);
  await page.screenshot({ path: `${OUT}/state_chrome_hidden.png` });
});

for (const [name, w, h] of [
  ['laptop_1366x768', 1366, 768],
  ['ipad_portrait', 768, 1024],
  ['ipad_landscape', 1024, 768],
  ['phone', 390, 844],
] as const) {
  test(`layout ${name}`, async ({ page }) => {
    await openHeart(page, w, h);
    await page.screenshot({ path: `${OUT}/layout_${name}.png` });
    await page.getByRole('button', { name: 'Layers and views' }).click();
    await settle(page, 600);
    await page.screenshot({ path: `${OUT}/layout_${name}_drawer.png` });
  });
}
