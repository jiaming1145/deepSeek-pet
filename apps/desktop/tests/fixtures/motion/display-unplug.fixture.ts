/**
 * §12.7 B-07 — `display-removed` during a drag; and again during a fling. `rebase()` re-clamps into
 * a live work area, keeps the velocity, does NOT bump the generation. Trace `motion` records continue
 * with the same generation and `clamped: true`; `window.json` holds an on-screen position with
 * >= 48 DIP grabbable.
 *
 * The pure part below drives the fake harness (unit lane). `B07_ADAPTER` is the adapter-lane
 * description for the Electron spec that Task 17's evidence run executes.
 */
import { MIN_GRABBABLE } from '../../../src/main/window-motion';
import type { MotionHarness } from './stale-generation.fixture';

const PET = { w: 420, h: 720 };

function grabbable(pos: [number, number], areas: MotionHarness['areas']): boolean {
  return areas.some((a) => {
    const w = Math.min(a.x + a.width, pos[0] + PET.w) - Math.max(a.x, pos[0]);
    const h = Math.min(a.y + a.height, pos[1] + PET.h) - Math.max(a.y, pos[1]);
    return w >= MIN_GRABBABLE && h >= MIN_GRABBABLE;
  });
}

export const B07_ADAPTER = {
  id: 'B-07',
  lane: 'adapter',
  input: 'display-removed during a drag; again during a fling',
  expectedState: 'rebase() re-clamps into a live work area, keeps the velocity, does not bump the generation',
  emitted: 'motion records continue with the same generation and clamped: true',
  persisted: 'window.json holds an on-screen position with >= 48 DIP grabbable',
  steps: [
    'launch the built app with two displays (or a simulated second work area via --force-device-scale-factor and a virtual display)',
    'SendInput press on the pet, drag it onto the second display, hold',
    'unplug / disable the second display (screen emits display-removed)',
    'assert window.getBounds() keeps >= 48 DIP inside the remaining work area and the trace motion generation is unchanged',
    'release with a fling toward the missing display; repeat the unplug during the fling',
    'assert the final window.json position is grabbable in the remaining work area',
  ],
} as const;

