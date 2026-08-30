import type { VisibilityFlag } from './visibility-state';

/** Who asked for the chat — `chat:open`'s `source` plus main's own two entry points. */
export type ChatRequestSource = 'pet' | 'bubble' | 'tray' | 'hotkey' | 'key';

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
