import { expect, test } from '@playwright/test';

const SHEET_SIZE = { width: 1180, height: 1600 };

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`token sheet (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test(`renders every token and matches the ${scheme} palette`, async ({ page }) => {
      await page.setViewportSize(SHEET_SIZE);
      await page.goto('/tokens-sheet.html');
      await page.waitForFunction(() => document.documentElement.dataset.sheetReady === 'true');

      // The sheet lists 26 colour roles; a missing token would render a blank chip.
      await expect(page.locator('#colours .sw')).toHaveCount(26);
      await expect(page.locator('#emotions .plate')).toHaveCount(9);
      await expect(page.locator('#ramp > div')).toHaveCount(5);
      await expect(page.locator('#shapes .spec')).toHaveCount(14);

      // State as material is BOTH halves: every emotion tile carries a line whose weight the
      // rule moved, not just a tinted plate.
      await expect(page.locator('#emotions .eline')).toHaveCount(9);
      const weights = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#emotions .eline'), (el) => getComputedStyle(el).fontWeight),
      );
      expect(new Set(weights)).toEqual(new Set(['400', '500']));

      // The theme actually switched: --c-bg differs between the two runs.
      const bg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim(),
      );
      expect(bg).toBe(scheme === 'dark' ? '#0E1220' : '#EDEAE3');

      // The signature device survived: the band's fill is cut at the plate's angle. The cut
      // lives on .band__surface, not on .band, because a clip-path on .band clips away both
      // --shadow-bubble and the plate that hangs above it (contracts.md §5.5).
      const clip = await page.evaluate(
        () => getComputedStyle(document.querySelector('.band__surface')!).clipPath,
      );
      expect(clip).toContain('14px');

      // ...and the two things the cut used to destroy are still painted: the band keeps its
      // elevation, and the name plate hangs clear above the band's top edge.
      const shadow = await page.evaluate(
        () => getComputedStyle(document.querySelector('.band')!).boxShadow,
      );
      expect(shadow).not.toBe('none');
      const bandTop = (await page.locator('.band').boundingBox())!.y;
      const plate = (await page.locator('.band .plate').boundingBox())!;
      expect(plate.height).toBeGreaterThan(16);
      expect(plate.y).toBeLessThan(bandTop);

      // All three governed surfaces are photographed at shipping geometry, not just the band:
      // the composer at CHAT_WIDTH x CHAT_BASE_H and the key window at KEY_SIZE (§6.1).
      const composer = (await page.locator('.composer').boundingBox())!;
      expect(Math.round(composer.width)).toBe(360);
      expect(Math.round(composer.height)).toBe(48);
      const key = (await page.locator('.key').boundingBox())!;
      expect(Math.round(key.width)).toBe(440);
      expect(Math.round(key.height)).toBe(360);

      await page.screenshot({
        path: `../../docs/evidence/phase2/tokens-sheet-${scheme}.png`,
        fullPage: true,
      });
    });
  });
}
