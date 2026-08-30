import { BrowserWindow, ipcMain } from 'electron';
import { parseEvent, type Channel, type Payload } from '@ds/protocol';
import { isAllowedPetUrl } from './app-protocol';

/** The slice of `BrowserWindow` `sendToPet` needs, so the lifecycle guard is testable with a fake. */
export type SendTarget = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void };
};

/**
 * Sends a validated event to the pet renderer. Throws if the payload does not match its schema —
 * that is a main-process bug and must be loud.
 *
 * A *destroyed* target is not a bug: the cursor poll, the tray and the power monitor all fire from
 * timers and OS callbacks that can outlive the window by a tick, and `webContents` dies slightly
 * before the `BrowserWindow` does. Both are checked, and `send` itself is wrapped because it can
 * still throw in the window between `render-process-gone` and the flag flipping.
 */
export function sendToPet<C extends Channel>(win: SendTarget, channel: C, payload: Payload<C>): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  const r = parseEvent(channel, payload);
  if (!r.ok) throw new Error(`refusing to send invalid ${channel}: ${r.error}`);
  try {
    win.webContents.send(channel, r.data);
  } catch (err) {
    console.warn(`[ipc] send ${channel} failed:`, err);
  }
}

/** The identity facts an inbound IPC event carries, and the window it must have come from. */
export type SenderIdentity = { sender: unknown; senderFrame: { url: string } | null };
export type PetIdentity = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; mainFrame: unknown };
};

/**
 * Whether an inbound event really came from the pet's own top-level document.
 *
 * "The sender belongs to *some* BrowserWindow" is not an authentication check. Electron keeps the
 * preload — and therefore the whole `window.ds` surface — installed across top-level navigations,
 * and any subframe of the pet document can post on the same channels. Three facts are required:
 * the webContents is the pet's, the frame is its *main* frame (not an iframe), and that frame's
 * document sits on an origin we shipped. Navigation is denied separately in `pet-window.ts`; this
 * is the boundary that holds even if a navigation slips through.
 */
export function isFromWindow(event: SenderIdentity, win: PetIdentity): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  if (event.sender !== win.webContents) return false;
  let frameUrl: string;
  try {
    // Only the frame getters can throw (a frame disposed mid-flight); an event from a frame that
    // no longer exists is not one we can authenticate. Nothing else is caught here, so a broken
    // origin policy stays loud instead of masquerading as "untrusted sender".
    if (event.senderFrame === null || event.senderFrame !== win.webContents.mainFrame) return false;
    frameUrl = event.senderFrame.url;
  } catch {
    return false;
  }
  // The bubble, chat and key pages ship from the same origin as the pet page (app://local in a
  // build, ELECTRON_RENDERER_URL in dev), so the Phase 1 origin predicate covers all four windows.
  // Its name is left alone: renaming it would ripple into app-protocol.test.ts, which T6 does not own.
  return isAllowedPetUrl(frameUrl);
}

/** Phase 1's name, kept so its call sites and its 8 tests are untouched. One copy of the checks. */
export function isFromPet(event: SenderIdentity, pet: PetIdentity): boolean {
  return isFromWindow(event, pet);
}

/** Subscribes to a renderer→main channel; untrusted senders and malformed payloads are dropped. */
export function onFromPet<C extends Channel>(
  pet: BrowserWindow,
  channel: C,
  cb: (payload: Payload<C>, win: BrowserWindow) => void,
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    if (!isFromPet(event, pet)) {
      console.warn(`[ipc] rejected ${channel}: untrusted sender`);
      return;
    }
    const r = parseEvent(channel, raw);
    if (!r.ok) {
      console.warn(`[ipc] rejected ${channel}: ${r.error}`);
      return;
    }
    cb(r.data, pet);
  });
}

/**
 * Null-tolerant send. Same schema validation and destroyed-target guards as `sendToPet`; the null
 * arm exists because main holds the bubble/chat/key windows in nullable module state that is only
 * populated inside `app.whenReady()`.
 */
export function sendTo<C extends Channel>(win: SendTarget | null, channel: C, payload: Payload<C>): void {
  if (!win) return;
  sendToPet(win, channel, payload);
}

/**
 * §11.2: a window allow-list that can be an array or a getter evaluated at event time. Lazy
 * windows (chat, key, bubble) are destroyed and recreated, so a list captured at registration
 * would authenticate a corpse and refuse the live window. `null` entries are the `peek()` of a
 * window that does not currently exist and are dropped.
 */
export type WindowList = ReadonlyArray<BrowserWindow | null> | (() => ReadonlyArray<BrowserWindow | null>);

export function resolveWindows(list: WindowList): BrowserWindow[] {
  const arr = typeof list === 'function' ? list() : list;
  return arr.filter((w): w is BrowserWindow => w !== null);
}

/**
 * Subscribe once to a channel that several windows may legitimately use (`chat:open` comes from the
 * pet, the bubble and the key window). The event is accepted only if `isFromWindow` passes for ONE
 * of `windows` — resolved per event (§11.2 getter form); the matching window is handed to the
 * callback. Untrusted senders and malformed payloads are dropped with a warning, exactly as in
 * `onFromPet`.
 */
export function onFromAny<C extends Channel>(
  windows: WindowList,
  channel: C,
  cb: (payload: Payload<C>, from: BrowserWindow) => void,
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    const from = resolveWindows(windows).find((w) => isFromWindow(event, w));
    if (!from) {
      console.warn(`[ipc] rejected ${channel}: untrusted sender`);
      return;
    }
    const r = parseEvent(channel, raw);
    if (!r.ok) {
      console.warn(`[ipc] rejected ${channel}: ${r.error}`);
      return;
    }
    cb(r.data, from);
  });
}
