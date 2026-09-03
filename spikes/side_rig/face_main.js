// Harness for the face kit lab: 900x900 transparent window, --capture shoots every mood + visemes + looks + a crossfade.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.commandLine.appendSwitch('allow-file-access-from-files');
const CAPTURE = process.argv.includes('--capture');
const SHOTS = path.join(__dirname, 'shots_face');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 700, height: 600, x: 80, y: 40, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  await win.loadFile(path.join(__dirname, 'face_lab.html'));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  let ready = false;
  for (let i = 0; i < 400; i++) { const err = await js('window.__error || null'); if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; } if (await js('!!window.__ready')) { ready = true; break; } await wait(100); }
  if (!ready) { console.error('renderer never became ready'); app.exit(1); return; }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify(info));
  if (!CAPTURE) return;
  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  await js('lab.hud(false); lab.pause(true)');
  const report = { moods: [], visemes: [], looks: [], fade: [], errors: [] };
  for (const m of info.moods) {
    try { await js(`lab.mood(${JSON.stringify(m)}); lab.step(0.5)`); await wait(30); await shoot('mood_' + m); report.moods.push(m); }
    catch (e) { report.errors.push({ tag: m, err: String(e.message || e) }); }
  }
  await js("lab.mood('neutral'); lab.step(0.5)");
  for (const v of ['aa', 'ih', 'ou', 'ee', 'oh']) { await js(`lab.viseme(${JSON.stringify(v)}); lab.step(0.3)`); await wait(30); await shoot('viseme_' + v); report.visemes.push(v); }
  await js('lab.viseme(null); lab.step(0.3)');
  for (const d of ['left', 'right', 'up', 'down']) { await js(`lab.look(${JSON.stringify(d)}); lab.step(0.3)`); await wait(30); await shoot('look_' + d); report.looks.push(d); }
  await js('lab.look(null); lab.step(0.3)');
  await js("lab.mood('neutral'); lab.step(0.5); lab.mood('cheerful')");
  for (const [i, s] of [0.03, 0.06, 0.12].entries()) { await js(`lab.step(${i === 0 ? s : s - [0.03, 0.06, 0.12][i - 1]})`); await wait(30); await shoot('fade_' + i); report.fade.push(s); }
  await js('lab.blink(); lab.step(0.07)'); await wait(30); await shoot('blink');
  const err = await js('window.__error || null'); if (err) report.errors.push({ tag: 'end', err });
  await js('lab.pause(false)'); await wait(400); report.fps = await js('lab.fps()');
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 1));
  console.log('captured', report.moods.length, 'moods,', report.visemes.length, 'visemes, errors', report.errors.length, 'fps', report.fps);
  app.exit(report.errors.length ? 2 : 0);
});
