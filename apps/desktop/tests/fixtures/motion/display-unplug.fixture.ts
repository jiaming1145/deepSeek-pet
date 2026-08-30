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
  dragClamped: boolean;
  flingGenerationKept: boolean;
  flingVelocityKept: boolean;
  finalGrabbable: boolean;
} {
  const twoDisplays = h.areas;
  const primaryOnly = [twoDisplays[0]];
  // --- drag onto the second display, then unplug it
  h.setCursor(1100, 200);
  h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 1100, screenY: 200 });
  h.setCursor(2600, 200);
  h.frame(240); // the spring has long since caught up: the window sits around x = 2500
  const genBeforeUnplug = h.ctl.generation;
  h.setAreas(primaryOnly);
  h.ctl.rebase();
  h.setCursor(2600, 200); // the cursor is still "over there"; the pointer target is now off every display
  h.frame(2);
  const dragGenerationKept = h.ctl.generation === genBeforeUnplug && h.ctl.phase === 'drag';
  const dragClamped = grabbable(h.position(), primaryOnly);
  // --- release into a fling towards the dead display, then unplug "again" (re-plug first)
  h.setAreas(twoDisplays);
  h.ctl.rebase();
  for (let i = 0; i < 6; i++) { h.setCursor(h.cursor().x + 30, 200); h.frame(); }
  h.ctl.release({ pressId: 1, wasTap: false });
  h.frame(3);
  const genBeforeSecond = h.ctl.generation;
  const vxBefore = h.motions().at(-1)!.vx;
  h.setAreas(primaryOnly);
  h.ctl.rebase();
  h.frame(1);
  const after = h.motions().at(-1)!;
  const flingGenerationKept = after.generation === genBeforeSecond;
  // Velocity is kept across the rebase (only air drag and gravity act between the two samples).
  const flingVelocityKept = Math.sign(after.vx) === Math.sign(vxBefore) && Math.abs(after.vx) > 0.8 * Math.abs(vxBefore);
  h.frame(500);
  const finalGrabbable = h.ctl.phase === 'rest' && grabbable(h.persisted.at(-1)!, primaryOnly);
  return { dragGenerationKept, dragClamped, flingGenerationKept, flingVelocityKept, finalGrabbable };
}
