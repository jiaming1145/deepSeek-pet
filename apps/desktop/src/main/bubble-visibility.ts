/**
 * The bubble window's visibility reconciler, lifted out of index.ts (G2-5) so the two edges can be
 * unit-tested: (brain wants it) AND (shell allows it) decides whether the window is up, and both
 * arms carry a side effect the renderer cannot produce on its own.
 *
 *  - EVERY hide calls `onHidden`, even when the window was already hidden. `BrainService.bubbleHidden`
 *    forces click-through and drops the hover pin; gating it on "was visible" (M-8's first cut)
 *    left a `bubbleWanted` replay showing a transparent window that still ate clicks, because the
 *    verdict-driven hide had landed while the window was down and the pin survived.
 *  - The hidden→visible edge calls `onShown`: the renderer's hover state is stale after a hide
 *    (no pointerleave ever arrived), so main resends the shell verdict as its resync and the page
 *    recomputes its DOM hit and re-emits `bubble:hover`.
 *
 * `showInactive`, never `show` (§5.4 rule 6); a `true` while the shell hides her is a no-op rather
 * than a show — nothing she has to say outranks a locked screen or a fullscreen game.
 */
export type BubbleSurface = {
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
  hide(): void;
};

export type BubbleVisibilityDeps = {
  /** Late-bound: the window is created inside `app.whenReady()` and may be recreated (CX-6). */
  window: () => BubbleSurface | null;
  shellHidden: () => boolean;
  onHidden: () => void;
  onShown: () => void;
};

export type BubbleVisibility = {
  /** `BrainService`'s `setBubbleVisible`: remembers the wish and reconciles. */
  set(on: boolean): void;
  /** Idempotent: re-derives the window state from the wish and the shell verdict. */
  apply(): void;
  readonly wanted: boolean;
};

export function createBubbleVisibility(deps: BubbleVisibilityDeps): BubbleVisibility {
  let wanted = false;
  const apply = (): void => {
    const win = deps.window();
    if (!win || win.isDestroyed()) return;
    if (wanted && !deps.shellHidden()) {
      if (win.isVisible()) return;
      win.showInactive();
      deps.onShown();
      return;
    }
    if (win.isVisible()) win.hide();
    deps.onHidden();
  };
  return {
    set(on) {
      wanted = on;
      apply();
    },
    apply,
    get wanted(): boolean {
      return wanted;
    },
  };
}
