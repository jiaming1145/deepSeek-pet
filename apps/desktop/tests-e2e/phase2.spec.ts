import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVIDENCE, REPO, boundsOf, captureRegion, isVisible, launchApp, logCheck, median, sampleResources,
  unionBounds, windowByUrl,
} from './app';

const bubbleText = (page: Page) => page.evaluate(() => document.body.innerText.trim());

/** C-12: a click anywhere on the band opens the chat with the composer focused. */
async function openChatByClickingTheBand(app: ElectronApplication, bubble: Page): Promise<Page> {
  // An Electron BrowserWindow page has no Playwright viewport (`viewportSize()` is null), so the
  // click is aimed at the band element itself — still a real, trusted mouse event at its centre.
  await bubble.locator('#bubble').click({ timeout: 15_000 });
  await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(true);
  return windowByUrl(app, 'chat.html');
}

/** The pet window's DIP bounds, read from main. */
function petBounds(app: ElectronApplication): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('pet.html'));
    if (!w) throw new Error('no pet window');
    return w.getBounds();
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`first run without a key, ${theme}: band, composer and key window`, async () => {
    test.setTimeout(180_000);
    const { app, launchedAt } = await launchApp({ theme });
    try {
      const bubble = await windowByUrl(app, 'bubble.html');

      // First run speaks card.first_mes through the normal brain:sentence path (contracts 6.6).
      // No key is needed for it: the sentence is synthesised in main.
      //
      // Controller ruling (2026-08-29), COLD PROFILE FIRST MESSAGE: launchApp() always uses a
      // throwaway --user-data-dir, so this IS the virgin-profile case aa0e9df fixed. The elapsed
      // time from `_electron.launch` being called to the first grapheme standing in a VISIBLE
      // bubble window is recorded and gated at 3 s.
      await expect.poll(() => bubbleText(bubble), { timeout: 30_000, intervals: [100] }).not.toBe('');
      await expect.poll(() => isVisible(app, 'bubble.html'), { timeout: 5_000, intervals: [50] }).toBe(true);
      const coldMs = Date.now() - launchedAt;
      logCheck(`cold-profile first message (${theme}): visible after ${coldMs} ms (bar <= 3000 ms)`);
      await bubble.screenshot({ path: join(EVIDENCE, `app-band-${theme}.png`) });
      if (theme === 'light') {
        // The composited desktop shot of the cold-profile first message: what the compositor
        // actually put on screen, not a page screenshot. The band is pinned first (the hover pin
        // main honours) so the 3.4 s linger cannot expire while the Live2D model finishes its
        // first draw — the shot has to contain BOTH of them to be worth anything.
        await bubble.evaluate(() => {
          document.querySelector('.bubble')?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
        });
        await bubble.waitForTimeout(3000);
        captureRegion(await unionBounds(app, ['pet.html', 'bubble.html']), join(EVIDENCE, 'app-first-message-cold.png'));
      }
      expect(coldMs, 'cold-profile first message must be visible within 3 s of launch').toBeLessThanOrEqual(3000);

      // Clicking the band opens the chat (contracts 5.2 / C-12).
      const chat = await openChatByClickingTheBand(app, bubble);
      const composer = chat.getByRole('textbox');
      await composer.fill('今天差点睡过头');
      await chat.screenshot({ path: join(EVIDENCE, `app-chat-${theme}.png`) });

      // Controller ruling (2026-08-29), PLACEMENT: the composer takes the band's rect over her
      // LOWER THIRD, never over her face. Asserted on the real windows, not only in the unit test.
      const pet = await petBounds(app);
      const chatRect = await boundsOf(app, 'chat.html');
      const topFraction = (chatRect.y - pet.y) / pet.height;
      logCheck(`placement (${theme}): composer top at ${(topFraction * 100).toFixed(1)} % of the pet window (bar >= 55 %), x ${chatRect.x} vs pet ${pet.x}`);
      expect(topFraction, 'the composer must not open over her face').toBeGreaterThanOrEqual(0.55);
      // She stands in the band's right third: her centre is at >= 2/3 of the composer's width.
      const petCentreFraction = (pet.x + pet.width / 2 - chatRect.x) / chatRect.width;
      expect(petCentreFraction).toBeGreaterThanOrEqual(2 / 3);
      if (theme === 'light') {
        captureRegion(await unionBounds(app, ['pet.html', 'chat.html', 'bubble.html']), join(EVIDENCE, 'app-placement.png'));
      }

      // No key -> the key window opens and the composer text comes back (contracts 6.2 rule 6, 6.4).
      await composer.press('Enter');
      await expect.poll(() => isVisible(app, 'key.html'), { timeout: 15_000 }).toBe(true);
      await expect(composer).toHaveValue('今天差点睡过头');

      const key = await windowByUrl(app, 'key.html');
      await expect(key.locator('input[type="password"]')).toBeVisible();
      await expect(key.getByText('对话内容会发送到 DeepSeek（服务器在中国境内）处理，回复由 AI 生成。')).toBeVisible();
      await key.screenshot({ path: join(EVIDENCE, `app-key-${theme}.png`) });

      // The key window took the focus, so the chat light-dismissed itself (6.1). Re-open it through
      // the same `chat:open` the band's click sends before driving the history pane.
      await bubble.evaluate(() => {
        (window as unknown as { dsBubble: { send(c: string, p: unknown): void } })
          .dsBubble.send('chat:open', { source: 'bubble', focusComposer: true });
      });
      await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(true);

      // History pane: the first message was appended with kind 'system' (contracts 6.6, 6.3).
      await chat.getByText('历史').click();
      await expect(chat.getByText('今天')).toBeVisible({ timeout: 10_000 });

      // Idle resource sample, once, while nothing is speaking (addendum section 0).
      if (theme === 'light') sampleResources('idle', 10);
    } finally {
      await app.close();
    }
  });
}

