/**
 * The independent reasons the pet window can be off screen. Real Windows lock+sleep is
 * `lock-screen` -> `suspend` -> `resume` -> (lock screen still showing) -> `unlock-screen`, so
 * `locked` and `suspended` must be tracked separately: `resume` alone must not reveal a still-locked
 * screen. `fullscreen` and `user` are the other two independent reasons (a foreign window covers a
 * display; the tray "显示/隐藏" toggle).
 */
export type VisibilityFlag = 'fullscreen' | 'locked' | 'suspended' | 'user';

/** Matches the `shell:visibility` schema in packages/protocol/src/index.ts — do not add values here. */
export type VisibilityReason = 'fullscreen' | 'locked' | 'suspended' | 'user' | 'none';

const FLAGS: readonly VisibilityFlag[] = ['fullscreen', 'locked', 'suspended', 'user'];

/**
 * Pure state holder: OR-s the four flags into `hidden`, and derives a single `reason` from them
 * with fixed precedence `user` > `locked` > `suspended` > `fullscreen` > `none` so the reported
 * reason is never wrong when two flags are live at once (e.g. fullscreen clearing while locked, or
 * unlocking while still fullscreen).
 */
export class VisibilityState {
  private readonly flags: Record<VisibilityFlag, boolean> = {
    fullscreen: false,
    locked: false,
    suspended: false,
    user: false,
  };

  set(flag: VisibilityFlag, value: boolean): void {
    this.flags[flag] = value;
  }

  get(flag: VisibilityFlag): boolean {
    return this.flags[flag];
  }

  get hidden(): boolean {
    return FLAGS.some((flag) => this.flags[flag]);
  }

  get reason(): VisibilityReason {
    if (this.flags.user) return 'user';
    if (this.flags.locked) return 'locked';
    if (this.flags.suspended) return 'suspended';
    if (this.flags.fullscreen) return 'fullscreen';
    return 'none';
  }

  /** One-line snapshot of every flag, for the `[shell]` diagnostic log. */
  describe(): string {
    return FLAGS.map((flag) => `${flag}=${this.flags[flag]}`).join(' ');
  }
}

/** What `shell:visibility` carries — the pair the renderer needs to stop or restart its loop. */
export type VisibilityVerdict = { hidden: boolean; reason: VisibilityReason };

/**
 * The slice of `BrowserWindow` the reconciler touches. Narrow on purpose: the reconciliation is the
 * one place that decides whether the pet is on screen, so it has to be provable with a fake window
 * rather than only observable by launching Electron.
 */
export type VisibilityWindow = {
  isDestroyed(): boolean;
  hide(): void;
  showInactive(): void;
};

export type VisibilityDeps = {
  /** Late-bound: the controller exists before the window does, and outlives a destroyed one. */
  window: () => VisibilityWindow | null;
  send: (verdict: VisibilityVerdict) => void;
  setCursorPaused?: (paused: boolean) => void;
  /** Forces the native click-through state; called with `true` on every hide. */
  setClickThrough?: (ignore: boolean) => void;
  /** Re-samples the cursor after a show so the renderer recomputes the real hit. */
  recheckCursor?: () => void;
  log?: (line: string) => void;
};

export type VisibilityController = {
  set(flag: VisibilityFlag, value: boolean): void;
  get(flag: VisibilityFlag): boolean;
  readonly verdict: VisibilityVerdict;
  /** Drives the window, the cursor poll and the renderer to the current verdict. */
  apply(): void;
  /** Re-sends the current verdict without touching the window (renderer-side resync). */
  resend(): void;
};

/**
 * The single owner of whether the pet is on screen.
 *
 * Every path that can hide or show her — the tray toggle, the power monitor, the foreground watch,
 * and the window's own first paint — goes through `apply()`, so no path can show her while another
 * reason to be hidden is still live. `ready-to-show` in particular must *not* call `showInactive()`
 * itself: a hide that lands during the ~1 s of renderer startup would be silently undone.
 *
 * `apply()` sends `shell:visibility` on every invocation, not only on a change, because the
 * renderer installs its listener late (after the Live2D model loads) and needs the latest verdict
 * whenever it asks for it — see `resend()`, which the `stage:ready` handler calls.
 */
export function createVisibilityController(deps: VisibilityDeps): VisibilityController {
  const state = new VisibilityState();
  const verdict = (): VisibilityVerdict => ({ hidden: state.hidden, reason: state.reason });
  return {
    set: (flag, value) => state.set(flag, value),
    get: (flag) => state.get(flag),
    get verdict(): VisibilityVerdict {
      return verdict();
    },
    apply(): void {
      const win = deps.window();
      if (!win || win.isDestroyed()) return;
      const v = verdict();
      (deps.log ?? console.log)(`[shell] ${v.hidden ? 'hide' : 'show'} reason=${v.reason} ${state.describe()}`);
      // showInactive, never show: reappearing must not steal focus from the app the user is in.
      if (v.hidden) {
        // The renderer's leave event may never arrive once the window is gone; a window hidden
        // while interactive would otherwise come back with transparent pixels eating clicks.
        deps.setClickThrough?.(true);
        win.hide();
      } else {
        win.showInactive();
      }
      deps.setCursorPaused?.(v.hidden);
      deps.send(v);
      // After a show the renderer has reset its hover cache (on shell:visibility) and needs one
      // fresh sample to re-emit the true hit — the cursor may still be sitting on her.
      if (!v.hidden) deps.recheckCursor?.();
    },
    resend(): void {
      deps.send(verdict());
    },
  };
}
