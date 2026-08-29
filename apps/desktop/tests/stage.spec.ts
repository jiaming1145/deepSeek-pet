import { expect, test, type Page } from '@playwright/test';
import type { StageTestHook } from '../src/renderer/pet/main';

/**
 * Runs `fn` against `window.__stage` inside the page.
 *
 * The hook type is imported from the renderer rather than re-declared here, so renaming a hook
 * method breaks this file at `tsc -p tsconfig.renderer.json` instead of silently evaluating to
 * `undefined` in the browser.
 */
const hook = (fn: (s: StageTestHook) => unknown) => `(${fn.toString()})(window.__stage)`;

type Zone = { x0: number; y0: number; x1: number; y1: number };

async function openStage(page: Page, query = 'test=1&character=haru'): Promise<void> {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`/pet.html?${query}`);
  await page.waitForFunction(() => (window as unknown as { __stage?: StageTestHook }).__stage?.ready === true, null, { timeout: 45_000 });
  await page.waitForTimeout(1500); // shaders fetch + first idle frames
}

/** Every hit-tested point of one area (4 px grid), in client px. */
async function sweep(page: Page, area: string): Promise<{ xs: number[]; ys: number[] }> {
  return page.evaluate((name: string) => {
    const s = (window as unknown as { __stage: StageTestHook }).__stage;
    const xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < window.innerHeight; y += 4) {
      for (let x = 0; x < window.innerWidth; x += 4) {
        if (s.hitTest(x, y) === name) { xs.push(x); ys.push(y); }
      }
    }
    return { xs, ys };
  }, area);
}

/**
 * The mouth zone: the lower 45% of the drawn head, located through the hit test rather than
 * hard-coded, so the check follows the model if scale/offsetY change.
 */
async function mouthZone(page: Page): Promise<Zone> {
  const { xs, ys } = await sweep(page, 'Head');
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.round(y0 + (y1 - y0) * 0.55), y1 };
}

/** A point solidly inside a hit area: the median of the swept points, re-verified through hitTest. */
async function pointIn(page: Page, area: string): Promise<{ x: number; y: number }> {
  const { xs, ys } = await sweep(page, area);
  expect(xs.length, `${area} must be somewhere on screen`).toBeGreaterThan(10);
  const mid = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const centre = { x: mid(xs), y: mid(ys) };
  // The medians are taken per axis, so the pair is not guaranteed to be a swept point itself.
  const at = await page.evaluate(
    (p: { x: number; y: number }) => (window as unknown as { __stage: StageTestHook }).__stage.hitTest(p.x, p.y),
    centre,
  );
  if (at === area) return centre;
  const i = Math.floor(xs.length / 2);
  return { x: xs[i], y: ys[i] };
}

/**
 * Dark red pixels (the mouth interior) inside the mouth zone — median of 5 samples spread over
 * 2.4 s so a blink or a head turn cannot decide the result. Unlike a frame-to-frame delta this is
 * pose-invariant, which matters because Haru's Idle is a 10 s looping 63-curve full-body animation:
 * measured over a full loop, idle churn moves ~30000 of the 40000 sampled pixels while an
 * expression moves far fewer, so any before/after hash or delta says nothing about expressions.
 * This statistic does: closed mouth ~110 px, F02's open mouth ~205 px (12-sample spreads 52-127 vs
 * 170-229 over two full loops).
 */
async function mouthPixels(page: Page, zone: Zone): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    samples.push(
      await page.evaluate((z: Zone) => {
        const c = document.getElementById('stage') as HTMLCanvasElement;
        const c2 = document.createElement('canvas'); c2.width = c.width; c2.height = c.height;
        const ctx = c2.getContext('2d')!; ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
        const scale = c.width / window.innerWidth; // client px -> device px
        let n = 0;
        for (let y = Math.round(z.y0 * scale); y < Math.round(z.y1 * scale); y++) {
          for (let x = Math.round(z.x0 * scale); x < Math.round(z.x1 * scale); x++) {
            const i2 = (y * c.width + x) * 4;
            if (d[i2 + 3] < 200) continue;
            const R = d[i2], G = d[i2 + 1], B = d[i2 + 2];
            if (R - G > 30 && R - B > 30 && 0.299 * R + 0.587 * G + 0.114 * B < 140) n++;
          }
        }
        return n;
      }, zone),
    );
    await page.waitForTimeout(400);
  }
  return samples.sort((a, b) => a - b)[2];
}