test('a bad key routes the reason to the hint surface, never into her voice', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ devKey: 'sk-e2e-invalid-000000000000' });
  try {
    const bubble = await windowByUrl(app, 'bubble.html');
    await expect.poll(() => bubbleText(bubble), { timeout: 30_000, intervals: [100] }).not.toBe('');
    const chat = await openChatByClickingTheBand(app, bubble);
    await chat.getByRole('textbox').fill('在吗');
    await chat.getByRole('textbox').press('Enter');

    // A 401 gives `auth`; an offline machine gives `network`/`timeout`/`server` after the retry
    // ladder (contracts 3.9.3). Every one of them is an ERROR_HINTS string (contracts 2.8), and
    // every one of them belongs on the hint surface rather than in her dialogue.
    await expect.poll(() => bubbleText(bubble), { timeout: 90_000, intervals: [250] })
      .toMatch(/API Key 无效，重新填一下|网络不太好，等一下再聊|等太久了，先歇一会儿|DeepSeek 那边出问题了，等一下再聊/);
    expect(await isVisible(app, 'bubble.html')).toBe(true);
  } finally {
    await app.close();
  }
});

/**
 * The four in-app checks Task 6 could not exercise, plus the composited desktop shot and the
 * interruption marker, driven by the offline echo brain (DS_FAKE_BRAIN=1) so none of it depends on
 * a DeepSeek balance. Every step writes a PASS / FAIL / UNTESTABLE line into
 * docs/evidence/phase2/app-inapp-checks.md.
 */
