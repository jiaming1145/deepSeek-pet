// Electron harness for the actions lab (same window as the pet: transparent, frameless, on top, 640x900).
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/vrm/actions/main.js            interactive (keys on the HUD)
//   npx electron ../../spikes/vrm/actions/main.js --capture  every action at 20/50/80 % + every emotion -> shots/, report.json, then exit
// Pattern copied from ../main.js. Capture frames are stepped deterministically (lab.begin / lab.stepTo,
// 1/60 s steps); the fps numbers come from the real rAF loop afterwards.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('allow-file-access-from-files');
const CAPTURE = process.argv.includes('--capture');
const SHOTS = path.join(__dirname, 'shots');
const WIN = { width: 640, height: 900, x: 80, y: 40 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    ...WIN,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  const vrmIdx = process.argv.indexOf('--vrm');
  const vrmArg = vrmIdx >= 0 ? process.argv[vrmIdx + 1] : null;
  const vrmUrl = vrmArg ? require('node:url').pathToFileURL(path.resolve(__dirname, vrmArg)).href : null;
  await win.loadFile(path.join(__dirname, 'lab.html'), vrmUrl ? { query: { vrm: vrmUrl } } : undefined);
  const js = (s) => win.webContents.executeJavaScript(s, true);
  let ready = false;
  for (let i = 0; i < 600; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) { ready = true; break; }
    await wait(100);
  }
  if (!ready) { console.error('renderer never became ready (60 s)'); app.exit(1); return; }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify(info));
  if (!CAPTURE) return;

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const log = { info, actions: {}, emotions: {}, look: {}, errors: [] };
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const checkErr = async (tag) => { const err = await js('window.__error || null'); if (err) { console.error('RENDERER ERROR at ' + tag + '\n' + err); log.errors.push({ tag, err }); await js('window.__error = null'); } };
  const settle = async () => { await js("lab.stop(); lab.emotion('neutral'); lab.look('none'); lab.step(1.2)"); };
  await js("lab.hud(false); lab.blink(false); lab.cursor(0, 0); lab.pause(true); lab.look('none'); lab.step(1.0)");

  // --- reach / inspect targets at 85 % of the arm length, one on each side so the nearer-arm pick is exercised
  const armL = await js("lab.arm('left')"), armR = await js("lab.arm('right')");
  const RL = armL.length * 0.85, [lx, ly, lz] = armL.shoulder;
  const RR = armR.length * 0.85, [rx, ry, rz] = armR.shoulder;
  const reachTarget = [lx + RL * 0.45, ly + RL * 0.35, lz + RL * 0.75];      // character's left, up/forward -> left arm
  const inspectTarget = [rx - RR * 0.55, ry - RR * 0.45, rz + RR * 0.65];    // character's right, low/forward -> right arm

  // nominal capture durations for open-ended actions
  const plan = [
    ['idle', {}, 2.5], ['walk', {}, 2.666], ['hop', {}, null], ['sit', {}, 3.3], ['sleep', {}, 4.8], ['wake', {}, null, { after: 'sleep' }],
    ['stretch', {}, null], ['stumble', {}, null], ['recover', {}, null], ['reach', { target: reachTarget, duration: 2.0 }, null],
    ['inspect', { target: inspectTarget }, null], ['wave', {}, null], ['eat', { bites: 4 }, null], ['drink', {}, null], ['celebrate', {}, null], ['tail_react', {}, null],
  ];
  for (const [name, opts, nominal, extra] of plan) {
    try {
      if (extra?.after) { await js(`lab.begin(${JSON.stringify(extra.after)}, {}); lab.step(4.8)`); }   // wake follows a real sleep
      else if (name === 'recover') { await js("lab.begin('stumble', {}); lab.step(1.1)"); }              // recover follows a real stumble
      const r = extra?.after || name === 'recover' ? await js(`lab.start(${JSON.stringify(name)}, ${JSON.stringify(opts)})`) : await js(`lab.begin(${JSON.stringify(name)}, ${JSON.stringify(opts)})`);
      if (extra?.after || name === 'recover') await js('lab.stepTo(0)');
      const D = r.duration ?? nominal;
      const entry = { duration: r.duration, captureDuration: D, source: r.source, frames: [] };
      const base = await js('lab.snapshot().body.t');
      for (const [k, f] of [0.2, 0.5, 0.8].entries()) {
        await js(`lab.step(${(f * D - (k === 0 ? 0 : [0.2, 0.5, 0.8][k - 1] * D)).toFixed(4)})`);
        await wait(40);
        await shoot(`act_${name}_${k}`);
        const snap = await js('lab.snapshot()');
        entry.frames.push({ pct: f * 100, t: +(snap.body?.t ?? 0).toFixed(2), clip: snap.clip, lanes: snap.lanes, ik: snap.ik, props: snap.props, body: snap.body?.name, emotion: snap.emotion });
      }
      if (name === 'eat' || name === 'drink') { entry.propWorld = await js('lab.propWorld()'); entry.handWorld = await js("lab.handWorld('right')"); entry.mouth = await js('lab.mouth()'); }
      if (name === 'tail_react') { entry.springBefore = await js("lab.step(0.9); lab.springSample()"); await js("lab.start('tail_react', {})"); entry.springAfter = []; for (let i = 0; i < 4; i++) { await js('lab.step(0.05)'); entry.springAfter.push(await js('lab.springSample()')); } }
      log.actions[name] = entry;
      console.log('captured', name, JSON.stringify({ D, source: r.source, base }));
    } catch (e) { log.actions[name] = { error: String(e.message || e) }; console.error('action', name, e); }
    await checkErr(name);
    await settle();
  }

  // --- look patterns (gaze lane), cursor upper-left so follow/cursorLock/away/edge differ visibly
  await js("lab.begin('idle', {}); lab.cursor(-0.7, 0.35); lab.step(0.5)");
  for (const p of ['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none']) {
    await js(`lab.look(${JSON.stringify(p)}); lab.step(1.5)`);
    await wait(40); await shoot(`look_${p}`);
    const snap = await js('lab.snapshot()'); log.look[p] = snap.gaze;
  }
  await js("lab.cursor(0, 0); lab.look('none'); lab.step(1.0)");

  // --- emotions (expression lane) on idle
  for (const e of ['neutral', 'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious']) {
    await js(`lab.emotion(${JSON.stringify(e)}, 1); lab.step(0.8)`);
    await wait(40); await shoot(`emo_${e}`);
    const snap = await js('lab.snapshot()'); log.emotions[e] = { emotion: snap.emotion, expressions: snap.expressions };
  }
  await js("lab.emotion('happy', 1); lab.step(0.8); lab.emotion('surprised', 1); lab.step(0.07)"); await wait(40); await shoot('emo_xfade_happy_to_surprised');
  await js("lab.emotion('neutral', 1); lab.step(0.6)");
  await checkErr('emotions');

  // --- fps: real rAF loop. 5 s idle (idle clip + follow gaze + blink), then 5 s busy (eat: clip base + IK + prop + chew, wander gaze, happy)
  app.getAppMetrics();   // first call always reports 0 %; the delta is read after the busy window
  await js("lab.pause(false); lab.blink(true); lab.look('follow'); lab.cursor(0.3, 0.1); lab.hud(true)");
  await wait(500); await js('lab.resetStats()'); await wait(5000);
  log.perf = { idle: await js('lab.stats()') };
  await js("lab.start('eat', { bites: 5 }); lab.look('wander'); lab.emotion('happy', 1)");
  await wait(300); await js('lab.resetStats()'); await wait(5000);
  log.perf.busy = await js('lab.stats()');
  await shoot('hud_busy');
  const m = app.getAppMetrics();
  log.perf.processes = m.map((p) => ({ type: p.type, cpuPercent: +p.cpu.percentCPUUsage.toFixed(1), memMB: p.memory ? +(p.memory.workingSetSize / 1024).toFixed(0) : null }));
  await checkErr('perf');
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(log, null, 2));
  console.log('perf', JSON.stringify({ idleFps: log.perf.idle.fps, busyFps: log.perf.busy.fps, p95Idle: log.perf.idle.p95Ms, p95Busy: log.perf.busy.p95Ms }));
  app.exit(log.errors.length ? 2 : 0);
});
