import { expect, test } from '@playwright/test';
import { openHeart, settle, state } from './helpers';

test('loads with no errors and shows the quiet default screen', async ({ page }) => {
  const errors = await openHeart(page);
  expect((await state(page)).visible).toContain('epi_LV');
  await expect(page.locator('.hint')).toBeVisible();
  await expect(page.locator('.app.drawer-open')).toHaveCount(0);
  expect(errors.filter((e) => !/ReadPixels|GPU stall/.test(e))).toEqual([]);
});

test('layer toggles change what is drawn', async ({ page }) => {
  await openHeart(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await page.getByLabel('Great vessels').uncheck();
  let s = await state(page);
  expect(s.visible).not.toContain('aorta');
  expect(s.visible).not.toContain('vein_SVC');
  await page.getByLabel('Valves').uncheck();
  expect((await state(page)).visible.some((n: string) => n.startsWith('valve_'))).toBe(false);
  await page.getByLabel('Right atrium').uncheck();
  s = await state(page);
  expect(s.visible).not.toContain('epi_RA');
  expect(s.visible).not.toContain('endo_RA');
  await page.getByLabel('Epicardial surface').uncheck();
  expect((await state(page)).visible.some((n: string) => n.startsWith('epi_'))).toBe(false);
});

test('view presets and number keys move the camera', async ({ page }) => {
  await openHeart(page);
  const views: Record<string, [number, number]> = { '2': [2, -1], '3': [0, 1], '4': [0, -1], '5': [1, 1] };
  for (const [key, [axis, sign]] of Object.entries(views)) {
    await page.keyboard.press(key);
    await settle(page);
    const s = await state(page);
    const d = s.camera.map((c: number, i: number) => c - s.target[i]);
    expect(Math.abs(d[axis])).toBeGreaterThan(2.5);
    expect(Math.sign(d[axis])).toBe(sign);
  }
});

test('cutaway presets clip and the slider moves the plane', async ({ page }) => {
  await openHeart(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await page.getByRole('button', { name: 'Four-chamber cut' }).click();
  await settle(page);
  expect((await state(page)).cut.mode).toBe('fourChamber');
  await page.getByLabel('Cut plane position').fill('0.1');
  expect((await state(page)).cut.offset).toBeCloseTo(0.1, 3);
  await page.getByRole('button', { name: 'Short-axis cut' }).click();
  expect((await state(page)).cut.mode).toBe('shortAxis');
  await page.getByRole('button', { name: 'None' }).click();
  expect((await state(page)).cut.mode).toBe('off');
});

test('clicking a structure selects it and shows its note', async ({ page }) => {
  await openHeart(page);
  await page.mouse.click(700, 450);
  await settle(page, 300);
  const s = await state(page);
  expect(s.selected).toBeTruthy();
  await expect(page.locator('.struct-name')).not.toBeEmpty();
  await expect(page.locator('.app.drawer-open')).toHaveCount(1);
  await page.keyboard.press('Escape');
  expect((await state(page)).selected).toBeNull();
});

test('labels key toggles labels and H hides the interface', async ({ page }) => {
  await openHeart(page);
  await page.keyboard.press('l');
  await settle(page);
  expect(await page.locator('.overlay text').count()).toBeGreaterThan(3);
  await page.keyboard.press('l');
  await settle(page);
  expect(await page.locator('.overlay text').count()).toBe(0);
  await page.keyboard.press('h');
  await expect(page.locator('.app.chrome-hidden')).toHaveCount(1);
});

test('every preset lands on its own direction, including superior to inferior', async ({ page }) => {
  await openHeart(page);
  for (const [key, axis, sign] of [['5', 1, 1], ['6', 1, -1], ['5', 1, 1], ['1', 2, 1], ['2', 2, -1], ['3', 0, 1], ['4', 0, -1]] as const) {
    await page.keyboard.press(key);
    await settle(page, 1000);
    const s = await state(page);
    const d = s.camera.map((c: number, i: number) => c - s.target[i]);
    expect(Math.sign(d[axis])).toBe(sign);
    expect(Math.abs(d[axis])).toBeGreaterThan(3);
  }
});
