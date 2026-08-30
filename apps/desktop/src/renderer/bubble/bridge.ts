import type { Channel, Payload } from '@ds/protocol';

/**
 * The bubble window's preload bridge (contracts.md §2.6). Undefined in browser/Playwright mode,
 * where the page runs standalone. `BUBBLE_INVOKE` is empty, so there is deliberately no `invoke`.
 */
export interface DsBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
}

declare global {
  interface Window {
    dsBubble?: DsBridge;
  }
}

export const bridge: DsBridge | undefined = window.dsBubble;
