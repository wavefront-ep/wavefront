import { Page } from '@playwright/test';

export async function openHeart(page: Page, w = 1366, h = 768) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).epHeart?.getState().visible.length > 0, null, { timeout: 60000 });
  await settle(page);
  return errors;
}

/** Wait for camera tweens and the label pass to finish. */
export async function settle(page: Page, ms = 1100) {
  await page.waitForTimeout(ms);
}

export const state = (page: Page) => page.evaluate(() => (window as any).epHeart.getState());

/** Wait until the activation engine has solved the sinus beat. */
export async function waitForSim(page: Page) {
  await page.waitForFunction(() => (window as any).epEngine?.events?.length > 0, null, { timeout: 90000 });
}
