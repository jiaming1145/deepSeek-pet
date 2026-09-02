// Electron harness that proves the retargeted clips actually pose a VRM. Same window
// configuration as the pet (transparent, frameless, always-on-top). Copied from
// spikes/character/main.js.
//   cd D:/ds/apps/desktop && npx electron ../../spikes/vrm/anim/preview/main.cjs            (interactive)
//   cd D:/ds/apps/desktop && npx electron ../../spikes/vrm/anim/preview/main.cjs --capture  (screenshots into preview/shots/)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');
const CAPTURE = process.argv.includes('--capture');
const SHOTS = path.join(__dirname, 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 480, height: 720, x: 80, y: 40,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => { console.error('did-fail-load', code, desc, url); });
  await win.loadFile(path.join(__dirname, 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  let ready = false;
  for (let i = 0; i < 300; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) { ready = true; break; }
    await wait(100);
  }
  if (!ready) { console.error('renderer never became ready (30 s)'); app.exit(1); return; }
  console.log('ready');
  if (!CAPTURE) { await js("lab.quaternius('Walk_Loop')"); return; }

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const report = [];
  const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Loop', 'Sitting_Idle_Loop', 'Dance_Loop', 'Interact', 'PickUp_Table', 'Death01', 'Hit_Chest', 'Roll'];
  for (const c of clips) {
    const info = await js(`lab.quaternius(${JSON.stringify(c)})`);
    for (const [k, frac] of [[0, 0.15], [1, 0.55]]) {
      await js(`lab.setTime(${(info.duration * frac).toFixed(3)})`);
      await wait(120);
      await shoot(`quaternius_${c}_${k}`);
    }
    report.push(info);
    console.log('captured', JSON.stringify(info));
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
  }
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'vrma')).filter((f) => f.endsWith('.vrma'))) {
    const info = await js(`lab.vrma(${JSON.stringify(f)})`);
    for (const [k, frac] of [[0, 0.3], [1, 0.7]]) {
      await js(`lab.setTime(${(info.duration * frac).toFixed(3)})`);
      await wait(120);
      await shoot(`vrma_${f.replace(/\.vrma$/, '')}_${k}`);
    }
    report.push(info);
    console.log('captured', JSON.stringify(info));
  }
  const mixamoDir = path.join(__dirname, '..', 'mixamo');
  for (const f of fs.existsSync(mixamoDir) ? fs.readdirSync(mixamoDir).filter((f) => f.toLowerCase().endsWith('.fbx')) : []) {
    const info = await js(`lab.mixamo(${JSON.stringify(f)})`);
    for (const [k, frac] of [[0, 0.3], [1, 0.7]]) {
      await js(`lab.setTime(${(info.duration * frac).toFixed(3)})`);
      await wait(120);
      await shoot(`mixamo_${f.replace(/\.fbx$/i, '')}_${k}`);
    }
    report.push(info);
    console.log('captured', JSON.stringify(info));
  }
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  app.exit(0);
});
