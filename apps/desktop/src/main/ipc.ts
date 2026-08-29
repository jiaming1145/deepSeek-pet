import { BrowserWindow, ipcMain } from 'electron';
import { parseEvent, type Channel, type Payload } from '@ds/protocol';

/** Sends a validated event to the pet renderer. Throws if the payload does not match its schema. */
export function sendToPet<C extends Channel>(win: BrowserWindow, channel: C, payload: Payload<C>): void {
  if (win.isDestroyed()) return;
  const r = parseEvent(channel, payload);
  if (!r.ok) throw new Error(`refusing to send invalid ${channel}: ${r.error}`);
  win.webContents.send(channel, r.data);
}

/** Subscribes to a renderer→main channel; malformed payloads are dropped with a warning. */
export function onFromPet<C extends Channel>(
  channel: C,
  cb: (payload: Payload<C>, win: BrowserWindow) => void,
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    const r = parseEvent(channel, raw);
    if (!r.ok) {
      console.warn(`[ipc] rejected ${channel}: ${r.error}`);
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) cb(r.data, win);
  });
}
