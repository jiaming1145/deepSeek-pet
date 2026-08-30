import { contextBridge, ipcRenderer } from 'electron';
import { KEY_INVOKE, KEY_TO_MAIN, MAIN_TO_KEY, type Channel, type InvokeChannel } from '@ds/protocol';

const toMain = new Set<string>(KEY_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_KEY);
const canInvoke = new Set<string>(KEY_INVOKE);

contextBridge.exposeInMainWorld('dsKey', {
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
