// Electron harness for the side-view layered rig (same window as the pet: transparent, frameless, on top).
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/side_rig/main.js             interactive (keys on the HUD)
//   npx electron ../../spikes/side_rig/main.js --tour      cycles every action, loops until closed
//   npx electron ../../spikes/side_rig/main.js --capture   every action at 20/50/80 % + expressions -> shots/, then exit
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');
const CAPTURE = process.argv.includes('--capture');
const TOUR = process.argv.includes('--tour');
const SHOTS = path.join(__dirname, 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 900, x: 80, y: 40,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  await win.loadFile(path.join(__dirname, 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  let ready = false;
  for (let i = 0; i < 300; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) { ready = true; break; }
    await wait(100);
  }
  if (!ready) { console.error('renderer never became ready'); app.exit(1); return; }
  console.log('ready', JSON.stringify(await js('lab.info()')));

  if (TOUR) {
    const plan = [['idle', 3], ['walk', 4], ['run', 3], ['hop', 2], ['wave', 3], ['look', 3], ['talk', 3], ['sit', 3], ['sleep', 4], ['wake', 2], ['idle', 2]];
    const emos = ['neutral', 'happy', 'surprised', 'sad', 'angry', 'happy'];
    (async () => {
      for (let round = 0; !win.isDestroyed(); round++) {
        for (const [i, [name, secs]] of plan.entries()) {
          if (win.isDestroyed()) return;
          try { await js(`lab.emotion(${JSON.stringify(emos[i % emos.length])}); lab.start(${JSON.stringify(name)})`); console.log(`tour ${round}: ${name}`); }
          catch (e) { console.error('tour', name, e.message || e); }
          await wait(secs * 1000);
          const err = await js('window.__error || null');
          if (err) { console.error('RENDERER ERROR during tour ' + name + ': ' + err); await js('window.__error = null'); }
        }
      }
    })();
    return;
  }
  if (!CAPTURE) return;

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const report = { actions: {}, emotions: [], errors: [] };
  await js('lab.hud(false); lab.pause(true)');
  const plan = [['idle', 2.4], ['walk', 2.0], ['run', 1.4], ['hop', 1.2], ['wave', 2.0], ['look', 2.0], ['talk', 2.0], ['sit', 2.4], ['sleep', 3.0], ['wake', 1.6], ['turn', 1.2]];
  for (const [name, D] of plan) {
    try {
      await js(`lab.begin(${JSON.stringify(name)})`);
      let prev = 0;
      for (const [k, f] of [0.2, 0.5, 0.8].entries()) {
        await js(`lab.step(${(f * D - prev).toFixed(4)})`); prev = f * D;
        await wait(30); await shoot(`act_${name}_${k}`);
      }
      report.actions[name] = await js('lab.snapshot()');
    } catch (e) { report.errors.push({ tag: name, err: String(e.message || e) }); }
    const err = await js('window.__error || null');
    if (err) { report.errors.push({ tag: name, err }); await js('window.__error = null'); }
    await js("lab.stop(); lab.step(0.8)");
  }
  await js("lab.begin('idle'); lab.step(0.5)");
  for (const e of ['neutral', 'happy', 'sad', 'angry', 'surprised', 'think']) {
    await js(`lab.emotion(${JSON.stringify(e)}); lab.step(0.6)`); await wait(30); await shoot(`emo_${e}`); report.emotions.push(e);
  }
  await js('lab.pause(false)');
  await wait(400);
  report.fps = await js('lab.fps()');
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 1));
  console.log('captured', Object.keys(report.actions).length, 'actions,', report.emotions.length, 'emotions, errors', report.errors.length, 'fps', report.fps);
  app.exit(report.errors.length ? 2 : 0);
});
