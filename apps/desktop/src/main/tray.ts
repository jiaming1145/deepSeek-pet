import { app, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';

export function createTray(actions: { toggleVisible(): void; toggleDebug(): void; quit(): void }): Tray {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png');
  // No GUID on purpose: Windows binds a tray GUID to the *executable path* that first registered
  // it and then refuses the icon for any other path (Shell_NotifyIcon fails, no icon at all).
  // Dev runs node_modules/.../electron.exe while a packaged build runs ds.exe, so a fixed GUID
  // would silently kill the tray icon of the packaged app on every machine that ran dev.
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('ds');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示/隐藏', click: actions.toggleVisible },
      { label: '调试面板', click: actions.toggleDebug },
      { type: 'separator' },
      { label: '退出', click: actions.quit },
    ]),
  );
  return tray;
}
