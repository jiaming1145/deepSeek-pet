// Records the README media from the real pet renderer. Nothing here is mocked: the window is the same page,
// rig and mind the pet runs, driven through its `lab` / `pet` control surface with the clock stepped by hand
// so every captured frame is exactly 1/FPS s apart. Frames are RGBA PNGs of the transparent window; build.mjs
// composites them over a wallpaper and encodes the GIFs.
//
//   cd apps/desktop
//   npx electron ../../tools/media/record.js --scene hero --out ../../.cache/media/hero
//
// Scenes: hero (hover, pick-up, throw, a line, a walk, a dance), dance (the full routine), chat (a typed
// request answered by her brain and acted out - needs a DeepSeek key, see brain.js), carry (six stills of
// being picked up, for the strip in the README).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const RIG = path.join(__dirname, '..', '..', 'spikes', 'side_rig');
const { createBrain, think, chat } = require(path.join(RIG, 'brain.js'));

const argOf = (flag, dflt = null) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const SCENE = argOf('--scene', 'hero');
const OUT = path.resolve(argOf('--out', path.join(os.tmpdir(), 'whalechan-media', SCENE)));
const FPS = 20;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('allow-file-access-from-files');
// Her memory must not be the owner's real one: a recording session is not a real visit.
app.setPath('userData', path.join(os.tmpdir(), 'whalechan-media-userdata'));

const SCENES = {
  hero: { w: 1000, h: 520, height: 330, x: 0.42 },
  dance: { w: 560, h: 520, height: 360, x: 0.5 },
  chat: { w: 1150, h: 640, height: 360, x: 0.3 },
  carry: { w: 700, h: 620, height: 330, x: 0.5 },
};

