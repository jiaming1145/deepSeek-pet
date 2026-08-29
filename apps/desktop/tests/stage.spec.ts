import { expect, test } from '@playwright/test';

type Hook = { ready: boolean; setExpression(n: string | null): void; playMotion(g: string, i: number): boolean; hitTest(x: number, y: number): string | null; pixels(): { opaque: number; hash: number } };
const hook = (fn: (s: Hook) => unknown) => `(${fn.toString()})(window.__stage)`;

test('Haru renders, expressions change pixels, hit-test finds the body', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/pet.html?test=1&character=haru');
  await page.waitForFunction(() => (window as unknown as { __stage?: Hook }).__stage?.ready === true, null, { timeout: 45_000 });
  await page.waitForTimeout(1500); // shaders fetch + first idle frames

  const before = (await page.evaluate(hook((s) => s.pixels()))) as { opaque: number; hash: number };
  expect(before.opaque).toBeGreaterThan(500);

  await page.evaluate(hook((s) => s.setExpression('F01')));
  await page.waitForTimeout(1500); // expression fade is 1 s
  const after = (await page.evaluate(hook((s) => s.pixels()))) as { opaque: number; hash: number };
  expect(after.hash).not.toBe(before.hash);

  const hit = await page.evaluate(hook((s) => s.hitTest(200, 350)));
  expect(['Head', 'Body']).toContain(hit);
  const miss = await page.evaluate(hook((s) => s.hitTest(5, 5)));
  expect(miss).toBeNull();

  // ?test=1 also turns the debug panel on, and it sits over Haru's face — hide it so the committed
  // evidence shows the render, not the overlay. Assertions above already ran against the live page.
  await page.evaluate(() => document.getElementById('debug')?.classList.remove('show'));
  await page.screenshot({ path: '../../docs/evidence/phase1/browser-haru.png' });
});
