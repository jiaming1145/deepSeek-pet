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
