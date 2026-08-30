import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  parseInvokeRequest, parseInvokeResponse,
  type InvokeChannel, type InvokeReq, type InvokeRes,
} from '@ds/protocol';
import { isFromWindow, resolveWindows, type WindowList } from './ipc';

/**
 * `ipcMain.handle` with the sender authenticated and both halves validated: an untrusted sender
 * never reaches the handler, a malformed request never reaches the handler, and a malformed
 * response never reaches the renderer (which would otherwise fail its own parse somewhere with no
 * context). `windows` is the allow-list from contracts.md §2.7 — `[chat]` or `[key]` — or, for a
 * lazy window, a getter such as `() => [chatWin.peek()]` resolved on every call (Phase 3 §11.2).
 */
export function handleInvoke<C extends InvokeChannel>(
  channel: C,
  windows: WindowList,
  cb: (payload: InvokeReq<C>, event: IpcMainInvokeEvent, from: BrowserWindow) => Promise<InvokeRes<C>> | InvokeRes<C>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const from = resolveWindows(windows).find((w) => isFromWindow(event, w));
    if (!from) throw new Error(`[ipc] rejected ${channel}: untrusted sender`);
    const req = parseInvokeRequest(channel, raw);
    if (!req.ok) throw new Error(`[ipc] rejected ${channel}: ${req.error}`);
    const out = await cb(req.data, event, from);
    const res = parseInvokeResponse(channel, out);
    if (!res.ok) throw new Error(`[ipc] refusing to return invalid ${channel}: ${res.error}`);
    return res.data;
  });
}
