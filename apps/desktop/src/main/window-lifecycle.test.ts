import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { Channels } from '@ds/protocol';
import {
  BUBBLE_IDLE_GRACE_MS, BUBBLE_REPLAY_CHANNELS, BubbleLifecycle, CHAT_PRECREATE_DELAY_MS,
  FIRST_MESSAGE_BUDGET_MS, HIDDEN_PLAYBACK_RETIRE_MS, LazyWindow, RECREATE_BUDGET_MS, replayWhenLoaded,
} from './window-lifecycle';

/** The slice of BrowserWindow the lifecycle touches; cast to BrowserWindow the way ipc.test.ts does. */
class FakeWin {
  destroyed = false;
  visible = false;
  loading = false;
  readonly calls: string[] = [];
  private readonly closedCbs: Array<() => void> = [];
  private readonly loadCbs: Array<() => void> = [];
  readonly webContents = {
    isLoading: () => this.loading,
    once: (_ev: 'did-finish-load', cb: () => void) => { this.loadCbs.push(cb); },
  };
  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  focus(): void { this.calls.push('focus'); }
  show(): void { this.calls.push('show'); this.visible = true; }
  once(_ev: 'closed', cb: () => void): this { this.closedCbs.push(cb); return this; }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.calls.push('destroy');
    for (const cb of this.closedCbs) cb();
  }
  finishLoad(): void { this.loading = false; for (const cb of this.loadCbs.splice(0)) cb(); }
}
const asWin = (f: FakeWin): BrowserWindow => f as unknown as BrowserWindow;

function lazy() {
  const created: FakeWin[] = [];
  const events: string[] = [];
  const holder = new LazyWindow<BrowserWindow>(() => { const f = new FakeWin(); created.push(f); return asWin(f); }, {
    onCreated: () => events.push('created'),
    onDestroyed: () => events.push('destroyed'),
  });
  return { holder, created, events };
}

describe('§11.2 constants', () => {
  it('pins the R3-14 numbers', () => {
    expect(BUBBLE_IDLE_GRACE_MS).toBe(60_000);
    expect(RECREATE_BUDGET_MS).toBe(400);
    expect(FIRST_MESSAGE_BUDGET_MS).toBe(3_000);
    expect(HIDDEN_PLAYBACK_RETIRE_MS).toBe(600_000);
    expect(CHAT_PRECREATE_DELAY_MS).toBe(2_000);
  });
});

describe('LazyWindow', () => {
  it('get() creates once and returns the same live window; peek() never resurrects', () => {
    const { holder, created, events } = lazy();
    expect(holder.alive).toBe(false);
    expect(holder.peek()).toBeNull();
    const a = holder.get();
    expect(holder.get()).toBe(a);
    expect(created).toHaveLength(1);
    expect(holder.alive).toBe(true);
    expect(events).toEqual(['created']);
  });

  it('destroy() destroys, fires onDestroyed once, and the next get() recreates', () => {
    const { holder, created, events } = lazy();
    holder.get();
    holder.destroy();
    holder.destroy();
    expect(created[0].destroyed).toBe(true);
    expect(holder.alive).toBe(false);
    expect(holder.peek()).toBeNull();
    holder.get();
    expect(created).toHaveLength(2);
    expect(events).toEqual(['created', 'destroyed', 'created']);
  });

  it('a window closed from outside (close() IS the destroy for chat/key) is seen as gone', () => {
    const { holder, created, events } = lazy();
    holder.get();
    created[0].destroy();
    expect(holder.alive).toBe(false);
    expect(events).toEqual(['created', 'destroyed']);
    expect(holder.get()).not.toBe(asWin(created[0]));
  });

  it('records lastCreateMs from the injected clock', () => {
    let t = 100;
    const holder = new LazyWindow<BrowserWindow>(() => { t += 37; return asWin(new FakeWin()); }, { now: () => t });
    expect(holder.lastCreateMs).toBe(0);
    holder.get();
    expect(holder.lastCreateMs).toBe(37);
  });

  it('D10 guard: the pre-created chat window reports isVisible()===false and no focus()/show() is made', () => {
    const { holder, created } = lazy();
    const win = holder.get();
    expect(win.isVisible()).toBe(false);
    expect(created[0].calls).toEqual([]);
    expect(holder.lastCreateMs).toBeGreaterThanOrEqual(0);
  });

  describe('generation-stamped grace timer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a callback armed under an older generation returns immediately', () => {
      const { holder } = lazy();
      const fired: number[] = [];
      holder.armGrace(1000, (g) => { fired.push(g); });
      holder.cancelGrace();
      vi.advanceTimersByTime(1000);
      expect(fired).toEqual([]);
      const g = holder.graceGeneration;
      holder.armGrace(1000, (gen) => { fired.push(gen); });
      vi.advanceTimersByTime(1000);
      expect(fired).toEqual([g]);
    });

    it('every get() (show/recreate) bumps the generation', () => {
      const { holder } = lazy();
      const g0 = holder.graceGeneration;
      holder.get();
      expect(holder.graceGeneration).toBe(g0 + 1);
      holder.get();
      expect(holder.graceGeneration).toBe(g0 + 2);
    });
  });
});

