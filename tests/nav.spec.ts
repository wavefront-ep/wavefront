import { expect, test } from '@playwright/test';
import { openHeart, settle } from './helpers';

test('cutaway is reachable from the rail and the drawer nav', async ({ page }) => {
  await openHeart(page, 1366, 768);
  await page.locator('.rail-btn[aria-label="Cutaway"]').click();
  await settle(page, 700);
  await expect(page.locator('.app.drawer-open')).toHaveCount(1);
  await expect(page.locator('#sec-cutaway')).toBeInViewport();
  await page.screenshot({ path: 'review/phase1/drawer_cutaway_first.png' });
  await page.locator('.drawer-nav button', { hasText: 'View' }).click();
  await settle(page, 700);
  await expect(page.locator('#sec-view')).toBeInViewport();
  await page.locator('.drawer-nav button', { hasText: 'Structure' }).click();
  await settle(page, 700);
  await expect(page.locator('#sec-structure')).toBeInViewport();
});
