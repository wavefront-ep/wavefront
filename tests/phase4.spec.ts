import { expect, test } from '@playwright/test';
import { openHeart, settle, state, waitForSim } from './helpers';

test('present mode hides the chrome, enlarges the text, and Esc leaves it', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Sinus beat' }).click();
  await page.keyboard.press('p');
  await expect(page.locator('.app.present')).toHaveCount(1);
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.drawer')).toBeHidden();
  await expect(page.locator('.playbar')).toBeVisible();
  const size = await page.locator('.pb-caption').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(22);
  expect(page.url()).toContain('present=1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.app.present')).toHaveCount(0);
  await expect(page.locator('.topbar')).toBeVisible();
});

test('the address describes the state and opens it again', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('avnrt'));
  await expect(page.locator('.playbar')).toBeVisible();
  expect(page.url()).toContain('#rhythm=avnrt');
  await page.goto('/#rhythm=wpw_preexcitation');
  await page.reload();
  await waitForSim(page);
  await expect(page.locator('.pb-title')).toContainText(/pre-excitation/i);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Arrhythmias' })).toHaveAttribute('aria-pressed', 'true');
  // a paused start, as when picked from the list
  expect((await state(page)).playing).toBe(false);
  await page.goto('/#tour=4');
  await page.reload();
  await waitForSim(page);
  await expect(page.locator('.pb-tour-count')).toHaveText('4 of 9');
  await settle(page, 300);
  await page.goto('/#present=1&rhythm=sinus_rhythm');
  await page.reload();
  await waitForSim(page);
  await expect(page.locator('.app.present')).toHaveCount(1);
});

test('the instructor guide page is served and has no deck references', async ({ page }) => {
  const g = await page.request.get('/guide.html');
  expect(g.ok()).toBe(true);
  expect(await g.text()).not.toMatch(/\bdeck\b|slides? \d/i);
});

test('in present mode the rhythm list opens from "Choose a rhythm" and closes after a pick', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.goto('/#present=1&rhythms');
  await page.reload();
  await waitForSim(page);
  await page.getByRole('button', { name: 'Choose a rhythm' }).click();
  await expect(page.locator('#sec-mech')).toBeVisible();
  await page.evaluate(() => (window as any).epOpen('mobitz_i'));
  await expect(page.locator('.playbar')).toBeVisible();
  await expect(page.locator('.drawer')).toBeHidden();
});

test('"End tour" on the last step goes to the sinus beat', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.goto('/#tour=9');
  await page.reload();
  await waitForSim(page);
  await page.getByRole('button', { name: 'End tour' }).click();
  await expect(page.locator('.pb-ecgrow')).toBeVisible();
  await expect(page.locator('.pb-title')).toContainText(/sinus rhythm/i);
});

test('the Wavefront name returns to the heart on its own with the Layers and views panel open', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('avnrt'));
  await expect(page.locator('.playbar')).toBeVisible();
  await page.getByRole('button', { name: 'Wavefront: back to the heart' }).click();
  await expect(page.locator('.playbar')).toBeHidden();
  await expect(page.locator('.app.drawer-open')).toHaveCount(1);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Arrhythmias' })).toHaveAttribute('aria-pressed', 'false');
  expect(page.url()).not.toContain('#');
  const s = await page.evaluate(() => (window as any).epHeart.getState());
  expect(s.layers.conduction).toBe(false);
  expect(s.cut.mode).toBe('off');
  await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  // and from the tour
  await page.locator('.topbar').getByRole('button', { name: 'Guided tour' }).click();
  await expect(page.locator('.pb-tour-count')).toBeVisible();
  await page.getByRole('button', { name: 'Wavefront: back to the heart' }).click();
  await expect(page.locator('.playbar')).toBeHidden();
});
