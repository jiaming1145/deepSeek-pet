/**
 * Press → tap / drag discrimination for the pet window, rewired for §7.2.
 *
 * The tracker still owns only the button state machine (hover sampling and gaze forwarding stay in
 * `main.ts`). What changed in Phase 3: a pointer-down no longer hit-tests on the CPU — it queues a
 * 1-px GPU read (§6.3) and the press is decided when `resolvePress` delivers the framebuffer alpha
 * on the next frame. `alpha >= ENTER_ALPHA` → `arb:grab` (main's motor owns the window from here,
 * R3-5); `alpha < ENTER_ALPHA` → nothing (off-model). Pointer-up / lost button → `arb:release`.
 * The Phase 1 recovery paths (buttons === 0 mid-move ends the press; the late mouseup is consumed)
 * are kept verbatim in behaviour. `avatar:drag` / `avatar:dragEnd` have no sender any more (§2.9).
 */
import type { HitPart } from '@ds/protocol';
import { ENTER_ALPHA, type PendingPress, type PickResult } from '@ds/stage';

export interface PressEvent {
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  target: EventTarget | null;
}

export interface PressGrab { pressId: number; part: HitPart; modelX: number; modelY: number; screenX: number; screenY: number }
export interface PressRelease { pressId: number; wasTap: boolean }
export interface PressTap { pressId: number; part: HitPart; alpha: number; clientX: number; clientY: number }
export type PressPick = Pick<PickResult, 'alpha' | 'part' | 'modelX' | 'modelY'>;

export interface PressTrackerOptions {
  /** Accumulated pointer travel (DIP) a press may have and still count as a tap. TAP_SLOP_DIP. */
  slopPx: number;
  /** client px -> device px, exactly Live2DStage.toDevice (the GPU read wants device pixels). */
  toDevice(clientX: number, clientY: number): { x: number; y: number };
  /** GpuPressReader.queue — serviced inside the next frame (§6.3). */
  queuePress(p: PendingPress): void;
  /** The CPU predicate at the same point, for the part and the model-local anchor (R3-22). */
  pick(clientX: number, clientY: number): PressPick;
  hitPartDefault: HitPart;
  onGrab(g: PressGrab): void;
  onRelease(r: PressRelease): void;
  onTap(t: PressTap): void;
  /** GPU says on-model, CPU says off: reported so §6.5's error rate is measured in production. */
  onDisagreement(alphaDelta: number): void;
  /** True for event targets that must swallow the press entirely (the debug panel). */
  isRejected(target: EventTarget | null): boolean;
}

interface Press {
  pressId: number;
  clientX: number; clientY: number;
  screenX: number; screenY: number;
  moved: number;
  /** pending: GPU read not back yet; grabbed: arb:grab sent. */
  phase: 'pending' | 'grabbed';
  part: HitPart; alpha: number;
  /** The button went up before the GPU read returned: replay the release once it does. */
  endedEarly: { clientX: number; clientY: number; rejected: boolean } | null;
}

export class PressTracker {
  private press: Press | null = null;
  private seq = 0;
  private rejected = false;
  private consumed = false;

  constructor(private readonly opts: PressTrackerOptions) {}

  mousedown(e: PressEvent): void {
    if (e.button !== 0) return;
    this.rejected = false;
    this.consumed = false;
    this.press = null;
    // The id is stamped for every left press, rejected or not: a pressId names a GESTURE, and main
    // correlates `arb:grab`/`arb:release` by it — reusing an id a swallowed press already had would
    // make a later grab indistinguishable from a replay of that one.
    const pressId = ++this.seq;
    if (this.opts.isRejected(e.target)) { this.rejected = true; return; }
    const d = this.opts.toDevice(e.clientX, e.clientY);
    this.press = {
      pressId, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, moved: 0,
      phase: 'pending', part: this.opts.hitPartDefault, alpha: 0, endedEarly: null,
    };
    this.opts.queuePress({ pressId, deviceX: Math.round(d.x), deviceY: Math.round(d.y) });
  }

  /** GpuPressReader.service() result for one press. A pressId that is not the live press is ignored. */
  resolvePress(pressId: number, alpha: number): void {
    const p = this.press;
    if (!p || p.pressId !== pressId || p.phase !== 'pending') return;
    if (alpha < ENTER_ALPHA) { this.press = null; return; }          // off-model: nothing is sent
    const pick = this.opts.pick(p.clientX, p.clientY);
    let part = pick.part ?? this.opts.hitPartDefault;
    if (pick.alpha < ENTER_ALPHA) { this.opts.onDisagreement(alpha - pick.alpha); part = this.opts.hitPartDefault; }
    p.phase = 'grabbed'; p.part = part; p.alpha = alpha;
    this.opts.onGrab({ pressId, part, modelX: clamp1(pick.modelX), modelY: clamp1(pick.modelY), screenX: p.screenX, screenY: p.screenY });
    if (p.endedEarly) {
      const end = p.endedEarly;
      this.press = null;
      this.finish(p, end.clientX, end.clientY, end.rejected);
    }
  }

  mousemove(e: PressEvent): void {
    const p = this.press;
    if (!p) return;
    // The button can be released where we never see the mouseup (outside the window, or over
    // another window once main has moved us). Without this the press would stick.
    if (e.buttons === 0) {
      this.press = null;
      this.consumed = true;
      if (p.phase === 'grabbed') this.opts.onRelease({ pressId: p.pressId, wasTap: p.moved < this.opts.slopPx });
      return;
    }
    p.moved += Math.abs(e.screenX - p.screenX) + Math.abs(e.screenY - p.screenY);
    p.screenX = e.screenX; p.screenY = e.screenY;
  }

  mouseup(e: PressEvent): void {
    if (e.button !== 0) return;
    const p = this.press;
    const rejected = this.rejected || this.consumed || this.opts.isRejected(e.target);
    this.rejected = false;
    this.consumed = false;
    if (!p) return;
    if (p.phase === 'pending') { p.endedEarly = { clientX: e.clientX, clientY: e.clientY, rejected }; return; }
    this.press = null;
    this.finish(p, e.clientX, e.clientY, rejected);
  }

  private finish(p: Press, clientX: number, clientY: number, rejected: boolean): void {
    const wasTap = p.moved < this.opts.slopPx;
    this.opts.onRelease({ pressId: p.pressId, wasTap });
    // A real drag ends there; a press that began or ended on the panel belongs to the button.
    if (!wasTap || rejected) return;
    this.opts.onTap({ pressId: p.pressId, part: p.part, alpha: p.alpha, clientX, clientY });
  }
}

function clamp1(v: number): number { return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

/**
 * Every `(group, index)` pair a hit area maps to, flattened.
 *
 * Flattening rather than taking `Object.entries(...)[0]`: a hit area mapped to
 * `{ TapBody: [0, 1], TapHead: [2] }` must be able to pick all three. `undefined` (a hit area with
 * no entry at all) and `{}` yield an empty list instead of throwing on a destructure.
 */
export function tapCandidates(
  groups: Record<string, number[]> | undefined,
): [string, number][] {
  const out: [string, number][] = [];
  for (const [group, idxs] of Object.entries(groups ?? {})) {
    for (const index of idxs) out.push([group, index]);
  }
  return out;
}
