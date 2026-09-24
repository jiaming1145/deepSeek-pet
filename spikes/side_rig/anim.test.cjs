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
const toeCanvas = (rig) => Math.max(...rig.bones.filter((b) => /^foot_/.test(b.name)).map((b) => b.tail[1]));
const TOE = { side: (toeCanvas(SIDE) - ankleCanvas(SIDE)) / 384, front: (toeCanvas(FRONT) - ankleCanvas(FRONT)) / 384 };   // toe below the ankle, units

app.commandLine.appendSwitch('allow-file-access-from-files');

app.whenReady().then(() => main().catch((e) => { console.log('  FAIL the test itself threw -- ' + (e.stack || e)); app.exit(1); }));
async function main() {
  const PET_JS = pathToFileURL(path.join(__dirname, 'pet.js')).href.toLowerCase();
  protocol.handle('file', (req) => (req.url.toLowerCase() === PET_JS
    ? new Response("import './rig.js';", { headers: { 'content-type': 'text/javascript' } })
    : net.fetch(req, { bypassCustomProtocolHandlers: true })));
  const win = new BrowserWindow({ x: -3000, y: -3000, width: 1600, height: 900, show: true, transparent: true,
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
    // The lowest point of her feet - the tip of the foot bone - against where it is when she stands. The ankle is not
    // it: a walking heel rises onto its toe, and a squashed foot has its ankle lower while the toe stays on the floor.
    toeDrop: ${JSON.stringify(TOE)},
    contact: () => { const v = lab.pos().view, s = lab.stage(), restTip = T_.stand(v) + T_.toeDrop[v] * s.k;
      return restTip - Math.max(lab.bone('foot_near').tip[1], lab.bone('foot_far').tip[1]); },
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
    // mean px a foot moves per frame over n frames (a walking foot is still half the time, so one frame is no yardstick)
    meanMove(n, bone = 'foot_near') { let p = lab.bone(bone).px, sum = 0; for (let i = 0; i < n; i++) { lab.step(1/60); const q = lab.bone(bone).px; sum += T_.dist(p, q); p = q; } return sum / n; },
  }; 1`);

  // ---- A. the ground ----------------------------------------------------------------------------------------------
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('fall'); lab.setPos(lab.stage().w / 2, 0.5);
      for (let i = 0; i < 200 && lab.pos().action !== 'land'; i++) lab.step(1/60);
      let lo = 1e9, hi = -1e9, n = 0; lab.step(1/60);
      while (lab.pos().action === 'land' && lab.pos().tau <= 0.3 + 1e-6) { const a = T_.contact(); lo = Math.min(lo, a); hi = Math.max(hi, a); n++; lab.step(1/60); }
      return { lo, hi, n }; })()`);
    check('land: her feet stay on the floor through the squash (tau 0-0.3)', r.n >= 15 && r.lo >= -2 && r.hi <= 2, `lowest toe ${r1(r.lo)}..${r1(r.hi)} px over ${r.n} frames`);
  }
  for (const mood of ['neutral', 'cheerful']) {
    const r = await js(`(() => { lab.emotion('${mood}'); lab.begin('dance', { move: 0 }); lab.step(1/60);
      let lo = 1e9, hi = -1e9, air = 0, airMax = 0, n = 0;
      for (let i = 0; i < 800; i++) { lab.step(1/60); const a = T_.contact();
        if (lab.snapshot().plant >= 0.98) { lo = Math.min(lo, a); hi = Math.max(hi, a); n++; } else { air++; airMax = Math.max(airMax, a); } }
      return { lo, hi, n, air, airMax }; })()`);
    check(`dance (${mood}): lowest foot on the floor outside the bounce's airtime`, r.n > 600 && r.lo >= -2 && r.hi <= 2, `lowest toe ${r1(r.lo)}..${r1(r.hi)} px over ${r.n} frames; ${r.air} airborne frames up to ${r1(r.airMax)} px`);
    check(`dance (${mood}): the bounce still leaves the floor`, r.air > 20 && r.airMax > 15, `${r.air} frames, peak ${r1(r.airMax)} px`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('fall'); lab.setPos(lab.stage().w / 2, 1.5);
      for (let i = 0; i < 300 && lab.pos().action !== 'stumble'; i++) lab.step(1/60);
      let lo = 1e9, n = 0; while (lab.pos().action === 'stumble') { lo = Math.min(lo, T_.contact()); n++; lab.step(1/60); }
      return { lo, n }; })()`);
    check('stumble: never sinks into the floor', r.n > 30 && r.lo >= -2, `lowest toe ${r1(r.lo)} px over ${r.n} frames`);
  }
  // (sitting, her shoes are squashed out of sight under her skirt, so there it is the ankle that has to be down)
  for (const act of ['idle', 'walk', 'sit', 'wave', 'talk', 'stretch']) {
    const r = await js(`(() => { lab.begin('${act}'); lab.setPos(1.5, 0); lab.step(0.5); let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 60; i++) { lab.step(1/60); const a = '${act}' === 'sit' ? T_.above() : T_.contact(); lo = Math.min(lo, a); hi = Math.max(hi, a); } return { lo, hi }; })()`);
    check(`${act}: her feet touch the floor (lowest of ankle and toe)`, r.lo >= -2 && r.hi <= 2, `${r1(r.lo)}..${r1(r.hi)} px`);
  }
  {
    // a turn's squash-and-stretch used to scale her about a point far above her feet and sink them 28 px
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.0, 0); lab.step(0.3); lab.turnTo(-1); let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 20; i++) { lab.step(1/60); const a = T_.contact(); lo = Math.min(lo, a); hi = Math.max(hi, a); } return { lo, hi }; })()`);
    check('turn: her feet stay down through the squash', r.lo >= -2 && r.hi <= 2, `${r1(r.lo)}..${r1(r.hi)} px`);
  }

  // ---- walking plants her feet ----------------------------------------------------------------------------------
  // The stance foot is held on the floor and her position follows it; the old walk slid her along at a set speed and
  // the planted foot skated 2-9 px a frame. Measured on the foot the gait says she is standing on.
  for (const [g, face, v] of [['walk', 1, 0.74], ['walk', -1, 0.74], ['run', 1, 1.9]]) {
    const r = await js(`(() => { const s = lab.stage(); lab.begin('${g}'); lab.setPos(${face > 0 ? 1.4 : 3.6}, 0);
      ${face < 0 ? "lab.turnTo(-1); lab.settle(); lab.start('" + g + "');" : ''} lab.step(0.6);
      // Not asking the rig which foot is planted: any foot that is ON the floor in two frames running must not have
      // moved sideways between them (a skidding swing foot counts too).
      const floorY = T_.stand(lab.pos().view), slides = []; let low = 1e9, prev = null; const x0 = lab.pos().x;
      for (let i = 0; i < 60; i++) { lab.step(1/60); const f = [lab.bone('foot_near').px, lab.bone('foot_far').px]; low = Math.min(low, T_.above());
        if (prev) for (let k = 0; k < 2; k++) if (Math.abs(f[k][1] - floorY) <= 1.5 && Math.abs(prev[k][1] - floorY) <= 1.5) slides.push(Math.abs(f[k][0] - prev[k][0]));
        prev = f; }
      slides.sort((a, b) => a - b);
      return { n: slides.length, median: slides[slides.length >> 1], max: slides[slides.length - 1], low, speed: (lab.pos().x - x0) * ${face} / 1.0, turning: lab.pos().turning }; })()`);
    check(`${g} (facing ${face > 0 ? 'right' : 'left'}): a foot on the floor does not slide`, r.n >= 30 && r.median <= 1 && r.max <= 2, `${r.n} foot-on-floor frame pairs: median ${r.median} px, worst ${r.max} px`);
    check(`${g} (facing ${face > 0 ? 'right' : 'left'}): no foot goes through the floor`, r.low >= -2, `lowest ankle ${r1(r.low)} px`);
    check(`${g} (facing ${face > 0 ? 'right' : 'left'}): covers ground at her speed, forwards`, Math.abs(r.speed - v) < 0.12 * v, `${r1(r.speed * 100) / 100} units/s, meant ${v}`);
  }
  {
    // she shifts her weight before the first step, and reaches speed over about a third of a second after it
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.5, 0); const x0 = lab.pos().x; lab.step(0.15); const early = lab.pos().x - x0; lab.step(0.5); const s = lab.pos().speed; return { early, s }; })()`);
    check('walk: a weight shift, then a ramp up to speed', Math.abs(r.early) < 0.01 && r.s > 0.7, `moved ${r1(r.early * 1000) / 1000} units in the first 0.15 s; ${r1(r.s * 100) / 100} units/s at 0.65 s`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.5, 0); lab.walkTo(2.5); let prevV = 9, slowed = true, t = 0;
      while (lab.pos().action === 'walk' && t < 6) { lab.step(1/60); t += 1/60; const p = lab.pos(); if (2.5 - p.x < 0.35 && p.speed > prevV + 1e-6) slowed = false; if (2.5 - p.x < 0.35) prevV = p.speed; }
      return { x: lab.pos().x, action: lab.pos().action, t, slowed }; })()`);
    check('walkTo: she slows over the last stretch and stands at the spot', r.action === 'idle' && Math.abs(r.x - 2.5) < 0.06 && r.slowed, `stopped at ${r1(r.x * 1000) / 1000} (target 2.5) after ${r1(r.t)} s, now ${r.action}`);
  }

  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(3.0, 0); lab.walkTo(1.8); let t = 0; while (lab.pos().action === 'walk' && t < 8) { lab.step(1/60); t += 1/60; }
      const a = { x: lab.pos().x, action: lab.pos().action, facing: lab.pos().facing, t };
      lab.begin('walk'); lab.setPos(2.0, 0); lab.walkTo('abc'); lab.step(0.5); return { a, junk: lab.pos().x, junkOk: Number.isFinite(lab.pos().x) && lab.pos().action === 'walk' }; })()`);
    check('walkTo: a target behind her turns her round, and she still arrives', r.a.action === 'idle' && Math.abs(r.a.x - 1.8) < 0.06 && r.a.facing === -1, `stopped at ${r1(r.a.x * 1000) / 1000} facing ${r.a.facing} after ${r1(r.a.t)} s`);
    check('walkTo: junk is ignored, not turned into NaN', r.junkOk, `x ${r.junk}`);
  }
  {
    // a squash still blending out when she starts walking must not drag the planted foot
    const r = await js(`(() => { lab.begin('fall'); lab.setPos(1.5, 0.5); for (let i = 0; i < 200 && lab.pos().action !== 'land'; i++) lab.step(1/60); lab.step(0.05); lab.start('walk');
      let worst = 0, prev = null; const all = [];
      // (not while the swap's sliver is still widening)
      for (let i = 0; i < 40; i++) { lab.step(1/60); if (lab.pos().view !== 'side' || lab.pos().turning || Math.abs(lab.snapshot().scaleX) < 0.98) { prev = null; continue; } const fs = T_.stand('side'); const f = [lab.bone('foot_near').px, lab.bone('foot_far').px];
        if (prev) for (let k = 0; k < 2; k++) if (Math.abs(f[k][1] - fs) <= 1.5 && Math.abs(prev[k][1] - fs) <= 1.5) { const d = Math.abs(f[k][0] - prev[k][0]); worst = Math.max(worst, d); all.push(d); } prev = f; }
      all.sort((p, q) => p - q); return { worst, median: all[all.length >> 1], n: all.length }; })()`);
    // (the legs are still blending in from the landing pose over the first hand-over, so one frame may give a little)
    check('land -> walk: the first steps plant too', r.n >= 10 && r.median <= 1 && r.worst <= 3, `median ${r.median} px, worst ${r.worst} px over ${r.n} foot-on-floor frames`);
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
    // a foot keeps doing roughly what it was doing on the frame before: a planted one stays put, a swinging one does
    // not suddenly go faster (checked at several points of the stride, since the answer depends on where she stops)
    // (the stop starts a view swap, whose squash narrows her toward her feet: that part is a camera move, so the
    // expected narrowing of each foot toward her root is taken back out of the switch frame)
    const r = await js(`(() => { let worst = { over: -1e9 }; for (let k = 0; k < 6; k++) { for (const n of ['foot_near', 'foot_far']) { lab.begin('walk'); lab.setPos(1.5, 0); lab.step(0.6 + k * 0.13);
        const f0 = lab.bone(n).px; lab.step(1/60); const f1 = lab.bone(n).px, root1 = lab.bone('root').px[0]; lab.start('idle'); lab.step(1/60); const f2 = lab.bone(n).px, sq = Math.abs(lab.snapshot().scaleX);
        const f2un = [lab.bone('root').px[0] + (f2[0] - lab.bone('root').px[0]) / sq, f2[1]];
        const before = T_.dist(f1, f0), sw = T_.dist(f2un, f1), over = sw - (1.5 * before + 2); if (over > worst.over) worst = { over, before, sw, n, k }; } }
      return worst; })()`);
    check('walk -> idle: on the stop frame a foot moves no more than 1.5x its previous frame (+2 px)', r.over <= 0, `worst: ${r1(r.sw)} px on the stop after ${r1(r.before)} px (${r.n}, stride point ${r.k})`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.5, 0); lab.step(0.6); const normal = T_.meanMove(30);
      lab.begin('idle'); lab.setPos(1.5, 0); lab.step(1.0); const f1 = lab.bone('foot_near').px; lab.start('walk'); lab.step(1/60); const f2 = lab.bone('foot_near').px;
      return { normal, sw: T_.dist(f2, f1) }; })()`);
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
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('look'); lab.step(1.3); lab.start('idle'); lab.step(1.0); const s = lab.snapshot(); return { gaze: s.gaze, yaw: s.eyeYaw }; })()`);
    check('look: her gaze comes back after the look action ends', r.gaze === null && Math.abs(r.yaw) < 0.02, `gaze ${r.gaze}, eye yaw ${r.yaw}`);
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
      for (const y of [0, 0.4, 0.5, 0.4, 0.35, 0.28]) { for (let i = 0; i < 18; i++) { lab.look(y, 0); lab.step(1/60); } out.push(lab.snapshot().gaze); } lab.look(0, 0); return out; })()`);
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

  // ---- eye life, look-at, breathing, talking body, hop, stop, turn ------------------------------------------------
  {
    // a minute of idle with nobody around: her gaze should wander by itself, 20-40 look-cell changes a minute
    const r = await js(`(() => { T_.pairedBlinks = 0; lab.emotion('neutral'); lab.begin('idle'); lab.step(0.5); let prev = lab.face().eye_l, changes = 0, glances = 0, paired = 0, fades = 0, lastLook = -99, wasBlink = false, blinkAt = [];
      for (let i = 0; i < 3600; i++) { lab.step(1/60); const f = lab.face(); const e = f.eye_l;
        if (f.blinking && !wasBlink) blinkAt.push(i); wasBlink = f.blinking;
        if (f.eye_l_in && (/^look_/.test(f.eye_l_in) || /^look_/.test(e))) fades++;
        const look = (x) => /^look_/.test(x);
        if (look(e) !== look(prev) && e !== 'closed' && prev !== 'closed' && e !== 'half_lid' && prev !== 'half_lid') { changes++; if (look(e)) { glances++; lastLook = i; if (blinkAt.some((b) => Math.abs(b - i) <= 20)) T_.pairedBlinks++; } }
        prev = e; }
      return { changes, glances, blinks: blinkAt.length, fades, paired: T_.pairedBlinks }; })()`);
    check('eye life: her gaze wanders on its own, 20-40 look changes a minute', r.changes >= 20 && r.changes <= 40 && r.glances >= 8, `${r.changes} changes (${r.glances} glances), ${r.blinks} blinks in 60 s`);
    check('eye life: some gaze shifts ride on a blink', r.paired >= 1, `${r.paired} of ${r.glances} glances within 1/3 s of a blink`);
    check('eye life: gaze changes snap, they do not dissolve', r.fades === 0, `${r.fades} frames of a gaze crossfade`);
  }
  {
    const r = await js(`(() => { lab.emotion('smug'); lab.begin('idle'); lab.step(0.5); const seen = new Set(); for (let i = 0; i < 1800; i++) { lab.step(1/60); seen.add(lab.face().eye_l); } return [...seen]; })()`);
    check('eye life: half-lidded eyes are left alone', !r.some((e) => /^look_/.test(e)), `eye states ${r.join('/')}`);
  }
  {
    const r = await js(`(() => { lab.begin('walk'); lab.setPos(1.0, 0); lab.step(0.5); const seen = []; let prev = null, big = 0;
      for (let i = 0; i < 300; i++) { lab.step(1/60); const m = lab.snapshot().micro; if (!m) continue; const k = m.join(','); if (k !== prev) { seen.push(Math.hypot(m[0], m[1])); prev = k; } }
      return { n: seen.length, lo: Math.min(...seen), hi: Math.max(...seen) }; })()`);
    check('side view: tiny saccades of the iris, every 0.3-0.8 s', r.n >= 6 && r.n <= 18 && r.lo >= 0.99 && r.hi <= 1.51, `${r.n} in 5 s, ${r1(r.lo * 100) / 100}-${r1(r.hi * 100) / 100} px`);
  }
  {
    // The pet calls lab.lookAt(null) every frame the cursor is away. The look action must still move her eyes.
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('look'); let maxEye = 0, gazes = new Set(), maxHead = 0;
      for (let i = 0; i < 150; i++) { lab.step(1/60); lab.lookAt(null); const s = lab.snapshot(); maxEye = Math.max(maxEye, Math.abs(s.eyeYaw)); if (s.gaze) gazes.add(s.gaze); maxHead = Math.max(maxHead, Math.abs(lab.bone('head').pose)); }
      return { maxEye, gazes: [...gazes], maxHead }; })()`);
    check('look action: her eyes move even while the pet keeps clearing lab.look', r.maxEye > 0.6 && r.gazes.length >= 2 && r.maxHead > 0.05, `eye yaw up to ${r1(r.maxEye * 100) / 100}, gaze ${r.gazes.join('/')}, head ${r1(r.maxHead * 1000) / 1000} rad`);
  }
  {
    // a mood change while she is looking at you fades like any mood change; only gaze-to-gaze changes snap
    // (a blink can land in the middle and rightly cut the fade short, so up to three tries: a snap never fades at all)
    const r = await js(`(() => { let out = null; for (let k = 0; k < 3; k++) { lab.emotion('neutral'); lab.begin('idle'); let before = null;
      for (let i = 0; i < 120 && !/^look_/.test(before || ''); i++) { lab.look(0.9, 0); lab.step(1/60); before = lab.face().eye_l; }
      lab.emotion('happy'); let faded = false; for (let i = 0; i < 20; i++) { lab.look(0.9, 0); lab.step(1/60); const f = lab.face(); if (f.eye_l_in === 'happy') faded = true; }
      out = { before, faded, tries: k + 1 }; if (faded) break; } return out; })()`);
    check('a mood change while she looks at you still crossfades', /^look_/.test(r.before) && r.faded, JSON.stringify(r));
  }
  {
    // the eyes lead, the head follows
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(1.0); let te = null, th = null, t = 0;
      for (let i = 0; i < 90; i++) { lab.look(1, 0); lab.step(1/60); t += 1/60; const s = lab.snapshot(); if (te === null && s.eyeYaw >= 0.5) te = t; if (th === null && s.headYaw >= 0.3) th = t; }
      const head = lab.bone('head').pose; lab.look(0, 0); return { te, th, head }; })()`);
    check('look: the eyes get there first and the head follows (lead >= 80 ms)', r.te !== null && r.th !== null && r.th - r.te >= 0.08, `eyes half-way at ${Math.round(r.te * 1000)} ms, head at ${Math.round(r.th * 1000)} ms; head ${r1(r.head * 1000) / 1000} rad`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.step(0.3); const lens = new Set(); let prevSy = 1, rising = false, peaks = [];
      for (let i = 0; i < 40 * 60; i++) { lab.step(1/60); const sy = lab.bone('chest').sy; lens.add(lab.snapshot().breathLen); if (sy < prevSy && rising) peaks.push(i / 60); rising = sy > prevSy; prevSy = sy; }
      const gaps = peaks.slice(1).map((p, i) => p - peaks[i]); const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
      return { n: gaps.length, mean, sd, lens: lens.size }; })()`);
    check('breathing: 3.6-4.2 s a breath, no two alike', r.mean >= 3.3 && r.mean <= 4.6 && r.sd > 0.05, `${r.n} breaths, mean ${r1(r.mean * 100) / 100} s, spread ${r1(r.sd * 100) / 100} s`);
  }
  {
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('talk'); lab.step(0.5); lab.talking(6); let nods = 0, prev = 1, falling = false, deepest = 1, phrase = 0;
      let chestTalk = [], chestBreak = 0;
      for (let i = 0; i < 360; i++) { lab.step(1/60); const sy = lab.bone('neck').sy; deepest = Math.min(deepest, sy); if (sy > prev && falling && prev < 0.985) nods++; falling = sy < prev; prev = sy;
        const c = lab.bone('chest').sy; if (lab.face().viseme === 'closed') { phrase++; chestBreak = Math.max(chestBreak, c); } else chestTalk.push(c); }
      const chestMean = chestTalk.reduce((a, b) => a + b, 0) / chestTalk.length;
      const quiet = []; for (let i = 0; i < 120; i++) { lab.step(1/60); quiet.push(lab.bone('neck').sy); }
      return { nods, deepest, still: Math.min(...quiet.slice(60)), phrase, breath: chestBreak - chestMean }; })()`);
    check('talk: a nod every few syllables, and none once she is quiet', r.nods >= 4 && r.nods <= 12 && r.deepest < 0.975 && r.still > 0.999, `${r.nods} nods in 6 s (deepest neck ${r1(r.deepest * 1000) / 1000}), neck ${r1(r.still * 1000) / 1000} once quiet`);
    check('talk: she breathes in at the phrase breaks', r.phrase > 10 && r.breath > 0.008, `${r.phrase} break frames; chest ${r1(r.breath * 1000) / 1000} above its talking mean`);
  }
  {
    // the hop crouches before it leaves the floor and lands on planted feet
    const r = await js(`(() => { lab.begin('hop'); lab.setPos(1.5, 0); const hip0 = lab.bone('hips').px[1]; let lowHip = hip0, feet = 1e9, air = 0;
      for (let i = 0; i < 7; i++) { lab.step(1/60); lowHip = Math.max(lowHip, lab.bone('hips').px[1]); feet = Math.min(feet, T_.above() > -2 && T_.above() < 2 ? 1 : 0); }
      for (let i = 0; i < 36; i++) { lab.step(1/60); if (lab.pos().y > 0.001 || lab.snapshot().rootY > 0.05) air++; }
      let contact = 1e9, ok = true; for (let i = 0; i < 6; i++) { lab.step(1/60); const a = T_.above(); if (a < -2 || a > 2) ok = false; }
      return { dip: lowHip - hip0, feet, ok, air }; })()`);
    check('hop: she crouches first (feet planted), flies, and lands on planted feet', r.dip >= 3 && r.feet === 1 && r.ok && r.air >= 30, `hips dropped ${r1(r.dip)} px before take-off, ${r.air} frames in the air`);
  }
  {
    // her neck never shortens in idle, so any dip there after a walk is the stop settling (and it should ring, not just sag)
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('walk'); lab.setPos(1.2, 0); lab.step(0.8); lab.start('idle'); let deepest = 1, crossings = 0, prev = 0;
      for (let i = 0; i < 60; i++) { lab.step(1/60); const d = lab.bone('neck').sy - 1; deepest = Math.min(deepest, 1 + d); const sgn = Math.abs(d) < 1e-4 ? 0 : Math.sign(d); if (sgn && prev && sgn !== prev) crossings++; if (sgn) prev = sgn; }
      return { deepest, crossings, view: lab.pos().view }; })()`);
    check('stopping from a walk: her body carries on and settles, facing us', r.view === 'front' && r.deepest < 0.99 && r.crossings >= 1, `neck down to ${r1(r.deepest * 1000) / 1000}, ${r.crossings} rebounds`);
  }
  {
    // measured against the same seven frames of the same walk without a turn, so the walk's own head bob cancels out
    const r = await js(`(() => { const run = (turn) => { lab.begin('walk'); lab.setPos(1.5, 0); lab.step(0.5); if (turn) lab.turnTo(-1); const out = []; for (let i = 0; i < 7; i++) { lab.step(1/60); out.push([lab.bone('head').pose, lab.snapshot().facing]); } return out; };
      const a = run(true), b = run(false); let lead = 0; a.forEach((v, i) => { if (v[1] === 1) lead = Math.max(lead, Math.abs(v[0] - b[i][0])); }); return lead; })()`);
    check('turn: her head starts it (about 0.1 rad before the flip)', r > 0.06, `head ${r1(r * 1000) / 1000} rad off its no-turn path before the sprite flipped`);
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
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('walk'); lab.setPos(1.0, 0); lab.step(1.2); lab.start('idle'); lab.settle(); const xs = [];
      for (let i = 0; i < 120; i++) { lab.step(1/60); xs.push(lab.snapshot().springs.tail_4); }
      let peaks = 0, sign = 0; const peakAmps = []; let cur = 0;
      for (const v of xs) { const s = Math.sign(v); if (s && s !== sign) { if (sign && cur > 0.012) { peaks++; peakAmps.push(cur); } sign = s; cur = 0; } cur = Math.max(cur, Math.abs(v)); }
      if (cur > 0.012) { peaks++; peakAmps.push(cur); }
      return { peaks, amps: peakAmps.map((a) => +a.toFixed(3)), view: lab.pos().view }; })()`);
    check('walk -> idle: the tail swings on past her stop and swings back', r.view === 'front' && r.peaks >= 2, `swings ${r.peaks}: ${r.amps.join(', ')} rad`);
  }
  {
    // The desktop selftest's drag: 45 px per 0.05 s at the pet's scale (0.225 units, about 4.5 units/s), then a throw.
    // The springs used to take that speed at face value and her hair streamed out to its limit like a flame.
    const r = await js(`(() => { lab.emotion('neutral'); lab.begin('idle'); lab.setPos(lab.stage().w * 0.3, 0); lab.step(1.0);
      const k = lab.stage().k, b = lab.bbox(), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; const peak = {};
      const rec = () => { const s = lab.snapshot().springs; for (const n in s) { const c = n.replace(/_[0-9]+$/, ''); peak[c] = Math.max(peak[c] || 0, Math.abs(s[n])); } };
      lab.hold(cx, cy, 'body');
      for (let i = 1; i <= 12; i++) { lab.holdAt(cx + i * 0.225 * k, cy - i * 0.18 * k); for (let f = 0; f < 3; f++) { lab.step(1/60); rec(); } }
      lab.release(); for (let f = 0; f < 45; f++) { lab.step(1/60); rec(); }
      return peak; })()`);
    const HELD_LIMIT = { hair_l: 1.0, hair_r: 1.0, tail: 1.25 };   // HELD_SPRING in rig.js
    const worst = Math.max(...Object.keys(HELD_LIMIT).map((c) => (r[c] || 0) / HELD_LIMIT[c]));
    check('dragged fast and thrown: hair and tail sway, never fan out (< 40 % of their travel)', worst < 0.4 && (r.hair_l || 0) > 0.03,
      Object.keys(HELD_LIMIT).map((c) => `${c} ${Math.round(100 * (r[c] || 0) / HELD_LIMIT[c])}%`).join(', '));
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
