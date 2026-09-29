// macOS entry for the pet. It runs main.js unchanged and adds only what macOS needs on top of it:
//   pnpm pet:mac                  (same flags as main.js: --pet, --height, --selftest ...)
// On any other platform it is exactly main.js.
const { app, BrowserWindow, Menu } = require('electron');

const PET = process.argv.includes('--pet');
const MAC = process.platform === 'darwin';

// She lives in the menu bar's tray icon, not the Dock. skipTaskbar only hides the Windows taskbar button, so without
// this a Dock icon sat there for an invisible full-screen window.
if (MAC && PET && app.dock) app.dock.hide();

require('./main.js');

if (MAC && PET) {
  // Both handlers wait on the same ready promise, so this one runs after main.js's has created her window and cleared
  // the application menu (it does both before its first await).
  app.whenReady().then(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;       // a second launch: main.js is already quitting
    // main.js drops the menu so Ctrl+R / Ctrl+W cannot reload or close her. On macOS copy, paste, cut, select-all and
    // undo in the chat box are menu key equivalents, so with no menu Cmd+V did nothing. Put back only those (and
    // Cmd+Q); still no reload, no close, no hide. The Dock is hidden, so this menu is never shown, only its keys work.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ] },
    ]));
    // Windows has one desktop; macOS has Spaces and full-screen apps. Follow the owner onto all of them, as she
    // does on Windows. skipTransformProcessType: the default flips the process type and brings the Dock icon back.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  });
}
