import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect, Win32 } from './foreground';

const display = { x: 0, y: 0, width: 1920, height: 1080 };
/** A 40 px taskbar is reserved at the bottom — the ordinary desktop. */
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

const displayMatching = vi.fn<() => { bounds: Rect; workArea: Rect }>();

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getDisplayMatching: () => displayMatching(),
    getPrimaryDisplay: () => displayMatching(),
  },
}));

// Dynamic so the mock factory above can close over `displayMatching`, which vitest's hoisting of
// `vi.mock` would otherwise put in the temporal dead zone.
const { shouldHideForForeground, startForegroundWatch } = await import('./foreground');

const base = {
  displayBounds: display,
  workArea,
  isZoomed: false,
  selfHwnd: 1n,
  fgHwnd: 2n,
  shellHwnds: [] as bigint[],
};

describe('shouldHideForForeground', () => {
  it('hides for an exactly-fullscreen foreign window', () => {
    expect(shouldHideForForeground({ ...base, rect: display })).toBe(true);
  });

  it('does not hide for our own window', () => {
    expect(shouldHideForForeground({ ...base, rect: display, selfHwnd: 2n })).toBe(false);
  });

  it('does not hide for the shell/desktop window', () => {
    expect(shouldHideForForeground({ ...base, rect: display, fgHwnd: 3n, shellHwnds: [3n] })).toBe(false);
  });

  it('does not hide when nothing is foreground', () => {
    expect(shouldHideForForeground({ ...base, rect: null, fgHwnd: 0n })).toBe(false);
  });

  it('does not hide for an auto-hide-taskbar maximized window (zoomed, rect == display)', () => {
    // workArea === bounds, so geometry alone cannot tell this from fullscreen; IsZoomed vetoes.
    expect(shouldHideForForeground({ ...base, rect: display, workArea: display, isZoomed: true })).toBe(false);
  });

  it('does not hide for an ordinary maximized window (borders out, taskbar respected)', () => {
    expect(shouldHideForForeground({
      ...base,
      rect: { x: -8, y: -8, width: 1936, height: 1048 },
      isZoomed: true,
    })).toBe(false);
  });

  it('hides for a spanning window that contains the display', () => {
    // Borderless fullscreen sized to the virtual desktop: strictly larger than this display, so the
    // old equal-width/equal-height test missed it.
    expect(shouldHideForForeground({ ...base, rect: { x: -1920, y: 0, width: 3840, height: 1080 } })).toBe(true);
  });

  it('hides within the 2 DIP rounding tolerance', () => {
    expect(shouldHideForForeground({ ...base, rect: { x: 1, y: 1, width: 1918, height: 1078 } })).toBe(true);
  });

  it('does not hide for a near-miss window 3 px short of the display', () => {
    expect(shouldHideForForeground({ ...base, rect: { x: 0, y: 0, width: 1917, height: 1077 } })).toBe(false);
  });
});

describe('startForegroundWatch', () => {
  type RectOut = { left: number; top: number; right: number; bottom: number };
  const fullscreenRect: RectOut = { left: 0, top: 0, right: 1920, bottom: 1080 };

  function fakeWin32(overrides: Partial<Win32> = {}): Win32 {
    return {
      GetForegroundWindow: () => 2,
      GetShellWindow: () => 9,
      GetDesktopWindow: () => 10,
      GetWindowRect: (_hwnd: number | bigint, out: RectOut) => {
        Object.assign(out, fullscreenRect);
        return true;
      },
      IsZoomed: () => false,
      ...overrides,
    };
  }

  /** Only `isDestroyed` and `getNativeWindowHandle` are ever touched by the watcher. */
  const fakeWindow = (destroyed = false): never => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(1n);
    return { isDestroyed: () => destroyed, getNativeWindowHandle: () => handle } as never;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    displayMatching.mockReset();
    displayMatching.mockReturnValue({ bounds: display, workArea });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls once immediately, before the interval elapses', () => {
    const onChange = vi.fn();
    const watch = startForegroundWatch(fakeWindow(), onChange, { intervalMs: 2000, api: fakeWin32() });
    // No timer has fired yet — the transition is already reported.
    expect(onChange.mock.calls).toEqual([[true]]);
    watch.stop();
  });

  it('recheck() reports a transition without waiting out the interval', () => {
    const onChange = vi.fn();
    let zoomed = false;
    const watch = startForegroundWatch(fakeWindow(), onChange, {
      intervalMs: 2000,
      api: fakeWin32({ IsZoomed: () => zoomed }),
    });
    expect(onChange.mock.calls).toEqual([[true]]);

    // The window turns out to be maximized with the taskbar auto-hidden.
    displayMatching.mockReturnValue({ bounds: display, workArea: display });
    zoomed = true;
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls).toEqual([[true]]); // the interval has not come round yet
    watch.recheck();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    watch.stop();
  });

  it('keeps polling on the interval after the first sample', () => {
    const onChange = vi.fn();
    let rectValid = true;
    const watch = startForegroundWatch(fakeWindow(), onChange, {
      intervalMs: 2000,
      api: fakeWin32({
        GetWindowRect: (_hwnd: number | bigint, out: RectOut) => {
          Object.assign(out, fullscreenRect);
          return rectValid;
        },
      }),
    });
    expect(onChange.mock.calls).toEqual([[true]]);
    rectValid = false; // GetWindowRect starts failing → no rect → she comes back
    vi.advanceTimersByTime(2000);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    watch.stop();
  });

  it('arms no interval when the window is already destroyed', () => {
    const onChange = vi.fn();
    startForegroundWatch(fakeWindow(true), onChange, { intervalMs: 2000, api: fakeWin32() });
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is an inert no-op when the Win32 bindings are unavailable', () => {
    const onChange = vi.fn();
    const watch = startForegroundWatch(fakeWindow(), onChange, { api: null });
    watch.recheck();
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    watch.stop();
  });
});
