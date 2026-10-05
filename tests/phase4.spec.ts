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
