import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { waitForSim } from './helpers';

// The single-file build must run from file:// with no server (scripts/build-offline.mjs).
test('offline single file loads the heart, solves a beat and plays a rhythm', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('file://' + resolve('dist-offline/wavefront.html'));
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('avnrt'));
  await expect(page.locator('.playbar')).toBeVisible();
  await expect(page.locator('.pb-ecg svg')).toHaveCount(1);
  expect(errors).toEqual([]);
});
