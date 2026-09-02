// Throwaway Electron harness for the VRM lab. Same window configuration as the real pet
// (transparent, frameless, always-on-top, 640x900). Run from D:\ds\apps\desktop:
//   npx electron ../../spikes/vrm/main.js            (interactive; keys are on the HUD)
//   npx electron ../../spikes/vrm/main.js --capture  (scripted capture into shots/, then exit)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

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
  // --vrm <path>: load a different model (absolute path or relative to this directory), e.g. the
  // hookup output tools/vrm/out/whalechan/<run>/whalechan.vrm. Forwarded to the page as ?vrm=<file URL>.
  const vrmIdx = process.argv.indexOf('--vrm');
  const vrmArg = vrmIdx >= 0 ? process.argv[vrmIdx + 1] : null;
  const vrmUrl = vrmArg ? require('node:url').pathToFileURL(path.resolve(__dirname, vrmArg)).href : null;
  await win.loadFile(path.join(__dirname, 'index.html'), vrmUrl ? { query: { vrm: vrmUrl } } : undefined);
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 300; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) break;
    await wait(100);
  }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify(info));
  // --eval <file.js>: run an async snippet (it can `await js(...)`, `wait(ms)`, `shoot(name)`), print its JSON result, exit.
  const evalIdx = process.argv.indexOf('--eval');
  if (evalIdx > 0) {
    const shootTo = async (name) => { const img = await win.webContents.capturePage(); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
    try {
      const fn = new Function('js', 'wait', 'shoot', 'return (async () => {' + fs.readFileSync(process.argv[evalIdx + 1], 'utf8') + '})()');
      console.log('EVAL ' + JSON.stringify(await fn(js, wait, shootTo)));
      const err = await js('window.__error || null'); if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    } catch (e) { console.error('EVAL ERROR', e); app.exit(1); return; }
    app.exit(0); return;
  }
  if (!CAPTURE) return;                       // interactive: leave the window up

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const log = {};
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const checkErr = async (tag) => { const err = await js('window.__error || null'); if (err) { console.error('RENDERER ERROR at ' + tag + '\n' + err); log.error = { tag, err }; } };
  await js('lab.hud(false); lab.blink(false); lab.look(0,0)');
  await wait(800);

  // --- transparency proof: capturePage alpha AND a real desktop screenshot of the window region
  await shoot('idle_0');
  try {
    const ps = `Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap ${WIN.width},${WIN.height}; $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${WIN.x},${WIN.y},0,0,$b.Size); $b.Save('${path.join(SHOTS, 'desktop_composite.png').replace(/\\/g, '/')}')`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps]);
  } catch (e) { console.error('desktop screenshot failed', e.message); }

  // --- idle breathing at three points of the 3.6 s cycle
  for (const [i, t] of [0.0, 0.9, 1.8].entries()) { await js(`lab.setTime(${t})`); await wait(120); await shoot(`breath_${i}`); }
  // --- look-at: eyes (vrm.lookAt) + the head-turn layer; log the applied and the measured head angles
  log.head = {};
  for (const [n, [x, y]] of Object.entries({ left: [-1, 0.1], right: [1, 0.1], up: [0, 1], down: [0, -1] })) { await js(`lab.look(${x},${y})`); await wait(600); await shoot(`look_${n}`); log.head[n] = await js('lab.head()'); }
  await js('lab.headTurnOn(false); lab.look(-1,0.1)'); await wait(600); await shoot('look_left_eyesonly'); log.head.left_eyesonly = await js('lab.head()');
  await js('lab.headTurnOn(true); lab.look(0,0)'); await wait(400);
  // --- blink
  await js('lab.forceBlink(0)'); await wait(100); await shoot('blink_open');
  await js('lab.forceBlink(1)'); await wait(100); await shoot('blink_closed');
  await js('lab.forceBlink(0.5)'); await wait(100); await shoot('blink_half');
  await js('lab.forceBlink(null)');
  // --- lip sync visemes
  for (const v of ['aa', 'ih', 'ou']) { await js(`lab.forceViseme('${v}')`); await wait(100); await shoot(`lip_${v}`); }
  await js('lab.forceViseme(null); lab.talk(true)'); await wait(70); await shoot('lip_talk_a'); await wait(90); await shoot('lip_talk_b'); await js('lab.talk(false)');
  // --- expressions + a crossfade midpoint
  for (const e of ['happy', 'angry', 'sad', 'relaxed', 'surprised']) { await js(`lab.expression('${e}')`); await wait(600); await shoot(`expr_${e}`); }
  await js("lab.expression('happy')"); await wait(600); await js("lab.expression('surprised')"); await wait(70); await shoot('expr_xfade_happy_to_surprised');
  await wait(600); await js("lab.expression('neutral')"); await wait(500);
  // --- spring bones: nudge the root sideways and sample hair/skirt joints over time
  log.springBefore = await js('lab.springSample()');
  await shoot('spring_rest');
  await js('lab.nudge(1.6, 0.4)');
  log.springAfter = [];
  for (let i = 0; i < 4; i++) { await wait(i === 0 ? 60 : 130); log.springAfter.push(await js('lab.springSample()')); await shoot(`spring_nudge_${i}`); }
  await wait(1200);
  // --- clip route (shared retargeter, one AnimationMixer, crossfades). Idle_Loop is already the base state.
  log.clips = { load: await js('lab.clipLoad()'), shots: {} };
  const clipShots = async (tag, times) => { for (const [i, t] of times.entries()) { await js(`lab.clipTime(${t})`); await wait(120); await shoot(`${tag}_${i}`); } log.clips.shots[tag] = { state: await js('lab.clipState()'), times }; };
  await clipShots('clip_idle', [0.3, 1.5]);
  await js("lab.action('walk')"); await wait(400); await clipShots('clip_walk', [0.2, 0.55, 0.9]);
  // crossfade midpoint walk -> idle with a long fade, weights logged
  await js("lab.clip('quaternius:Idle_Loop', { fade: 0.8 })"); await wait(380); await shoot('xfade_walk_idle'); log.clips.xfadeWeights = await js('lab.mixerWeights()');
  await wait(700);
  await js("lab.action('sit')"); await wait(650); await shoot('clip_sit_enter'); await wait(1300); await clipShots('clip_sit', [0.3, 1.1]);
  await js("lab.action('stand')"); await wait(1500);
  await js("lab.action('jump')"); await wait(450); await shoot('clip_jump_0'); await wait(450); await shoot('clip_jump_1'); await wait(700); await shoot('clip_jump_land'); log.clips.shots.jump = await js('lab.clipState()');
  await wait(1200);
  // "wave": Quaternius Standard has no Wave clip; Interact (one-arm reach forward) is the stand-in, one-shot then back to idle
  await js("lab.action('wave')"); await clipShots('wave', [0.4, 0.8, 1.2, 1.6]); await wait(1200);
  log.clips.afterWave = await js('lab.clipState()');
  // --- IK reach at three targets (world metres; model is ~1.6 m tall, head at ~1.4)
  log.ik = [];
  const arm = await js('lab.arm()'); log.arm = arm;
  const R = arm.length * 0.85, [sx, sy, sz] = arm.shoulder;   // targets at 85% of reach: elbow must bend
  const targets = [[sx - R * 0.3, sy + R * 0.2, sz + R * 0.9], [sx + R * 0.7, sy - R * 0.5, sz + R * 0.45], [sx - R * 0.5, sy + R * 0.8, sz + R * 0.3], [sx + R * 1.6, sy + R * 0.2, sz + R * 0.6]];
  for (const [i, [x, y, z]] of targets.entries()) {
    await js(`lab.reach(${x},${y},${z})`); await wait(700); await shoot(`ik_reach_${i}`);
    log.ik.push({ target: [x, y, z].map((v) => +v.toFixed(3)), distFromShoulder: +Math.hypot(x - sx, y - sy, z - sz).toFixed(3), armLength: +arm.length.toFixed(3), handErrorM: +(await js('lab.ikError()')).toFixed(4) });
  }
  await js('lab.reach(null)'); await wait(300);
  // --- hop: squash, stretch, apex, land
  await js("lab.action('hop')");
  for (const [i, p] of [0.15, 0.24, 0.48, 0.78].entries()) { await js(`lab.setPhase(${p})`); await wait(90); await shoot(`hop_${i}`); }
  await js("lab.action('idle')"); await wait(300);
  // --- VRMA clip through the shared loader (crossfades from the idle clip)
  try {
    log.vrma = await js("lab.play('vrma','./clips/test.vrma')");
    for (let i = 0; i < 3; i++) { await wait(350); await shoot(`vrma_${i}`); }
    await js("lab.action('idle')"); await wait(500);
  } catch (e) { log.vrma = { error: String(e.message || e) }; console.error('vrma', e); }
  // --- Mixamo clip (and any FBX the owner dropped into anim/mixamo/)
  const drop = path.join(__dirname, 'anim', 'mixamo');
  const fbxs = ['./clips/SambaDancing.fbx'].concat(fs.existsSync(drop) ? fs.readdirSync(drop).filter((f) => /\.fbx$/i.test(f)).map((f) => './anim/mixamo/' + f) : []);
  log.mixamo = [];
  for (const [j, f] of fbxs.entries()) {
    try {
      const r = await js(`lab.play('mixamo', ${JSON.stringify(f)})`);
      for (let i = 0; i < 4; i++) { await wait(400); await shoot(`mixamo${j ? j : ''}_${i}`); }
      log.mixamo.push({ file: f, ...r });
      await js("lab.action('idle')"); await wait(500);
    } catch (e) { log.mixamo.push({ file: f, error: String(e.message || e) }); console.error('mixamo', f, e); }
  }
  // --- walk across the window: root motion + Walk_Loop, turning to face the travel direction
  log.walk = { start: await js('lab.walk()'), clipSpeed: await js("lab.clipSpeed('quaternius:Walk_Loop')"), frames: [] };
  const until = async (pred, timeoutMs) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const st = await js('lab.walkState()'); if (pred(st)) return st; await wait(40); } return null; };
  const walkShot = async (name, pred) => { const st = await until(pred, 8000); await shoot(name); log.walk.frames.push({ name, state: st ?? await js('lab.walkState()'), clip: await js('lab.clipState()') }); };
  await walkShot('walk_across_0', (st) => st && st.phase === 'walk' && st.leg === 0 && st.x > 0.25);
  await walkShot('walk_across_1', (st) => st && st.phase === 'turn' && st.leg === 1 && Math.abs(st.yawDeg) < 15);
  await walkShot('walk_across_2', (st) => st && st.phase === 'walk' && st.leg === 1 && st.x < -0.15);
  await walkShot('walk_across_3', (st) => st && st.phase === 'walk' && st.leg === 2 && st.x > -0.15);
  await walkShot('walk_across_4', (st) => st && st.phase === 'face');
  await until((st) => st === null, 4000); await wait(600); await shoot('walk_across_5');
  await checkErr('after actions');

  // --- measure 5 s idle: renderer frame times, process CPU, GPU util (nvidia-smi if present)
  await js("lab.expression('neutral'); lab.blink(true); lab.look(0.2,0.1); lab.hud(true); lab.action('idle'); lab.resetStats()");
  const m0 = app.getAppMetrics();
  const psCpu = () => { const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-Process electron | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum; [Environment]::ProcessorCount'], { encoding: 'utf8' }); const [ms, cores] = r.stdout.trim().split(/\s+/).map(Number); return { ms, cores }; };
  const c0 = psCpu(); const wall0 = Date.now();
  const gpuSamples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    await wait(1000);
    const r = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' });
    if (r.status === 0) gpuSamples.push(r.stdout.trim());
  }
  const m1 = app.getAppMetrics();
  const c1 = psCpu(); const wallMs = Date.now() - wall0;
  const allElectron = { cpuMsPerWallMs: +((c1.ms - c0.ms) / wallMs).toFixed(3), percentOfOneCore: +(100 * (c1.ms - c0.ms) / wallMs).toFixed(1), percentOfMachine: +(100 * (c1.ms - c0.ms) / wallMs / c1.cores).toFixed(2), cores: c1.cores, note: 'sum of TotalProcessorTime over every electron.exe (main+gpu+renderer+utility) via Get-Process, delta over the 5 s idle window' };
  const st = await js('lab.stats()');
  const cpu = m1.map((p) => ({ type: p.type, pid: p.pid, cpuPercent: +p.cpu.percentCPUUsage.toFixed(1), memMB: p.memory ? +(p.memory.workingSetSize / 1024).toFixed(0) : null }));
  log.perf = { renderer: st, processes: cpu, allElectron, gpu: gpuSamples, note: 'percentCPUUsage is per-process, averaged since the previous getAppMetrics call; 100 = one full core' };
  await shoot('hud_idle');
  // frame timing while walking across (root motion + Walk_Loop + head-turn + springs), 4 s
  await js('lab.walk({ speed: 0.35 }); lab.resetStats()'); await wait(4000);
  log.perf.rendererWalking = await js('lab.stats()');
  await until((st) => st === null, 8000);
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ info, ...log }, null, 2));
  console.log(JSON.stringify(log.perf));
  app.exit(log.error ? 2 : 0);
});
