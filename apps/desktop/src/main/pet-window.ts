import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { isAllowedPetUrl, PET_URL } from './app-protocol';
import { clampDrag, clampToDisplays, loadWindowState, saveWindowState, type Rect } from './window-state';

export const PET_SIZE = { w: 420, h: 720 };

const stateFile = (): string => join(app.getPath('userData'), 'window.json');

/** Work areas (taskbar excluded) of every current display — the region the pet may occupy. */
function workAreas(): Rect[] {
  return screen.getAllDisplays().map((d) => d.workArea);
}

/** The click-through surface of the pet window; narrowed so lifecycle resets are testable. */
export type ClickThroughTarget = {
  isDestroyed(): boolean;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
};

/** Everything to tear down when the renderer never loads. */
export type StartupCleanup = {
  destroyWindow(): void;
  stopCursor(): void;
  stopForeground(): void;
  destroyTray(): void;
  quit(): void;
};

export type PetWindowOptions = {
  /**
   * Called on `ready-to-show`. index.ts routes this through the visibility controller — the window
   * must never show itself, or a hide that landed during the ~1 s of renderer startup is undone.
   */
  onReadyToShow: () => void;
  /** Called when the renderer document fails to load (bad build, dev server down, bad app:// URL). */
  onLoadFailure: (err: unknown) => void;
};

export function createPetWindow(options: PetWindowOptions): BrowserWindow {
  const areas = workAreas();
  const saved = loadWindowState(stateFile());
  const pos = clampToDisplays(saved ? { ...saved, ...PET_SIZE } : null, areas, PET_SIZE);

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
  guardPetWebContents(win);

  // Registered *before* the load is observed, so a synchronous rejection cannot arrive first.
  win.once('ready-to-show', options.onReadyToShow);

  const query = process.env.DS_DEBUG === '1' ? '?debug=1' : '';
  const base = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/pet.html` : PET_URL;
  // Never `void`: a rejected load (missing renderer build, dev server down, bad app:// authority)
  // is asynchronous, so it bypasses the startup catch and would leave an unhandled rejection plus
  // an invisible always-on-top window wired to a tray icon that controls nothing.
  win.loadURL(`${base}${query}`).catch((err: unknown) => {
    // ERR_ABORTED (errno -3) is a superseded or destroyed load — quitting during startup — not a
    // broken renderer; running the fatal teardown for it would quit twice.
    if (isAbortedLoad(err)) return;
    options.onLoadFailure(err);
  });
  return win;
}

/**
 * Locks the pet webContents to its own document.
 *
 * Two separate hazards, one place:
 *  - *Identity.* Electron keeps the preload installed across top-level navigations, so a navigated
 *    page would inherit the whole `window.ds` surface. Unexpected navigation and `window.open` are
 *    denied outright; `ipc.ts isFromPet` is the second line if one ever slips through.
 *  - *Click-through.* The renderer's `HoverTracker` starts at `emitted = false`. If the old
 *    document had put main into `ignoreMouseEvents = false` (cursor over the avatar) and then
 *    reloads or crashes with the cursor elsewhere, nothing ever sends `inside: false` and the
 *    transparent 420x720 window silently eats every click on whatever is behind her. Resetting to
 *    click-through on every main-frame navigation and on renderer death is the recovery; the cursor
 *    poll keeps running, so a genuine hover re-enables interaction within a frame.
 */
export function isAbortedLoad(err: unknown): boolean {
  const e = err as { errno?: unknown; code?: unknown } | null;
  return !!e && (e.errno === -3 || e.code === 'ERR_ABORTED');
}

function guardPetWebContents(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyForeign = (details: { url: string; preventDefault: () => void }) => {
    if (isAllowedPetUrl(details.url)) return;
    console.warn('[pet] blocked navigation to', details.url);
    details.preventDefault();
  };
  wc.on('will-navigate', denyForeign);
  // will-navigate does not fire for server-side redirects; an allowed URL that 302s elsewhere
  // arrives here instead (dev server only in practice — app://local is our own handler).
  wc.on('will-redirect', denyForeign);
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame) setClickThrough(win, true);
  });
  wc.on('render-process-gone', (_event, details) => {
    console.warn('[pet] render process gone', details.reason);
    setClickThrough(win, true);
  });
}

/**
 * A renderer that never loads leaves an invisible always-on-top window, a live cursor poll and a
 * tray icon wired to nothing. Tear the startup down in dependency order and quit, rather than sit
 * there half-alive. Each step is isolated so one throwing does not strand the rest.
 */
export function handleLoadFailure(err: unknown, cleanup: StartupCleanup): void {
  console.error('[pet] renderer failed to load, shutting down:', err);
  const steps: [string, () => void][] = [
    ['window', () => cleanup.destroyWindow()],
    ['cursor', () => cleanup.stopCursor()],
    ['foreground', () => cleanup.stopForeground()],
    ['tray', () => cleanup.destroyTray()],
    ['quit', () => cleanup.quit()],
  ];
  for (const [name, run] of steps) {
    try {
      run();
    } catch (stepErr) {
      console.warn(`[pet] cleanup step ${name} failed:`, stepErr);
    }
  }
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

/**
 * Display topology changed (monitor unplugged, resolution/scale changed): the pet may now sit
 * entirely on a display that no longer exists, where no drag can reach her and the tray's show is
 * useless. Pull her back to a grabbable position and persist it. Returns true when she moved.
 */
export function reconcileDisplays(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  const [x, y] = win.getPosition();
  const safe = clampDrag({ x, y, ...PET_SIZE }, workAreas());
  const nx = Math.round(safe.x);
  const ny = Math.round(safe.y);
  if (nx === x && ny === y) return false;
  win.setPosition(nx, ny, false);
  savePetPosition(win);
  return true;
}

/** Click-through: `true` lets clicks reach the windows behind the pet (mouse moves are still forwarded). */
export function setClickThrough(win: ClickThroughTarget, ignore: boolean): void {
  if (win.isDestroyed()) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

export function moveBy(win: BrowserWindow, dx: number, dy: number): void {
  if (win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  // @ds/protocol bounds a single delta; this bounds the accumulation. Without it a stream of
  // individually-valid deltas walks her off every display — or past the native coordinate range,
  // where setPosition throws.
  const safe = clampDrag({ x: x + dx, y: y + dy, ...PET_SIZE }, workAreas());
  win.setPosition(Math.round(safe.x), Math.round(safe.y), false);
}
