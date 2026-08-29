import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels } from '@ds/protocol';

const cursorPoint = { x: 0, y: 0 };
const sent: { channel: string; payload: unknown }[] = [];

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getCursorScreenPoint: () => ({ ...cursorPoint }) },
}));
vi.mock('./ipc', () => ({
  sendToPet: (_win: unknown, channel: string, payload: unknown) => sent.push({ channel, payload }),
}));

const { startCursorPolling } = await import('./cursor');

/** Only the four members the poller touches. */
function fakeWindow() {
  const state = { destroyed: false, visible: true, position: [0, 0] as [number, number] };
  return {
    state,
    win: {
      isDestroyed: () => state.destroyed,
      isVisible: () => state.visible,
      getPosition: () => state.position,
    } as never,
  };
}

const gaze = (): unknown[] => sent.filter((s) => s.channel === Channels.gazeCursor).map((s) => s.payload);

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  cursorPoint.x = 0;
  cursorPoint.y = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startCursorPolling', () => {
  it('sends window-local coordinates', () => {
    const { state, win } = fakeWindow();
    state.position = [100, 50];
    cursorPoint.x = 130;
    cursorPoint.y = 90;
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34);
    expect(gaze()).toEqual([{ x: 30, y: 40 }]);
    polling.stop();
  });

  it('emits a new position when the window moves under a stationary cursor', () => {
    const { state, win } = fakeWindow();
    cursorPoint.x = 500;
    cursorPoint.y = 500;
    state.position = [100, 100];
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34);
    expect(gaze()).toEqual([{ x: 400, y: 400 }]);

    // The cursor does not move; the window does. The gaze target has changed, so it must be sent.
    state.position = [200, 150];
    vi.advanceTimersByTime(34);
    expect(gaze()).toEqual([{ x: 400, y: 400 }, { x: 300, y: 350 }]);
    polling.stop();
  });

  it('dedupes an unchanged local position', () => {
    const { state, win } = fakeWindow();
    state.position = [0, 0];
    cursorPoint.x = 10;
    cursorPoint.y = 10;
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34 * 4);
    expect(gaze()).toEqual([{ x: 10, y: 10 }]);
    polling.stop();
  });

  it('samples immediately on unpause, even with the cursor unmoved', () => {
    const { state, win } = fakeWindow();
    cursorPoint.x = 10;
    cursorPoint.y = 10;
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34);
    expect(gaze()).toHaveLength(1);

    polling.setPaused(true);
    state.visible = false;
    vi.advanceTimersByTime(34 * 10);
    expect(gaze()).toHaveLength(1); // nothing sent while hidden

    // She comes back at a different place; unpausing must resync without waiting for a tick.
    state.visible = true;
    state.position = [40, 0];
    polling.setPaused(false);
    expect(gaze()).toEqual([{ x: 10, y: 10 }, { x: -30, y: 10 }]);
    polling.stop();
  });

  it('recheck() re-sends even when nothing changed (a fresh renderer knows nothing)', () => {
    const { win } = fakeWindow();
    cursorPoint.x = 7;
    cursorPoint.y = 7;
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34);
    polling.recheck();
    expect(gaze()).toEqual([{ x: 7, y: 7 }, { x: 7, y: 7 }]);
    polling.stop();
  });

  it('clears the interval when the window is destroyed while paused', () => {
    const { state, win } = fakeWindow();
    const polling = startCursorPolling(win, 30);
    polling.setPaused(true);
    expect(vi.getTimerCount()).toBe(1);
    state.destroyed = true;
    vi.advanceTimersByTime(34);
    expect(vi.getTimerCount()).toBe(0);
    polling.stop();
  });

  it('sends nothing while the window is not visible', () => {
    const { state, win } = fakeWindow();
    state.visible = false;
    const polling = startCursorPolling(win, 30);
    vi.advanceTimersByTime(34 * 5);
    expect(gaze()).toEqual([]);
    polling.stop();
  });
});
