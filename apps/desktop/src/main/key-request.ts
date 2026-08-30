import type { KeyWindowReason } from './key-window';
import type { VisibilityFlag } from './visibility-state';

/**
 * CX-3: the key window is the app's only other focusable window, and `reportError` used to
 * `show()+focus()` it straight from an auth failure — over a lock screen, a suspend or a
 * fullscreen game. Every show of it now goes through here, the same visibility-aware gate the chat
 * request uses (`chat-request.ts`), with one difference: a refused key prompt is not dropped but
 * QUEUED, and shown the moment the verdict clears. Dropping it would leave the user with a dead key
 * and no door; the chat's refusal is fine because the user will simply ask again.
 *
 * `user`-only hidden (the tray toggle) opens at once WITHOUT revealing her: the key window is a
 * settings dialog, not the pet, and the tray item that asks for it is the user's own gesture.
 */
export type KeyRequestDecision = 'open' | 'queue';

const SYSTEM_FLAGS: readonly VisibilityFlag[] = ['locked', 'suspended', 'fullscreen'];

export function decideKeyRequest(vis: { hidden: boolean; get(flag: VisibilityFlag): boolean }): KeyRequestDecision {
  if (!vis.hidden) return 'open';
  return SYSTEM_FLAGS.some((flag) => vis.get(flag)) ? 'queue' : 'open';
}

export type KeyRequest = {
  /** Show now, or queue until the verdict clears. The latest queued reason wins. */
  request(reason: KeyWindowReason): void;
  /**
   * Called on every verdict `VisibilityState` applies. GC3-1: the flush decision is
   * `decideKeyRequest` over the INDIVIDUAL flags, never the aggregate verdict — a queued prompt
   * must open once the last system flag clears even while the user flag stays set.
   */
  onVerdict(): void;
  readonly pending: KeyWindowReason | null;
};

export function createKeyRequest(deps: {
  visibility: { hidden(): boolean; get(flag: VisibilityFlag): boolean };
  show(reason: KeyWindowReason): void;
  log?: (line: string) => void;
}): KeyRequest {
  const log = deps.log ?? ((line: string) => console.log(line));
  let pending: KeyWindowReason | null = null;
  return {
    request(reason) {
      const decision = decideKeyRequest({ hidden: deps.visibility.hidden(), get: deps.visibility.get });
      if (decision === 'open') {
        pending = null;
        deps.show(reason);
        return;
      }
      pending = reason;
      log(`[key] queued reason=${reason}: shell hidden by the system; shown when the verdict clears`);
    },
    onVerdict() {
      if (pending === null) return;
      if (decideKeyRequest({ hidden: deps.visibility.hidden(), get: deps.visibility.get }) !== 'open') return;
      // Cleared BEFORE show: a verdict re-entered from inside show() finds nothing queued.
      const reason = pending;
      pending = null;
      deps.show(reason);
    },
    get pending(): KeyWindowReason | null {
      return pending;
    },
  };
}
