/** Feeds ParamMouthOpenY. Mirrors Cubism's IParameterProvider (update + getParameter) so it can be
 *  handed straight to CubismLipSyncUpdater. Phase 2 adds AudioMouthDriver with the same interface. */
export interface MouthDriver {
  update(deltaSeconds: number): boolean;
  getParameter(): number;
  start(): void;
  stop(): void;
}

/** Procedural "talking" for text-only mode: a 4–7 Hz open/close rhythm with jittered amplitude. */
export class TextMouthDriver implements MouthDriver {
  private speaking = false;
  private value = 0;
  private phase = 0;
  private hz = 5;
  private amp = 0.8;

  constructor(private readonly rng: () => number = Math.random) {}

  start(): void { this.speaking = true; }
  stop(): void { this.speaking = false; }

  update(dt: number): boolean {
    let target = 0;
    if (this.speaking) {
      this.phase += dt * this.hz * Math.PI * 2;
      if (this.phase > Math.PI * 2) {
        this.phase -= Math.PI * 2;
        this.hz = 4 + this.rng() * 3;       // 4–7 Hz
        this.amp = 0.6 + this.rng() * 0.3;  // 0.6–0.9
      }
      target = this.amp * (0.5 - 0.5 * Math.cos(this.phase));
    }
    // fast attack, ~100 ms release
    const k = target > this.value ? 1 - Math.exp(-dt * 60) : 1 - Math.exp(-dt * 10);
    this.value += (target - this.value) * k;
    this.value = Math.max(0, Math.min(1, this.value));
    return true;
  }

  getParameter(): number { return this.value; }
}