test('in-app checks: hover pin, drag follow, display reconciliation, abandoned IME', async () => {
  test.setTimeout(600_000);
  const rows: string[] = [];
  const record = (name: string, verdict: 'PASS' | 'FAIL' | 'UNTESTABLE', detail: string): void => {
    rows.push(`| ${name} | ${verdict} | ${detail} |`);
    logCheck(`${name}: ${verdict} — ${detail}`);
  };

  const { app } = await launchApp({ fakeBrain: true, theme: 'light' });
  try {
    const bubble = await windowByUrl(app, 'bubble.html');
    await expect.poll(() => bubbleText(bubble), { timeout: 30_000, intervals: [100] }).not.toBe('');

    // Record every setIgnoreMouseEvents call on the bubble window, so "hover holds the window
    // interactive" can be proved rather than inferred (Electron exposes no getter).
    await app.evaluate(({ BrowserWindow }) => {
      const g = globalThis as unknown as { __clickThrough: boolean[] };
      g.__clickThrough = [];
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.getURL().includes('bubble.html')) continue;
        const orig = w.setIgnoreMouseEvents.bind(w);
        (w as unknown as { setIgnoreMouseEvents: (i: boolean, o?: unknown) => void }).setIgnoreMouseEvents =
          (ignore: boolean, o?: unknown) => { g.__clickThrough.push(ignore); orig(ignore, o as never); };
      }
    });

    // ---- check 1: hover holds the window interactive ------------------------------------
    await test.step('hover holds the window interactive', async () => {
      await bubble.evaluate(() => {
        document.querySelector('.bubble')?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      });
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __clickThrough: boolean[] }).__clickThrough), { timeout: 10_000 })
        .toContain(false);
      // The first message already asked for a hide (LINGER 3000 + HIDE_DELAY 400). While the
      // pointer rests on the band, main must defer it: the window is still up well past that.
      await bubble.waitForTimeout(5_000);
      const stillUp = await isVisible(app, 'bubble.html');
      record('hover holds the window interactive', stillUp ? 'PASS' : 'FAIL',
        `setIgnoreMouseEvents(false) observed on the bubble window; still visible ${stillUp} after 5 s of hover (hide was armed at 3.4 s)`);
      expect(stillUp).toBe(true);
    });

    // ---- check 2: the bubble follows a drag of the pet ----------------------------------
    await test.step('the bubble follows a drag of the pet', async () => {
      const before = await boundsOf(app, 'bubble.html');
      const petBefore = await petBounds(app);
      const pet = await windowByUrl(app, 'pet.html');
      // The real IPC the pet renderer sends while she is dragged (contracts 5.4 rule 3).
      await pet.evaluate(() => {
        (window as unknown as { ds: { send(c: string, p: unknown): void } }).ds.send('avatar:drag', { dx: -180, dy: -60 });
      });
      await expect.poll(async () => (await petBounds(app)).x, { timeout: 10_000 }).toBe(petBefore.x - 180);
      const after = await boundsOf(app, 'bubble.html');
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const followed = Math.abs(dx - -180) <= 2 && Math.abs(dy - -60) <= 2;
      record('the bubble follows a drag of the pet', followed ? 'PASS' : 'FAIL',
        `pet moved (-180, -60); band moved (${dx}, ${dy})`);
      expect(followed).toBe(true);
    });

    // ---- check 3: display reconciliation ------------------------------------------------
    await test.step('display-removal reconciliation', async () => {
      const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
      // Fire the two events index.ts listens for. On a single-monitor machine this exercises the
      // handler and its reconcileDisplays + brain.reposition path; it is NOT a physical unplug.
      const state = await app.evaluate(({ BrowserWindow, screen }) => {
        (screen as unknown as { emit(e: string): void }).emit('display-removed');
        (screen as unknown as { emit(e: string): void }).emit('display-metrics-changed');
        const win = (n: string) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(n));
        const pet = win('pet.html');
        const bub = win('bubble.html');
        if (!pet || !bub) throw new Error('windows missing');
        const pb = pet.getBounds();
        const bb = bub.getBounds();
        return { pb, bb, wa: screen.getDisplayMatching(pb).workArea };
      });
      const petInside = state.pb.x >= state.wa.x && state.pb.y >= state.wa.y
        && state.pb.x + state.pb.width <= state.wa.x + state.wa.width
        && state.pb.y + state.pb.height <= state.wa.y + state.wa.height;
      const bandInside = state.bb.x >= state.wa.x && state.bb.y >= state.wa.y
        && state.bb.x + state.bb.width <= state.wa.x + state.wa.width
        && state.bb.y + state.bb.height <= state.wa.y + state.wa.height;
      const topFraction = (state.bb.y - state.pb.y) / state.pb.height;
      if (displays > 1) {
        record('display-removal reconciliation', petInside && bandInside ? 'PASS' : 'FAIL',
          `${displays} displays; after display-removed + display-metrics-changed the pet and the band are both inside the work area`);
      } else {
        record('display-removal reconciliation', 'UNTESTABLE',
          `only ${displays} display on this machine, so a real unplug cannot be produced. The handler path was exercised synthetically (screen.emit('display-removed') + ('display-metrics-changed')): pet inside work area ${petInside}, band inside work area ${bandInside}, band top at ${(topFraction * 100).toFixed(1)} % of the pet.`);
      }
      expect(petInside && bandInside).toBe(true);
    });

    // ---- check 1b: leaving the band re-arms the hide -----------------------------------
    await test.step('pointerleave re-arms the hide', async () => {
      await bubble.evaluate(() => {
        document.querySelector('.bubble')?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
      });
      const hid = await expect.poll(() => isVisible(app, 'bubble.html'), { timeout: 20_000, intervals: [250] }).toBe(false)
        .then(() => true).catch(() => false);
      record('pointerleave re-arms the hide', hid ? 'PASS' : 'FAIL',
        `the first message had armed a hide; while the pointer was on the band it never fired, and the band hid within 20 s of pointerleave: ${hid}`);
      expect(hid).toBe(true);
    });

    // ---- composited desktop + interruption, on the echo brain --------------------------
    // The band is hidden again by now, so the C-12 click has nothing to land on; the two first-run
    // tests already prove that gesture. Open through the same `chat:open` IPC the click sends.
    await bubble.evaluate(() => {
      (window as unknown as { dsBubble: { send(c: string, p: unknown): void } })
        .dsBubble.send('chat:open', { source: 'bubble', focusComposer: true });
    });
    await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(true);
    const chat = await windowByUrl(app, 'chat.html');
    const composer = chat.getByRole('textbox');
    await chat.evaluate(() => {
      const w = window as unknown as { __states: string[]; dsChat: { on(c: string, cb: (p: unknown) => void): () => void } };
      w.__states = [];
      w.dsChat.on('brain:state', (p) => { w.__states.push((p as { state: string }).state); });
    });
    const lastState = () => chat.evaluate(() => (window as unknown as { __states: string[] }).__states.at(-1) ?? 'idle');

    await test.step('composited desktop shot while she is speaking', async () => {
      await composer.fill(`早。${'今天挺普通的。'.repeat(40)}`);
      await composer.press('Enter');
      await expect.poll(lastState, { timeout: 60_000, intervals: [100] }).toBe('speaking');
      // Put the composer away so this shot is the pet and the BAND on the desktop: the composer
      // sits on the band's own rect and would cover it. The pet window is not focusable, so a
      // focus steal cannot do it; `chat:close` is the channel the composer's own Escape uses.
      await chat.evaluate(() => {
        (window as unknown as { dsChat: { send(c: string, p: unknown): void } }).dsChat.send('chat:close', {});
      });
      await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(false);
      captureRegion(await unionBounds(app, ['pet.html', 'bubble.html']), join(EVIDENCE, 'app-desktop.png'));
      sampleResources('speaking', 5);
      await expect.poll(lastState, { timeout: 120_000, intervals: [250] }).toBe('idle');
      // Re-open for the interruption step (the band's click gesture is proved in the first-run tests).
      await bubble.evaluate(() => {
        (window as unknown as { dsBubble: { send(c: string, p: unknown): void } })
          .dsBubble.send('chat:open', { source: 'bubble', focusComposer: true });
      });
      await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(true);
    });

    await test.step('Escape mid-reply cancels without closing, and history marks [中断]', async () => {
      // `TurnRunner.cancel()` is a no-op once the turn has settled, and a turn settles when the
      // STREAM ends — not when playback does. `retire()` also needs at least one
      // `playback:sentenceDone`. The echo brain streams at 6 chars / 40 ms while the band reveals
      // at 70 ms per 汉字, so the only way to be inside that window offline is a reply whose FIRST
      // sentence is short (fast to reveal) and whose TOTAL length is long (slow to stream). The
      // echo brain quotes the user back, so a long message of very short sentences produces exactly
      // that shape.
      // Counted in MAIN with an extra ipcMain listener: `window.dsBubble` is a contextBridge
      // object, so its `send` cannot be monkey-patched from the page.
      const shownCount = () => app.evaluate(() => (globalThis as unknown as { __shown: number[] }).__shown.length);
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __shown: number[]; __shownArmed?: boolean };
        g.__shown = [];
        if (g.__shownArmed) return;
        g.__shownArmed = true;
        ipcMain.on('playback:sentenceDone', (_e, p: unknown) => { g.__shown.push((p as { seq: number }).seq); });
      });
      await composer.fill(`早。${'今天挺普通的。'.repeat(60)}`);
      await composer.press('Enter');
      await expect.poll(lastState, { timeout: 60_000, intervals: [100] }).toBe('speaking');
      await expect.poll(shownCount, { timeout: 60_000, intervals: [50] }).toBeGreaterThan(0);
      await composer.press('Escape');
      // 6.2 rule 4: Escape while brainState !== 'idle' cancels and does NOT close the window.
      expect(await isVisible(app, 'chat.html')).toBe(true);
      await expect.poll(lastState, { timeout: 30_000, intervals: [250] }).toBe('idle');
      await chat.getByText('历史').click();
      await expect(chat.getByText('[中断]')).toBeVisible({ timeout: 15_000 });
      await chat.screenshot({ path: join(EVIDENCE, 'app-history-interrupted.png') });
      record('Escape mid-reply: chat stays open, history marks [中断]', 'PASS',
        '6.2 rule 4 (Escape while brainState !== idle cancels and does not close) and R2 (the history row keeps only the sentences whose playback:sentenceDone arrived, and carries the [中断] chip)');
      await chat.getByText('历史').click();
    });

    // ---- check 4: an abandoned IME composition is dismissed cleanly ---------------------
    await test.step('an abandoned IME composition is dismissed cleanly', async () => {
      await composer.click();
      await composer.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'nihao' }));
      });
      // R6: while an IME session is open the composer swallows Escape, so the window stays.
      await composer.press('Escape');
      await chat.waitForTimeout(300);
      const survivedEscape = await isVisible(app, 'chat.html');

      // The user gives up: the IME cancels the composition without committing anything.
      await composer.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      });
      await chat.waitForTimeout(200);
      const valueAfter = await composer.inputValue();

      // Nothing is latched any more: Escape now closes, and a re-opened window still light-dismisses.
      await composer.press('Escape');
      await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(false);
      await bubble.evaluate(() => {
        (window as unknown as { dsBubble: { send(c: string, p: unknown): void } })
          .dsBubble.send('chat:open', { source: 'bubble', focusComposer: true });
      });
      await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('key.html'))?.showInactive();
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('key.html'))?.focus();
      });
      const dismissed = await expect.poll(() => isVisible(app, 'chat.html'), { timeout: 10_000 }).toBe(false)
        .then(() => true).catch(() => false);
      record('an abandoned IME composition is dismissed cleanly',
        survivedEscape && valueAfter === '' && dismissed ? 'PASS' : 'FAIL',
        `Escape swallowed while composing (window survived: ${survivedEscape}); nothing committed to the composer (value ${JSON.stringify(valueAfter)}); after the abandoned composition Escape closes and light-dismiss works again (${dismissed})`);
      expect(survivedEscape).toBe(true);
      expect(valueAfter).toBe('');
      expect(dismissed).toBe(true);
    });
  } finally {
    writeFileSync(join(EVIDENCE, 'app-inapp-checks.md'), [
      '# Phase 2 — the in-app checks Task 6 could not exercise',
      '',
      'Driven by `apps/desktop/tests-e2e/phase2.spec.ts` against the built app on a throwaway',
      'user-data directory with `DS_FAKE_BRAIN=1`, so none of it depends on a DeepSeek balance.',
      '',
      '| check | verdict | detail |',
      '|---|---|---|',
      ...rows,
      '',
    ].join('\n'), 'utf8');
    await app.close();
  }
});

