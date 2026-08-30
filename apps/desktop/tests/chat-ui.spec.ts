import { expect, test, type Page } from '@playwright/test';

const OUT = '../../docs/evidence/phase2';

/** Injected before the page's modules run (contracts.md 2.6). */
async function fakeChatBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<string, ((p: unknown) => void)[]>();
    const now = Date.now();
    const rows = [
      { id: 1, ts: now - 47 * 3600_000, role: 'user', content: '前天那个面试，我搞砸了', turnId: 't-1', kind: 'chat', interrupted: false },
      { id: 2, ts: now - 47 * 3600_000, role: 'assistant', content: '搞砸了就搞砸了。下一个。', turnId: 't-1', kind: 'chat', interrupted: false },
      { id: 3, ts: now - 26 * 3600_000, role: 'assistant', content: '你今天一句话都没说。', turnId: 't-2', kind: 'proactive', interrupted: false },
      { id: 4, ts: now - 2 * 3600_000, role: 'user', content: '在吗', turnId: 't-3', kind: 'chat', interrupted: false },
      { id: 5, ts: now - 2 * 3600_000, role: 'assistant', content: '在。刚才走神了。', turnId: 't-3', kind: 'chat', interrupted: true },
    ];
    (window as unknown as { dsChat: unknown }).dsChat = {
      send() {},
      on(ch: string, cb: (p: unknown) => void) {
        const arr = listeners.get(ch) ?? [];
        arr.push(cb);
        listeners.set(ch, arr);
        return () => {};
      },
      invoke(ch: string) {
        if (ch === 'user:text') return Promise.resolve({ ok: true, turnId: 't-9' });
        if (ch === 'history:list') return Promise.resolve({ rows, nextBefore: null });
        if (ch === 'history:delete') return Promise.resolve({ ok: true, deleted: 2 });
        return Promise.resolve({ ok: true });
      },
    };
  });
}

async function fakeKeyBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { dsKey: unknown }).dsKey = {
      send() {},
      on(ch: string, cb: (p: unknown) => void) {
        if (ch === 'key:status') setTimeout(() => cb({ present: false, source: 'none', lastTest: null }), 0);
        return () => {};
      },
      invoke() {
        return Promise.resolve({ ok: true });
      },
    };
  });
}

/** The chat window is transparent; paint the themed page ground so dark shots read as dark. */
async function backdrop(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html { background: var(--c-bg); }' });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`chat + key windows (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test(`empty composer (${scheme})`, async ({ page }) => {
      await fakeChatBridge(page);
      await page.setViewportSize({ width: 360, height: 48 });
      await page.goto('/chat.html');
      await backdrop(page);
      await expect(page.getByRole('textbox')).toBeVisible();
      await page.screenshot({ path: `${OUT}/sheet-composer-${scheme}.png`, animations: 'disabled' });
    });

    test(`typing (${scheme})`, async ({ page }) => {
      await fakeChatBridge(page);
      await page.setViewportSize({ width: 360, height: 92 });
      await page.goto('/chat.html');
      await backdrop(page);
      await page.getByRole('textbox').fill('今天面试完了\n三轮都问了同一个问题\n我一句都没答上来');
      await expect(page.getByRole('textbox')).toHaveValue(/答上来$/);
      await page.screenshot({ path: `${OUT}/sheet-composer-typing-${scheme}.png`, animations: 'disabled' });
    });

    test(`history open (${scheme})`, async ({ page }) => {
      await fakeChatBridge(page);
      await page.setViewportSize({ width: 360, height: 468 });
      await page.goto('/chat.html');
      await backdrop(page);
      await page.getByRole('button', { name: /历史/ }).click();
      await expect(page.getByText('在。刚才走神了。')).toBeVisible();
      await expect(page.getByText('[中断]')).toBeVisible();
      await expect(page.getByText('主动')).toBeVisible();
      await page.screenshot({ path: `${OUT}/chat-history-${scheme}.png`, animations: 'disabled' });
      if (scheme === 'light') {
        // R2's truthful-history marker, cropped to the row that carries it.
        await page.getByTestId('msg-5').screenshot({ path: `${OUT}/history-interrupted.png` });
      }
    });

    test(`key window (${scheme})`, async ({ page }) => {
      await fakeKeyBridge(page);
      await page.setViewportSize({ width: 440, height: 360 });
      await page.goto('/key.html');
      await expect(
        page.getByText('对话内容会发送到 DeepSeek（服务器在中国境内）处理，回复由 AI 生成。'),
      ).toBeVisible();
      await page.screenshot({ path: `${OUT}/sheet-key-${scheme}.png`, animations: 'disabled' });
    });
  });
}
