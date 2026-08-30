/**
 * §12.7 B-09 — reload the pet renderer mid-behaviour, mid-drag and mid-reply. Renderer lanes restart
 * from idle; main re-sends `sim:state`, the live `WindowMotion` generation and the speech state on
 * `stage:ready`; in-flight main-owned commands report `renderer_lost`; no duplicate history rows.
 *
 * Only the motor's share is pure: a renderer lost mid-drag reaches `WindowMotionController.cancel()`
 * through pet-window.ts's `onRendererReset` (this task). The `stage:ready` re-send and the
 * `renderer_lost` lane results belong to the index.ts wiring (Task 15) and the arbiter (Task 13);
 * `B09_ADAPTER` describes the Electron-lane run.
 */
import type { MotionHarness } from '../motion/stale-generation.fixture';

export const B09_ADAPTER = {
  id: 'B-09',
  lane: 'adapter',
  input: 'reload the pet renderer mid-behaviour, mid-drag and mid-reply',
  expectedState: 'renderer lanes restart from idle; main re-sends sim:state, the live WindowMotion generation and the speech state on stage:ready',
  emitted: 'in-flight main-owned commands report renderer_lost',
  persisted: 'no duplicate history rows; the turn continues or retires per R3-17',
  steps: [
    'launch the built app with DS_FAKE_BRAIN=1 and DS_TRACE=<tmp>',
    'wait for a behaviourStart trace record, then webContents.reload() the pet window; assert the next behaviourStart follows a stage:ready',
    'SendInput press + drag; reload mid-drag; assert a motion record with phase rest and the drag generation, then a new generation on the next press',
    'send a chat message; reload mid-reply; assert history has exactly one assistant row for the turn',
  ],
} as const;

export function runRendererReload(h: MotionHarness): {
  restFrameSent: boolean;
  suspensionCleared: boolean;
  nextGeneration: number;
} {
  h.setCursor(700, 200);
  h.ctl.grab({ pressId: 1, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
  h.setCursor(800, 200);
  h.frame(10);
  // pet-window.ts: render-process-gone -> options.onRendererReset() -> motion.cancel()
  h.ctl.cancel();
  const last = h.motions().at(-1);
  const restFrameSent = last?.phase === 'rest' && last.generation === 1;
  const suspensionCleared = h.suspend.at(-1) === false;
  h.ctl.grab({ pressId: 2, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
  return { restFrameSent, suspensionCleared, nextGeneration: h.ctl.generation };
}
