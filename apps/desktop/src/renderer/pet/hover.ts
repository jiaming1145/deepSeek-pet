/**
 * Debounces "pointer is over the model" so a single-frame gap between two hit areas (or a cursor
 * that grazes the silhouette) does not flap the click-through state of the whole window.
 * Pure and clock-free: the caller supplies `nowMs`, so it is unit-testable without timers.
 */
export class HoverTracker {
  private emitted = false;
  private candidate = false;
  private since = 0;
  constructor(
    private readonly onChange: (inside: boolean) => void,
    private readonly debounceMs = 50,
  ) {}
  sample(inside: boolean, nowMs: number): void {
    if (inside !== this.candidate) {
      this.candidate = inside;
      this.since = nowMs;
    }
    if (this.candidate !== this.emitted && nowMs - this.since >= this.debounceMs) {
      this.emitted = this.candidate;
      this.onChange(this.emitted);
    }
  }
}
