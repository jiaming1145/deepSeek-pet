import { app, BrowserWindow, powerMonitor, type Tray, screen } from 'electron';
import { join } from 'node:path';
import { Channels } from '@ds/protocol';
import { registerAppScheme, serveRenderer } from './app-protocol';
import { createPetWindow, handleLoadFailure, moveBy, reconcileDisplays, savePetPosition, setClickThrough } from './pet-window';
import { onFromPet, sendToPet } from './ipc';
import { startCursorPolling, type CursorPolling } from './cursor';
import { startForegroundWatch, type ForegroundWatch } from './foreground';
import { createVisibilityController } from './visibility-state';
import { createTray } from './tray';

// userData must be %APPDATA%\ds, not %APPDATA%\@ds\desktop (the package name).
app.setName('ds');
registerAppScheme(); // must happen before the app is ready

let pet: BrowserWindow | null = null;
let tray: Tray | null = null; // held so the icon is not garbage-collected
let cursorPolling: CursorPolling | null = null;
let foreground: ForegroundWatch | null = null;

/**
 * The single owner of the pet window's visibility. Four independent reasons she can be off screen,
 * OR-ed together; `locked` and `suspended` are tracked separately (not merged into one "system"
 * flag) because real Windows lock+sleep is lock-screen -> suspend -> resume -> (lock screen still
 * showing) -> unlock-screen, and a merged flag would clear at `resume` and reveal her behind the
 * still-locked screen.
 *
 * Everything that shows or hides her routes through `visibility.apply()` — including the window's
 * own `ready-to-show`, which is why `createPetWindow` no longer shows itself.
 */
const visibility = createVisibilityController({
  window: () => pet,
  send: (verdict) => {
    if (pet) sendToPet(pet, Channels.shellVisibility, verdict);
  },
  setCursorPaused: (paused) => cursorPolling?.setPaused(paused),
  setClickThrough: (ignore) => { if (pet) setClickThrough(pet, ignore); },
  recheckCursor: () => cursorPolling?.recheck(),
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    visibility.set('user', false);
    visibility.apply();
  });

  app.whenReady().then(() => {
    serveRenderer(join(__dirname, '../renderer'));
    pet = createPetWindow({
      // Not `showInactive()`: the first paint asks the visibility owner whether she may appear, so
      // a hide that landed during renderer startup is honoured instead of being overridden.
      onReadyToShow: () => visibility.apply(),
      onLoadFailure: (err) =>
        handleLoadFailure(err, {
          destroyWindow: () => {
            pet?.destroy();
            pet = null;
          },
          stopCursor: () => cursorPolling?.stop(),
          stopForeground: () => foreground?.stop(),
          destroyTray: () => {
            tray?.destroy();
            tray = null;
          },
          quit: () => app.quit(),
        }),
    });
    cursorPolling = startCursorPolling(pet);
    foreground = startForegroundWatch(pet, (hide) => {
      visibility.set('fullscreen', hide);
      visibility.apply();
    });

    // The screen lock and sleep both leave the window on a surface nobody can see while the
    // renderer keeps drawing; stopping it is the whole point of forwarding these.
    powerMonitor.on('lock-screen', () => {
      console.log('[power] lock-screen');
      visibility.set('locked', true);
      visibility.apply();
    });
    powerMonitor.on('suspend', () => {
      console.log('[power] suspend');
      visibility.set('suspended', true);
      visibility.apply();
    });
    powerMonitor.on('unlock-screen', () => {
      console.log('[power] unlock-screen');
      visibility.set('locked', false);
      visibility.apply();
      // The foreground state can have changed entirely while the lock screen was up; do not wait
      // out the poll interval to find out.
      foreground?.recheck();
    });
    powerMonitor.on('resume', () => {
      console.log('[power] resume');
      visibility.set('suspended', false);
      visibility.apply();
      foreground?.recheck();
    });

    onFromPet(pet, Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
    onFromPet(pet, Channels.avatarDrag, ({ dx, dy }, win) => moveBy(win, dx, dy));
    onFromPet(pet, Channels.avatarDragEnd, (_payload, win) => savePetPosition(win));
    onFromPet(pet, Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
    onFromPet(pet, Channels.stageReady, (info) => {
      console.log('[pet] stage ready', info);
      // `shell:visibility` is a one-shot notification and the renderer only installs its listener
      // after the Live2D model finishes loading, so any verdict issued during those ~1000 ms landed
      // on nobody. `stage:ready` is the sync point: replay the verdict (and the cursor position,
      // which a fresh renderer also knows nothing about). Also covers a reload.
      visibility.resend();
      cursorPolling?.recheck();
    });
    onFromPet(pet, Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

    tray = createTray({
      toggleVisible: () => {
        visibility.set('user', !visibility.get('user'));
        visibility.apply();
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

  // A monitor unplugged (or rescaled) under her: clampDrag only runs on the next drag event and
  // clampToDisplays only at startup, so without this she can stay stranded on a display that is gone.
  const onDisplaysChanged = (): void => {
    if (pet && reconcileDisplays(pet)) console.log('[pet] moved back onto a live display');
  };
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  app.on('before-quit', () => {
    screen.removeListener('display-removed', onDisplaysChanged);
    screen.removeListener('display-metrics-changed', onDisplaysChanged);
    // Safety net: a drag whose mouseup lands outside the window can lose its avatar:dragEnd.
    if (pet) savePetPosition(pet);
    cursorPolling?.stop();
    foreground?.stop();
    tray?.destroy();
    tray = null;
  });
}
