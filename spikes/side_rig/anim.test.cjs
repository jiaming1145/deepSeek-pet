// Her animation, measured rather than eyeballed. Most checks below are a defect that was real: they failed on the
// code before the fix and pass after it. The rest (idle and wave stay grounded, the bounce still leaves the floor,
// every chain still moves) guard against a fix that works by deleting the motion. The rig is stepped
// deterministically at 60 fps off-screen, and every position is read in window px through `lab`.
//
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/side_rig/anim.test.cjs
//
// Where her feet should be is worked out here from the rig files (the floor line and the ankle joint in canvas px),
// not asked of the rig, so the ground solver cannot mark its own homework.
//
// pet.js is swapped for a one-line stub that only loads the rig: this tests the rig, and pet.js's per-frame hooks
// (the cursor gaze resets lab.look every frame, the autopilot starts actions) would otherwise be measured with it.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ok   ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failures.push(name); console.log('  FAIL ' + name + ' -- ' + detail); }
};
const r1 = (v) => Math.round(v * 10) / 10;

const SIDE = require('./rig.json'), FRONT = require('./rig_front.json');
const ankleCanvas = (rig) => Math.max(...rig.bones.filter((b) => /^foot_/.test(b.name)).map((b) => b.head[1]));
const LIFT = { side: (SIDE.floor - ankleCanvas(SIDE)) / 384, front: (FRONT.floor - ankleCanvas(FRONT)) / 384 };   // ankle above the floor, units

app.commandLine.appendSwitch('allow-file-access-from-files');

