import { BrowserWindow, screen } from 'electron';

export type Rect = { x: number; y: number; width: number; height: number };

/** Everything `shouldHideForForeground` needs — every OS-dependent value supplied by the caller. */
export type ForegroundInput = {
  /** Foreground window rect in DIP, or `null` when it could not be read. */
  rect: Rect | null;
  /** `Display.bounds` of the display the foreground window sits on. */
  displayBounds: Rect;
  /** `Display.workArea` of the same display — bounds minus the taskbar, when one is reserved. */
  workArea: Rect;
  /** Win32 `IsZoomed(hwnd)`: the foreground window is *maximized*, which is not fullscreen. */
  isZoomed: boolean;
  selfHwnd: bigint;
  fgHwnd: bigint;
  shellHwnds: bigint[];
};

/** DIP slack for rounding between the physical-pixel Win32 rect and Electron's DIP bounds. */
const TOLERANCE = 2;

/**
 * Decides whether the pet should hide because a *foreign* window covers a whole display.
 *
 * Pure so the policy is testable without Windows: `startForegroundWatch` converts the
 * physical-pixel rect Win32 hands back into Electron's DIP space before calling this.
 *
 * Two things the previous equality test got wrong:
 *  - *Containment, not equality.* A borderless fullscreen window may overhang the display slightly
 *    (multi-monitor spanning, or a game that sizes to the virtual desktop). Requiring exact width
 *    and height missed those, so the pet floated over them.
 *  - *Maximized is not fullscreen.* With an auto-hidden taskbar (`workArea === bounds`) a
 *    custom-framed maximized window's rect equals the display exactly and no geometry can tell the
 *    two apart — `IsZoomed` is the only signal, so it vetoes there. When the taskbar *does* reserve
 *    space, a maximized window physically cannot cover the display, so containment already excludes
 *    it and a zoomed flag must not veto a genuine fullscreen window.
 */
export function shouldHideForForeground(input: ForegroundInput): boolean {
  const { rect, displayBounds, workArea, isZoomed, selfHwnd, fgHwnd, shellHwnds } = input;
  if (!rect || fgHwnd === 0n) return false;
  if (fgHwnd === selfHwnd || shellHwnds.includes(fgHwnd)) return false;

  const taskbarReserved = workArea.width < displayBounds.width || workArea.height < displayBounds.height;
  if (isZoomed && !taskbarReserved) return false;

  return rect.x <= displayBounds.x + TOLERANCE
    && rect.y <= displayBounds.y + TOLERANCE
    && rect.x + rect.width >= displayBounds.x + displayBounds.width - TOLERANCE
    && rect.y + rect.height >= displayBounds.y + displayBounds.height - TOLERANCE;
}

/** koffi returns `uintptr_t` as a Number while it fits in a double, and as a BigInt beyond that. */
type Handle = number | bigint;
type RectOut = { left: number; top: number; right: number; bottom: number };

export type Win32 = {
  GetForegroundWindow(): Handle;
  GetShellWindow(): Handle;
  GetDesktopWindow(): Handle;
  GetWindowRect(hwnd: Handle, out: RectOut): boolean;
  IsZoomed(hwnd: Handle): number | boolean;
};

function toHwnd(value: Handle): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

let win32: Win32 | null | undefined;
function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  try {
    // Loaded lazily through require (main is bundled to CJS and koffi is declared external in
    // electron.vite.config.ts) so a missing/incompatible native binary degrades to "never hide"
    // instead of taking the whole app down at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');
    // Namespaced so the registration can never collide with another koffi user in this process;
    // koffi.struct() throws when a type name is registered twice.
    koffi.struct('DS_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    win32 = {
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetShellWindow: user32.func('uintptr_t __stdcall GetShellWindow()'),
      GetDesktopWindow: user32.func('uintptr_t __stdcall GetDesktopWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ DS_RECT* rect)'),
      // Win32 BOOL is a 4-byte int; koffi's `bool` is one byte. user32 returns 0/1 so either
      // reads correctly, but `int` is the exact width.
      IsZoomed: user32.func('int __stdcall IsZoomed(uintptr_t hwnd)'),
    } as unknown as Win32;
  } catch (err) {
    console.warn('[foreground] koffi unavailable, fullscreen hiding disabled:', err);
    win32 = null;
  }
  return win32;
}

/**
 * Win32 rects come back in *physical* pixels because Electron's main process is per-monitor DPI
 * aware, while `Display.bounds` is in DIP. On a 150 %-scaled monitor the two differ by 1.5x, so
 * without this conversion a fullscreen window never matches its display and nothing would ever hide.
 * (Measured on a 3840x2160 @150 % display: GetWindowRect -> 3840x2160, bounds -> 2560x1440.)
 */
function toDip(rect: Rect): Rect {
  // Windows-only API; on any other platform we never get here because user32.dll fails to load.
  return typeof screen.screenToDipRect === 'function' ? screen.screenToDipRect(null, rect) : rect;
}