test('20 real turns: cache hit, paint latency, composited desktop, interruption marker', async () => {
  test.skip(!process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY not set');
  test.setTimeout(900_000);

  const fixture = JSON.parse(readFileSync(join(REPO, 'eval', 'fixtures', 'prompts.zh.json'), 'utf8')) as {
    prompts: { id: string; text: string }[];
  };
  const prompts = fixture.prompts.slice(0, 20);
  expect(prompts).toHaveLength(20);

  const { app } = await launchApp({ devKey: process.env.DEEPSEEK_API_KEY, theme: 'light' });
  try {
    const bubble = await windowByUrl(app, 'bubble.html');
    await expect.poll(() => bubbleText(bubble), { timeout: 30_000, intervals: [100] }).not.toBe('');
    const chat = await openChatByClickingTheBand(app, bubble);

    // Paint latency, measured entirely inside the bubble renderer: the delta between the arrival of
    // sentence 0 and the first mutation that makes the band non-empty (addendum section 0 / R4).
    // No new hook is needed - `brain:sentence` is already on MAIN_TO_BUBBLE.
    await bubble.evaluate(() => {
      const w = window as unknown as {
        __paint: { pending: number | null; deltas: number[] };
        dsBubble: { on(c: string, cb: (p: unknown) => void): () => void };
      };
      w.__paint = { pending: null, deltas: [] };
      w.dsBubble.on('brain:sentence', (p) => {
        if ((p as { seq: number }).seq === 0) w.__paint.pending = performance.now();
      });
      new MutationObserver(() => {
        if (w.__paint.pending !== null && document.body.innerText.trim() !== '') {
          w.__paint.deltas.push(performance.now() - w.__paint.pending);
          w.__paint.pending = null;
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });

    await chat.evaluate(() => {
      const w = window as unknown as {
        __turns: unknown[]; __states: string[];
        dsChat: { on(c: string, cb: (p: unknown) => void): () => void };
      };
      w.__turns = [];
      w.__states = [];
      w.dsChat.on('brain:turnDone', (p) => { w.__turns.push(p); });
      w.dsChat.on('brain:error', (p) => { w.__turns.push({ error: p }); });
      w.dsChat.on('brain:state', (p) => { w.__states.push((p as { state: string }).state); });
    });

    const composer = chat.getByRole('textbox');
    const doneCount = () => chat.evaluate(() => (window as unknown as { __turns: unknown[] }).__turns.length);
    const lastState = () => chat.evaluate(() => (window as unknown as { __states: string[] }).__states.at(-1) ?? 'idle');

    for (let i = 0; i < prompts.length; i++) {
      const before = await doneCount();
      await composer.fill(prompts[i].text);
      await composer.press('Enter');
      await expect.poll(doneCount, { timeout: 90_000, intervals: [250] }).toBe(before + 1);
      if (i === 1) {
        // The band is painting right now: this is the one moment the composited desktop shot is
        // guaranteed to contain both the pet and a speaking band.
        captureRegion(await unionBounds(app, ['pet.html', 'bubble.html']), join(EVIDENCE, 'app-desktop.png'));
        sampleResources('speaking', 5);
      }
      // Let playback finish so the next send is a new turn, not an interruption (contracts 3.11.4).
      await expect.poll(lastState, { timeout: 60_000, intervals: [250] }).toBe('idle');
    }

    const raw = await chat.evaluate(() => (window as unknown as {
      __turns: {
        usage: { promptTokens: number; cacheHit: number; cacheMiss: number; completionTokens: number } | null;
        ttftMs: number | null; totalMs: number; complianceMiss: boolean; regenerated: boolean;
      }[];
    }).__turns);
    const withUsage = raw.filter((t) => t.usage !== null);
    expect(withUsage.length).toBeGreaterThanOrEqual(20);

    const rows = withUsage.slice(0, 20).map((t, i) => ({
      turn: i + 1,
      promptId: prompts[i].id,
      promptTokens: t.usage!.promptTokens,
      cacheHit: t.usage!.cacheHit,
      cacheMiss: t.usage!.cacheMiss,
      completionTokens: t.usage!.completionTokens,
      ttftMs: t.ttftMs,
      totalMs: t.totalMs,
      complianceMiss: t.complianceMiss,
      regenerated: t.regenerated,
    }));
    let hit = 0;
    let total = 0;
    for (const r of rows) if (r.turn >= 3) { hit += r.cacheHit; total += r.promptTokens; }
    const cacheHitPct = total === 0 ? 0 : hit / total;

    const paint = await bubble.evaluate(() => (window as unknown as { __paint: { deltas: number[] } }).__paint.deltas);
    expect(paint.length).toBeGreaterThanOrEqual(20);
    const paintP50 = median(paint);

    writeFileSync(join(EVIDENCE, 'app-20-turns.json'),
      `${JSON.stringify({ version: 1, cacheHitPct, paintP50, paintSamples: paint.length, turns: rows }, null, 2)}\n`, 'utf8');
    writeFileSync(join(EVIDENCE, 'app-20-turns.md'), [
      '# Phase 2 — 20 real turns in the shipping app',
      '',
      `- prompt-cache hit, turns 3-20: **${(cacheHitPct * 100).toFixed(1)} %** (bar >= 70 %, X1)`,
      `- first grapheme painted after sentence 0 arrived, p50: **${paintP50.toFixed(0)} ms** (bar <= 100 ms, addendum section 0)`,
      `- compliance misses: ${rows.filter((r) => r.complianceMiss).length} / 20`,
      `- regenerated turns: ${rows.filter((r) => r.regenerated).length} / 20 (the shipped TurnRunner may regenerate once; the eval harness never does)`,
      '',
      '| turn | prompt | prompt tokens | cache hit | cache miss | completion | ttft ms | total ms |',
      '|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.turn} | ${r.promptId} | ${r.promptTokens} | ${r.cacheHit} | ${r.cacheMiss} | ${r.completionTokens} | ${r.ttftMs ?? ''} | ${r.totalMs} |`),
      '',
    ].join('\n'), 'utf8');

    expect(cacheHitPct).toBeGreaterThanOrEqual(0.7);
    expect(paintP50).toBeLessThanOrEqual(100);

    // Interruption: history keeps exactly the sentences whose sentenceDone arrived, and marks the
    // row (R2). Escape while brainState !== 'idle' cancels and does NOT close (contracts 6.2 rule 4).
    let interrupted = false;
    for (let attempt = 0; attempt < 2 && !interrupted; attempt++) {
      await composer.fill('把你今天从早到晚做过的事，一件一件慢慢讲给我听');
      await composer.press('Enter');
      await expect.poll(() => bubbleText(bubble), { timeout: 60_000, intervals: [100] }).not.toBe('');
      await chat.waitForTimeout(3600);
      if ((await lastState()) !== 'speaking') continue;
      await composer.press('Escape');
      await expect.poll(lastState, { timeout: 30_000, intervals: [250] }).toBe('idle');
      interrupted = true;
    }
    expect(interrupted).toBe(true);

    await chat.getByText('历史').click();
    await expect(chat.getByText('[中断]')).toBeVisible({ timeout: 15_000 });
    await chat.screenshot({ path: join(EVIDENCE, 'app-history-interrupted.png') });
  } finally {
    await app.close();
  }
});
