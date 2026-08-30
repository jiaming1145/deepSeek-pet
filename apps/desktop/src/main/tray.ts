import { app, Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { join } from 'node:path';

// Stable tray GUID for the *packaged* app only (spec §7). Generated once with
// `node -e "console.log(require('crypto').randomUUID())"` and hard-coded — it must stay the
// same across builds so Windows recognizes this as the same tray icon (e.g. to restore a
// user's "always show" preference in the systray overflow). Never regenerate at runtime.
const TRAY_GUID = '204bbcbc-4990-403d-83b2-577785f13b41';

/**
 * A 16x16 white disc, PNG, base64. Embedded rather than read from disk because it exists precisely
 * for the case where the on-disk icon is missing or unreadable: `new Tray(emptyImage)` produces a
 * tray entry with no clickable target at all, and with `skipTaskbar` and the pet hidden, that
 * leaves the process with no show or quit control whatsoever.
 */
const FALLBACK_ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR42mP4//8/AyUYlwQuQJQBhABeA4gFWA0gFaAY'
  + 'QC4YNYCaBlAcjVRJSFRJylTJTCRhAJIsmJISbBmQAAAAAElFTkSuQmCC';

/** Never returns an empty image: an invisible tray icon is an unusable app, not a cosmetic bug. */
function loadTrayIcon(iconPath: string): NativeImage {
  // createFromPath() returns an *empty* image (not a thrown error) when the file is missing.
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) return icon;
  console.warn('[tray] icon missing or undecodable at', iconPath, '— using the built-in fallback');
  return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_PNG}`);
}

export function createTray(actions: {
  toggleVisible(): void;
  toggleDebug(): void;
  openChat(): void;
  openKey(): void;
  quit(): void;
}): Tray {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png');
  const icon = loadTrayIcon(iconPath);
  // GUID only when packaged: Windows binds a tray GUID to the *executable path* that first
  // registered it and refuses the icon for any other path (Shell_NotifyIcon fails, no icon at
  // all). Dev runs node_modules/.../electron.exe while a packaged build runs ds.exe, so passing
  // the same GUID in dev would let a dev run claim it and poison the packaged app's tray identity
  // on that machine. In dev we construct the tray without a GUID; the packaged app always gets
  // the fixed GUID above so its identity (and any OS-remembered icon preference) is stable across
  // updates.
  const tray = app.isPackaged ? new Tray(icon, TRAY_GUID) : new Tray(icon);
  tray.setToolTip('ds');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示/隐藏', click: actions.toggleVisible },
      { label: '打开对话', click: actions.openChat },
      { label: '设置 API Key', click: actions.openKey },
      { label: '调试面板', click: actions.toggleDebug },
      { type: 'separator' },
      { label: '退出', click: actions.quit },
    ]),
  );
  return tray;
}
