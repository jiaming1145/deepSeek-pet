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
export function isFromPet(event: SenderIdentity, pet: PetIdentity): boolean {
  try {
    if (pet.isDestroyed() || pet.webContents.isDestroyed()) return false;
    if (event.sender !== pet.webContents) return false;
    if (event.senderFrame === null || event.senderFrame !== pet.webContents.mainFrame) return false;
    return isAllowedPetUrl(event.senderFrame.url);
  } catch {
    // `mainFrame` and `senderFrame.url` throw on a frame disposed mid-flight; an event from a
    // frame that no longer exists is not one we can authenticate.
    return false;
  }
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
