/**
 * Press → tap / drag discrimination for the pet window.
 *
 * Extracted out of `main.ts`'s three `window.addEventListener` closures so the four behaviours that
 * were fixed by hand during Task 6/7 (drag release must not tap, a mouseup we never see must not
 * leave the drag stuck, every `tapMotions` group must be reachable, a press on the debug panel must
 * not tap) can be unit-tested without a browser or a loaded Live2D model.
 *
 * The tracker deliberately owns *only* the button state machine. Hover sampling and gaze forwarding
 * stay in `main.ts` because they also run for pointer streams that never produce a press
 * (`gaze:cursor` forwarded from main once the window is click-through).
 */

/**
 * The subset of `MouseEvent` the tracker reads. `MouseEvent` satisfies it structurally, so `main.ts`
 * hands the DOM event straight through while tests can pass object literals.
 *
 * `client*` are viewport pixels (what the hit test consumes); `screen*` are desktop pixels, which is
 * what a window move has to be expressed in — the window itself moves under the cursor, so client
 * coordinates stop advancing mid-drag while screen coordinates keep tracking the real pointer.
 */
export interface PressEvent {
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  target: EventTarget | null;
}

export interface PressTrackerOptions {
  /** Name of the hit area under a viewport point, or null where the model is not drawn. */
  hitTest(x: number, y: number): string | null;
  /** Accumulated pointer travel a press may have and still count as a tap rather than a drag. */
  slopPx: number;
  onTap(hit: string): void;
  /**
   * A press was accepted and the window is now being dragged. Optional: today's protocol has no
   * "drag started" message (main infers the drag from the first delta), so `main.ts` leaves it
   * unwired. It exists because the accept decision is only visible in here.
   */
  onDragStart?(): void;
  /** One drag step, in desktop pixels. */
  onDragMove(dx: number, dy: number): void;
  /** The drag terminator. Sent exactly once per drag that actually moved. */
  onDragEnd(): void;
  /**
   * True for event targets that must swallow the press entirely — the debug panel, whose buttons
   * would otherwise drag the window out from under the pointer and then also fire a tap motion.
   */
  isRejected(target: EventTarget | null): boolean;
}

export class PressTracker {
  private drag: { x: number; y: number; moved: number } | null = null;
  /** A press that started on a rejected target: it must not tap wherever it is released. */
  private rejected = false;
  /**
   * The current press already ended through the `buttons === 0` recovery below. A mouseup that
   * *does* still arrive afterwards is the tail of that same release, not a new click, so it must not
   * tap — otherwise a long drag whose mouseup lands back inside the window taps on release, which is
   * the defect the slop check exists to prevent.
   */
  private consumed = false;

  constructor(private readonly opts: PressTrackerOptions) {}

  mousedown(e: PressEvent): void {
    if (e.button !== 0) return;
    this.rejected = false;
    this.consumed = false;
    // Pressing a debug-panel control must not grab the window: the panel would run away from the
    // pointer and the click would never reach the button.
    if (this.opts.isRejected(e.target)) {
      this.rejected = true;
      return;
    }
    if (this.opts.hitTest(e.clientX, e.clientY) === null) return;
    this.drag = { x: e.screenX, y: e.screenY, moved: 0 };
    this.opts.onDragStart?.();
  }

  mousemove(e: PressEvent): void {
    // The button can be released where we never see the mouseup (outside the window, or over
    // another window once main has moved us). Without this the drag would stick and every later
    // move would keep dragging the window around.
    if (this.drag && e.buttons === 0) {
      this.drag = null;
      this.consumed = true;
      this.opts.onDragEnd();
      return;
    }
    if (!this.drag) return;
    const dx = e.screenX - this.drag.x;
    const dy = e.screenY - this.drag.y;
    this.drag = { x: e.screenX, y: e.screenY, moved: this.drag.moved + Math.abs(dx) + Math.abs(dy) };
    this.opts.onDragMove(dx, dy);
  }

  mouseup(e: PressEvent): void {
    if (e.button !== 0) return;
    const press = this.drag;
    const rejected = this.rejected || this.consumed;
    this.drag = null;
    this.rejected = false;
    this.consumed = false;
    // Anything that moved already sent drag deltas, so main always gets its terminator.
    if (press && press.moved > 0) this.opts.onDragEnd();
    // A real drag ends there: letting go after moving the window must not also fire a tap. A press
    // that only jittered is still a tap, which is why the slop is compared instead of `moved > 0`.
    if (press && press.moved >= this.opts.slopPx) return;
    // The press began on the panel (or ends over it): the drag terminator above still had to be
    // sent, but the click belongs to the button and must not also play a tap motion.
    if (rejected || this.opts.isRejected(e.target)) return;
    const hit = this.opts.hitTest(e.clientX, e.clientY);
    if (hit) this.opts.onTap(hit);
  }
}

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
