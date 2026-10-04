// Produces the Phase 3 review package in review/phase3. Run: npx playwright test tests/review3.spec.ts
import { test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { openHeart, settle, waitForSim } from './helpers';

const OUT = 'review/phase3';
test.describe.configure({ mode: 'serial' });
const IDS = readdirSync('src/scenarios').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).filter((id) => id !== 'sinus_rhythm');

for (const id of IDS) {
  test(`scenario ${id}`, async ({ page }) => {
    await openHeart(page, 1400, 800);
    await waitForSim(page);
    await page.evaluate((id) => (window as any).epOpen(id), id);
    await settle(page, 2200);
    const events: [string, number][] = await page.evaluate(async (id) => {
      const { loader } = (window as any).epEngine;
      const d = await loader.get(id);
      return d.events.map((e: any) => [e.id, e.t]);
    }, id);
    // first, middle and last event of each scenario keep the package a reviewable size
    const keep = new Set([0, Math.floor(events.length / 2), events.length - 1]);
    for (const [i, [eid, t]] of events.entries()) {
      if (!keep.has(i)) continue;
      await page.evaluate((t) => { const s = (window as any).epHeart; s.pause(); s.setTime(t + 4); }, t);
      await settle(page, 450);
      await page.screenshot({ path: `${OUT}/${id}_${eid}.png` });
    }
    // normal vs this
    await page.getByRole('button', { name: 'Normal', exact: true }).click();
    await page.evaluate(() => { const s = (window as any).epHeart; s.pause(); s.setTime(180); });
    await settle(page, 600);
    await page.screenshot({ path: `${OUT}/${id}_normal_compare.png` });
  });
}
