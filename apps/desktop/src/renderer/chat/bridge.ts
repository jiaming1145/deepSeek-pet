import type { Channel, InvokeChannel, InvokeReq, InvokeRes, Payload } from '@ds/protocol';

/** The chat window's preload surface (contracts.md 2.6). */
export interface DsInvokeBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeReq<C>): Promise<InvokeRes<C>>;
}

declare global {
  interface Window {
    dsChat?: DsInvokeBridge;
  }
}

/** Browser and Playwright mode: no preload, but the page must still render. */
export const noopBridge: DsInvokeBridge = {
  send() {},
  on() {
    return () => {};
  },
  invoke() {
    return Promise.reject(new Error('chat bridge unavailable'));
  },
};

export const bridge: DsInvokeBridge = window.dsChat ?? noopBridge;
