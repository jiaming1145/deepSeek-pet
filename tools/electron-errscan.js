// Electron renderer error scan for a spike page: boots it, presses every key the spike
// documents, moves the mouse, calls every window.lab.* function, and prints any renderer
// error (window.__error, set by the spike's error/unhandledrejection handlers) plus every
// console error. Usage, from D:\ds\apps\desktop:
//   npx electron ..\..\tools\electron-errscan.js <absolute path to the spike index.html>
// Exit 0 always; read the JSON. A clean run prints "errors": [].

const { app, BrowserWindow } = require('electron'); const path = require('node:path');
app.commandLine.appendSwitch('allow-file-access-from-files');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const target = process.argv[process.argv.length - 1];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 900, x: 1400, y: 40, show: true, transparent: true, frame: false, webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const msgs = [];
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 1) msgs.push({ level, message: String(message).slice(0, 300), where: `${path.basename(String(src))}:${line}` }); });
  await win.loadFile(target);
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 150; i++) { if (await js('!!window.__ready')) break; await wait(100); }
  const ready = await js('!!window.__ready'); const boot = await js('window.__error || null');
  const errs = [];
  const check = async (tag) => { const e = await js('window.__error || null'); if (e) { errs.push({ tag, err: String(e).split('\n').slice(0, 3).join(' | ') }); await js('window.__error = null'); } };
  await check('boot');
  const keys = ['1','2','3','4','5','0','b','B','t','T','w','W','h','H','n','N','r','R','a','A','m','M',' ','g','G','Escape'];
  for (const k of keys) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(350); await check('key ' + JSON.stringify(k)); }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 320, y: 300 }); await wait(200); await check('mousemove');
  const labKeys = await js('Object.keys(window.lab||{})');
  for (const fn of labKeys) { try { await js(`(async()=>{ const r = window.lab[${JSON.stringify(fn)}]; if (typeof r==='function' && !['play','setPhase'].includes(${JSON.stringify(fn)})) { const v = r.length ? r(0.3, 0.2) : r(); if (v && v.then) await v; } })()`); } catch (e) { errs.push({ tag: 'lab.' + fn, err: String(e.message || e).slice(0, 200) }); } await wait(120); await check('lab.' + fn); }
  await wait(1500); await check('final');
  console.log(JSON.stringify({ ready, boot, labKeys, errors: errs, console_errors: msgs.filter(m => m.level >= 2).slice(0, 20), warnings: msgs.filter(m => m.level === 1).length }, null, 1));
  app.exit(0);
});
