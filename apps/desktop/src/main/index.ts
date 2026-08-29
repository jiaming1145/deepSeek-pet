import { app, BrowserWindow, powerMonitor, type Tray } from 'electron';
import { join } from 'node:path';
import { Channels } from '@ds/protocol';
import { registerAppScheme, serveRenderer } from './app-protocol';
import { createPetWindow, moveBy, savePetPosition, setClickThrough } from './pet-window';
import { onFromPet, sendToPet } from './ipc';
import { startCursorPolling, type CursorPolling } from './cursor';
import { startForegroundWatch } from './foreground';
import { VisibilityState } from './visibility-state';
import { createTray } from './tray';

// userData must be %APPDATA%\ds, not %APPDATA%\@ds\desktop (the package name).
app.setName('ds');
registerAppScheme(); // must happen before the app is ready

let pet: BrowserWindow | null = null;
let tray: Tray | null = null; // held so the icon is not garbage-collected
let cursorPolling: CursorPolling | null = null;
let stopForeground: (() => void) | null = null;

// Four independent reasons she can be off screen, OR-ed together by VisibilityState. `locked` and
// `suspended` are tracked separately (not merged into one "system" flag): real Windows lock+sleep
// is lock-screen -> suspend -> resume -> (lock screen still showing) -> unlock-screen, and a single
// merged flag would clear at `resume` and reveal her behind the still-locked screen.
const visibility = new VisibilityState();

/**
 * The single owner of the pet window's visibility: any one flag hides her, and she only comes back
 * when all of them are clear. `reason` is derived from the flags (never passed in), so it can never
 * disagree with `hidden` when two flags are live at once. The renderer gets the same verdict on
 * `shell:visibility` so it can stop its render loop while hidden (spec §4.6); the cursor poll is
 * paused/resumed in lockstep so main stops IPC-ing `gaze:cursor` into a hidden window.
 */
function applyVisibility(): void {
  if (!pet || pet.isDestroyed()) return;
  const hidden = visibility.hidden;
  const reason = visibility.reason;
  console.log(`[shell] ${hidden ? 'hide' : 'show'} reason=${reason} ${visibility.describe()}`);
  // showInactive, never show: reappearing must not steal focus from the app the user is working in.
  if (hidden) pet.hide();
  else pet.showInactive();
  cursorPolling?.setPaused(hidden);
  sendToPet(pet, Channels.shellVisibility, { hidden, reason });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    visibility.set('user', false);
    applyVisibility();
  });

  app.whenReady().then(() => {
    serveRenderer(join(__dirname, '../renderer'));
    pet = createPetWindow();
    cursorPolling = startCursorPolling(pet);
    stopForeground = startForegroundWatch(pet, (hide) => {
      visibility.set('fullscreen', hide);
      applyVisibility();
    });

    // The screen lock and sleep both leave the window on a surface nobody can see while the
    // renderer keeps drawing; stopping it is the whole point of forwarding these.
    powerMonitor.on('lock-screen', () => {
      console.log('[power] lock-screen');
      visibility.set('locked', true);
      applyVisibility();
    });
    powerMonitor.on('suspend', () => {
      console.log('[power] suspend');
      visibility.set('suspended', true);
      applyVisibility();
    });
    powerMonitor.on('unlock-screen', () => {
      console.log('[power] unlock-screen');
      visibility.set('locked', false);
      applyVisibility();
    });
    powerMonitor.on('resume', () => {
      console.log('[power] resume');
      visibility.set('suspended', false);
      applyVisibility();
    });

    onFromPet(Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
    onFromPet(Channels.avatarDrag, ({ dx, dy }, win) => moveBy(win, dx, dy));
    onFromPet(Channels.avatarDragEnd, (_payload, win) => savePetPosition(win));
    onFromPet(Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
    onFromPet(Channels.stageReady, (info) => console.log('[pet] stage ready', info));
    onFromPet(Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

    tray = createTray({
      toggleVisible: () => {
        visibility.set('user', !visibility.get('user'));
        applyVisibility();
      },
      toggleDebug: () => {
        if (!pet) return;
        console.log('[tray] debug:toggle');
        sendToPet(pet, Channels.debugToggle, {});
      },
      quit: () => app.quit(),
    });
  }).catch((err: unknown) => {
    // Without this, a throw in startup only surfaces as an unhandled rejection warning and the
    // app sits there half-wired.
    console.error('[main] startup failed', err);
    app.quit();
  });

  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('before-quit', () => {
    // Safety net: a drag whose mouseup lands outside the window can lose its avatar:dragEnd.
    if (pet) savePetPosition(pet);
    cursorPolling?.stop();
    stopForeground?.();
    tray?.destroy();
    tray = null;
  });
}
