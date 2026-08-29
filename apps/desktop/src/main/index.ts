import { app, BrowserWindow, type Tray } from 'electron';
import { join } from 'node:path';
import { Channels } from '@ds/protocol';
import { registerAppScheme, serveRenderer } from './app-protocol';
import { createPetWindow, moveBy, savePetPosition, setClickThrough } from './pet-window';
import { onFromPet, sendToPet } from './ipc';
import { startCursorPolling } from './cursor';
import { createTray } from './tray';

// userData must be %APPDATA%\ds, not %APPDATA%\@ds\desktop (the package name).
app.setName('ds');
registerAppScheme(); // must happen before the app is ready

let pet: BrowserWindow | null = null;
let tray: Tray | null = null; // held so the icon is not garbage-collected
let stopCursor: (() => void) | null = null;
let userHidden = false;

function showPet(visible: boolean): void {
  if (!pet || pet.isDestroyed()) return;
  if (visible) pet.showInactive();
  else pet.hide();
  sendToPet(pet, Channels.shellVisibility, { hidden: !visible, reason: visible ? 'none' : 'user' });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    userHidden = false;
    showPet(true);
  });

  app.whenReady().then(() => {
    serveRenderer(join(__dirname, '../renderer'));
    pet = createPetWindow();
    stopCursor = startCursorPolling(pet);

    onFromPet(Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
    onFromPet(Channels.avatarDrag, ({ dx, dy }, win) => moveBy(win, dx, dy));
    onFromPet(Channels.avatarDragEnd, (_payload, win) => savePetPosition(win));
    onFromPet(Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
    onFromPet(Channels.stageReady, (info) => console.log('[pet] stage ready', info));
    onFromPet(Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

    tray = createTray({
      toggleVisible: () => {
        userHidden = !userHidden;
        showPet(!userHidden);
      },
      toggleDebug: () => {
        if (!pet) return;
        // Logged because the renderer-side handler for this channel arrives in Task 8: until then
        // this is the only way to see that the menu item fired.
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
    tray?.destroy();
    tray = null;
  });
}
