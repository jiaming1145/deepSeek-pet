/**
 * requestAnimationFrame pump with frame skipping so a 60 Hz (or 120 Hz) display can still be driven
 * at a lower target fps. Kept free of DOM/GL state so `shouldRender` is unit-testable.
 */

/** True when enough time has passed since the last rendered frame to draw another at `fps`. */
export function shouldRender(fps: number, lastRenderMs: number, nowMs: number): boolean {
  const interval = 1000 / fps;
  return nowMs - lastRenderMs >= interval - 0.5; // 0.5 ms tolerance for rAF jitter
}

export class Ticker {
  private fps = 30;
  private last = 0;
  private lastRender = 0;
  private raf = 0;
  private isRunning = false;
  /**
   * Bumped by every start() and stop(). A running loop schedules its successor only while its own
   * generation is current, so a synchronous `stop(); start()` from inside the frame callback leaves
   * exactly one pump: the new one. Without it the new pump *and* the old loop's tail both schedule,
   * only one id is tracked, and the untracked pump can never be cancelled.
   */
  private generation = 0;

  constructor(private readonly cb: (dtSeconds: number) => void) {}

  setFps(fps: number): void {
    this.fps = fps;
  }

  /** Whether a pump is currently scheduled. */
  running(): boolean {
    return this.isRunning;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const generation = ++this.generation;
    this.last = performance.now();
    // Draw the first frame as soon as the loop starts rather than one interval later.
    this.lastRender = 0;
    const loop = (now: number) => {
      if (!this.isRunning || generation !== this.generation) return;
      if (shouldRender(this.fps, this.lastRender, now)) {
        const dt = Math.min((now - this.last) / 1000, 0.1); // clamp after tab/lock stalls
        this.last = now;
        this.lastRender = now;
        try {
          this.cb(dt);
        } catch (e) {
          // Leave the ticker stopped but restartable. Exiting the loop with isRunning still true
          // would wedge it forever: start() is a no-op while it believes a pump is scheduled.
          this.isRunning = false;
          this.raf = 0;
          this.generation++;
          throw e; // surfaces as an uncaught rAF error, i.e. the browser's error reporting
        }
        // The callback may have stopped or restarted us synchronously.
        if (!this.isRunning || generation !== this.generation) return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.isRunning = false;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
