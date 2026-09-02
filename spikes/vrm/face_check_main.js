// Electron harness for face_check.html (pet-style window: transparent, frameless, always-on-top, 640x900).
// Run from D:\ds\apps\desktop:
//   npx electron ../../spikes/vrm/face_check_main.js                       (interactive; keys on the HUD)
//   npx electron ../../spikes/vrm/face_check_main.js --capture [--out DIR] (scripted capture, then exit)
//   optional: --vrm <path-or-url> --mat <regex> --atlas <path-or-url>      (defaults: the stock Whale-chan-face
//             build tools/vrm/out/build/stock_whalechan_face.vrm, material ^eye$, spikes/model/face/face_atlas_states.json)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');
const argv = process.argv.slice(1);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const CAPTURE = argv.includes('--capture');
const OUT = opt('--out') || path.join(__dirname, '..', 'model', 'face', 'evidence_runtime');
const WIN = { width: 640, height: 900, x: 80, y: 40 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    ...WIN,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  const query = {};
  for (const k of ['vrm', 'mat', 'atlas']) { const v = opt('--' + k); if (v) query[k] = v; }
  await win.loadFile(path.join(__dirname, 'face_check.html'), { query });
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 600; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) break;
    await wait(100);
  }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify(info));
  if (!CAPTURE) return;

  fs.mkdirSync(OUT, { recursive: true });
  const shots = {};
  const shoot = async (name) => {
    await wait(150);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    shots[name] = { weights: await js('lab.weights()'), mapOffset: await js('lab.offset()') };
    const err = await js('window.__error || null'); if (err) { shots[name].error = err; console.error('RENDERER ERROR at ' + name + '\n' + err); }
  };
  await js('lab.hud(false)');
  await wait(600);
  // the four states the brief asks for, plus a few customs
  for (const e of ['neutral', 'happy', 'blink', 'aa', 'surprised', 'cheerful', 'affection', 'shy', 'sleepy', 'lookLeft', 'angry']) {
    await js(`lab.only(${JSON.stringify(e)})`); await shoot('expr_' + e);
  }
  // 50 % crossfade through the expression manager: both binds are isBinary, weight 0.5 -> outputWeight 0
  await js("lab.xfade('happy','surprised',0.5)"); await shoot('xfade_binary_50_happy_surprised');
  await js("lab.xfade('happy','surprised',0.6)"); await shoot('xfade_binary_60_happy_surprised');
  // 50 % crossfade the way the README describes: second face layer at the target cell, alpha-faded
  await js("lab.overlay('neutral','happy',0.5)"); await shoot('xfade_overlay_50_neutral_happy');
  await js("lab.overlay('happy','surprised',0.5)"); await shoot('xfade_overlay_50_happy_surprised');
  await js("lab.overlay(null); lab.only('neutral'); lab.hud(true)"); await shoot('hud_neutral');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ info, shots }, null, 2));
  console.log('captured', Object.keys(shots).length, 'shots ->', OUT);
  app.exit(Object.values(shots).some((s) => s.error) ? 2 : 0);
});
