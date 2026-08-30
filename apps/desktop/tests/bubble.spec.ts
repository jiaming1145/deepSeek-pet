import { expect, test, type Page } from '@playwright/test';
import { installFakeBridge } from './fake-bridge';

/** Relative to the Playwright cwd, which is apps/desktop. */
const EVIDENCE = '../../docs/evidence/phase2';
const LINE = { turnId: 'p1', seq: 0, text: '你回来啦，我等你好久了。', emotion: 'happy' };
/** RevealPlan.totalMs() for this exact string is 1990 (contracts.md §5.1). */
const LONG = { turnId: 'p2', seq: 0, text: '一二三四五六七八九十一二三四五六七八九十，。', emotion: 'neutral' };

async function open(page: Page): Promise<void> {
  await installFakeBridge(page, 'dsBubble');
  await page.goto('/bubble.html?test=1&character=haru');
  await page.waitForFunction(() => window.__bubble?.ready === true);
}

/** Show the band, pin it with the pointer, then speak — so no linger can hide it mid-screenshot. */
async function showPinned(page: Page, line: typeof LINE): Promise<void> {
  await page.evaluate((t) => window.__fake.emit('brain:state', { state: 'thinking', turnId: t }), line.turnId);
  await page.hover('#bubble');
  await page.evaluate((l) => window.__bubble.speak([l]), line);
}

async function surfaceAlpha(page: Page): Promise<number> {
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.bubble__surface');
    return el ? getComputedStyle(el).backgroundColor : '';
  });
  const m = /^rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\s*\)$/.exec(bg);
  return m ? Number(m[1]) : 1;
}

