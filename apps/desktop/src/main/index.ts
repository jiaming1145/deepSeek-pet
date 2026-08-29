import { app, BrowserWindow, powerMonitor, type Tray } from 'electron';
import { join } from 'node:path';
import { Channels } from '@ds/protocol';
import { registerAppScheme, serveRenderer } from './app-protocol';
import { createPetWindow, moveBy, savePetPosition, setClickThrough } from './pet-window';
import { onFromPet, sendToPet } from './ipc';
import { startCursorPolling } from './cursor';
import { startForegroundWatch } from './foreground';
import { createTray } from './tray';

// userData must be %APPDATA%\ds, not %APPDATA%\@ds\desktop (the package name).
app.setName('ds');
registerAppScheme(); // must happen before the app is ready

let pet: BrowserWindow | null = null;
let tray: Tray | null = null; // held so the icon is not garbage-collected
let stopCursor: (() => void) | null = null;
let stopForeground: (() => void) | null = null;

// Three independent reasons she can be off screen. They are tracked separately rather than as one
// boolean so that, say, leaving fullscreen while the screen is still locked does not reveal her.
let userHidden = false; // tray → 显示/隐藏
let fullscreenHidden = false; // a foreign window covers a whole display
let systemHidden = false; // session locked or machine suspended

/**
 * The single owner of the pet window's visibility: any one reason hides her, and she only comes
 * back when all of them are clear. The renderer gets the same verdict on `shell:visibility` so it
 * can stop its render loop while hidden (spec §4.6).
 */
function applyVisibility(reason: 'fullscreen' | 'locked' | 'suspended' | 'user' | 'none'): void {
  if (!pet || pet.isDestroyed()) return;
  const hidden = userHidden || fullscreenHidden || systemHidden;
  console.log(`[shell] ${hidden ? 'hide' : 'show'} reason=${hidden ? reason : 'none'} user=${userHidden} fullscreen=${fullscreenHidden} system=${systemHidden}`);
  // showInactive, never show: reappearing must not steal focus from the app the user is working in.
  if (hidden) pet.hide();
  else pet.showInactive();
  sendToPet(pet, Channels.shellVisibility, { hidden, reason: hidden ? reason : 'none' });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    userHidden = false;
    applyVisibility('none');
  });

  app.whenReady().then(() => {
    serveRenderer(join(__dirname, '../renderer'));
    pet = createPetWindow();
    stopCursor = startCursorPolling(pet);
    stopForeground = startForegroundWatch(pet, (hide) => {
      fullscreenHidden = hide;
      applyVisibility('fullscreen');
    });

    // The screen lock and sleep both leave the window on a surface nobody can see while the
    // renderer keeps drawing; stopping it is the whole point of forwarding these.
    powerMonitor.on('lock-screen', () => {
      console.log('[power] lock-screen');
      systemHidden = true;
      applyVisibility('locked');
    });
    powerMonitor.on('suspend', () => {
      console.log('[power] suspend');
      systemHidden = true;
      applyVisibility('suspended');
    });
    powerMonitor.on('unlock-screen', () => {
      console.log('[power] unlock-screen');
      systemHidden = false;
      applyVisibility('none');
    });
    powerMonitor.on('resume', () => {
      console.log('[power] resume');
      systemHidden = false;
      applyVisibility('none');
    });

    onFromPet(Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
    onFromPet(Channels.avatarDrag, ({ dx, dy }, win) => moveBy(win, dx, dy));
    onFromPet(Channels.avatarDragEnd, (_payload, win) => savePetPosition(win));
    onFromPet(Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
    onFromPet(Channels.stageReady, (info) => console.log('[pet] stage ready', info));
    onFromPet(Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

    tray = createTray({
      toggleVisible: () => {
        userHidden = !userHidden;
        applyVisibility('user');
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
    stopCursor?.();
    stopForeground?.();
    tray?.destroy();
    tray = null;
  });
}