app.whenReady().then(() => main().catch((e) => { console.log('  FAIL the test itself threw -- ' + (e.stack || e)); app.exit(1); }));
async function main() {
  const PET_JS = pathToFileURL(path.join(__dirname, 'pet.js')).href.toLowerCase();
  protocol.handle('file', (req) => (req.url.toLowerCase() === PET_JS
    ? new Response("import './rig.js';", { headers: { 'content-type': 'text/javascript' } })
    : net.fetch(req, { bypassCustomProtocolHandlers: true })));
  const win = new BrowserWindow({ x: -3000, y: -3000, width: 640, height: 900, show: true, transparent: true,
    frame: false, skipTaskbar: true, webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2 && !/unknown emotion (nonsense|toString)/.test(message)) rendererErrors.push(message); });
  await win.loadFile(path.join(__dirname, 'index.html'), { query: { rig: 'rig.json', front: 'rig_front.json' } });
  // a page-side exception becomes a failed check rather than a hung test
  const js = (s) => win.webContents.executeJavaScript(s, true).catch((e) => ({ error: String(e).slice(0, 160) }));
  for (let i = 0; i < 100 && (await js('!!window.__ready')) !== true; i++) await wait(100);
  await wait(300);
  await js('lab.hud(false); lab.pause(true)');
  await js(`window.T_ = {
    stand: (view) => { const s = lab.stage(); return s.hPx - (s.margin + ${JSON.stringify(LIFT)}[view]) * s.k; },
    // how far her LOWEST ankle is above where it is when she stands: + floating, - sunk into the floor
    above: () => T_.stand(lab.pos().view) - Math.max(lab.bone('foot_near').px[1], lab.bone('foot_far').px[1]),
    JOINTS: ['hips', 'chest', 'neck', 'head', 'upper_arm_near', 'upper_arm_far', 'forearm_near', 'forearm_far', 'hand_near', 'hand_far',
      'thigh_near', 'thigh_far', 'shin_near', 'shin_far', 'foot_near', 'foot_far', 'tail_1', 'tail_3', 'tail_6'],
    pose: () => T_.JOINTS.map((n) => lab.bone(n).pose),
    // largest single-frame change of any joint's angle over n frames, and where it happened
    rate(n, prev) {
      let p = prev || T_.pose(), worst = { d: 0 };
      for (let i = 0; i < n; i++) { lab.step(1 / 60); const q = T_.pose(); q.forEach((v, j) => { const d = Math.abs(v - p[j]); if (d > worst.d) worst = { d, joint: T_.JOINTS[j], tau: lab.pos().tau, action: lab.pos().action }; }); p = q; }
      return worst;
    },
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  }; 1`);

  // ---- A. the ground ----------------------------------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('fall'); lab.setPos(lab.stage().w / 2, 0.5);
      for (let i = 0; i < 200 && lab.pos().action !== 'land'; i++) lab.step(1/60);
      let lo = 1e9, hi = -1e9, n = 0; lab.step(1/60);
      while (lab.pos().action === 'land' && lab.pos().tau <= 0.3 + 1e-6) { const a = T_.above(); lo = Math.min(lo, a); hi = Math.max(hi, a); n++; lab.step(1/60); }
      return { lo, hi, n }; })()`);
    check('land: her feet stay on the floor through the squash (tau 0-0.3)', r.n >= 15 && r.lo >= -2 && r.hi <= 2, `ankle ${r1(r.lo)}..${r1(r.hi)} px over ${r.n} frames`);
  }
  for (const mood of ['neutral', 'cheerful']) {
    const r = await js(`(() => { lab.emotion('${mood}'); lab.begin('dance', { move: 0 }); lab.step(1/60);
      let lo = 1e9, hi = -1e9, air = 0, airMax = 0, n = 0;
      for (let i = 0; i < 800; i++) { lab.step(1/60); const a = T_.above();
        if (lab.snapshot().plant >= 0.98) { lo = Math.min(lo, a); hi = Math.max(hi, a); n++; } else { air++; airMax = Math.max(airMax, a); } }
      return { lo, hi, n, air, airMax }; })()`);
    check(`dance (${mood}): lowest foot on the floor outside the bounce's airtime`, r.n > 600 && r.lo >= -2 && r.hi <= 2, `ankle ${r1(r.lo)}..${r1(r.hi)} px over ${r.n} frames; ${r.air} airborne frames up to ${r1(r.airMax)} px`);
    check(`dance (${mood}): the bounce still leaves the floor`, r.air > 20 && r.airMax > 15, `${r.air} frames, peak ${r1(r.airMax)} px`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('fall'); lab.setPos(lab.stage().w / 2, 1.5);
      for (let i = 0; i < 300 && lab.pos().action !== 'stumble'; i++) lab.step(1/60);
      let lo = 1e9, n = 0; while (lab.pos().action === 'stumble') { lo = Math.min(lo, T_.above()); n++; lab.step(1/60); }
      return { lo, n }; })()`);
    check('stumble: never sinks into the floor', r.n > 30 && r.lo >= -2, `lowest ankle ${r1(r.lo)} px over ${r.n} frames`);
  }
  for (const act of ['idle', 'walk', 'sit', 'wave', 'talk', 'stretch']) {
    const r = await js(`(() => { lab.begin('${act}'); lab.setPos(1.0, 0); lab.step(0.5); let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 60; i++) { lab.step(1/60); const a = T_.above(); lo = Math.min(lo, a); hi = Math.max(hi, a); } return { lo, hi }; })()`);
    check(`${act}: lowest ankle on the floor`, r.lo >= -2 && r.hi <= 2, `${r1(r.lo)}..${r1(r.hi)} px`);
  }
  {
    // a turn's squash-and-stretch used to scale her about a point far above her feet and sink them 28 px
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.0, 0); lab.step(0.3); lab.turnTo(-1); let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 20; i++) { lab.step(1/60); const a = T_.above(); lo = Math.min(lo, a); hi = Math.max(hi, a); } return { lo, hi }; })()`);
    check('turn: her feet stay down through the squash', r.lo >= -2 && r.hi <= 2, `${r1(r.lo)}..${r1(r.hi)} px`);
  }

  // ---- B/K. fall in the front view, and the turn ------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.begin('fall'); lab.setPos(lab.stage().w / 2, 2.0); lab.step(0.4);
      const n = lab.bone('upper_arm_near').pose, f = lab.bone('upper_arm_far').pose, tn = lab.bone('thigh_near').pose, tf = lab.bone('thigh_far').pose;
      return { view: lab.pos().view, n, f, tn, tf, syN: lab.bone('thigh_near').sy }; })()`);
    check('fall (front): the far arm mirrors the near one', r.view === 'front' && r.n > 1 && r.f < -1, `near ${r1(r.n)} far ${r1(r.f)} rad`);
    check('fall (front): knees bend by shortening, not by kicking the thighs sideways', Math.abs(r.tn) < 0.01 && Math.abs(r.tf) < 0.01 && r.syN < 0.95, `thighs ${r.tn}/${r.tf}, thigh sy ${r1(r.syN * 100) / 100}`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.0, 0); lab.step(0.2); lab.turnTo(-1); lab.step(0.1); const a = lab.snapshot(); lab.step(0.1); const b = lab.snapshot(); return { a: [a.facing, Math.sign(a.scaleX)], b: [b.facing, Math.sign(b.scaleX), b.mirror] }; })()`);
    check('turn: facing flips together with the sprite, not after the squash ends', r.a[0] === 1 && r.b[0] === -1 && r.b[1] === r.b[2], JSON.stringify(r));
  }

  // ---- C/D/F. switches, release, vigour ---------------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(0.6, 0); lab.step(0.9); const f0 = lab.bone('foot_near').px; lab.step(1/60); const f1 = lab.bone('foot_near').px;
      lab.start('idle'); lab.step(1/60); const f2 = lab.bone('foot_near').px; return { normal: T_.dist(f1, f0), sw: T_.dist(f2, f1) }; })()`);
    check('walk -> idle: the switch frame moves a foot no more than 1.5x a normal frame', r.sw < 1.5 * r.normal, `switch ${r1(r.sw)} px vs normal ${r1(r.normal)} px`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(0.6, 0); lab.step(1.2); const w0 = lab.bone('foot_near').px; lab.step(1/60); const w1 = lab.bone('foot_near').px;
      lab.begin('idle'); lab.setPos(0.6, 0); lab.step(1.0); const f1 = lab.bone('foot_near').px; lab.start('walk'); lab.step(1/60); const f2 = lab.bone('foot_near').px;
      return { normal: T_.dist(w1, w0), sw: T_.dist(f2, f1) }; })()`);
    check('idle -> walk: the switch frame moves a foot no more than 1.5x a walking frame', r.sw < 1.5 * r.normal, `switch ${r1(r.sw)} px vs walking ${r1(r.normal)} px`);
  }
  {
    const r = await js(`(() => { lab.begin('idle'); lab.step(0.5); const [hx, hy] = lab.headPx(); lab.hold(hx, hy + 80, 'body'); lab.step(0.5);
      for (let i = 0; i < 120; i++) { lab.holdAt(hx + 260 * Math.sign(Math.sin(2 * Math.PI * 1.2 * i / 60)), hy - 60); lab.step(1/60); }
      for (let i = 0; i < 60; i++) { lab.step(1/60); if (lab.carry().swing > 0.5) break; }
      const swing = lab.carry().swing; lab.step(1/60); const f0 = lab.bone('foot_near').px, h0 = lab.bone('hips').px;
      lab.release(); lab.step(1/60); const f1 = lab.bone('foot_near').px, h1 = lab.bone('hips').px;
      return { swing, foot: T_.dist(f1, f0), hips: T_.dist(h1, h0), action: lab.pos().action }; })()`);
    check('release: she does not jump when let go mid-swing', r.foot < 6 && r.hips < 6, `swing ${r1(r.swing)} rad; foot ${r1(r.foot)} px, hips ${r1(r.hips)} px (${r.action})`);
  }
  {
    const r = await js(`(() => { lab.emotion('cheerful'); lab.begin('dance', { move: 0 }); lab.step(21.5 * 60/108); const h0 = lab.bone('hand_near').px; lab.step(1/60); const h1 = lab.bone('hand_near').px;
      lab.emotion('sleepy'); lab.step(1/60); const h2 = lab.bone('hand_near').px; return { normal: T_.dist(h1, h0), jump: T_.dist(h2, h1) }; })()`);
    check('dance: a mood change mid-pose does not throw her hand', r.jump < 10, `hand ${r1(r.jump)} px on the mood change vs ${r1(r.normal)} px a frame before`);
  }
  for (const mood of ['neutral', 'cheerful']) {
    const r = await js(`(() => { lab.emotion('${mood}'); lab.begin('dance', { move: 0 }); lab.step(1/60); return T_.rate(800); })()`);
    check(`dance (${mood}): no joint moves more than 0.1 rad in a frame over the whole routine`, r.d <= 0.1, `worst ${r1(r.d * 1000) / 1000} rad on ${r.joint} at beat ${r1(r.tau * 108 / 60)}`);
  }
  {
    let worst = { d: 0 };
    for (let m = 0; m < 6; m++) {
      const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(1.0); const p = T_.pose(); lab.start('dance', { move: ${m} }); return T_.rate(60, p); })()`);
      if (r.d > worst.d) worst = { ...r, move: m };
    }
    check('idle -> dance, starting on any move: no joint over 0.1 rad in a frame', worst.d <= 0.1, `worst ${r1(worst.d * 1000) / 1000} rad on ${worst.joint} (move ${worst.move})`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('dance', { move: 0 }); lab.step(21.5 * 60/108); const p = T_.pose(); lab.start('idle'); return T_.rate(60, p); })()`);
    check('dance -> idle (arm overhead): no joint over 0.1 rad in a frame', r.d <= 0.1, `worst ${r1(r.d * 1000) / 1000} rad on ${r.joint}`);
  }
  {
    const moves = await js(`(() => { const seen = new Set(); for (let i = 0; i < 40; i++) { lab.begin('dance'); lab.settle(); lab.step(0.05); seen.add(lab.bone('upper_arm_near').pose.toFixed(2)); } return seen.size; })()`);
    check('dance: does not always start on the same move', moves >= 3, `${moves} distinct opening poses in 40 starts`);
  }

  // ---- E/J. stretch, look ---------------------------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.begin('stretch'); lab.step(2.5); const a = T_.pose(); lab.step(2.0); const b = T_.pose(); return { change: a.reduce((s, v, i) => s + Math.abs(b[i] - v), 0), action: lab.pos().action }; })()`);
    check('stretch: she is still alive after the stretch ends (tau > 2.3)', r.change > 0.005, `total joint change over 2 s ${r1(r.change * 1000) / 1000} rad, now ${r.action}`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('look'); lab.step(1.3); lab.start('idle'); lab.step(1.0); return lab.face().look; })()`);
    check('look: her gaze comes back after the look action ends', r === null, `kit look ${r}`);
  }

  // ---- H. the face kit -------------------------------------------------------------------------------------------
  for (const mood of ['sleepy', 'happy']) {
    const r = await js(`(() => { lab.emotion('${mood}'); lab.begin('idle'); lab.step(0.5); const seen = new Set(); let blinks = 0, was = false;
      for (let i = 0; i < 12 * 60; i++) { lab.step(1/60); const f = lab.face(); seen.add(f.eye_l); if (f.eye_l_in) seen.add(f.eye_l_in); if (f.blinking && !was) blinks++; was = f.blinking; }
      return { states: [...seen], blinks }; })()`);
    check(`${mood}: a blink never shows a half-open eye`, r.blinks >= 2 && !r.states.includes('half_lid'), `${r.blinks} blinks, eye states ${r.states.join('/')}`);
  }
  {
    // a blink reopening through half_lid used to crossfade into open: two half-transparent cells, a ghostly eye
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(0.5); let blinks = 0, was = false; const fades = new Set();
      for (let i = 0; i < 12 * 60; i++) { lab.step(1/60); const f = lab.face(); if (f.eye_l_in) fades.add(f.eye_l + '>' + f.eye_l_in); if (f.blinking && !was) blinks++; was = f.blinking; }
      return { blinks, fades: [...fades] }; })()`);
    check('neutral: a blink snaps back open instead of fading through a ghost eye', r.blinks >= 2 && r.fades.length === 0, `${r.blinks} blinks, eye crossfades ${r.fades.join(', ') || 'none'}`);
  }
  {
    const r = await js(`(() => { lab.emotion('happy'); lab.begin('dance', { move: 5 }); const seen = new Set(); let lid = 0;
      for (let i = 0; i < 4 * 34; i++) { lab.step(1/60); const f = lab.face(); seen.add(f.eye_l); lid = Math.max(lid, f.lid); }
      return { states: [...seen], lid }; })()`);
    check('happy, dance pose: the squint keeps her happy eyes', r.lid > 0.3 && !r.states.includes('half_lid'), `lid up to ${r1(r.lid * 100) / 100}, eye states ${r.states.join('/')}`);
  }
  {
    const r = await js(`(() => { lab.emotion('smug'); lab.begin('idle'); lab.step(1.0); const seen = new Set(); for (let i = 0; i < 60; i++) { lab.look(0.8, 0); lab.step(1/60); seen.add(lab.face().eye_l); } lab.look(0, 0); return [...seen]; })()`);
    check('smug + gaze: her half-lidded eyes stay half-lidded', r.includes('half_lid') && !r.some((e) => /^look_/.test(e)), `eye states ${r.join('/')}`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(1.0); const out = [];
      for (const y of [0, 0.4, 0.5, 0.4, 0.35, 0.28]) { for (let i = 0; i < 18; i++) { lab.look(y, 0); lab.step(1/60); } out.push(lab.face().look); } lab.look(0, 0); return out; })()`);
    check('gaze: enters at 0.45 and leaves at 0.30 (hysteresis)', JSON.stringify(r) === JSON.stringify([null, null, 'left', 'left', 'left', null]), JSON.stringify(r));
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(0.5); const [hx, hy] = lab.headPx(); lab.hold(hx, hy + 80, 'body'); const seen = new Set(); let blinked = false;
      for (let i = 0; i < 20; i++) { lab.blink(); lab.step(1/60); if (lab.pos().action === 'startle') { seen.add(lab.face().mouth); if (lab.face().blinking) blinked = true; } }
      lab.blink(); lab.step(0.5); lab.release(); lab.step(1);
      lab.begin('idle'); lab.step(0.3); let control = false; for (let i = 0; i < 20; i++) { lab.blink(); lab.step(1/60); if (lab.face().blinking) control = true; }
      lab.begin('stretch'); const y = new Set(); for (let i = 0; i < 90; i++) { lab.step(1/60); y.add(lab.face().mouth); } return { startle: [...seen], blinked, control, yawn: [...y] }; })()`);
    check("front view shows the body's open mouth: startle gasp", r.startle.includes('open_wide'), 'startle mouths ' + r.startle.join('/'));
    check("front view shows the body's open mouth: stretch yawn", r.yawn.some((m) => /^open_/.test(m)), 'stretch mouths ' + r.yawn.join('/'));
    check('startle: no blink during the stare, even when one is due', !r.blinked && r.control, r.blinked ? 'blinked' : r.control ? 'a forced blink was held off' : 'control failed: a forced blink never happened outside the startle');
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(0.5); lab.talking(3.0); const vis = []; let changes = 0, prev = null;
      for (let i = 0; i < 180; i++) { lab.step(1/60); const v = lab.face().viseme; vis.push(v); if (v !== prev) changes++; prev = v; }
      const after = []; for (let i = 0; i < 30; i++) { lab.step(1/60); after.push(lab.face().viseme); }
      lab.start('talk'); lab.step(0.5); const quiet = lab.face().mouth;
      return { kinds: [...new Set(vis)], changes, after: [...new Set(after)], quiet }; })()`);
    const shapes = r.kinds.filter((k) => k && k !== 'closed');
    check('talking: a different mouth shape per syllable, about 4-6 a second, with a closed break', shapes.length >= 4 && r.kinds.includes('closed') && r.changes >= 11 && r.changes <= 20, `${r.changes} changes in 3 s, shapes ${r.kinds.join('/')}`);
    check('talking: the mouth stops when the speech does', r.after.length === 1 && r.after[0] === null, 'after: ' + r.after.join('/'));
    check('talk action with nothing to say keeps its mouth shut', r.quiet === 'closed', 'mouth ' + r.quiet);
  }
  {
    const r = await js(`(() => { lab.emotion('happy'); lab.step(0.1); let threw = null, out, proto; try { out = lab.emotion('nonsense'); proto = lab.emotion('toString'); lab.begin('dance', { move: 3 }); lab.step(0.5); } catch (e) { threw = String(e); }
      return { out, proto, threw, mood: lab.face().mood, vig: lab.snapshot().vig, arm: lab.bone('upper_arm_near').pose, again: lab.emotion('happy') }; })()`);
    check("lab.emotion('nonsense') returns false, does not throw, leaves her face alone", r.out === false && r.proto === false && !r.threw && r.mood === 'happy' && Number.isFinite(r.vig) && Number.isFinite(r.arm) && r.again === true, JSON.stringify(r));
  }

  // ---- I. the side view's brows, both ways round ---------------------------------------------------------------
  {
    const r = await js(`(() => { lab.emotion('angry'); lab.begin('hop'); lab.step(1.5); const a = lab.snapshot(); lab.turnTo(-1); lab.settle(); lab.step(1.0); const b = lab.snapshot();
      return { a: a.brow, b: b.brow, fa: a.facing, fb: b.facing, view: b.view }; })()`);
    check('side view: angry brows keep their slant when she faces the other way', r.view === 'side' && r.fa === 1 && r.fb === -1 && Math.abs(r.a) > 0.2 && Math.abs(r.a - r.b) < 1e-3, JSON.stringify(r));
  }

  // ---- L. springs --------------------------------------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('dance', { move: 3 }); let sll = 0, srr = 0, slr = 0, ml = 0, mr = 0;
      for (let i = 0; i < Math.round(3 * 34); i++) { lab.step(1/60); const s = lab.snapshot().springs; const l = s.hair_l_1, rr = s.hair_r_1; sll += l*l; srr += rr*rr; slr += l*rr; ml = Math.max(ml, Math.abs(l)); mr = Math.max(mr, Math.abs(rr)); }
      return { corr: slr / Math.sqrt(sll * srr), ml, mr }; })()`);
    check('bounce: her front hair flares in mirror', r.corr < 0, `left/right correlation ${r1(r.corr * 100) / 100}`);
    check('bounce: and visibly (0.10-0.20 rad peak)', Math.max(r.ml, r.mr) >= 0.10 && Math.max(r.ml, r.mr) <= 0.20, `peak L ${r1(r.ml * 1000) / 1000} R ${r1(r.mr * 1000) / 1000} rad`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('walk'); lab.setPos(0.6, 0); lab.step(1.2); lab.start('idle'); lab.settle(); const xs = [];
      for (let i = 0; i < 120; i++) { lab.step(1/60); xs.push(lab.snapshot().springs.tail_4); }
      let peaks = 0, sign = 0; const peakAmps = []; let cur = 0;
      for (const v of xs) { const s = Math.sign(v); if (s && s !== sign) { if (sign && cur > 0.012) { peaks++; peakAmps.push(cur); } sign = s; cur = 0; } cur = Math.max(cur, Math.abs(v)); }
      if (cur > 0.012) { peaks++; peakAmps.push(cur); }
      return { peaks, amps: peakAmps.map((a) => +a.toFixed(3)), view: lab.pos().view }; })()`);
    check('walk -> idle: the tail swings on past her stop and swings back', r.view === 'front' && r.peaks >= 2, `swings ${r.peaks}: ${r.amps.join(', ')} rad`);
  }
  {
    // a blocked renderer: 600 ms with no frames, then one clamped 0.05 s step
    const tau0 = await js(`lab.begin('run'); lab.setPos(1.0, 0); lab.pause(false); lab.pos().tau`);
    await wait(500);
    await js('(() => { const t = performance.now(); while (performance.now() - t < 600) {} return 1; })()');
    await wait(80);
    const a = await js('lab.snapshot()');
    await wait(700);
    await js('lab.pause(true)');
    const b = await js('lab.snapshot()');
    const ran = (await js('lab.pos().tau')) - tau0;   // the frame loop really ran (an occluded window might not)
    const mx = (s) => Math.max(...Object.values(s.springs).map((v) => (Number.isFinite(v) ? Math.abs(v) : Infinity)));
    check('springs stay bounded through a 600 ms blocked frame', ran > 0.5 && mx(a) < 0.6 && mx(b) < 0.3, `ran ${r1(ran)} s of rig time; max spring right after ${r1(mx(a) * 1000) / 1000}, 0.7 s later ${r1(mx(b) * 1000) / 1000} rad`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.0, 0); lab.step(1.5); const o = {}; for (let i = 0; i < 60; i++) { lab.step(1/60); const s = lab.snapshot().springs; for (const k in s) { const c = k.replace(/_[0-9]+$/, ''); o[c] = Math.max(o[c] || 0, Math.abs(s[k])); } } return o; })()`);
    const ok = Object.values(r).every((v) => v > 0.005 && v < 0.2);
    check('walk: every chain still moves, none flails', ok, Object.entries(r).map(([k, v]) => `${k} ${r1(v * 1000) / 1000}`).join(', '));
  }

  const err = await js('window.__error || null');
  check('no renderer errors', rendererErrors.length === 0 && !err, rendererErrors.slice(0, 2).join(' | ') + (err || ''));

  // ---- pet mode: pet.js owns the keys and there is no HUD --------------------------------------------------------
  {
    const pw = new BrowserWindow({ x: -3000, y: -3000, width: 640, height: 900, show: true, transparent: true, frame: false, skipTaskbar: true,
      webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false } });
    await pw.loadFile(path.join(__dirname, 'index.html'), { query: { rig: 'rig.json', front: 'rig_front.json', pet: '1', height: '380', floor: '2' } });
    const pj = (s) => pw.webContents.executeJavaScript(s, true).catch((e) => ({ error: String(e).slice(0, 160) }));
    for (let i = 0; i < 100 && (await pj('!!window.__ready')) !== true; i++) await wait(100);
    const hud = await pj("getComputedStyle(document.getElementById('hud')).display");
    await pj("lab.pause(true); lab.begin('idle'); lab.step(0.2); document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1");
    pw.webContents.focus();
    pw.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z' });
    pw.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
    pw.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z' });
    await wait(200);
    const act = await pj('lab.pos().action');
    check('pet mode: no HUD, and the lab\'s letter keys are not registered', hud === 'none' && act !== 'sleep', `hud ${hud}, action after Z: ${act}`);
    pw.destroy();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  app.exit(failures.length ? 1 : 0);
}
