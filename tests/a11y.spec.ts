import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openHeart, waitForSim } from './helpers';

// Automated WCAG 2 A/AA checks on the states a student meets. (Colour contrast is checked too.)
const check = async (page: any, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = r.violations.map((v: any) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0].html.slice(0, 120)} | ${v.nodes[0].failureSummary?.split('\n')[1] ?? ''}`);
  expect(bad, label).toEqual([]);
};

test('start screen', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await check(page, 'start');
});
test('layers and views drawer', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.getByRole('button', { name: 'Layers and views' }).click();
  await check(page, 'drawer');
});
test('guided tour', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.locator('.topbar').getByRole('button', { name: 'Guided tour' }).click();
  await check(page, 'tour');
});
test('a rhythm with the player', async ({ page }) => {
  await openHeart(page, 1440, 900);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('atrial_fibrillation'));
  await page.getByRole('button', { name: 'Arrhythmias' }).click();
  await check(page, 'rhythm');
});
