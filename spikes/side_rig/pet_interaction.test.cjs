// How she behaves when you actually use her: orders that stick, a chat box that cannot be killed, a window that
// only takes the clicks that are meant for her, and a press-and-hold that still picks her up.
//
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/side_rig/pet_interaction.test.cjs
//
// This loads the real pet page (pet=1) with the real preload in an off-screen window. The main process is stubbed:
// the IPC handlers the preload talks to are registered here, so the test can see every hit-state change the page
// sends, catch a quit, and decide what her "brain" answers. Most checks step the rig's clock by hand, which is
// exact; the pointer checks let real frames run, because a press is not a hold until the pointer has moved 5 px
// on a LATER frame (see README, "Dragging her is the fragile path") and a test that presses and moves in one JS
// turn cannot see that.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + ' -- ' + detail); }
};

// An off-screen window is "occluded" as far as Chromium is concerned, and it throttles frames and timers for
// occluded windows; without these the real-frame checks run at a few fps and time out.
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// the stubbed main process
const hits = [];
let quits = 0;
let reply = { error: 'no brain in this test' };       // what her brain says next; each check sets its own
ipcMain.on('pet:hit', (_e, v) => hits.push(v));
ipcMain.on('pet:quit', () => { quits++; });
ipcMain.on('pet:memory:save', () => {});
ipcMain.on('pet:focus', () => {});
ipcMain.handle('pet:memory:load', () => null);
ipcMain.handle('pet:think', () => null);
ipcMain.handle('pet:brain', () => ({ enabled: false }));
ipcMain.handle('pet:chat', () => reply);

