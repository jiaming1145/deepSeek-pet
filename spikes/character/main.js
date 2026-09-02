// Throwaway Electron harness for the character lab. Same window configuration as the real pet
// (transparent, frameless, always-on-top). Captures every action at four phases and every
// expression once, then exits. Run without arguments for an interactive window that stays open:
//   npx electron spikes/character/main.js            (interactive)
//   npx electron spikes/character/main.js --capture  (scripted capture into shots/)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');
const CAPTURE = process.argv.includes('--capture');
const SHOTS = path.join(__dirname, 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 900, x: 80, y: 40,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadFile(path.join(__dirname, 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 200; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) break;
    await wait(100);
  }
  console.log('ready; bones', await js('lab.bones()'), 'joints', JSON.stringify(await js('lab.joints()')).slice(0, 200));
  if (!CAPTURE) return;                       // interactive: leave the window up

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  await js('lab.noBlink(); lab.hud(false); lab.look(0.15,0.05)');

  const actions = await js('lab.actions()');
  const phases = [0.12, 0.38, 0.64, 0.9];
  for (const a of actions) {
    await js(`lab.expression('neutral'); lab.action(${JSON.stringify(a)})`);
    if (a === 'reach' || a === 'inspect') await js('lab.reach(760, 980)');
    for (let k = 0; k < phases.length; k++) {
      await js(`lab.setPhase(${phases[k]})`);
      await wait(a === 'idle' || a === 'sleep' || a === 'look' ? 420 : 260);   // let physics settle a little
      await shoot(`action_${a}_${k}`);
    }
    console.log('action', a);
  }
  await js("lab.action('idle')");
  const exprs = await js('lab.expressions()');
  for (const e of exprs) {
    await js(`lab.expression(${JSON.stringify(e)})`);
    await wait(380);
    await shoot(`expr_${e}`);
  }
  await js("lab.expression('neutral'); lab.talk(true)"); await wait(160); await shoot('expr_talking_a'); await wait(90); await shoot('expr_talking_b'); await js('lab.talk(false)');
  // gaze: three looks
  for (const [i, [x, y]] of [[-0.9, -0.3], [0, 0], [0.9, 0.4]].entries()) { await js(`lab.look(${x},${y})`); await wait(500); await shoot(`gaze_${i}`); }
  const stats = await js('lab.stats()');
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ actions, expressions: exprs, stats, approx_fps: null }, null, 2));
  console.log(JSON.stringify(stats));
  app.exit(0);
});
