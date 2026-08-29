import { BrowserWindow, screen } from 'electron';
import { Channels } from '@ds/protocol';
import { sendToPet } from './ipc';

export type CursorPolling = {
  stop: () => void;
  /** Skip polling (and the `gaze:cursor` IPC it would send) while the pet window is hidden. */
  setPaused: (paused: boolean) => void;
  /** Drop the dedupe cache and sample now — for `stage:ready`, where a fresh renderer knows nothing. */
  recheck: () => void;
};

/** Polls the global cursor and sends it in window-local CSS pixels (can be far outside the window). */
export function startCursorPolling(win: BrowserWindow, hz = 30): CursorPolling {
  // Deduped on the *window-local* pair, not the global point: the value that matters is the one the
  // renderer receives. A window that moves while the cursor is still produces a new local position
  // from an unchanged global one, and deduping globally would hold the old gaze until the user
  // happened to move the mouse.
  let last = { x: NaN, y: NaN };
  let paused = false;

  const sample = (): void => {
    // Hoisted above `paused`: a window destroyed while she is hidden must still stop the interval,
    // otherwise the timer holds a dead BrowserWindow for the life of the process.
    if (win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    if (paused || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const local = { x: p.x - wx, y: p.y - wy };
    if (local.x === last.x && local.y === last.y) return;
    last = local;
    sendToPet(win, Channels.gazeCursor, local);
  };

  const timer = setInterval(sample, Math.round(1000 / hz));

  /** Forget the last sent pair so the next sample always emits, then take it. */
  const resample = (): void => {
    last = { x: NaN, y: NaN };
    sample();
  };

  return {
    stop: () => clearInterval(timer),
    setPaused: (p) => {
      const wasPaused = paused;
      paused = p;
      // Unpausing is a resync point: the window may have moved (or been replaced) while hidden, so
      // the renderer's gaze target is stale and the cached pair is meaningless.
      if (wasPaused && !p) resample();
    },
    recheck: resample,
  };
}
