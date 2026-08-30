import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { isAllowedPetUrl, rendererUrl } from './app-protocol';
import {
  BUBBLE_MAX, BUBBLE_MIN, placeBubble, preferredSideFor,
  type Placement, type Rect, type Size,
} from './bubble-place';
import type { BubbleSurface } from './bubble-visibility';
import { isAbortedLoad } from './pet-window';

/** Must equal SpeechController's LINGER_MS (contracts.md §5.2). */
export const BUBBLE_LINGER_MS = 3000;
/**
 * Grace for the renderer's exit animation before the WINDOW is hidden. Deliberately NOT called
 * BUBBLE_EXIT_MS: the renderer owns a constant of that name whose value is 160 (it mirrors
 * --dur-exit). Two different numbers under one name in two modules is the trap contracts.md §5.4
 * closes by renaming this one.
 */
export const BUBBLE_HIDE_DELAY_MS = 400;

/**
 * G2-6 / CX-6: what index.ts wires into the bubble's lifecycle.
 *  - `onLoadFailure`: the startup `loadURL` rejected for a reason other than ERR_ABORTED — the same
 *    startup failure policy the pet window uses (`handleLoadFailure`).
 *  - `onCrash`: the renderer process is gone. `BrainService.bubbleCrashed()` force-interrupts the
 *    active turn and resets the bubble state BEFORE the page is reloaded.
 *  - `onReloaded`: the page came back after a crash — re-place it and resend the shell verdict.
 *  - `onUnrecoverable`: a second crash, or the reload's own load failed — index.ts recreates the
 *    window (a recreated window that cannot load reports through `onLoadFailure`).
 */
export interface BubbleWindowHooks {
  onLoadFailure(err: unknown): void;
  onCrash(): void;
  onReloaded(): void;
  onUnrecoverable(): void;
}

export function createBubbleWindow(hooks: BubbleWindowHooks): BrowserWindow {
  const win = new BrowserWindow({
    width: BUBBLE_MAX.width,
    height: BUBBLE_MAX.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // C2 — zero white frames
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // structurally incapable of stealing the IME from the chat window
    hasShadow: false,
    resizable: false,
    show: false, // C2 — shown by showBubble(), never here
    webPreferences: {
      preload: join(__dirname, '../preload/bubble.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  setBubbleClickThrough(win, true);
  guardBubbleWebContents(win, hooks);
  // G2-6: never `void` — a rejected load (missing renderer build, dev server down) is asynchronous
  // and used to be swallowed, leaving an unusable bubble behind a working pet.
  win.loadURL(rendererUrl('bubble')).catch((err: unknown) => {
    if (isAbortedLoad(err)) return;
    hooks.onLoadFailure(err);
  });
  // §5.4 rule 1: ready-to-show deliberately does NOT show. The bubble appears only when there is
  // something to say.
  win.once('ready-to-show', () => {
    /* do NOT show here */
  });
  return win;
}

/**
 * The same lock `pet-window.ts` puts on the pet webContents, applied to the bubble because it now
 * carries a preload with its own `window.dsBubble` surface:
 *  - *Identity.* Electron keeps the preload installed across top-level navigations, so a navigated
 *    page would inherit `dsBubble`. Unexpected navigation and `window.open` are denied outright;
 *    `ipc.ts isFromWindow` is the second line if one ever slips through.
 *  - *Click-through.* The renderer reports hover through `bubble:hover`. If the old document had
 *    put main into `ignoreMouseEvents = false` and then reloads or crashes with the cursor
 *    elsewhere, nothing ever sends `inside: false` and the transparent window silently eats every
 *    click behind it. Resetting to click-through on every main-frame navigation and on renderer
 *    death is the recovery.
 */
function guardBubbleWebContents(win: BrowserWindow, hooks: BubbleWindowHooks): void {
  const wc = win.webContents;
  let reloaded = false;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyForeign = (details: { url: string; preventDefault: () => void }): void => {
    if (isAllowedPetUrl(details.url)) return;
    console.warn('[bubble] blocked navigation to', details.url);
    details.preventDefault();
  };
  wc.on('will-navigate', denyForeign);
  // will-navigate does not fire for server-side redirects; an allowed URL that 302s elsewhere
  // arrives here instead (dev server only in practice — app://local is our own handler).
  wc.on('will-redirect', denyForeign);
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame) setBubbleClickThrough(win, true);
  });
  // CX-6: a dead renderer used to strand the active playback — the runner and the pet stayed
  // `speaking`, the band was simply absent. Now: click-through, interrupt the turn and reset the
  // bubble state (`onCrash`), then reload the page once; a second death recreates the window.
  wc.on('render-process-gone', (_event, details) => {
    console.warn('[bubble] render process gone', details.reason);
    setBubbleClickThrough(win, true);
    hooks.onCrash();
    if (win.isDestroyed()) return;
    if (reloaded) {
      console.error('[bubble] renderer died again after a reload; recreating the window');
      hooks.onUnrecoverable();
      return;
    }
    reloaded = true;
    wc.reload();
  });
  // The reload's own failure: the startup load reports through the `loadURL` promise, so this arm
  // is only armed after a crash.
  wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !reloaded) return;
    console.error('[bubble] reload after a crash failed: %s (%d); recreating the window', errorDescription, errorCode);
    hooks.onUnrecoverable();
  });
  wc.on('did-finish-load', () => {
    if (reloaded) hooks.onReloaded();
  });
}