app.whenReady().then(async () => {
  const cfg = SCENES[SCENE];
  if (!cfg) { console.error('unknown scene', SCENE, '- one of', Object.keys(SCENES).join(', ')); app.exit(1); return; }
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

  const memFile = path.join(app.getPath('userData'), 'whalechan-memory.json');
  const brain = createBrain({});
  ipcMain.handle('pet:think', async (_e, state, history, activities) => { try { return await think(brain, state, history, activities); } catch (e) { return null; } });
  ipcMain.handle('pet:brain', () => ({ enabled: brain.enabled, calls: brain.calls, ok: brain.ok, failed: brain.failed, lastError: brain.lastError }));
  ipcMain.handle('pet:chat', async (_e, turns, state, history) => { try { return await chat(brain, turns, state, history); } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('pet:memory:load', () => { try { return JSON.parse(fs.readFileSync(memFile, 'utf8')); } catch (e) { return null; } });
  ipcMain.on('pet:memory:save', (_e, data) => { try { fs.writeFileSync(memFile, JSON.stringify(data)); } catch (e) { /* a recording has nothing to remember */ } });
  ipcMain.on('pet:hit', () => {});
  ipcMain.on('pet:quit', () => app.quit());

  const win = new BrowserWindow({
    x: 120, y: 120, width: cfg.w, height: cfg.h, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false, focusable: false,
    webPreferences: { preload: path.join(RIG, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  await win.loadFile(path.join(RIG, 'index.html'), { query: { rig: 'rig.json', front: 'rig_front.json', height: String(cfg.height), floor: '8', pet: '1' } });

  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 300; i++) {
    const err = await js('window.__error || null');
    if (err) { console.error('RENDERER ERROR\n' + err); app.exit(1); return; }
    if (await js('!!window.__ready')) break;
    await wait(100);
  }
  const info = await js('lab.info()');
  console.log('ready', JSON.stringify({ view: info.view, bones: info.bones, layers: info.layers, actions: info.actions.length, moods: info.kitMoods.length }));

  let n = 0;
  const errors = [];
  const shoot = async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `frame_${String(n++).padStart(4, '0')}.png`), img.toPNG());
    const err = await js('window.__error || null');
    if (err) { errors.push({ frame: n, err }); await js('window.__error = null'); }
  };
  const frame = async (code) => { await js(`${code ? code + ';' : ''} lab.step(${1 / FPS})`); await shoot(); };
  const run = async (sec, code) => { if (code) await js(code); for (let i = 0; i < Math.round(sec * FPS); i++) await frame(); };
  const centre = async () => { const b = await js('lab.bbox()'); return [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]; };
  // A pointer path over `sec` seconds, one synthetic move per frame; the rig only counts a hold once the pointer
  // has travelled 5 px across real frames, which is why the moves are spread over frames rather than one turn.
  const glide = async (x0, y0, x1, y1, sec, ease = (t) => t) => {
    const k = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= k; i++) { const t = ease(i / k); await frame(`pet.simulate({type:'move', x:${Math.round(x0 + (x1 - x0) * t)}, y:${Math.round(y0 + (y1 - y0) * t)}})`); }
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  // the same, without capturing: for stills, where only the named moments are wanted
  const stepOnly = (sec, code) => js(`${code ? code + ';' : ''} lab.step(${sec})`);
  const glideOnly = async (x0, y0, x1, y1, sec, ease = (t) => t) => {
    const k = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= k; i++) { const t = ease(i / k); await stepOnly(1 / FPS, `pet.simulate({type:'move', x:${Math.round(x0 + (x1 - x0) * t)}, y:${Math.round(y0 + (y1 - y0) * t)}})`); }
  };
  const moments = [];
  const moment = async (name) => { await shoot(); moments.push({ name, frame: n - 1, bbox: await js('lab.bbox()'), pos: await js('lab.pos()') }); };

  const setup = `lab.hud(false); lab.pause(true); pet.auto(false); pet.go('idle', {dur: 999}); lab.setPos(lab.stage().w * ${cfg.x}, 0); lab.step(0.6)`;
  await js(setup);

  if (SCENE === 'hero') {
    await run(0.5);
    // the cursor arrives from the right and she looks at it
    let [cx, cy] = await centre();
    await glide(cx + 360, cy - 200, cx + 40, cy - 40, 0.7, smooth);
    await run(1.1);
    // picked up from the body, lifted, held a moment, then tossed to the right
    [cx, cy] = await centre();
    await frame(`pet.simulate({type:'down', x:${cx}, y:${cy}})`);
    await glide(cx, cy, cx - 30, cy - 150, 0.6, smooth);
    await run(0.5);
    await glide(cx - 30, cy - 150, cx + 90, cy - 175, 0.25);
    await frame(`pet.simulate({type:'up', x:${cx + 90}, y:${cy - 175}})`);
    await run(1.7);
    // she has something to say about that
    await run(1.9, `pet.go('talk', {dur: 3})`);
    // walks back to the middle, then dances
    await run(1.7, `pet.go('wander', {target: lab.stage().w * 0.5, gait: 'walk'})`);
    await run(3.0, `pet.go('dance', {dur: 20})`);
  } else if (SCENE === 'dance') {
    await run(0.4);
    await run(13.6, `pet.go('dance', {dur: 30})`);    // 24 beats at 108 BPM, plus her pose at the end
  } else if (SCENE === 'chat') {
    const text = argOf('--say', '在原地跳个舞给我看吧');
    await run(0.8);
    await run(0.6, `pet.chat(true)`);
    const chars = Array.from(text);
    for (let i = 1; i <= chars.length; i++) await frame(`document.getElementById('chatIn').value = ${JSON.stringify(chars.slice(0, i).join(''))}`);
    await run(0.5);
    const reply = js(`pet.ask(${JSON.stringify(text)})`);
    let done = false; reply.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 40 * FPS && !done; i++) { await frame(); await wait(10); }    // she thinks; the pause reads as real
    const turn = await reply;
    console.log('her reply:', JSON.stringify(turn && turn.text));
    await run(6.5);
  }

  if (SCENE === 'carry') {
    await stepOnly(0.3);
    const [cx, cy] = await centre();
    await stepOnly(0.05, `pet.simulate({type:'down', x:${cx}, y:${cy}})`);
    await glideOnly(cx, cy, cx, cy - 50, 0.2, smooth);      await moment('grabbed');
    await glideOnly(cx, cy - 50, cx, cy - 130, 0.5, smooth); await stepOnly(0.6); await moment('held_low');
    await glideOnly(cx, cy - 130, cx, cy - 250, 0.6, smooth); await stepOnly(0.5); await moment('held_high');
    for (let i = 0; i < 14; i++) await stepOnly(1 / FPS, `pet.simulate({type:'move', x:${cx + (i % 2 ? 34 : -34)}, y:${cy - 250}})`);
    await moment('shaken');
    await stepOnly(0.3, `pet.simulate({type:'move', x:${cx}, y:${cy - 250}})`);
    await stepOnly(0.2, `pet.simulate({type:'up', x:${cx}, y:${cy - 250}})`); await moment('dropped');
    await stepOnly(0.55); await moment('landing');
  }

  await js('lab.pause(false)');
  const fps = await js('lab.fps()');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ scene: SCENE, frames: n, fps: FPS, window: { w: cfg.w, h: cfg.h }, dpr: await js('window.devicePixelRatio'), renderFps: fps, moments, errors, log: await js('pet.log()') }, null, 1));
  console.log(`recorded ${n} frames of '${SCENE}' to ${OUT}; renderer errors ${errors.length}`);
  app.exit(errors.length ? 2 : 0);
});
