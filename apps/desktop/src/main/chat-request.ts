import type { VisibilityFlag } from './visibility-state';

/** Who asked for the chat — `chat:open`'s `source` plus main's own three entry points. */
export type ChatRequestSource = 'pet' | 'bubble' | 'tray' | 'hotkey' | 'key' | 'second-instance';

/**
 * I-7: what to do with a chat request given the shell's current visibility.
 *
 * - `open`: she is on screen; open the composer.
 * - `reveal`: she is hidden ONLY because the user hid her (tray toggle). Asking for the chat is
 *   the user changing their mind, exactly as a second launch is (`second-instance`): clear the
 *   flag, apply the verdict, THEN open — otherwise the reply streams into a hidden pet and a
 *   hidden bubble and the composer shows nothing but state.
 * - `refuse`: a lock screen, a suspend or a fullscreen app is live (with or without the user
 *   flag). Nothing the user types should pop a focusable window over a game or a lock screen,
 *   and the bubble would stay hidden anyway (§5.4 rule 5), so the request is dropped with one
 *   log line. The flags are read individually because `VisibilityVerdict.reason` reports `user`
 *   first whenever it is set, which would hide a live `locked` behind it.
 */
export type ChatRequestDecision = 'open' | 'reveal' | 'refuse';

const SYSTEM_FLAGS: readonly VisibilityFlag[] = ['locked', 'suspended', 'fullscreen'];

export function decideChatRequest(vis: { hidden: boolean; get(flag: VisibilityFlag): boolean }): ChatRequestDecision {
  if (!vis.hidden) return 'open';
  return SYSTEM_FLAGS.some((flag) => vis.get(flag)) ? 'refuse' : 'reveal';
}

export type ChatRequestFn = (source: ChatRequestSource, focusComposer: boolean) => void;

export type LateBoundChatRequest = {
  /** Forwarded once wired; before that, held as the ONE pending request (latest wins). */
  request: ChatRequestFn;
  /** Wire the real `requestChat`; a held request is replayed exactly once. */
  bind(fn: ChatRequestFn): void;
  readonly pending: { source: ChatRequestSource; focusComposer: boolean } | null;
};

/**
 * GC2-2: `second-instance` is registered at module scope and can fire before `whenReady` has
 * built the windows and `requestChat`. Rather than a second opener (the single-opener rule, A-31)
 * the event is routed through this late-bound delegate: before wiring one request is remembered,
 * after wiring every request goes straight to `requestChat`. `pending` is cleared BEFORE the
 * replay so a request issued from inside it is forwarded, not re-queued.
 */
export function createLateBoundChatRequest(log?: (line: string) => void): LateBoundChatRequest {
  const out = log ?? ((line: string) => console.log(line));
  let target: ChatRequestFn | null = null;
  let pending: { source: ChatRequestSource; focusComposer: boolean } | null = null;
  return {
    request(source, focusComposer) {
      if (target) {
        target(source, focusComposer);
        return;
      }
      pending = { source, focusComposer };
      out(`[chat] request source=${source} held: main is not wired yet; replayed once it is`);
    },
    bind(fn) {
      target = fn;
      if (pending === null) return;
      const { source, focusComposer } = pending;
      pending = null;
      fn(source, focusComposer);
    },
    get pending() {
      return pending;
    },
  };
}