describe('BubbleLifecycle — §11.3 ordered destroy rule', () => {
  beforeEach(() => { vi.useFakeTimers({ now: 0 }); });
  afterEach(() => { vi.useRealTimers(); });

  function harness(opts: { lease?: () => boolean } = {}) {
    const { holder, created } = lazy();
    const order: string[] = [];
    const retireSpeech = vi.fn(async () => { order.push('retire'); });
    const life = new BubbleLifecycle({
      bubble: holder,
      speechLeaseActive: opts.lease ?? (() => false),
      retireSpeech,
      onDestroyed: () => order.push('destroy'),
    });
    return { holder, created, life, order, retireSpeech, destroys: () => created.filter((c) => c.destroyed).length };
  }

  it('pins the cycle: hide → show at t+10 s → hide at t+20 s ⇒ exactly ONE destroy, at t+80 s', async () => {
    const h = harness();
    h.holder.get();
    h.life.onHidden();                                   // t = 0
    await vi.advanceTimersByTimeAsync(10_000);
    h.life.onNeeded();                                   // t = 10 s: show — invalidates the first timer
    await vi.advanceTimersByTimeAsync(10_000);
    h.life.onHidden();                                   // t = 20 s
    await vi.advanceTimersByTimeAsync(40_000 - 1);       // t = 60 s − 1 ms: the FIRST timer would have fired here
    expect(h.destroys()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);           // t = 80 s − 1 ms
    expect(h.destroys()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);                // t = 80 s
    expect(h.destroys()).toBe(1);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(h.destroys()).toBe(1);
    expect(h.retireSpeech).not.toHaveBeenCalled();
  });

  it('never destroys under a live speech lease before HIDDEN_PLAYBACK_RETIRE_MS: it re-arms the grace', async () => {
    let lease = true;
    const h = harness({ lease: () => lease });
    h.holder.get();
    h.life.onHidden();
    await vi.advanceTimersByTimeAsync(BUBBLE_IDLE_GRACE_MS * 5);   // 5 min hidden, still speaking
    expect(h.destroys()).toBe(0);
    expect(h.retireSpeech).not.toHaveBeenCalled();
    lease = false;                                                  // the turn ended by itself
    await vi.advanceTimersByTimeAsync(BUBBLE_IDLE_GRACE_MS);
    expect(h.destroys()).toBe(1);
  });

  it('hidden ≥ 10 min while speaking: awaits retireSpeech() FIRST, then destroys (R3-17 → R3-14 order)', async () => {
    const h = harness({ lease: () => true });
    h.holder.get();
    h.life.onHidden();
    await vi.advanceTimersByTimeAsync(HIDDEN_PLAYBACK_RETIRE_MS - 1);
    expect(h.retireSpeech).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.retireSpeech).toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(['retire', 'destroy']);
    expect(h.destroys()).toBe(1);
  });

  it('onNeeded() during the retire await wins: the window is NOT destroyed under the show', async () => {
    let resolveRetire: () => void = () => {};
    const { holder, created } = lazy();
    const life = new BubbleLifecycle({
      bubble: holder,
      speechLeaseActive: () => true,
      retireSpeech: () => new Promise<void>((r) => { resolveRetire = r; }),
    });
    holder.get();
    life.onHidden();
    await vi.advanceTimersByTimeAsync(HIDDEN_PLAYBACK_RETIRE_MS);
    life.onNeeded();
    resolveRetire();
    await vi.advanceTimersByTimeAsync(0);
    expect(created.filter((c) => c.destroyed)).toHaveLength(0);
  });

  it('onNeeded() recreates a destroyed bubble and returns the live window; the recreate is timed', async () => {
    const h = harness();
    h.holder.get();
    h.life.onHidden();
    await vi.advanceTimersByTimeAsync(BUBBLE_IDLE_GRACE_MS);
    expect(h.destroys()).toBe(1);
    const w = h.life.onNeeded();
    expect(w.isDestroyed()).toBe(false);
    expect(h.created).toHaveLength(2);
    expect(h.holder.lastCreateMs).toBeGreaterThanOrEqual(0);
  });

  it('dispose() cancels an armed grace timer', async () => {
    const h = harness();
    h.holder.get();
    h.life.onHidden();
    h.life.dispose();
    await vi.advanceTimersByTimeAsync(BUBBLE_IDLE_GRACE_MS * 2);
    expect(h.destroys()).toBe(0);
  });
});

describe('replay on recreate (§11.3)', () => {
  it('names the four channels main re-sends, in order, before the pending sentences', () => {
    expect(BUBBLE_REPLAY_CHANNELS).toEqual([
      Channels.bubblePlace, Channels.shellVisibility, Channels.modeChanged, Channels.simState,
    ]);
  });

  it('replayWhenLoaded sends now when the page is loaded, else once on did-finish-load (the §6.6 guard)', () => {
    const f = new FakeWin();
    const send = vi.fn();
    replayWhenLoaded(asWin(f), send);
    expect(send).toHaveBeenCalledTimes(1);
    f.loading = true;
    replayWhenLoaded(asWin(f), send);
    expect(send).toHaveBeenCalledTimes(1);
    f.finishLoad();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('replayWhenLoaded is a no-op on a destroyed window', () => {
    const f = new FakeWin();
    f.destroyed = true;
    const send = vi.fn();
    replayWhenLoaded(asWin(f), send);
    expect(send).not.toHaveBeenCalled();
  });
});
