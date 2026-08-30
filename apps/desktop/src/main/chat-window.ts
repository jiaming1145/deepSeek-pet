import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { Channels } from '@ds/protocol';
import { isAllowedPetUrl, rendererUrl } from './app-protocol';
import { placeBubble } from './bubble-place';
import { sendTo } from './ipc';
// contracts.md 6.1: the numbers live in the renderer's chat-metrics.ts, which T8 owns; main
// re-exports them so the sizer and the composer cannot drift.
import {
  CHAT_BASE_H, CHAT_GAP, CHAT_HISTORY_H, CHAT_MAX_H, CHAT_MAX_ROWS, CHAT_ROW_H, CHAT_WIDTH,
} from '../renderer/shared/chat-metrics';

export { CHAT_BASE_H, CHAT_GAP, CHAT_HISTORY_H, CHAT_MAX_H, CHAT_MAX_ROWS, CHAT_ROW_H, CHAT_WIDTH };

/**
 * Light dismiss must not fire while an IME candidate window holds the focus, and only the renderer
 * knows that. `chat:composing` is the single source of truth; main caches the last value here
 * because the `blur` listener is registered inside `createChatWindow`.
 */
let composing = false;
export function setChatComposing(on: boolean): void {
  composing = on;
}
export function isChatComposing(): boolean {
  return composing;
}

export function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: CHAT_WIDTH,
    height: CHAT_BASE_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // C2
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true, // it must host the IME
    hasShadow: false, // the shadow is CSS (--shadow-popover), so the corners stay CSS-only (C3)
    resizable: false,
    show: false, // C2 — created hidden at startup so openChat() is instant (C8: <= 250 ms)
    webPreferences: {
      preload: join(__dirname, '../preload/chat.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  guardChatWebContents(win);
  void win.loadURL(rendererUrl('chat'));
  win.once('ready-to-show', () => {
    /* do NOT show here */
  });
  win.on('blur', () => {
    if (!composing) closeChat(win);
  });
  // §2.3's recovery box, main's half of it: a window that goes away never leaves the guard armed
  // for the next open. This covers the hides the renderer's own `blur` cannot see — a
  // VisibilityState-driven `closeChat`, and the `chat:close` handler's `chat.hide()`.
  win.on('hide', () => setChatComposing(false));
  return win;
}

/**
 * The identity half of `pet-window.ts`'s `guardPetWebContents`, applied to the chat window because
 * it carries a preload exposing `window.dsChat` — including the `user:text` / `history:*` invoke
 * surface. Electron keeps the preload installed across top-level navigations, so a navigated page
 * would inherit that surface; unexpected navigation and `window.open` are denied outright, with
 * `ipc.ts isFromWindow` as the second line. There is no click-through arm here: the chat window is
 * never click-through.
 */
function guardChatWebContents(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyForeign = (details: { url: string; preventDefault: () => void }): void => {
    if (isAllowedPetUrl(details.url)) return;
    console.warn('[chat] blocked navigation to', details.url);
    details.preventDefault();
  };
  wc.on('will-navigate', denyForeign);
  wc.on('will-redirect', denyForeign);
}

/**
 * One placement implementation for both surfaces (contracts.md §6.1): the composer is a popover at
 * her head with the same flip/shift discipline, the same gap and the same work-area rule as the
 * bubble, so a grown chat can no more cross a monitor edge than the bubble can (C14).
 */
function place(win: BrowserWindow, pet: BrowserWindow): void {
  const petBounds = pet.getBounds();
  const workArea = screen.getDisplayMatching(petBounds).workArea;
  const size = { width: CHAT_WIDTH, height: win.getBounds().height };
  const p = placeBubble(petBounds, size, workArea, 'top');
  win.setBounds({ x: p.x, y: p.y, width: size.width, height: size.height });
}

export function openChat(win: BrowserWindow, pet: BrowserWindow, focusComposer: boolean): void {
  if (win.isDestroyed()) return;
  place(win, pet);
  win.show();
  win.focus();
  // On the very first open the page may still be loading, and a `chat:opened` sent now would land
  // on nobody — the composer would come up unfocused exactly once per run.
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => sendTo(win, Channels.chatOpened, { focusComposer }));
  } else {
    sendTo(win, Channels.chatOpened, { focusComposer });
  }
}

export function closeChat(win: BrowserWindow): void {
  // §2.3's recovery box names both `closeChat` and the window's `hide`, and both are needed: a
  // `closeChat` on an already hidden window fires no `hide` event, and a hide driven by
  // VisibilityState never goes through `closeChat`.
  setChatComposing(false);
  if (!win.isDestroyed() && win.isVisible()) win.hide();
}

/**
 * Driven by `chat:resize` (contracts.md §2.3). Takes `pet` because a resize must re-place the
 * window against the pet's display work area — the three-argument form cannot, which is why §6.1
 * pins four.
 */
export function resizeChat(win: BrowserWindow, pet: BrowserWindow, rows: number, historyOpen: boolean): void {
  if (win.isDestroyed()) return;
  const clamped = Math.min(Math.max(Math.round(rows), 1), CHAT_MAX_ROWS);
  const height = CHAT_BASE_H + CHAT_ROW_H * (clamped - 1) + (historyOpen ? CHAT_HISTORY_H : 0);
  win.setBounds({ ...win.getBounds(), width: CHAT_WIDTH, height });
  place(win, pet);
}
