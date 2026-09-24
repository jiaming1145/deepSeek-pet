// Electron harness for the layered rig.
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/side_rig/main.js [--rig rig.json --front rig_front.json]   lab window (keys on the HUD)
//   ... --tour      cycles every action, loops until closed
//   ... --capture   every action at 20/50/80 % + expressions -> shots/ (shots_views/ with --front), then exit
//   ... --pet [--height 380] [--selftest]   the pet: click-through window over the whole work area, she walks the
//                  taskbar edge, hover/click/drag her; tray icon has Quit. --selftest drives the autopilot + a
//                  synthetic click and drag, shoots shots_pet/, then exits.
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createBrain, think, chat } = require('./brain.js');

app.commandLine.appendSwitch('allow-file-access-from-files');
const has = (f) => process.argv.includes(f);
const argOf = (flag, dflt = null) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const CAPTURE = has('--capture'), TOUR = has('--tour'), PET = has('--pet'), SELFTEST = has('--selftest');
const SHOTS = path.join(__dirname, PET ? 'shots_pet' : has('--front') ? 'shots_views' : has('--rig') ? 'shots_' + path.basename(argOf('--rig'), '.json') : 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let tray = null;

// One pet at a time. A second `--pet` launch used to put a second her on the desktop, fighting the first over the
// same memory file; now it quits and the running one waves instead. Only the pet takes the lock, so the lab, the
// tour and the capture runs still start while she is on the desktop.
const SECOND = PET && !app.requestSingleInstanceLock();
if (SECOND) {
  console.log('she is already on the desktop; this launch quits');
  app.exit(SELFTEST ? 3 : 0);
}

// Only our own page may use the bridge. Navigation is blocked below, but this is checked on every message as well,
// because a page that got in some other way must still not reach the key-holding brain or her memory file.
const fromPage = (e) => { const u = e && e.senderFrame && e.senderFrame.url; return typeof u === 'string' && u.startsWith('file:'); };

app.whenReady().then(async () => {
  if (SECOND) return;
  // her memory: one small JSON file beside the app's settings, so she is not a blank slate every launch.
  // Registered for every mode, not just --pet, so the lab and the probes can read it too.
  const memFile = path.join(app.getPath('userData'), 'whalechan-memory.json');
  // Her optional language-model brain. The key is read here and never reaches the page. Everything she does
  // works without it, so a missing key, an empty account or a dead network changes nothing on screen.
  const brain = createBrain({});
  ipcMain.handle('pet:think', async (e, state, history, activities) => {
    if (!fromPage(e)) return null;
    try { return await think(brain, state, history, activities); } catch (err) { return null; }
  });
  ipcMain.handle('pet:brain', (e) => (fromPage(e) ? { enabled: brain.enabled, calls: brain.calls, ok: brain.ok, failed: brain.failed, lastError: brain.lastError } : null));
  ipcMain.handle('pet:chat', async (e, turns, state, history) => {
    if (!fromPage(e)) return { error: 'refused: not her page' };
    try { return await chat(brain, turns, state, history); } catch (err) { return { error: String(err.message || err) }; }
  });
  // A memory file that does not parse is moved aside, not treated as "no memory": the page would otherwise start
  // blank and its first save would write over the only copy of everything she remembered.
  ipcMain.handle('pet:memory:load', (e) => {
    if (!fromPage(e)) return null;
    let text;
    try { text = fs.readFileSync(memFile, 'utf8'); } catch (err) { return null; }   // no file yet: first meeting
    try { return JSON.parse(text); } catch (err) {
      const aside = `${memFile}.corrupt-${Date.now()}`;
      try { fs.renameSync(memFile, aside); console.error(`her memory did not parse (${err.message}); kept it as ${aside}`); }
      catch (err2) { console.error('her memory did not parse and could not be moved aside:', err2.message); }
      return text;      // the page's loader reads a string as "damaged", not as a first meeting
    }
  });
  // Written to a temporary file and renamed over the real one, so a crash or a power cut mid-write leaves the
  // previous memory whole instead of a half-written file.
  ipcMain.on('pet:memory:save', (e, data) => {
    if (!fromPage(e)) return;
    const tmp = memFile + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, memFile); } catch (err) { console.error('could not save her memory:', err.message); }
  });
  const query = {};
  if (argOf('--rig')) query.rig = argOf('--rig');
  if (argOf('--front')) query.front = argOf('--front');
  let bounds = { width: 640, height: 900, x: 80, y: 40 };
  if (PET) {
    const wa = screen.getPrimaryDisplay().workArea;
    bounds = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
    Object.assign(query, { rig: query.rig || 'rig.json', front: query.front || 'rig_front.json', height: argOf('--height', '380'), floor: '2', pet: '1' });
  }
  // The pet is created NOT focusable: patting her or dragging her must leave the keyboard with whatever the owner
  // was typing into. The chat box asks for focus while it is open (pet:focus below) and gives it back on close.
  const win = new BrowserWindow({
    ...bounds, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    focusable: !PET,
    webPreferences: { preload: PET ? path.join(__dirname, 'preload.js') : undefined, contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`); });
  // Nothing may navigate this window or open another one. Dropping a link or a file on her used to load it in
  // her place, and whatever loaded there would have had the bridge.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (PET) {
    // No application menu: its Ctrl+R and Ctrl+W accelerators reloaded or closed an invisible full-screen window.
    Menu.setApplicationMenu(null);
    win.setIgnoreMouseEvents(true, { forward: true });
    // Main remembers the last hit state but a reloaded (or crashed, or hung) page starts again believing the cursor
    // is not over her, so it never sends the "click-through again" that would undo it. The window then swallowed
    // every click on the whole screen. Whenever the page goes away, the window goes back to click-through and
    // unfocusable, which is what a freshly started page assumes.
    // A page that only hung comes back with its state intact but only re-sends a hit state when it changes, so
    // main keeps what the page last asked for and puts it back on 'responsive'; otherwise an open chat box stayed
    // click-through and unfocusable after a stall until it was closed and reopened.
    const asked = { over: false, focus: false };
    const release = () => { if (win.isDestroyed()) return; win.setIgnoreMouseEvents(true, { forward: true }); win.setFocusable(false); };
    const restart = () => { asked.over = false; asked.focus = false; release(); };
    // On Windows setFocusable(true) also takes skipTaskbar off, which would put an invisible full-screen window
    // in the taskbar for as long as the chat box is open.
    const takeFocus = () => { win.setFocusable(true); win.setSkipTaskbar(true); win.focus(); };
    win.webContents.on('did-start-loading', restart);
    win.webContents.on('render-process-gone', restart);
    win.on('unresponsive', release);
    win.on('responsive', () => {
      if (win.isDestroyed()) return;
      win.setIgnoreMouseEvents(!asked.over, { forward: true });
      if (asked.focus) takeFocus();
    });
    // A reloaded page also starts in character. Tell it the mode the tray is showing, once it is listening
    // (its command handler is registered after the rig's top-level awaits, which is later than did-finish-load).
    win.webContents.on('did-finish-load', async () => {
      for (let i = 0; i < 300 && !win.isDestroyed(); i++) {
        let up = false;
        try { up = await win.webContents.executeJavaScript('!!(window.__ready && window.pet)', true); } catch (e) { up = false; }
        if (up) { win.webContents.send('pet:command', brain.mode === 'plain' ? 'plain' : 'character'); return; }
        await wait(100);
      }
    });
    ipcMain.on('pet:hit', (e, over) => { if (fromPage(e) && !win.isDestroyed()) { asked.over = !!over; win.setIgnoreMouseEvents(!over, { forward: true }); } });
    ipcMain.on('pet:quit', (e) => { if (fromPage(e)) app.quit(); });
    ipcMain.on('pet:focus', (e, on) => {
      if (!fromPage(e) || win.isDestroyed()) return;
      asked.focus = !!on;
      if (on) takeFocus(); else { win.setFocusable(false); win.blur(); }
    });
    app.on('second-instance', () => { if (!win.isDestroyed()) win.webContents.send('pet:command', 'wave'); });
    // She lives on the primary display's work area. A resolution or scaling change, or a monitor coming or going,
    // used to leave the window at the old size; refit it and rig.js refits her stage on the resize.
    const refit = () => { if (!win.isDestroyed()) win.setBounds(screen.getPrimaryDisplay().workArea); };
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, refit);
    const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Whale-chan');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Whale-chan', enabled: false }, { type: 'separator' },
      { label: 'Autopilot on/off', click: () => win.webContents.send('pet:command', 'auto') },
      // The community preset asks the MODEL to notice the string TIMEOUT_SIGNAL and drop character. We do it
      // here instead, deterministically: the switch picks which system prompt is sent, and quiets her lines.
      { label: 'Out of character (TIMEOUT_SIGNAL)', type: 'checkbox', checked: false,
        click: (item) => { brain.mode = item.checked ? 'plain' : 'character'; win.webContents.send('pet:command', item.checked ? 'plain' : 'character'); } },
      { label: 'Chat', click: () => { takeFocus(); win.webContents.send('pet:command', 'chat'); } },
      { label: 'Wave', click: () => win.webContents.send('pet:command', 'wave') },
      { label: 'Nap', click: () => win.webContents.send('pet:command', 'sleep') },
      { type: 'separator' }, { label: 'Quit', click: () => app.quit() },
    ]));
  }
  await win.loadFile(path.join(__dirname, 'index.html'), Object.keys(query).length ? { query } : undefined);
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
  if (PET) {
    // she should know whether you are actually at your computer: that is the difference between "busy" and
    // "gone away", and it is what lets her settle down for a nap instead of performing to an empty room
    const pushIdle = () => { if (!win.isDestroyed()) win.webContents.send('pet:idle', powerMonitor.getSystemIdleTime()); };
    pushIdle();
    const idleTimer = setInterval(pushIdle, 2000);
    // The page cannot tell when the cursor leaves a click-through window (see pet.js), but main can see the real
    // cursor. Tell the page each time it crosses the window edge, e.g. onto the taskbar or another monitor.
    let cursorInside = null;
    const pollCursor = () => {
      if (win.isDestroyed()) return;
      const c = screen.getCursorScreenPoint(), b = win.getBounds();
      const inside = c.x >= b.x && c.y >= b.y && c.x < b.x + b.width && c.y < b.y + b.height;
      if (inside !== cursorInside) { cursorInside = inside; win.webContents.send('pet:cursor', inside); }
    };
    const cursorTimer = setInterval(pollCursor, 200);
    win.on('closed', () => { clearInterval(idleTimer); clearInterval(cursorTimer); });
    console.log('pet', JSON.stringify(await js('pet.info()')), 'window', JSON.stringify(bounds), 'memory', memFile);
    console.log('brain', brain.enabled ? 'on (DeepSeek)' : 'off - she runs on her own mind alone');
  }

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
  const shoot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  if (PET && SELFTEST) {
    fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
    const report = { shots: [], errors: [], states: [], window: bounds, dpr: await js('window.devicePixelRatio'), stage: await js('lab.stage()') };
    const check = async (tag) => { const err = await js('window.__error || null'); if (err) { report.errors.push({ tag, err }); await js('window.__error = null'); } };
    const snap = async (name) => { await wait(30); await shoot(name); report.shots.push({ name, pos: await js('lab.pos()'), bbox: await js('lab.bbox()'), pet: await js('pet.info()') }); };
    await js('lab.hud(false); lab.pause(true); pet.auto(true)');
    // autopilot: 100 simulated seconds in 10 s slices
    for (let i = 0; i < 10; i++) { await js('lab.step(10)'); await snap(`auto_${i}`); await check('auto ' + i); }
    // hover, click, drag + throw, using her current hit box
    const centre = async () => { const b = await js('lab.bbox()'); return [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]; };
    await js("pet.go('idle', {dur: 30}); lab.step(1.5)");
    let [cx, cy] = await centre();
    await js(`pet.simulate({type:'move', x:${cx - 300}, y:${cy}}); lab.step(0.5)`); await snap('hover_far');
    await js(`pet.simulate({type:'move', x:${cx}, y:${cy}}); lab.step(0.8)`); await snap('hover_on');
    // the hit test is per-pixel now: on her -> true, the same distance away in empty space -> false
    report.pick = { onHer: await js(`lab.pick(${cx}, ${cy})`), offHer: await js(`lab.pick(${cx - 400}, ${cy - 300})`), zone: await js(`lab.zone(${cx}, ${cy})`) };
    const b0 = await js('lab.bbox()');
    report.pick.aboveHead = await js(`lab.pick(${cx}, ${Math.round(b0.y0 - 40)})`);
    console.log('pick check', JSON.stringify(report.pick));
    await js(`pet.simulate({type:'down', x:${cx}, y:${cy}}); pet.simulate({type:'up', x:${cx}, y:${cy}}); lab.step(0.7)`); await snap('click'); await check('click');
    await js("lab.step(3); pet.go('idle', {dur: 30}); lab.step(1)");
    [cx, cy] = await centre();
    await js(`pet.simulate({type:'down', x:${cx}, y:${cy}})`);
    for (let i = 1; i <= 12; i++) { await js(`pet.simulate({type:'move', x:${cx + i * 45}, y:${cy - i * 36}}); lab.step(0.05)`); if (i === 6) await snap('drag_mid'); }
    await snap('drag_end'); await check('drag');
    await js(`pet.simulate({type:'up', x:${cx + 12 * 45}, y:${cy - 12 * 36}}); lab.step(0.25)`); await snap('thrown'); await check('throw');
    await js('lab.step(0.5)'); await snap('falling');
    await js('lab.step(2.5)'); await snap('landed'); await check('land');
    await js('lab.step(4)'); await snap('after');
    await js('pet.think()');            // one real consultation, so the brain path is exercised end to end
    await wait(8000);
    report.brain = await js('pet.brain()');
    await js('pet.saveNow()');
    report.memory = await js('pet.memory()');
    report.log = await js('pet.log()');
    await js('lab.pause(false)'); await wait(600); report.fps = await js('lab.fps()');
    await check('end');
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 1));
    const states = [...new Set(report.log.map((l) => l.state))];
    console.log('pet selftest:', report.shots.length, 'shots, states', states.join(','), 'errors', report.errors.length, 'fps', report.fps);
    app.exit(report.errors.length ? 2 : 0);
    return;
  }
  if (!CAPTURE) return;

  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  const report = { actions: {}, emotions: [], errors: [] };
  await js('lab.hud(false); lab.pause(true)');
  const plan = [['idle', 2.4], ['walk', 2.0], ['run', 1.4], ['hop', 1.2], ['wave', 2.0], ['look', 2.0], ['talk', 2.0], ['sit', 2.4], ['sleep', 3.0], ['wake', 1.6], ['turn', 1.2], ['stretch', 2.4], ['celebrate', 1.4], ['land', 0.36]];
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
  const emos = (await js('lab.info()')).kit ? ['neutral', 'happy', 'sad', 'angry', 'surprised', 'think', 'cheerful', 'shy', 'panic', 'affection', 'pouty', 'sleepy'] : ['neutral', 'happy', 'sad', 'angry', 'surprised', 'think'];
  for (const e of emos) {
    await js(`lab.emotion(${JSON.stringify(e)}); lab.step(0.6)`); await wait(30); await shoot(`emo_${e}`); report.emotions.push(e);
  }
  await js('lab.pause(false)');
  await wait(400);
  report.fps = await js('lab.fps()');
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 1));
  console.log('captured', Object.keys(report.actions).length, 'actions,', report.emotions.length, 'emotions, errors', report.errors.length, 'fps', report.fps);
  app.exit(report.errors.length ? 2 : 0);
});
