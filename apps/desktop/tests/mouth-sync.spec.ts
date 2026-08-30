import { expect, test } from '@playwright/test';
import type { StageTestHook } from '../src/renderer/pet/main';
import { installFakeBridge } from './fake-bridge';

/**
 * D8: `TextMouthDriver` is a 4-7 Hz oscillator, so a single sample can land in a trough. Poll it.
 * The bubble's side of the chain (mouth transitions only, false on punctuation) is proven
 * deterministically in src/renderer/bubble/speech.test.ts; this proves the pet's side end to end.
 */
test('speech:mouth drives ParamMouthOpenY and releases after the turn', async ({ page }) => {
  await installFakeBridge(page, 'ds');
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/pet.html?test=1&character=haru');
  await page.waitForFunction(
    () => (window as unknown as { __stage?: StageTestHook }).__stage?.ready === true,
    null,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(1500); // shaders fetch + first idle frames

  const read = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __stage: StageTestHook }).__stage.mouth());

  await page.evaluate(() => window.__fake.emit('speech:mouth', { on: true }));
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push(await read());
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.__fake.emit('speech:mouth', { on: false }));
  await page.waitForTimeout(400);
  const released = await read();

  console.log(`MOUTH_SAMPLES ${JSON.stringify({ samples, max: Math.max(...samples), released })}`);

  expect(samples).toHaveLength(20);
  expect(Math.max(...samples)).toBeGreaterThan(0.3);
  expect(released).toBeLessThan(0.05);
});