export type ForegroundWatch = {
  stop(): void;
  /** Polls now instead of waiting out the interval — for `resume` and `unlock-screen`. */
  recheck(): void;
  /**
   * §10.3: the coarse breakpoint (a) the proactive deferral waits for. Fires with NO argument,
   * only when the foreground hwnd differs from the previous poll's. The hwnd is compared and then
   * dropped: it is never stored beyond the comparison, logged, or traced.
   */
  onForegroundChanged(cb: () => void): () => void;
};

/**
 * Polls the foreground window and reports transitions of "should the pet be hidden".
 * A missing/failing koffi makes this a no-op that never hides her.
 *
 * `api` exists for tests only: everything below the pure policy is Win32, and the immediate-first-
 * poll behaviour is exactly what cannot be proved by launching the real thing in CI.
 */
export function startForegroundWatch(
  win: BrowserWindow,
  onChange: (hide: boolean) => void,
  options: { intervalMs?: number; api?: Win32 | null } = {},
): ForegroundWatch {
  const { intervalMs = 2000 } = options;
  const api = options.api === undefined ? loadWin32() : options.api;
  if (!api) {
    return {
      stop: () => { /* hiding disabled */ },
      recheck: () => { /* hiding disabled */ },
      onForegroundChanged: () => () => { /* hiding disabled */ },
    };
  }

  const handle = win.getNativeWindowHandle();
  // 8 bytes on x64/arm64, 4 on ia32.
  const selfHwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  let lastHide = false;
  /** The previous poll's hwnd, kept ONLY to detect a change; nothing reads it but the comparison. */
  let lastFgHwnd: bigint | null = null;
  const fgSubs = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  // Cleared by `stop()` — whether that came from shutdown, a destroyed window or a failed poll.
  // Nothing re-arms afterwards, so a hard failure cannot come back as a 0.5 Hz error stream.
  let armed = true;
  const stop = (): void => {
    armed = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  /**
   * One poll. Run immediately at start (and on resume/unlock) rather than only after `intervalMs`:
   * otherwise every transition is stale for up to 2 s — the pet floats over a game for two seconds
   * after it goes fullscreen, and a stale `fullscreen: true` keeps her hidden for two seconds after
   * the machine wakes.
   */
  const pollOnce = (): void => {
    if (win.isDestroyed()) {
      // The window is gone; an armed interval holding a dead BrowserWindow forever is a leak.
      stop();
      return;
    }
    // FIX ROUND 1, finding 2: the foreground CHANGE is computed inside the try but fanned out
    // after it. The catch below is written for a native-call failure — it logs 'poll failed,
    // fullscreen hiding disabled' and calls `stop()`, which nothing re-arms — so a throwing
    // `onForegroundChanged` listener (Task 14's proactive breakpoint (a)) inside the try would
    // permanently kill an unrelated Phase 1 feature and blame Win32 for it.
    let fgChanged = false;
    try {
      const fgHwnd = toHwnd(api.GetForegroundWindow());
      fgChanged = lastFgHwnd !== null && fgHwnd !== lastFgHwnd;
      lastFgHwnd = fgHwnd;
      const out: RectOut = { left: 0, top: 0, right: 0, bottom: 0 };
      const ok = fgHwnd !== 0n && api.GetWindowRect(fgHwnd, out);
      const rect: Rect | null = ok
        ? toDip({ x: out.left, y: out.top, width: out.right - out.left, height: out.bottom - out.top })
        : null;
      const display = rect ? screen.getDisplayMatching(rect) : screen.getPrimaryDisplay();
      // Re-read rather than cache: Progman's handle changes when Explorer restarts, and a stale one
      // would make a click on the desktop (whose window does cover the display) look like fullscreen.
      const shellHwnds = [toHwnd(api.GetShellWindow()), toHwnd(api.GetDesktopWindow())];
      const hide = shouldHideForForeground({
        rect,
        displayBounds: display.bounds,
        workArea: display.workArea,
        isZoomed: ok ? Number(api.IsZoomed(fgHwnd)) !== 0 : false,
        selfHwnd,
        fgHwnd,
        shellHwnds,
      });
      if (hide !== lastHide) {
        lastHide = hide;
        onChange(hide);
      }
    } catch (err) {
      // One bad poll must not turn into a 0.5 Hz error stream, and it must not leave her hidden.
      console.warn('[foreground] poll failed, fullscreen hiding disabled:', err);
      stop();
      if (lastHide) {
        lastHide = false;
        onChange(false);
      }
    }
    // A pure notification, outside the Win32 catch, each listener isolated from the others.
    if (fgChanged) {
      for (const cb of fgSubs) {
        try { cb(); } catch (err) { console.warn('[foreground] onForegroundChanged listener threw:', err); }
      }
    }
  };

  pollOnce();
  // A poll that failed hard (or a window already gone) called stop(); do not arm the interval.
  if (armed) timer = setInterval(pollOnce, intervalMs);
  return {
    stop,
    recheck: () => { if (armed) pollOnce(); },
    onForegroundChanged: (cb) => {
      fgSubs.add(cb);
      return () => { fgSubs.delete(cb); };
    },
  };
}