test('Haru renders, expressions change pixels, hit-test finds the body', async ({ page }, testInfo) => {
  await openStage(page);

  const before = (await page.evaluate(hook((s) => s.pixels()))) as { opaque: number; hash: number };
  expect(before.opaque).toBeGreaterThan(500);

  const zone = await mouthZone(page);
  const closed = await mouthPixels(page, zone);
  await page.evaluate(hook((s) => s.setExpression('F02'))); // F02 opens the mouth wide
  await page.waitForTimeout(1500); // expression fade is 1 s
  const open = await mouthPixels(page, zone);
  expect(open).toBeGreaterThan(closed * 1.4); // measured ratio ~1.85, worst observed pairing 1.34

  const hit = await page.evaluate(hook((s) => s.hitTest(200, 350)));
  expect(['Head', 'Body']).toContain(hit);
  const miss = await page.evaluate(hook((s) => s.hitTest(5, 5)));
  expect(miss).toBeNull();

  // Back to the resting face, and hide the debug panel that ?test=1 turns on (it sits over Haru's
  // face), so the artifact shows the render rather than the overlay or a test expression.
  await page.evaluate(hook((s) => s.setExpression(null)));
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('debug')?.classList.remove('show'));
  // testInfo.outputPath, never the tracked docs/evidence PNG: a test run must leave the tree clean.
  await page.screenshot({ path: testInfo.outputPath('browser-haru.png') });
});

test('a press on her head taps; a drag past the slop does not (spec §9 "tap emits hit-area")', async ({ page }) => {
  await openStage(page);
  // ?test=1 turns the debug HUD on and it overlaps her: a press landing on a panel button is
  // rejected by design, so hide it first and drive the real pointer path against the canvas.
  await page.evaluate(() => document.getElementById('debug')?.classList.remove('show'));

  const head = await pointIn(page, 'Head');
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(() => page.evaluate(hook((s) => s.taps.length))).toBe(1);
  const taps = (await page.evaluate(hook((s) => s.taps))) as StageTestHook['taps'];
  expect(taps[0].hit).toBe('Head');
  // Haru maps Head -> { TapBody: [0, 1] }; the seeded rng must have chosen one of the two.
  expect(taps[0].motion?.[0]).toBe('TapBody');
  expect([0, 1]).toContain(taps[0].motion?.[1]);

  // Negative: the same press, released 24 px away, is a window drag and must not tap.
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(head.x + 12, head.y + 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(hook((s) => s.taps.length))).toBe(1);

  // ...and the drag was suppressed by the slop, not by a dead pointer path or a moved model: the
  // very next stationary press at the same place taps again.
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(hook((s) => s.taps.length))).toBe(2);
});

test('two ?test=1 loads pick the same first idle motion (spec §9 "with a fixed seed")', async ({ page }) => {
  const firstIdle = async (): Promise<[string, number]> => {
    await openStage(page);
    await expect.poll(() => page.evaluate(hook((s) => s.lastMotion))).not.toBeNull();
    return (await page.evaluate(hook((s) => s.lastMotion))) as [string, number];
  };
  const a = await firstIdle();
  const b = await firstIdle();
  // Pinned, not merely equal: Haru declares 2 Idle motions and mulberry32(1)'s first draw is
  // 0.62707…, so the seeded pick is floor(0.62707 * 2) = 1. An unseeded Math.random would agree
  // with this only half the time, and reaching for the wrong element of the stream would not
  // land on 1 by accident.
  expect(a).toEqual(['Idle', 1]);
  expect(b).toEqual(a);
});

test('a load failure paints the error <pre> over the canvas (F5)', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/pet.html?test=1&character=no-such-character');
  const pre = page.locator('pre');
  await expect(pre).toHaveText(/character\.json 40\d/);
  // The canvas fills the window; the on-page half of "console + on-page message" only works if the
  // <pre> is actually the topmost element where the user looks.
  expect(await page.evaluate(() => document.elementFromPoint(10, 10)?.tagName)).toBe('PRE');
});
