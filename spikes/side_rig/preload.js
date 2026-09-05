// Bridge for the pet window: hit state (click-through toggling), quit, tray commands.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petBridge', {
  setHit: (over) => ipcRenderer.send('pet:hit', !!over),
  quit: () => ipcRenderer.send('pet:quit'),
  onCommand: (cb) => ipcRenderer.on('pet:command', (_e, cmd) => cb(cmd)),
  onIdle: (cb) => ipcRenderer.on('pet:idle', (_e, seconds) => cb(seconds)),
});
