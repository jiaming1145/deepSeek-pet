// See chat/History.test.tsx: tsconfig.ui.json does not include src/renderer/test-setup.ts, so
// jest-dom's vitest augmentation has to be imported here for `toBeInTheDocument` to type-check.
import '@testing-library/jest-dom/vitest';
import { Channels } from '@ds/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, DISCLOSURE } from './App';
import type { DsKeyBridge } from './bridge';

// See chat/Composer.test.tsx: vitest's `globals: false` leaves RTL's auto-cleanup unregistered.
afterEach(cleanup);

function makeBridge() {
  const listeners = new Map<string, ((p: unknown) => void)[]>();
  const sent: Array<[string, unknown]> = [];
  const invoked: Array<[string, unknown]> = [];
  const replies = new Map<string, unknown>();
  const bridge = {
    send(ch: string, p: unknown) {
      sent.push([ch, p]);
    },
    on(ch: string, cb: (p: unknown) => void) {
      const arr = listeners.get(ch) ?? [];
      arr.push(cb);
      listeners.set(ch, arr);
      return () => {
        const a = listeners.get(ch) ?? [];
        a.splice(a.indexOf(cb), 1);
      };
    },
    invoke(ch: string, p: unknown) {
      invoked.push([ch, p]);
      return Promise.resolve(replies.get(ch) ?? { ok: true });
    },
  } as unknown as DsKeyBridge;
  const emit = (ch: string, p: unknown) =>
    act(() => {
      for (const cb of listeners.get(ch) ?? []) cb(p);
    });
  return { bridge, sent, invoked, replies, emit };
}

describe('key window', () => {
  it('shows the PRC disclosure verbatim, with no privacy link and no settings-window copy', () => {
    const b = makeBridge();
    render(<App bridge={b.bridge} onRequestClose={vi.fn()} />);
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
    expect(DISCLOSURE).toBe('对话内容会发送到 DeepSeek（服务器在中国境内）处理，回复由 AI 生成。');
    // CA-12: C-10 forbids copy that points at a settings window, not the substring 设置 -
    // 6.4's own key:status header copy is literally 还没设置.
    const body = document.body.textContent ?? '';
    for (const bad of ['打开设置', '设置窗口', '设置界面', '去设置', '设置里']) {
      expect(body).not.toContain(bad);
    }
    // The privacy-note link is dropped in Phase 2: one disclosure line, nothing else.
    expect(body).not.toContain('隐私');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reflects key:status in the header', () => {
    const b = makeBridge();
    render(<App bridge={b.bridge} onRequestClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('还没设置');
    b.emit(Channels.keyStatus, { present: true, source: 'store', lastTest: null });
    expect(screen.getByRole('status').textContent).toBe('已保存');
    b.emit(Channels.keyStatus, { present: true, source: 'dev-env', lastTest: null });
    expect(screen.getByRole('status').textContent).toBe('开发环境的临时 Key');
  });

  it('maps an auth failure to ERROR_HINTS.auth.text', async () => {
    const b = makeBridge();
    b.replies.set('key:test', { ok: false, code: 'auth', message: 'unauthorized' });
    render(<App bridge={b.bridge} onRequestClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), { target: { value: 'sk-12345678' } });
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('API Key 无效，重新填一下'));
  });

  it('saves, re-tests, opens the chat and closes the window', async () => {
    const b = makeBridge();
    const onRequestClose = vi.fn();
    render(<App bridge={b.bridge} onRequestClose={onRequestClose} />);
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), { target: { value: 'sk-12345678' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(onRequestClose).toHaveBeenCalledTimes(1));
    expect(b.invoked.map(([ch]) => ch)).toEqual(['key:set', 'key:test']);
    expect(b.invoked[0][1]).toEqual({ apiKey: 'sk-12345678' });
    expect(b.invoked[1][1]).toEqual({});
    expect(b.sent).toEqual([['chat:open', { source: 'key', focusComposer: true }]]);
  });

  it('closes on Escape only when a key is already stored', () => {
    const b = makeBridge();
    const onRequestClose = vi.fn();
    const { container } = render(<App bridge={b.bridge} onRequestClose={onRequestClose} />);
    const root = container.querySelector('.key') as HTMLElement;
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onRequestClose).not.toHaveBeenCalled();
    b.emit(Channels.keyStatus, { present: true, source: 'store', lastTest: null });
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the window', () => {
    const b = makeBridge();
    render(<App bridge={b.bridge} onRequestClose={vi.fn()} />);
    const input = screen.getByLabelText('DeepSeek API Key');
    fireEvent.change(input, { target: { value: 'sk-12345678' } });
    const save = screen.getByText('保存');
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('masks the key and reveals it on 显示', () => {
    const b = makeBridge();
    render(<App bridge={b.bridge} onRequestClose={vi.fn()} />);
    const input = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByText('显示'));
    expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).type).toBe('text');
  });
});
