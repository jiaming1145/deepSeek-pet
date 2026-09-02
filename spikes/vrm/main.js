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
  await win.loadFile(path.join(__dirname, 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 300; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) break;
    await wait(100);
  }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify(info));
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
  // --- look-at
  for (const [n, [x, y]] of Object.entries({ left: [-1, 0.1], right: [1, 0.1], up: [0, 1], down: [0, -1] })) { await js(`lab.look(${x},${y})`); await wait(450); await shoot(`look_${n}`); }
  await js('lab.look(0,0)');
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
  // --- wave
  await js("lab.action('wave')");
  for (const [i, p] of [0.2, 0.42, 0.55, 0.7].entries()) { await js(`lab.setPhase(${p})`); await wait(110); await shoot(`wave_${i}`); }
  await js("lab.action('idle')"); await wait(300);
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
  // --- VRMA clip
  try {
    log.vrma = await js("lab.play('vrma','./clips/test.vrma')");
    for (let i = 0; i < 3; i++) { await wait(350); await shoot(`vrma_${i}`); }
    await js('lab.stop()');
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
      await js('lab.stop()');
    } catch (e) { log.mixamo.push({ file: f, error: String(e.message || e) }); console.error('mixamo', f, e); }
  }
  await wait(300);
  await checkErr('after actions');

  // --- measure 5 s idle: renderer frame times, process CPU, GPU util (nvidia-smi if present)
  await js("lab.expression('neutral'); lab.blink(true); lab.look(0.2,0.1); lab.hud(true); lab.resetStats()");
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
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ info, ...log }, null, 2));
  console.log(JSON.stringify(log.perf));
  app.exit(log.error ? 2 : 0);
});
