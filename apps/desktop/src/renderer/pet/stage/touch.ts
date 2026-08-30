import type { HitPart, Payload } from '@ds/protocol';
import { ANNOY_COOLDOWN_MS, TAP_BURST_COUNT, TAP_BURST_WINDOW_MS, TAP_SLOP_DIP } from '../../shared/lane-metrics';
import type { SfxName } from './sfx';
import type { TouchReaction } from './arbiter';

// §5.13: the ONE home is lane-metrics.ts; these are re-exports, nothing is re-declared.
export { ANNOY_COOLDOWN_MS, TAP_BURST_COUNT, TAP_BURST_WINDOW_MS, TAP_SLOP_DIP };

export const BURST_RING_SLOTS = 8;

/** §5.11: an 8-slot ring buffer of monotonic timestamps. Triggers on `now - buf[(i - 6 + 8) % 8] < TAP_BURST_WINDOW_MS`. */
export class BurstDetector {
  private readonly buf = new Float64Array(BURST_RING_SLOTS).fill(-Infinity);
  private i = 0;
  private count = 0;

  push(nowMs: number): { burst: number; triggered: boolean } {
    this.buf[this.i] = nowMs;
    this.count++;
    const seventh = this.buf[(this.i - (TAP_BURST_COUNT - 1) + BURST_RING_SLOTS) % BURST_RING_SLOTS];
    const triggered = this.count >= TAP_BURST_COUNT && nowMs - seventh < TAP_BURST_WINDOW_MS;
    let burst = 0;
    for (let k = 0; k < BURST_RING_SLOTS; k++) if (nowMs - this.buf[k] < TAP_BURST_WINDOW_MS) burst++;
    this.i = (this.i + 1) % BURST_RING_SLOTS;
    return { burst, triggered };
  }
}

/** §5.11's table. Expression weights are BEFORE the touchVariantIntensity scale. */
export const TOUCH_REACTIONS: Record<HitPart, TouchReaction> = {
  head:     { motion: ['TapBody', 0], expression: { name: 'F02', weight: 0.55 }, gaze: 'cursorLock', overlay: 'headTilt' },
  face:     { motion: ['TapBody', 1], expression: { name: 'F07', weight: 0.60 }, gaze: 'down',       overlay: 'blush' },
  hair:     { motion: ['TapBody', 3], expression: { name: 'F01', weight: 0.45 }, gaze: 'cursorLock', overlay: 'headTiltHold' },
  body:     { motion: ['TapBody', 2], expression: { name: 'F01', weight: 0.40 }, gaze: 'follow',     overlay: 'none' },
  arm:      { motion: ['TapBody', 3], expression: { name: 'F06', weight: 0.40 }, gaze: 'cursorLock', overlay: 'leanRight' },
  ticklish: { motion: ['TapBody', 0], expression: { name: 'F02', weight: 0.65 }, gaze: 'away',       overlay: 'leanLeft' },
};
/** The burst reaction: F03 at 0.70, NOT scaled (R3-13's caps stay hard). */
export const ANNOYED_REACTION: TouchReaction = { motion: ['TapBody', 1], expression: { name: 'F03', weight: 0.70 }, gaze: 'away', overlay: 'headTilt' };

export function touchReaction(part: HitPart, intensity: number): TouchReaction {
  const base = TOUCH_REACTIONS[part];
  return { ...base, expression: { name: base.expression.name, weight: base.expression.weight * intensity } };
}

export interface TouchReactorDeps {
  arbiter: { touch(r: TouchReaction, now: number): void };
  send(payload: Payload<'arb:touch'>): void;
  /** §2.9: `avatar:tap` (hit-AREA name) fires first for the same gesture. */
  legacyTap(pressId: number): void;
  sfx: { play(name: SfxName, gain?: number): void } | null;
  /** livelinessMap(L).touchVariantIntensity — scales the variant, never the probability (R3-13). */
  intensity(): number;
}

export class TouchReactor {
  private readonly burst = new BurstDetector();
  private cooldownUntil = -Infinity;

  constructor(private readonly deps: TouchReactorDeps) {}

  /** One accepted tap (GPU alpha >= ENTER_ALPHA, travel < TAP_SLOP_DIP). */
  tap(pressId: number, part: HitPart, alpha: number, nowMs: number): void {
    const { burst, triggered } = this.burst.push(nowMs);
    const annoyed = triggered && nowMs >= this.cooldownUntil;
    if (annoyed) this.cooldownUntil = nowMs + ANNOY_COOLDOWN_MS;
    this.deps.legacyTap(pressId);
    this.deps.send({ pressId, part, alpha: Math.round(alpha), burst, annoyed });
    if (annoyed) {
      this.deps.arbiter.touch(ANNOYED_REACTION, nowMs);
      this.deps.sfx?.play('annoyed');
      return;
    }
    if (nowMs < this.cooldownUntil) return;   // the annoyed reaction is the last word until it expires
    this.deps.arbiter.touch(touchReaction(part, this.deps.intensity()), nowMs);
    this.deps.sfx?.play('tap');
  }
}
