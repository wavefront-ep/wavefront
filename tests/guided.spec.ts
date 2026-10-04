import { expect, test } from '@playwright/test';
import { openHeart, settle, state, waitForSim } from './helpers';

const events = (page: any, id: string): Promise<{ t: number }[]> =>
  page.evaluate(async (id: string) => (await (window as any).epEngine.loader.get(id)).events, id);

test('guided playback holds on each step so the caption can be read', async ({ page }) => {
  await openHeart(page, 1400, 800);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('sinus_rhythm', 'this', true));
  await settle(page, 1800);
  // started at the first event and is holding there: still "playing", time has not moved
  let s = await state(page);
  expect(s.playing).toBe(true);
  expect(s.time).toBe(0);
  await expect(page.locator('.pb-caption-label')).toContainText('Sinus node');
  // after the hold it moves on and stops at the next event (the left-atrial/Bachmann step)
  const ev = await events(page, 'sinus_rhythm');
  await page.waitForFunction((t) => (window as any).epHeart.getState().time >= t - 0.5, ev[1].t, { timeout: 15000 });
  s = await state(page);
  expect(s.time).toBeCloseTo(ev[1].t, 0);
  await expect(page.locator('.pb-caption-label')).toContainText('Atrial activation');
  await settle(page, 1500);
  expect((await state(page)).time).toBeCloseTo(ev[1].t, 0); // still holding
});

test('close-together steps each get their own hold', async ({ page }) => {
  await openHeart(page, 1400, 800);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('sinus_rhythm'));
  const ev = await events(page, 'sinus_rhythm');
  // His bundle (125 ms) and bundle branches (131 ms) are 6 ms apart
  const i = ev.findIndex((e: any) => e.id === 'his');
  await page.evaluate((t) => { const s = (window as any).epHeart; s.play(); s.pause(); s.setTime(t - 5); s.play(); }, ev[i].t);
  await page.waitForFunction((t) => (window as any).epHeart.getState().time >= t - 0.5, ev[i].t, { timeout: 8000 });
  await expect(page.locator('.pb-caption-label')).toContainText('His bundle');
  await settle(page, 1200);
  expect(Math.abs((await state(page)).time - ev[i].t)).toBeLessThan(1); // held on the His bundle step
  await page.waitForFunction((t) => (window as any).epHeart.getState().time >= t - 0.5, ev[i + 1].t, { timeout: 12000 });
  await expect(page.locator('.pb-caption-label')).toContainText('Bundle branches');
});

test('a long quiet stretch is crossed quickly, not at the slow base speed', async ({ page }) => {
  await openHeart(page, 1400, 800);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('sa_exit_block'));
  const ev = await events(page, 'sa_exit_block');
  const blocked = ev.find((e: any) => (e as any).id === 'blocked')!;
  const prev = [...ev].filter((e) => e.t < blocked.t).pop()!;
  // 800 ms of heart time at the 0.05x base speed would take 16 s; guided mode crosses it in about 2.5 s
  await page.evaluate((t) => { const s = (window as any).epHeart; s.play(); s.pause(); s.setTime(t + 1); s.play(); }, prev.t);
  const t0 = Date.now();
  await page.waitForFunction((t) => (window as any).epHeart.getState().time >= t - 0.5, blocked.t, { timeout: 8000 });
  expect(Date.now() - t0).toBeLessThan(5500);
});

test("the 'Pause at each step' switch turns the holds off", async ({ page }) => {
  await openHeart(page, 1400, 800);
  await waitForSim(page);
  await page.evaluate(() => (window as any).epOpen('sinus_rhythm', 'this', true));
  const sw = page.getByLabel('Pause at each step');
  await expect(sw).toBeChecked();
  await sw.uncheck();
  await expect(sw).not.toBeChecked();
  expect((await state(page)).time).toBe(0);
  await page.evaluate(() => ((window as any).epHeart.playback.speed = 1));
  await settle(page, 1000);
  expect((await state(page)).time).toBeGreaterThan(0); // moving continuously now
});