/** §5.4 rule 2. A hidden bubble measures 0x0, and `bubble:size` requires positive numbers. */
export function clampBubbleSize(size: Size): Size {
  return {
    width: Math.round(Math.min(Math.max(size.width, BUBBLE_MIN.width), BUBBLE_MAX.width)),
    height: Math.round(Math.min(Math.max(size.height, BUBBLE_MIN.height), BUBBLE_MAX.height)),
  };
}

/**
 * Places the bubble for a freshly measured content size and returns the placement main sends back
 * as `bubble:place` so the renderer can draw the notch on the right edge.
 *
 * `avoid` is the VISIBLE composer's rect, or `null` when the composer is hidden: the composer keeps
 * the band's anchor rect (§6.1) and the band is the surface that steps clear, so the two
 * always-on-top windows never render two texts into the same pixels. `brain-service.ts` is the only
 * caller and derives it from the chat window on every placement.
 */
export function placeBubbleWindow(
  bubble: BrowserWindow,
  pet: BrowserWindow,
  size: Size,
  avoid: Rect | null = null,
): Placement {
  const petBounds = pet.getBounds();
  // getDisplayMatching(petBounds), never getPrimaryDisplay(): that single choice is C14.
  const workArea = screen.getDisplayMatching(petBounds).workArea;
  const clamped = clampBubbleSize(size);
  const placement = placeBubble(petBounds, clamped, workArea, preferredSideFor(petBounds, workArea), avoid);
  bubble.setBounds({ x: placement.x, y: placement.y, width: clamped.width, height: clamped.height });
  return placement;
}

/** §5.4 rule 3: re-place at the current size — pet drag, drag end, display-metrics-changed. */
export function repositionBubble(
  bubble: BrowserWindow,
  pet: BrowserWindow,
  avoid: Rect | null = null,
): Placement {
  const b = bubble.getBounds();
  return placeBubbleWindow(bubble, pet, { width: b.width, height: b.height }, avoid);
}

/**
 * §5.4 rule 4. Same pattern as the pet's `avatar:hover` click-through, but on a different window —
 * which is precisely why R3 gave the bubble its own window. The pet window's hover predicate is
 * not touched.
 */
export function setBubbleClickThrough(bubble: BrowserWindow, ignore: boolean): void {
  if (bubble.isDestroyed()) return;
  if (ignore) bubble.setIgnoreMouseEvents(true, { forward: true });
  else bubble.setIgnoreMouseEvents(false);
}

/** §5.4 rule 6: showInactive, never show. The bubble must never take focus. */
export function showBubble(bubble: BubbleSurface): void {
  if (!bubble.isDestroyed() && !bubble.isVisible()) bubble.showInactive();
}

export function hideBubble(bubble: BubbleSurface): void {
  if (!bubble.isDestroyed() && bubble.isVisible()) bubble.hide();
}
