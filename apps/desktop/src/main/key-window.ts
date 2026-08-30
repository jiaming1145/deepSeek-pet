import type { BrowserWindow } from 'electron';
import { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { join } from 'node:path';
import type { ErrorCode } from '@ds/protocol';
import { isAllowedPetUrl, rendererUrl } from './app-protocol';

export const KEY_SIZE = { width: 440, height: 360 };

/** 'user' covers the tray item, which is neither a first run nor an error. */
export type KeyWindowReason = 'first-run' | 'user' | ErrorCode;

/**
 * Released on `before-quit`. Until then every close is converted to a hide, so the eagerly created
 * windows survive the key renderer's own `window.close()` and a stray Alt+F4 on the focusable chat
 * window. KEY_TO_MAIN carries only `chat:open`, so "Esc closes" and "on success the window closes"
 * need no channel of their own (contracts.md §6.1).
 */
let quitting = false;
export function markQuitting(): void {
  quitting = true;
}

export function holdWindowOpen(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || win.isDestroyed()) return;
    e.preventDefault();
    win.hide();
  });
}

export function createKeyWindow(): BrowserWindow {
  const win = new ElectronBrowserWindow({
    width: KEY_SIZE.width,
    height: KEY_SIZE.height,
    backgroundColor: '#00000000', // C2
    backgroundMaterial: 'mica', // C4; silently ignored where unsupported
    show: false, // C2 + ready-to-show; opened by openKeyWindow()
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '小春 · API Key',
    webPreferences: {
      preload: join(__dirname, '../preload/key.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  guardKeyWebContents(win);
  void win.loadURL(rendererUrl('key'));
  win.once('ready-to-show', () => {
    /* do NOT show here */
  });
  return win;
}

/**
 * The identity half of `pet-window.ts`'s `guardPetWebContents`, applied to the key window because
 * it carries a preload exposing `window.dsKey` — the `key:set` / `key:test` / `key:clear` invoke
 * surface, the most sensitive one in the app. Electron keeps the preload installed across
 * top-level navigations, so a navigated page would inherit it; unexpected navigation and
 * `window.open` are denied outright, with `ipc.ts isFromWindow` as the second line.
 */
function guardKeyWebContents(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyForeign = (details: { url: string; preventDefault: () => void }): void => {
    if (isAllowedPetUrl(details.url)) return;
    console.warn('[key] blocked navigation to', details.url);
    details.preventDefault();
  };
  wc.on('will-navigate', denyForeign);
  wc.on('will-redirect', denyForeign);
}

export function openKeyWindow(win: BrowserWindow, reason: KeyWindowReason): void {
  if (win.isDestroyed()) return;
  console.log('[key] open reason=%s', reason);
  win.show();
  win.focus();
}
