import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HINT_QUEUE_MAX, HintSurface } from './hint';

const H = (text: string) => ({ text, level: 'info' as const, ttlMs: 6000 });

describe('HintSurface', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="hint" hidden></div>';
    root = document.getElementById('hint') as HTMLElement;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one hint with its level', () => {
    new HintSurface(root).show({ text: 'API Key 无效，重新填一下', level: 'error', ttlMs: 6000 });
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe('API Key 无效，重新填一下');
    expect(root.dataset.level).toBe('error');
  });

  it('queues while one is visible and shows the next on dismiss', () => {
    const s = new HintSurface(root);
    s.show(H('一'));
    s.show(H('二'));
    expect(s.queueLength).toBe(1);
    expect(root.textContent).toBe('一');
    s.dismiss();
    expect(root.textContent).toBe('二');
    expect(s.queueLength).toBe(0);
  });

  it(`drops the oldest queued hint beyond HINT_QUEUE_MAX (${HINT_QUEUE_MAX})`, () => {
    const s = new HintSurface(root);
    s.show(H('visible'));
    for (const t of ['a', 'b', 'c', 'd']) s.show(H(t));
    expect(s.queueLength).toBe(HINT_QUEUE_MAX);
    s.dismiss();
    expect(root.textContent).toBe('b');
  });

  it('dismisses itself after ttlMs', () => {
    new HintSurface(root).show({ text: '网络不太好，等一下再聊', level: 'warn', ttlMs: 6000 });
    vi.advanceTimersByTime(5999);
    expect(root.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.hidden).toBe(true);
  });
});
