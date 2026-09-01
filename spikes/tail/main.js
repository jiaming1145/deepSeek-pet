// Throwaway Electron harness for the tail spike. Mirrors the real pet window:
// transparent, frameless, always-on-top. Runs a scripted capture sequence.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
  console.log('shot', name);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 900, x: 80, y: 60,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadFile(path.join(__dirname, 'index.html'));

  const js = (s) => win.webContents.executeJavaScript(s, true);

  // wait for assets
  for (let i = 0; i < 100; i++) {
    const err = await js('window.__spikeError || null');
    if (err) { console.error('RENDERER ERROR:\n' + err); app.exit(1); return; }
    if (await js('!!window.__spikeReady')) break;
    await wait(100);
  }
  console.log('ready');

  // 1. idle sway
  await js('spike.reset(); spike.resetStats(); spike.setRigid(false)');
  await wait(2200);
  await shoot(win, '01_idle');
  const idleStats = await js('spike.stats()');

  // 2. pull the tail hard to one side (skinned)
  await js('spike.grab(150)');
  await wait(450);
  await shoot(win, '02_pull_skinned');
  const pullAngles = await js('spike.angles()');

  // 3. release -> whip through the chain
  await js('spike.release()');
  await wait(110); await shoot(win, '03_whip_a');
  await wait(170); await shoot(win, '04_whip_b');
  await wait(260); await shoot(win, '05_whip_c');

  // 4. same pull with mesh deformation OFF, for comparison
  await js('spike.reset(); spike.setRigid(true)');
  await wait(300);
  await js('spike.grab(150)');
  await wait(450);
  await shoot(win, '06_pull_rigid');
  const rigidAngles = await js('spike.angles()');

  // 4b. TUNED rig: root skinned continuously with the stock + weights ramped in
  await js('spike.reset(); spike.setRigid(false); spike.setPin(true)');
  await wait(300);
  await js('spike.grab(150)');
  await wait(450);
  await shoot(win, '08_pull_pinned');
  await js('spike.release()');
  await wait(280); await shoot(win, '09_whip_pinned');
  // 4c. the old behaviour for comparison: no pin, root free
  await js('spike.reset(); spike.setPin(false)');
  await wait(300);
  await js('spike.grab(150)');
  await wait(450);
  await shoot(win, '10_pull_untuned');
  await js('spike.release(); spike.setPin(true)');

  // 5. mood-driven idle curl (skinned)
  await js('spike.release(); spike.reset(); spike.setRigid(false); spike.setMood(1)');
  await wait(1500);
  await shoot(win, '07_mood_happy');

  // 6. perf over a clean window of pure idle animation
  await js('spike.reset(); spike.resetStats()');
  await wait(4000);
  const perf = await js('spike.stats()');

  const report = {
    idle_capture_stats: idleStats,
    pull_angles_deg_skinned: pullAngles,
    pull_angles_deg_rigid: rigidAngles,
    idle_4s_perf: perf,
    approx_fps: perf.frames / 4,
  };
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
});
