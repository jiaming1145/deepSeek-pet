import type { Channel, InvokeChannel, InvokeReq, InvokeRes, Payload } from '@ds/protocol';

/** The key window's preload surface (contracts.md 2.6). */
export interface DsKeyBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeReq<C>): Promise<InvokeRes<C>>;
}

declare global {
  interface Window {
    dsKey?: DsKeyBridge;
  }
}

export const noopKeyBridge: DsKeyBridge = {
  send() {},
  on() {
    return () => {};
  },
  invoke() {
    return Promise.reject(new Error('key bridge unavailable'));
  },
};

export const bridge: DsKeyBridge = window.dsKey ?? noopKeyBridge;