export function runDisplayUnplug(h: MotionHarness): {
  dragGenerationKept: boolean;
  dragClampedByRebase: boolean;
  dragClamped: boolean;
  dragClampedTraced: boolean;
  flingGenerationKept: boolean;
  flingVelocityKept: boolean;
  flingGenerationTraced: boolean;
  finalGrabbable: boolean;
} {
  const twoDisplays = h.areas;
  const primaryOnly = [twoDisplays[0]];
  // --- drag onto the second display, then unplug it
  h.setCursor(1100, 200);
  h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 1100, screenY: 200 });
  h.setCursor(2600, 200);
  // 400 frames, not 240: §7.4 clamps the spring's ERROR at +/- DRAG_MAX_LAG_DIP, so far from the
  // pointer the window travels at a terminal k*L/c = 180*24/22.8035 = 189.4 DIP/s. 240 frames
  // (4.08 s) move her only 773 DIP, to x = 1765 — still on the PRIMARY display, where the unplug
  // below has nothing to pull and `clamped` would never be set. 400 frames (6.8 s) put her at
  // x ~ 2288, genuinely on the second display, which is what B-07's input describes.
  h.frame(400);
  const genBeforeUnplug = h.ctl.generation;
  const nTraceDrag = h.motionTraces().length;
  h.setAreas(primaryOnly);
  h.ctl.rebase();
  // Read BEFORE any motor frame runs: §7.7's re-clamp is `rebase()`'s own obligation, and it writes
  // the clamped position itself. Measured after `h.frame(2)` this assertion is satisfied by the
  // NEXT frame's `writePosition()` instead, so a `rebase()` that clamped nothing would pass it
  // (fix round 2, finding 2). The steady-state read below stays: both halves are B-07's claim.
  const dragClampedByRebase = grabbable(h.position(), primaryOnly);
  h.setCursor(2600, 200); // the cursor is still "over there"; the pointer target is now off every display
  h.frame(2);
  const dragGenerationKept = h.ctl.generation === genBeforeUnplug && h.ctl.phase === 'drag';
  const dragClamped = grabbable(h.position(), primaryOnly);
  // §12.7 B-07's "emitted" column, now observable through WindowMotionDeps.trace (§12.2's `motion`
  // row, Source = WindowMotionController): the records that follow the unplug keep the generation
  // and say `clamped: true`. Asserted on the DRAG unplug because that is the one that performs a
  // real clampDrag pull — she was at x ~ 2288 on a display that no longer exists.
  const afterDragRebase = h.motionTraces().slice(nTraceDrag);
  const dragClampedTraced = afterDragRebase.length > 0
    && afterDragRebase.every((r) => r.generation === genBeforeUnplug)
    && afterDragRebase.every((r) => r.clamped === true);
  // --- release into a fling towards the dead display, then unplug "again" (re-plug first)
  h.setAreas(twoDisplays);
  h.ctl.rebase();
  for (let i = 0; i < 6; i++) { h.setCursor(h.cursor().x + 30, 200); h.frame(); }
  h.ctl.release({ pressId: 1, wasTap: false });
  h.frame(3);
  const genBeforeSecond = h.ctl.generation;
  // `before` and `after` MUST be two different snapshot objects, or every assertion below is a
  // tautology: `h.motions().at(-1)` returns the identical payload until a fresh snapshot is
  // published, and §7.8 publishes only on every second motor frame. Under the unit lane's fake
  // timers (interval 1000/60 = 16.667 ms, driven 17 ms per `frame()`) the parity of `frameIndex`
  // at any given call is not predictable from the call count, so the index is captured and a new
  // record is REQUIRED rather than assumed — a `rebase()` that zeroed the velocity or bumped the
  // generation must be able to fail this fixture.
  const nBefore = h.motions().length;
  const nTraceBefore = h.motionTraces().length;
  const vxBefore = h.motions()[nBefore - 1].vx;
  h.setAreas(primaryOnly);
  h.ctl.rebase();
  h.frame(4); // >= 2 motor frames: a fresh even-frameIndex snapshot is guaranteed at either parity
  if (h.motions().length <= nBefore) throw new Error('B-07: no sim:windowMotion was published after rebase()');
  // Read into a local: narrowing `h.ctl.phase` itself here would make the `=== 'rest'` check at the
  // end of this function a TS2367 "no overlap" error.
  const midPhase: string = h.ctl.phase;
  if (midPhase !== 'fling') throw new Error(`B-07: expected the fling to still be in the air, got ${midPhase}`);
  const after = h.motions()[nBefore]; // the FIRST snapshot published after the rebase, never `before`
  const flingGenerationKept = after.generation === genBeforeSecond;
  // Velocity is kept across the rebase (only air drag and gravity act between the two samples:
  // exp(-AIR_DRAG_X * 4 * 0.017) = 0.916, comfortably above the 0.8 floor).
  const flingVelocityKept = Math.sign(after.vx) === Math.sign(vxBefore) && Math.abs(after.vx) > 0.8 * Math.abs(vxBefore);
  // The generation half of the same column, on the fling unplug. `clamped` is NOT asserted here:
  // she is inside the surviving work area by then (the sweep confined the fling to it), so a
  // truthful rebase pulls nothing and writes `clamped: false` — asserting true would only be
  // satisfiable by a controller that lies.
  const postRebase = h.motionTraces().slice(nTraceBefore);
  const flingGenerationTraced = postRebase.length > 0
    && postRebase.every((r) => r.generation === genBeforeSecond && r.phase === 'fling');
  h.frame(500);
  const finalGrabbable = h.ctl.phase === 'rest' && grabbable(h.persisted.at(-1)!, primaryOnly);
  return {
    dragGenerationKept, dragClampedByRebase, dragClamped, dragClampedTraced,
    flingGenerationKept, flingVelocityKept, flingGenerationTraced, finalGrabbable,
  };
}
