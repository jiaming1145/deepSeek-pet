import { contextBridge, ipcRenderer } from 'electron';
import { BUBBLE_TO_MAIN, MAIN_TO_BUBBLE, type Channel } from '@ds/protocol';

const toMain = new Set<string>(BUBBLE_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_BUBBLE);

contextBridge.exposeInMainWorld('dsBubble', {
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
