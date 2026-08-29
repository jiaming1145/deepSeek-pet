import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ticker, shouldRender } from './ticker';

describe('shouldRender', () => {
  it('renders every frame at 60 fps', () => {
    expect(shouldRender(60, 0, 16.7)).toBe(true);
  });
  it('skips frames that arrive before the 30 fps interval elapsed', () => {
    expect(shouldRender(30, 1000, 1016.7)).toBe(false);
    expect(shouldRender(30, 1000, 1033.4)).toBe(true);
  });
});

/** Deterministic rAF: records every scheduled callback so pumps can be counted. */
function fakeRaf() {
  let nextId = 1;
  const pending = new Map<number, (now: number) => void>();
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });
  return {
    get scheduled(): number {
      return pending.size;
    },
    /** Fires every callback scheduled so far (not the ones they schedule in turn). */
    flush(now: number): void {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb(now);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ticker', () => {
  it('stops and stays restartable when the frame callback throws', () => {
    const raf = fakeRaf();
    let frames = 0;
    const ticker = new Ticker(() => {
      frames++;
      if (frames === 1) throw new Error('MouthDriver blew up');
    });

    ticker.start();
    expect(ticker.running()).toBe(true);
    expect(raf.scheduled).toBe(1);

    expect(() => raf.flush(1000)).toThrow('MouthDriver blew up');
    expect(ticker.running()).toBe(false);
    expect(raf.scheduled).toBe(0); // the wedged loop did not schedule a successor

    ticker.start(); // must not be a no-op
    expect(ticker.running()).toBe(true);
    expect(raf.scheduled).toBe(1);
    raf.flush(2000);
    expect(frames).toBe(2);
    expect(raf.scheduled).toBe(1); // exactly one pump keeps running
  });

  it('leaves exactly one pump after a synchronous stop(); start() from the callback', () => {
    const raf = fakeRaf();
    let frames = 0;
    const ticker = new Ticker(() => {
      frames++;
      if (frames === 1) {
        ticker.stop();
        ticker.start();
      }
    });

    ticker.start();
    raf.flush(1000);

    // Old code: the restarted pump AND the old loop's tail were both scheduled.
    expect(raf.scheduled).toBe(1);
    expect(ticker.running()).toBe(true);

    raf.flush(2000);
    expect(frames).toBe(2);
    expect(raf.scheduled).toBe(1);
  });

  it('leaves no pump when the callback stops the ticker', () => {
    const raf = fakeRaf();
    const ticker = new Ticker(() => ticker.stop());
    ticker.start();
    raf.flush(1000);
    expect(raf.scheduled).toBe(0);
    expect(ticker.running()).toBe(false);
  });

  it('start() while running is a no-op, and stop() cancels the pending frame', () => {
    const raf = fakeRaf();
    const ticker = new Ticker(() => {});
    ticker.start();
    ticker.start();
    expect(raf.scheduled).toBe(1);
    ticker.stop();
    expect(raf.scheduled).toBe(0);
    expect(ticker.running()).toBe(false);
  });
});
