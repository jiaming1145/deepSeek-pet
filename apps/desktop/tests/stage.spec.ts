import { expect, test, type Page } from '@playwright/test';

type Hook = { ready: boolean; setExpression(n: string | null): void; playMotion(g: string, i: number): boolean; hitTest(x: number, y: number): string | null; pixels(): { opaque: number; hash: number } };
const hook = (fn: (s: Hook) => unknown) => `(${fn.toString()})(window.__stage)`;

type Zone = { x0: number; y0: number; x1: number; y1: number };

/**
 * The mouth zone: the lower 45% of the drawn head, located through the hit test rather than
 * hard-coded, so the check follows the model if scale/offsetY change.
 */
async function mouthZone(page: Page): Promise<Zone> {
  return page.evaluate(() => {
    const s = (window as unknown as { __stage: { hitTest(x: number, y: number): string | null } }).__stage;
    const xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < window.innerHeight; y += 4) {
      for (let x = 0; x < window.innerWidth; x += 4) {
        if (s.hitTest(x, y) === 'Head') { xs.push(x); ys.push(y); }
      }
    }
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.round(y0 + (y1 - y0) * 0.55), y1 };
  });
}

/**
 * Dark red pixels (the mouth interior) inside the mouth zone — median of 3 samples so a blink or a
 * head turn cannot decide the result. Unlike a frame-to-frame delta this is pose-invariant, which
 * matters because Haru's Idle is a 10 s looping 63-curve full-body animation: measured over a full
 * loop, idle churn moves ~30000 of the 40000 sampled pixels while an expression moves far fewer, so
 * any before/after hash or delta says nothing about expressions. This statistic does: closed mouth
 * ~110 px, F02's open mouth ~205 px (12-sample spreads 52-127 vs 170-229 over two full loops).
 */
async function mouthPixels(page: Page, zone: Zone): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
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
  return samples.sort((a, b) => a - b)[1];
}

test('Haru renders, expressions change pixels, hit-test finds the body', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/pet.html?test=1&character=haru');
  await page.waitForFunction(() => (window as unknown as { __stage?: Hook }).__stage?.ready === true, null, { timeout: 45_000 });
  await page.waitForTimeout(1500); // shaders fetch + first idle frames

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
  // face), so the committed evidence shows the render rather than the overlay or a test expression.
  await page.evaluate(hook((s) => s.setExpression(null)));
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('debug')?.classList.remove('show'));
  await page.screenshot({ path: '../../docs/evidence/phase1/browser-haru.png' });
});
