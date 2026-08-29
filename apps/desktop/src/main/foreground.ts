import { BrowserWindow, screen } from 'electron';

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Decides whether the pet should hide because a *foreign* window covers a whole display.
 *
 * Pure so the policy is testable without Windows: every OS-dependent value (the foreground rect,
 * the display it sits on, and the three window handles) is supplied by the caller. All rects must
 * already be in the same coordinate space — `startForegroundWatch` converts the physical-pixel rect
 * Win32 hands back into Electron's DIP space before calling this.
 *
 * The tolerance is deliberately tight: a real fullscreen window matches the display bounds exactly,
 * while a *maximized* window overhangs by the invisible resize border (±8 px at 100% scaling) and
 * stops short of the taskbar, so it stays outside the ±1/±2 window and does not hide her.
 */
export function shouldHideForForeground(fg: Rect | null, display: Rect, selfHwnd: bigint, fgHwnd: bigint, shellHwnds: bigint[]): boolean {
  if (!fg || fgHwnd === 0n) return false;
  if (fgHwnd === selfHwnd || shellHwnds.includes(fgHwnd)) return false;
  const covers = Math.abs(fg.x - display.x) <= 1 && Math.abs(fg.y - display.y) <= 1
    && Math.abs(fg.width - display.width) <= 2 && Math.abs(fg.height - display.height) <= 2;
  return covers;
}

/** koffi returns `uintptr_t` as a Number while it fits in a double, and as a BigInt beyond that. */
type Handle = number | bigint;
type RectOut = { left: number; top: number; right: number; bottom: number };

type Win32 = {
  GetForegroundWindow(): Handle;
  GetShellWindow(): Handle;
  GetDesktopWindow(): Handle;
  GetWindowRect(hwnd: Handle, out: RectOut): boolean;
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

/**
 * Polls the foreground window and reports transitions of "should the pet be hidden".
 * Returns a stop function; a missing/failing koffi makes this a no-op that never hides her.
 */
export function startForegroundWatch(win: BrowserWindow, onChange: (hide: boolean) => void, intervalMs = 2000): () => void {
  const api = loadWin32();
  if (!api) return () => { /* hiding disabled */ };

  const handle = win.getNativeWindowHandle();
  // 8 bytes on x64/arm64, 4 on ia32.
  const selfHwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  let lastHide = false;
  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      // The window is gone; an armed interval holding a dead BrowserWindow forever is a leak.
      clearInterval(timer);
      return;
    }
    try {
      const fgHwnd = toHwnd(api.GetForegroundWindow());
      const out: RectOut = { left: 0, top: 0, right: 0, bottom: 0 };
      const ok = fgHwnd !== 0n && api.GetWindowRect(fgHwnd, out);
      const fg: Rect | null = ok
        ? toDip({ x: out.left, y: out.top, width: out.right - out.left, height: out.bottom - out.top })
        : null;
      const display = fg ? screen.getDisplayMatching(fg).bounds : screen.getPrimaryDisplay().bounds;
      // Re-read rather than cache: Progman's handle changes when Explorer restarts, and a stale one
      // would make a click on the desktop (whose window does cover the display) look like fullscreen.
      const shellHwnds = [toHwnd(api.GetShellWindow()), toHwnd(api.GetDesktopWindow())];
      const hide = shouldHideForForeground(fg, display, selfHwnd, fgHwnd, shellHwnds);
      if (hide !== lastHide) {
        lastHide = hide;
        onChange(hide);
      }
    } catch (err) {
      // One bad poll must not turn into a 0.5 Hz error stream, and it must not leave her hidden.
      console.warn('[foreground] poll failed, fullscreen hiding disabled:', err);
      clearInterval(timer);
      if (lastHide) {
        lastHide = false;
        onChange(false);
      }
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
