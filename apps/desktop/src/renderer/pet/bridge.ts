import type { Channel, Payload } from '@ds/protocol';

/** The preload bridge (Task 7). Undefined in browser mode, where the page runs standalone. */
export interface DsBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
}

declare global {
  interface Window {
    ds?: DsBridge;
  }
}

export const bridge: DsBridge | undefined = window.ds;
