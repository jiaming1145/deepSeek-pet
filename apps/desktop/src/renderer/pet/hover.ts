/**
 * Debounces "pointer is over the model" so a single-frame gap between two hit areas (or a cursor
 * that grazes the silhouette) does not flap the click-through state of the whole window.
 *
 * The caller supplies `nowMs` on every sample, but samples alone are not enough: the cursor can
 * come to rest on the model (no more mousemove events) and, once main turns click-through on, DOM
 * mousemove stops arriving altogether. So a pending change also arms a timer that re-checks the
 * debounce window on its own. Both the clock and the timer are injected, which keeps the class
 * unit-testable without real time.
 */
export interface HoverClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const wallClock: HoverClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
  now: () => performance.now(),
};

export class HoverTracker {
  private emitted = false;
  private candidate = false;
  private since = 0;
  private timer: unknown = undefined;

  constructor(
    private readonly onChange: (inside: boolean) => void,
    private readonly debounceMs = 50,
    private readonly clock: HoverClock = wallClock,
  ) {}

  sample(inside: boolean, nowMs: number): void {
    if (inside !== this.candidate) {
      this.candidate = inside;
      this.since = nowMs;
    }
    this.settle(nowMs);
  }

  /**
   * Forget the emitted state (window was hidden and shown again): main forced click-through on
   * hide, so `inside` must be re-emitted from the next sample even if the cursor never moved.
   */
  reset(): void {
    this.cancel();
    this.emitted = false;
    this.candidate = false;
  }

  /** Drop any armed timer (e.g. when the page is torn down). */
  cancel(): void {
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private settle(nowMs: number): void {
    this.cancel();
    if (this.candidate === this.emitted) return;
    if (nowMs - this.since >= this.debounceMs) {
      this.emitted = this.candidate;
      this.onChange(this.emitted);
      return;
    }
    // No further sample is guaranteed: re-check once the window would have elapsed.
    const wait = this.debounceMs - (nowMs - this.since);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      // The deadline has passed by construction; clamp so a coarse clock cannot re-arm forever.
      this.settle(Math.max(this.clock.now(), this.since + this.debounceMs));
    }, wait);
  }
}
