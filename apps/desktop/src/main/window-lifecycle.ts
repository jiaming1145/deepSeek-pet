import type { BrowserWindow } from 'electron';
import { Channels } from '@ds/protocol';

// §11.2 — declared HERE only; §11.3's rule references them, never re-declares them.
export const BUBBLE_IDLE_GRACE_MS = 60_000;      // R3-14: "grace default 60 s"
export const RECREATE_BUDGET_MS = 400;           // R3-14: "recreation <= 400 ms"
export const FIRST_MESSAGE_BUDGET_MS = 3_000;    // R3-14: "visible <= 3000 ms from launch"
// §11.3
export const HIDDEN_PLAYBACK_RETIRE_MS = 600_000; // R3-17: 10 minutes
/** §11.2: the chat window is pre-created once, `setTimeout(…, 2000)` after `stage:ready`. */
export const CHAT_PRECREATE_DELAY_MS = 2_000;

export interface LazyWindowOptions<T> {
  onCreated?(w: T): void;
  onDestroyed?(): void;
  /** Injected clock for `lastCreateMs` (tests); production uses `performance.now()`. */
  now?: () => number;
}

/**
 * §11.2. Holds a window that may not exist. `get()` creates on demand, `peek()` never resurrects,
 * `destroy()` is idempotent. §11.3's grace timer lives here because it is generation-stamped
 * against THIS holder: arming captures `graceGeneration`, the callback returns immediately when
 * the captured value is stale, and every `get()` (show or recreate) and every `cancelGrace()`
 * bumps it — so a hide→show→hide cycle cannot leave two timers racing to destroy the window.
 */
export class LazyWindow<T extends BrowserWindow> {
  private win: T | null = null;
  private createMs = 0;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly create: () => T, private readonly opts: LazyWindowOptions<T> = {}) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** Creates if absent; always returns a live, non-destroyed window. Bumps the grace generation. */
  get(): T {
    this.generation += 1;
    this.clearTimer();
    if (this.win && !this.win.isDestroyed()) return this.win;
    const t0 = this.now();
    const w = this.create();
    this.createMs = this.now() - t0;
    this.win = w;
    // `close()` IS the destroy for the lazy windows (§11.2): a window closed from outside must
    // read as gone here, or `alive` lies and `peek()` hands out a corpse.
    w.once('closed', () => { if (this.win === w) { this.win = null; this.opts.onDestroyed?.(); } });
    this.opts.onCreated?.(w);
    return w;
  }

  /** The live window or null — for code that must not resurrect it (e.g. a visibility broadcast). */
  peek(): T | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  destroy(): void {
    const w = this.win;
    this.win = null;
    this.clearTimer();
    if (w && !w.isDestroyed()) {
      w.destroy();
      this.opts.onDestroyed?.();
    }
  }

  get alive(): boolean {
    return this.peek() !== null;
  }

  /** Wall ms the last create() took. Written into the evidence (§11.4). */
  get lastCreateMs(): number {
    return this.createMs;
  }

  get graceGeneration(): number {
    return this.generation;
  }

  /** Arms the one grace timer; a previous one is replaced. `cb` runs only if no bump happened. */
  armGrace(ms: number, cb: (generation: number) => void | Promise<void>): void {
    this.clearTimer();
    const captured = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (captured !== this.generation) return;
      void cb(captured);
    }, ms);
  }

  /** Explicit cancel: bumps the generation so an in-flight callback aborts too. */
  cancelGrace(): void {
    this.generation += 1;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}

export interface BubbleLifecycleDeps<T extends BrowserWindow> {
  bubble: LazyWindow<T>;
  /** `runner.state !== 'idle'` OR SpeechController reports a reveal in flight (FW-5). Task 14 supplies it. */
  speechLeaseActive(): boolean;
  /** R3-17 retire: `await turnRunner.cancel()` — the history row gets interrupted = true (FW-1). Task 14 supplies it. */
  retireSpeech(): Promise<void>;
  /** Monotonic-enough ms for `hiddenFor`; defaults to Date.now (fake-timer friendly). */
  now?: () => number;
  graceMs?: number;
  retireMs?: number;
  onDestroyed?(): void;
}

/**
 * §11.3, the single ordered rule:
 *   on hidden → armGrace(BUBBLE_IDLE_GRACE_MS)
 *   on grace → lease active? (hiddenFor ≥ HIDDEN_PLAYBACK_RETIRE_MS ? await retire; destroy : re-arm) : destroy
 *   on needed → generation += 1, clear, bubble.get()
 */
export class BubbleLifecycle<T extends BrowserWindow> {
  private hiddenAt: number | null = null;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly retireMs: number;

  constructor(private readonly deps: BubbleLifecycleDeps<T>) {
    this.now = deps.now ?? Date.now;
    this.graceMs = deps.graceMs ?? BUBBLE_IDLE_GRACE_MS;
    this.retireMs = deps.retireMs ?? HIDDEN_PLAYBACK_RETIRE_MS;
  }

  /** The bubble window became hidden (VisibilityState hide, or the linger expiring). */
  onHidden(): void {
    if (this.hiddenAt === null) this.hiddenAt = this.now();
    this.arm();
  }

  /** Anything that needs the bubble: brain:state leaving idle, hint:show, proactive:turn, first-mes. */
  onNeeded(): T {
    this.hiddenAt = null;
    this.deps.bubble.cancelGrace();
    return this.deps.bubble.get(); // measured against RECREATE_BUDGET_MS via lastCreateMs
  }

  dispose(): void {
    this.deps.bubble.cancelGrace();
  }

  private arm(): void {
    this.deps.bubble.armGrace(this.graceMs, (generation) => this.onGrace(generation));
  }

  private async onGrace(generation: number): Promise<void> {
    if (!this.deps.speechLeaseActive()) { this.destroyNow(); return; }
    const hiddenFor = this.hiddenAt === null ? 0 : this.now() - this.hiddenAt;
    if (hiddenFor < this.retireMs) { this.arm(); return; }          // wait; never destroy under a live turn
    try {
      await this.deps.retireSpeech();                                // R3-17 first
    } catch (err) {
      console.warn('[bubble] retire failed; keeping the window:', err);
      this.arm();
      return;
    }
    // A show that arrived during the await bumped the generation: the window is wanted again.
    if (generation !== this.deps.bubble.graceGeneration) return;
    this.destroyNow();
  }

  private destroyNow(): void {
    this.deps.bubble.destroy();
    this.deps.onDestroyed?.();
  }
}

/** §11.3: what main re-sends on a recreated bubble's load, in this order, before the pending sentence(s). */
export const BUBBLE_REPLAY_CHANNELS = [
  Channels.bubblePlace, Channels.shellVisibility, Channels.modeChanged, Channels.simState,
] as const;

/** The first-message path's `webContents.isLoading()` guard (Phase 2 §6.6), reused for the replay. */
export function replayWhenLoaded(win: BrowserWindow, send: () => void): void {
  if (win.isDestroyed()) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}
