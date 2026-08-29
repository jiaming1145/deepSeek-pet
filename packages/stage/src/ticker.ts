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
  private running = false;

  constructor(private readonly cb: (dtSeconds: number) => void) {}

  setFps(fps: number): void {
    this.fps = fps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    // Draw the first frame as soon as the loop starts rather than one interval later.
    this.lastRender = 0;
    const loop = (now: number) => {
      if (!this.running) return;
      if (shouldRender(this.fps, this.lastRender, now)) {
        const dt = Math.min((now - this.last) / 1000, 0.1); // clamp after tab/lock stalls
        this.last = now;
        this.lastRender = now;
        this.cb(dt);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