test.describe('bubble window renderer', () => {
  test.use({ viewport: { width: 720, height: 520 } });

  test('paints the first grapheme inside the reveal budget and finishes the sentence', async ({ page }) => {
    await open(page);
    const firstPaintMs = await page.evaluate(async (line) => {
      const t0 = performance.now();
      void window.__bubble.speak([line]);
      await new Promise<void>((res) => {
        const tick = (): void => {
          if (window.__bubble.text().length > 0) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return performance.now() - t0;
    }, LINE);
    // The first step's own delay is hanziMs (70); one rAF of slop is ~16 ms; R4's bar is 100 ms.
    expect(firstPaintMs).toBeGreaterThanOrEqual(60);
    expect(firstPaintMs).toBeLessThanOrEqual(150);
    await expect.poll(() => page.evaluate(() => window.__bubble.text())).toBe(LINE.text);
  });

  test('shows the thinking band with no text, then hides 3 s after the turn', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__fake.emit('brain:state', { state: 'thinking', turnId: 'p3' }));
    expect(await page.evaluate(() => window.__bubble.text())).toBe('');
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(true);
    // Let the --dur-overlay enter transition land, or the capture shows a half-faded band.
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/bubble-thinking.png` });
    await page.evaluate((line) => window.__bubble.speak([line]), { ...LINE, turnId: 'p3' });
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(true);
    await page.waitForTimeout(3400);
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(false);
  });

  test('the band surface keeps >= 0.92 alpha in light and dark (C1/C-4/C12)', async ({ page }) => {
    await open(page);
    await showPinned(page, { ...LINE, turnId: 'p5' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await surfaceAlpha(page)).toBeGreaterThanOrEqual(0.92);
    await page.screenshot({ path: `${EVIDENCE}/sheet-band-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await surfaceAlpha(page)).toBeGreaterThanOrEqual(0.92);
    await page.screenshot({ path: `${EVIDENCE}/sheet-band-dark.png` });
  });

  test('clicking the band completes the reveal and opens the chat (C-12)', async ({ page }) => {
    await open(page);
    await page.evaluate((line) => {
      void window.__bubble.speak([line]);
    }, LONG);
    await page.waitForTimeout(200);
    await page.click('#bubble');
    expect(await page.evaluate(() => window.__bubble.text())).toBe(LONG.text);
    const sent = await page.evaluate(() => window.__fake.sent());
    const opened = sent.filter((s) => s.channel === 'chat:open');
    expect(opened).toHaveLength(1);
    expect(opened[0].payload).toEqual({ source: 'bubble', focusComposer: true });
  });

  test('hover defers the auto-hide and never pauses the reveal', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__fake.emit('brain:state', { state: 'thinking', turnId: 'p4' }));
    await page.hover('#bubble');
    const elapsed = await page.evaluate(async (line) => {
      const t0 = performance.now();
      await window.__bubble.speak([line]);
      return performance.now() - t0;
    }, { ...LONG, turnId: 'p4' });
    expect(elapsed).toBeGreaterThanOrEqual(1990);
    expect(elapsed).toBeLessThanOrEqual(4000);
    const sent = await page.evaluate(() => window.__fake.sent());
    expect(sent.filter((s) => s.channel === 'bubble:hover').map((s) => s.payload)).toContainEqual({ inside: true });
    await page.waitForTimeout(3400);
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(true);
    // Bottom-right of the 720x520 viewport: provably outside the band, which `body.browser` insets
    // to (24, 24) and which is at most 460 wide (contract addition 10).
    await page.mouse.move(700, 500);
    await page.waitForTimeout(3400);
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(false);
  });

  test('an error hides the band and the hint carries the app voice (C10/C-10)', async ({ page }) => {
    await open(page);
    await showPinned(page, { ...LINE, turnId: 'p6' });
    await page.evaluate(() => {
      window.__fake.emit('brain:error', { turnId: 'p6', code: 'auth', message: 'API Key 无效，重新填一下' });
      window.__bubble.hint({ text: 'API Key 无效，重新填一下', level: 'error', ttlMs: 6000 });
    });
    expect(await page.evaluate(() => window.__bubble.visible())).toBe(false);
    // `visible` flips synchronously, but Bubble.hide() only sets [hidden] after BUBBLE_EXIT_MS, so
    // without this the capture catches the band mid --dur-exit and the evidence contradicts C10.
    await expect(page.locator('#bubble')).toBeHidden();
    await expect(page.locator('#hint')).toHaveText('API Key 无效，重新填一下');
    await page.screenshot({ path: `${EVIDENCE}/hint-error.png` });
  });
});

test.describe('300 % glyph peep (C1)', () => {
  test.use({ viewport: { width: 720, height: 520 }, deviceScaleFactor: 3 });

  test('glyph edges at 300 %', async ({ page }) => {
    await open(page);
    await showPinned(page, { ...LINE, turnId: 'p7' });
    const box = await page.locator('.bubble__text').boundingBox();
    expect(box).not.toBeNull();
    await page.screenshot({
      path: `${EVIDENCE}/bubble-glyphs-300.png`,
      clip: { x: box!.x, y: box!.y, width: Math.min(180, box!.width), height: Math.min(40, box!.height) },
    });
  });
});

for (const dsf of [1, 1.25, 1.5, 2] as const) {
  test.describe(`corner peep @${dsf}x (C3)`, () => {
    test.use({ viewport: { width: 720, height: 520 }, deviceScaleFactor: dsf });

    test('the corner is CSS-only and unclipped', async ({ page }) => {
      await open(page);
      await showPinned(page, { ...LINE, turnId: `p8-${dsf}` });
      const radius = await page.evaluate(() => {
        const el = document.querySelector('.bubble__surface');
        return el ? getComputedStyle(el).borderRadius : '';
      });
      expect(radius).toBe('14px'); // --r-bubble, fixed by C5
      const box = await page.locator('.bubble__surface').boundingBox();
      expect(box).not.toBeNull();
      await page.screenshot({
        path: `${EVIDENCE}/bubble-corner-${dsf}x.png`,
        clip: { x: box!.x - 2, y: box!.y - 2, width: 28, height: 28 },
      });
    });
  });
}
