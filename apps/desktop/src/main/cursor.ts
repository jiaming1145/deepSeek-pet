import { BrowserWindow, screen } from 'electron';
import { Channels } from '@ds/protocol';
import { sendToPet } from './ipc';

export type CursorPolling = {
  stop: () => void;
  /** Skip polling (and the `gaze:cursor` IPC it would send) while the pet window is hidden. */
  setPaused: (paused: boolean) => void;
};

/** Polls the global cursor and sends it in window-local CSS pixels (can be far outside the window). */
export function startCursorPolling(win: BrowserWindow, hz = 30): CursorPolling {
  let last = { x: NaN, y: NaN };
  let paused = false;
  const timer = setInterval(() => {
    if (paused || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return;
    last = p;
    const [wx, wy] = win.getPosition();
    sendToPet(win, Channels.gazeCursor, { x: p.x - wx, y: p.y - wy });
  }, Math.round(1000 / hz));
  return { stop: () => clearInterval(timer), setPaused: (p) => { paused = p; } };
}
