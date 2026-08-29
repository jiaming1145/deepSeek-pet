import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { PET_URL } from './app-protocol';
import { clampToDisplays, loadWindowState, saveWindowState } from './window-state';

export const PET_SIZE = { w: 420, h: 720 };

const stateFile = (): string => join(app.getPath('userData'), 'window.json');

export function createPetWindow(): BrowserWindow {
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const saved = loadWindowState(stateFile());
  const pos = clampToDisplays(saved ? { ...saved, ...PET_SIZE } : null, displays, PET_SIZE);

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: PET_SIZE.w,
    height: PET_SIZE.h,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/pet.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  setClickThrough(win, true);

  const query = process.env.DS_DEBUG === '1' ? '?debug=1' : '';
  const base = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/pet.html` : PET_URL;
  void win.loadURL(`${base}${query}`);

  // showInactive, never show: the pet must never steal focus from the app the user is working in.
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

/**
 * Persists the current position. Called at the end of a drag rather than from a `moved` listener:
 * Electron only emits `moved` for a user-initiated system move (a title bar drag / WM_EXITSIZEMOVE),
 * which a frameless window moved through `setPosition` never produces — measured on Electron 43,
 * where a drag emitted 13 `move` events and zero `moved`.
 */
export function savePetPosition(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  saveWindowState(stateFile(), { x, y });
}

/** Click-through: `true` lets clicks reach the windows behind the pet (mouse moves are still forwarded). */
export function setClickThrough(win: BrowserWindow, ignore: boolean): void {
  if (win.isDestroyed()) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

export function moveBy(win: BrowserWindow, dx: number, dy: number): void {
  if (win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy), false);
}
