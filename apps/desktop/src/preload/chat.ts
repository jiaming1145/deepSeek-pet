import { contextBridge, ipcRenderer } from 'electron';
import { CHAT_INVOKE, CHAT_TO_MAIN, MAIN_TO_CHAT, type Channel, type InvokeChannel } from '@ds/protocol';

const toMain = new Set<string>(CHAT_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_CHAT);
const canInvoke = new Set<string>(CHAT_INVOKE);

contextBridge.exposeInMainWorld('dsChat', {
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
  invoke(channel: InvokeChannel, payload: unknown) {
    if (!canInvoke.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },
});