// a hung check must fail the run, not hang it
setTimeout(() => { console.log(`
TIMED OUT after ${passed} passed, ${failures.length} failed`); app.exit(2); }, 240000).unref();
process.on('unhandledRejection', (e) => { console.log('  FAIL unexpected error -- ' + (e && e.message || e)); app.exit(1); });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: -3000, y: -3000, width: 1400, height: 900, show: true, transparent: true,
    frame: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) rendererErrors.push(message); });
  const js = (s) => win.webContents.executeJavaScript(s, true);
  const load = () => win.loadFile(path.join(__dirname, 'index.html'), { query: { rig: 'rig.json', front: 'rig_front.json', height: '380', floor: '2', pet: '1' } });
  const ready = async () => {
    for (let i = 0; i < 100 && !(await js('!!window.__ready && !!window.pet').catch(() => false)); i++) await wait(100);
    await wait(300);
  };
  await load(); await ready();
  if (!(await js('!!window.pet').catch(() => false))) {
    console.log('  FAIL the pet page never came up -- ' + ((await js('window.__error || null').catch(() => null)) || rendererErrors.join(' | ')));
    app.exit(1); return;
  }
  const centre = () => js('(() => { const b = lab.bbox(); return [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]; })()');
  // a clean start for each check: clock under our control, standing still, no chat, no cursor
  const reset = async () => {
    await js("lab.hud(false); lab.pause(true); pet.chat(false); pet.simulate({type:'move', x:-50, y:-50}); lab.step(0.1); pet.go('idle', {dur: 999}); lab.step(0.5)");
  };
  // type into the open chat box and press send, the way you would; wait for her answer to be handled
  const send = async (text) => {
    await js(`document.getElementById('chatIn').value = ${JSON.stringify(text)}; document.getElementById('chatSend').click()`);
    for (let i = 0; i < 50 && (await js('pet.state().chatBusy')); i++) await wait(20);
  };
  // how long she stays in `state`, stepping one frame at a time, up to `limit` seconds
  const lasts = (state, limit) => js(`(() => { let t = 0; while (pet.state().state === ${JSON.stringify(state)} && t < ${limit}) { lab.step(1/60); t += 1/60; } return +t.toFixed(2); })()`);

  // --- the window after a reload --------------------------------------------------------------------------
  // main keeps the last hit state it was sent; a reloaded page must tell it again, or a window that was clickable
  // when it reloaded stays clickable over the whole desktop
  {
    await reset();
    const [cx, cy] = await centre();
    await js(`pet.simulate({type:'move', x:${cx}, y:${cy}}); lab.step(0.2)`);
    const before = hits[hits.length - 1];
    const n0 = hits.length;
    win.webContents.reload(); await ready();
    await js("lab.pause(true); lab.step(0.5)");
    check('after a reload the page re-sends click-through', before === true && hits.slice(n0).includes(false),
      `main last heard ${before} before the reload and ${JSON.stringify(hits.slice(n0))} after`);
  }

  // --- the cursor leaving -----------------------------------------------------------------------------------
  {
    await reset();
    const [hx, hy] = (await js('lab.headPx()')).map(Math.round);
    await js(`pet.simulate({type:'move', x:${hx + 40}, y:${hy}}); lab.step(0.5)`);
    const nearBefore = await js('pet.state().near');
    // a document 'mouseleave' must NOT count: with a real mouse it fires after every forwarded move
    await js("document.dispatchEvent(new MouseEvent('mouseleave')); lab.step(0.5)");
    const ignored = await js('({ near: pet.state().near, over: pet.state().over })');
    check('a DOM mouseleave is ignored (it fires after every forwarded move while click-through)', ignored.near === true, JSON.stringify(ignored));
    win.webContents.send('pet:cursor', false);                         // what main sends when the real cursor crosses the edge
    await wait(50); await js('lab.step(0.5)');
    const after = await js('({ near: pet.state().near, cursor: pet.state().cursor, over: pet.state().over })');
    check('the cursor leaving the window: she stops thinking you are near', nearBefore === true && after.near === false && after.cursor === null && after.over === false,
      `near before ${nearBefore}, after ${JSON.stringify(after)}`);
    // and by the other route: the last move we saw was outside the window
    await js(`pet.simulate({type:'move', x:${hx + 40}, y:${hy}}); lab.step(0.5); pet.simulate({type:'move', x:-30, y:${hy}}); lab.step(0.5)`);
    check('the cursor moving off the edge: same', (await js('pet.state().near')) === false, 'near stayed true');
  }

  // --- the tray -----------------------------------------------------------------------------------------------
  {
    await reset();
    win.webContents.send('pet:command', 'sleep');
    await wait(150);
    const slept = await lasts('sleep', 40);
    check('the tray Nap lasts longer than 30 s', slept > 30, `she slept ${slept} s`);
  }

  // --- waking up --------------------------------------------------------------------------------------------
  {
    await reset();
    await js("pet.go('sleep', {dur: 60}); lab.step(3)");
    const [cx, cy] = await centre();
    // a pat wakes her. The pat itself waits out the double-click window, so step past it before timing the wake
    await js(`pet.simulate({type:'down', x:${cx}, y:${cy}}); lab.step(1/60); pet.simulate({type:'up', x:${cx}, y:${cy}}); pet.simulate({type:'move', x:-50, y:-50})`);
    await js("(() => { let n = 0; while (pet.state().state === 'sleep' && n++ < 120) lab.step(1/60); })()");
    const state = await js('pet.state().state');
    const woke = await lasts('wake', 5);
    const next = await js('pet.state().state');
    const idle = next === 'idle' ? await lasts('idle', 10) : 0;
    check('a wake-up plays for its 1.3 s', state === 'wake' && Math.abs(woke - 1.3) < 0.1, `state ${state}, woke for ${woke} s`);
    check('and the idle after it lasts its 2-4 s', next === 'idle' && idle >= 1.9, `then ${next} for ${idle} s`);
  }

  // --- a mood the model made up -------------------------------------------------------------------------------
  {
    await reset();
    reply = { text: '（兴奋地转起圈来）好耶！', raw: '【动作】{"do":"dance","mood":"excited"}\n（兴奋地转起圈来）好耶！', act: { do: 'dance', to: null, mood: 'excited', for: 0 } };
    const thrown = await js("pet.ask('跳个舞').then(() => null, (e) => String(e))");
    const s = await js("({ busy: pet.state().chatBusy, disabled: document.getElementById('chatSend').disabled, state: pet.state().state, err: window.__error || null, last: pet.turns().slice(-1)[0] })");
    check('an invented mood does not lock the chat', !thrown && s.busy === false && s.disabled === false,
      `threw ${thrown}, busy ${s.busy}, send disabled ${s.disabled}`);
    check('and she still dances', s.state === 'dance', `state ${s.state}`);
    check('her turn is stored as the model wrote it', s.last && s.last.role === 'her' && s.last.text.startsWith('【动作】'), JSON.stringify(s.last));
    const danced = await lasts('dance', 20);
    check('an ordered dance runs its whole 13.5 s routine once', danced >= 13.4 && danced < 14, `danced ${danced} s`);
    await js('pet.chat(false)');
  }

  // --- a reply that is only an action ------------------------------------------------------------------------
  // the model sometimes writes nothing but the 【动作】 line: that is a silent order, not a failure
  {
    await reset();
    reply = { text: '', raw: '【动作】{"do":"sit"}', act: { do: 'sit', to: null, mood: null, for: 0 } };
    await js('pet.chat(true)');
    await send('坐下吧');
    const s = await js("({ state: pet.state().state, busy: pet.state().chatBusy, errors: document.querySelectorAll('#chatLog .msg.sys').length, sysText: [...document.querySelectorAll('#chatLog .msg.sys')].map((e) => e.textContent).join(' | '), last: pet.turns().slice(-1)[0] })");
    check('an action-only reply is carried out silently', s.state === 'sit' && s.busy === false && !/没能回答/.test(s.sysText),
      JSON.stringify(s));
    check('and kept in the history as written', s.last && s.last.role === 'her' && s.last.text === reply.raw, JSON.stringify(s.last));
    await js('pet.chat(false)');
  }

  // --- orders and what she is already doing -------------------------------------------------------------------
  {
    // asleep, no brain: "跳个舞" wakes her, lets the wake-up play out, and THEN she dances
    await reset();
    reply = { error: 'offline' };
    await js("pet.go('sleep', {dur: 60}); lab.step(2); pet.chat(true)");
    await send('跳个舞');
    const first = await js('pet.state().state');
    const woke = await lasts('wake', 5);
    const then = await js('pet.state().state');
    check('an order given in her sleep waits for the wake-up, then happens', first === 'wake' && woke > 1.2 && then === 'dance',
      `${first} for ${woke} s, then ${then}`);
    // a plain reply that orders nothing does not end the order she is carrying out
    await reset();
    await js('pet.chat(true)');
    reply = { text: '', raw: '【动作】{"do":"sit"}', act: { do: 'sit', to: null, mood: null, for: 20 } };
    await send('坐下');
    await js('lab.step(2)');
    reply = { text: '嗯嗯，不客气', raw: '嗯嗯，不客气', act: null };
    await send('谢谢');
    await js('lab.step(3)');
    check('a "thank you" does not end the order it thanks her for', (await js('pet.state().state')) === 'sit', `state ${await js('pet.state().state')}`);
    await js('pet.chat(false)');
  }

  // --- stop means stop, even mid-walk -----------------------------------------------------------------------
  for (const [label, r] of [['the model says stop', { text: '（停下脚步）好啦', act: { do: 'stop', to: null, mood: null, for: 0 } }],
    ['no brain, the keyword reader hears 停下', { error: 'offline' }]]) {
    await reset();
    reply = r;
    // the chat is opened first: opening it stops a walk by itself, and this is about the order
    await js("pet.chat(true); pet.go('wander', {target: lab.pos().x > lab.stage().w / 2 ? 1 : lab.stage().w - 1}); lab.step(1)");
    const walking = await js('pet.state().state');
    await send('停下');
    const x0 = await js('lab.pos().x');
    await js('lab.step(3)');
    const s = await js('({ state: pet.state().state, x: lab.pos().x, turns: pet.turns().length, lastRole: (pet.turns().slice(-1)[0] || {}).role })');
    check(`stop ends a walk (${label})`, walking === 'wander' && s.state === 'idle' && Math.abs(s.x - x0) < 0.3,
      `was ${walking}, now ${s.state}, moved ${(s.x - x0).toFixed(2)} units after the order`);
    if (r.error) check('a failed turn leaves no orphan question behind', s.lastRole !== 'you', `last turn is ${s.lastRole}`);
    await js('pet.chat(false)');
  }

  // --- double-click is not a pat --------------------------------------------------------------------------------
  {
    await reset();
    const pets0 = await js('pet.memory().totalPets');
    const [cx, cy] = await centre();
    await js(`pet.simulate({type:'down', x:${cx}, y:${cy}}); lab.step(1/60); pet.simulate({type:'up', x:${cx}, y:${cy}}); lab.step(0.15);
      pet.simulate({type:'down', x:${cx}, y:${cy}}); lab.step(1/60); pet.simulate({type:'up', x:${cx}, y:${cy}}); lab.step(1)`);
    const s = await js("({ pets: pet.memory().totalPets, state: pet.state().state, chat: document.getElementById('chat').classList.contains('on') })");
    check('a double-click opens the chat without also patting her', s.chat && s.pets === pets0 && s.state !== 'react',
      `chat ${s.chat}, pats ${pets0} -> ${s.pets}, state ${s.state}`);
    await js('pet.chat(false)');
    // and a single click still is one
    await js(`pet.simulate({type:'down', x:${cx}, y:${cy}}); lab.step(1/60); pet.simulate({type:'up', x:${cx}, y:${cy}}); lab.step(0.6)`);
    const one = await js("({ pets: pet.memory().totalPets, state: pet.state().state })");
    check('a single click is still a pat', one.pets === s.pets + 1 && one.state === 'react', JSON.stringify(one));
  }

  // --- hovering -----------------------------------------------------------------------------------------------
  {
    await reset();
    const [cx, cy] = await centre();
    const c0 = await js('pet.needs().company');
    await js(`pet.simulate({type:'move', x:${cx}, y:${cy}}); lab.step(3)`);
    const c1 = await js('pet.needs().company');
    check('three seconds of hover is one bit of attention, not 180', c1 - c0 < 0.1, `company ${c0.toFixed(3)} -> ${c1.toFixed(3)}`);
  }

  // --- which clicks the window takes ------------------------------------------------------------------------
  // "Swallowed" is a point where the window is clickable (so the app behind her never gets the click) but a press
  // there does nothing. Sampled on a 4 px grid over her box plus GRAB_PAD, frame by frame through the real code.
  {
    await reset();
    const r = await js(`(() => { const b = lab.bbox(14); let n = 0, over = 0, sw = 0, offHer = 0;
      for (let x = b.x0; x <= b.x1; x += 4) for (let y = b.y0; y <= b.y1; y += 4) {
        n++; pet.simulate({type:'move', x, y}); lab.step(1/60);
        const o = pet.state().over;
        if (o) { over++; if (!pet.grabbable(x, y)) sw++; if (!lab.pick(x, y)) offHer++; }
      }
      pet.simulate({type:'move', x: -50, y: -50}); lab.step(0.1);
      return { n, clickable: over / n, swallowed: sw / n, haloOnly: offHer / n }; })()`);
    const pct = (v) => (100 * v).toFixed(1) + ' %';
    console.log(`       box samples ${r.n}: clickable ${pct(r.clickable)}, swallowed ${pct(r.swallowed)}, of which grab slack beyond her pixels ${pct(r.haloOnly)}`);
    check('under 5 % of her box swallows a click', r.swallowed < 0.05, `swallowed ${pct(r.swallowed)}`);
    check('and the empty part of the box lets clicks through', r.clickable < 0.8, `clickable ${pct(r.clickable)} of the box`);
  }

  // --- real input from here on: frames running --------------------------------------------------------------
  await reset();
  await js('lab.pause(false)');
  await wait(600);
  const fps = await js('lab.fps()');
  console.log(`       frames running at ${fps} fps`);
  const mouse = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x, y, ...extra });

  // press, hold still for four seconds, then drag: she must still come up
  {
    await js("pet.go('idle', {dur: 999})"); await wait(500);
    const [cx, cy] = await centre();
    mouse('mouseMove', cx, cy); await wait(80);
    mouse('mouseDown', cx, cy, { button: 'left', clickCount: 1 }); await wait(4000);
    const pressed = await js('({ drag: !!pet.state().drag, capture: pet.state().capture })');
    for (let i = 1; i <= 8; i++) { mouse('mouseMove', cx + i * 10, cy - i * 20, { modifiers: ['leftButtonDown'] }); await wait(30); }
    const s = await js('({ held: lab.pos().held, state: pet.state().state })');
    check('a 4 s press then a drag still picks her up', s.held && s.state === 'held',
      `after the hold: drag ${pressed.drag}, capture ${pressed.capture}; after the drag: ${JSON.stringify(s)}`);
    mouse('mouseUp', cx + 80, cy - 160, { button: 'left', clickCount: 1 }); await wait(2500);
  }

  // Escape: closes the chat, never quits her
  {
    await js("pet.go('idle', {dur: 999}); pet.chat(true)"); await wait(200);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await wait(100);
    const closed = !(await js("document.getElementById('chat').classList.contains('on')"));
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await wait(100);
    check('Esc closes the chat', closed, 'the chat stayed open');
    check('Esc never quits', quits === 0, `quit was requested ${quits} time(s)`);
  }

  // letter keys typed at her while the chat is open do nothing (and do not close it)
  {
    await js('pet.chat(true)'); await wait(100);
    await js('document.activeElement && document.activeElement.blur()');
    const auto0 = await js('pet.info().auto');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'C' }); win.webContents.sendInputEvent({ type: 'char', keyCode: 'c' }); await wait(60);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P' }); win.webContents.sendInputEvent({ type: 'char', keyCode: 'p' }); await wait(60);
    const s = await js("({ chat: document.getElementById('chat').classList.contains('on'), auto: pet.info().auto })");
    check('letter keys are ignored while the chat is open', s.chat && s.auto === auto0, JSON.stringify(s));
    await js('pet.chat(false)');
  }

  const err = await js('window.__error || null');
  check('no renderer errors', !err && rendererErrors.length === 0, err || rendererErrors.slice(0, 2).join(' | '));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  app.exit(failures.length ? 1 : 0);
});
