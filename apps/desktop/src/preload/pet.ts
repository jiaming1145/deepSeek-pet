import { contextBridge, ipcRenderer } from 'electron';
import { MAIN_TO_RENDERER, RENDERER_TO_MAIN, type Channel } from '@ds/protocol';

const toMain = new Set<string>(RENDERER_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_RENDERER);

contextBridge.exposeInMainWorld('ds', {
  send(channel: Channel, payload: unknown) {
    if (!toMain.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on(channel: Channel, cb: (payload: unknown) => void) {
    if (!toRenderer.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
