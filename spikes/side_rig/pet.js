// Pet layer on top of rig.js: pointer interaction (hover, click, drag, throw) and an autopilot that keeps her busy
// (wander, look, sit, stretch, nap). In the pet window a preload bridge (window.petBridge) tells the main process when
// the cursor is over her so the window stops being click-through; in the lab the same code runs without the bridge.
import './rig.js';
import { createMind, observe, tick as mindTick, decide as mindDecide, shouldChange, summarise, suggest, ACTIVITIES } from './mind.js';
import { createVoice, react as vReact, idleLine, speak, readTime } from './voice.js';
import { blank as blankMemory, load as loadMemory, resume as resumeMemory, record as recordMemory, snapshot as snapshotMemory, describe as describeMemory } from './memory.js';
const lab = window.lab, bridge = window.petBridge || null;
const M = createMind();          // what she wants; see mind.js. The dice are gone.
const V = createVoice();         // what she says; see voice.js
let MEM = blankMemory();         // what she remembers about you; see memory.js
const bubble = document.getElementById('say');
let bubbleUntil = 0;
const Q = new URLSearchParams(location.search);
const rnd = (a, b) => a + Math.random() * (b - a), pick = (a) => a[Math.floor(Math.random() * a.length)];
const P = { auto: Q.get('pet') === '1', state: 'idle', since: 0, until: 0, t: 0, target: null, gait: 'walk', cursor: null, over: false, drag: null, lastTouch: 0, hoverT: 0, behindT: 0, pickT: 0, userIdle: null, near: false, nextIdleLine: 20, nextThought: 35, lastSave: 0, quiet: false, log: [] };
const mindCtx = () => ({ cursorNear: P.near, userIdleSeconds: P.userIdle });
const IDLE_EMO = ['neutral', 'neutral', 'relaxed', 'gentle', 'happy'];
// what she does when you touch each part of her
const REACT = {
  head: { action: 'wave', emotion: 'affection' },
  hair: { action: 'tail_react', emotion: 'shy' },
  body: { action: 'talk', emotion: 'happy' },
  skirt: { action: 'tail_react', emotion: 'shy' },
  legs: { action: 'tail_react', emotion: 'surprised' },
  arms: { action: 'wave', emotion: 'cheerful' },
  tail: { action: 'tail_react', emotion: 'panic' },
};
const onHer = (x, y) => lab.pick(x, y);

function note(state, extra) { P.log.push({ t: +P.t.toFixed(1), state, mood: M.mood, ...(extra || {}) }); if (P.log.length > 300) P.log.shift(); }
const feel = (fallback) => { try { lab.emotion(M.mood); } catch (e) { lab.emotion(fallback || 'neutral'); } };
function enter(state, opts = {}) {
  P.state = state; P.since = P.t; P.until = P.t + (opts.dur ?? 3);
  note(state, opts.note ? { note: opts.note } : undefined);
  switch (state) {
    case 'idle': lab.start('idle'); if (opts.emotion) lab.emotion(opts.emotion); else feel(); break;
    case 'wander': {
      const st = lab.stage(), p = lab.pos();
      let tx = p.x, tries = 0;
      while (Math.abs(tx - p.x) < Math.min(1.2, st.w * 0.3) && tries++ < 20) tx = rnd(0.9, Math.max(0.9, st.w - 0.9));
      P.target = tx; P.gait = opts.gait || (Math.abs(tx - p.x) > st.w * 0.45 || Math.random() < 0.2 ? 'run' : 'walk');
      lab.turnTo(tx > p.x ? 1 : -1); lab.start(P.gait); if (P.gait === 'run') lab.emotion('cheerful'); else feel();
      P.until = P.t + 40; note('wander', { target: +tx.toFixed(2), gait: P.gait });
      break;
    }
    case 'look': lab.start('look'); lab.emotion('curious'); break;
    case 'sit': lab.start('sit'); feel('relaxed'); break;
    case 'stretch': lab.start('stretch'); lab.emotion('sleepy'); break;
    case 'tail': lab.start('tail_react'); feel('happy'); break;
    case 'talk': lab.start('talk'); feel('happy'); say(idleLine(V, P.t, M, ctxNow(), true)); break;
    case 'sleep': lab.start('sleep'); lab.emotion('sleepy'); break;
    case 'wake': lab.start('wake'); lab.emotion('neutral'); break;
    case 'react': lab.start(opts.action || pick(['wave', 'celebrate', 'tail_react', 'talk'])); lab.emotion(opts.emotion || pick(['happy', 'cheerful', 'affection', 'surprised'])); break;
    case 'held': lab.emotion('panic'); break;        // lab.hold() already started the dangle
    case 'fall': lab.emotion('shocked'); break;
    case 'landed': lab.emotion(opts.emotion || 'awkward'); break;
  }
}
function decide() {
  // She no longer rolls dice. mind.js scores everything she could do against the needs she actually has and
  // hands back a choice with a plain-English reason, which is kept in the log so her behaviour is explainable.
  if (P.state === 'sleep') return enter('wake', { dur: 1.3 });
  if (P.state === 'wake') return enter('idle', { dur: rnd(2, 4) });
  const c = mindDecide(M, mindCtx());
  return enter(c.activity, { dur: Math.max(1.2, c.until - M.t), note: c.reason });
}
function touched() { P.lastTouch = P.t; }

// --- her voice -------------------------------------------------------------------------------------------
// The bubble follows her head, so it reads as her speaking rather than as a notification.
function say(line) {
  if (!line || !bubble || P.quiet) return;   // out-of-character mode keeps her quiet
  bubble.textContent = line;
  bubble.classList.add('on');
  bubbleUntil = P.t + readTime(line);
  note('say', { line });
}
function placeBubble() {
  if (!bubble) return;
  if (P.t > bubbleUntil) { bubble.classList.remove('on'); return; }
  // horizontally on her head, vertically clear of her silhouette: the head BONE sits at the base of her skull,
  // so anchoring to it alone put the bubble on her forehead.
  const [hx] = lab.headPx();
  const b = lab.bbox();
  const w = bubble.offsetWidth || 160, h = bubble.offsetHeight || 40;
  bubble.style.left = `${Math.max(w / 2 + 6, Math.min(window.innerWidth - w / 2 - 6, hx))}px`;
  bubble.style.top = `${Math.max(h + 10, b.y0 - 10)}px`;
}
const ctxNow = () => ({ ...mindCtx(), hourOfDay: new Date().getHours() });

// --- her optional brain ----------------------------------------------------------------------------------
// We ask, and carry on. Whatever comes back arrives later and only ever becomes a SUGGESTION for her next
// decision, so a slow, broken, unpaid or absent model can never stall her or take her over.
let thinking = false;
async function consult() {
  if (thinking || !bridge || !bridge.think) return;
  thinking = true;
  try {
    const out = await bridge.think(summarise(M, ctxNow()), describeMemory(MEM, Date.now()), Object.keys(ACTIVITIES));
    if (out && out.activity) {
      suggest(M, out.activity, 'she thought about it');
      note('thought', { activity: out.activity, line: out.line || '' });
      if (out.line) say(speak(V, P.t, out.line));
    }
  } catch (e) { /* she simply carries on */ } finally { thinking = false; }
}

function endDrag() { P.drag = null; setOver(false); document.body.style.cursor = 'default'; }
function setOver(v) { if (v === P.over) return; P.over = v; if (bridge) bridge.setHit(v); document.body.style.cursor = v ? (P.drag ? 'grabbing' : 'grab') : 'default'; }
function onTick(dt) {
  P.t += dt;
  const p = lab.pos();
  mindTick(M, dt, mindCtx());
  // hit state follows her even when the mouse is still (she walks out from under the cursor)
  P.pickT += dt;
  if (P.cursor && !P.drag && P.pickT >= 0.05) { P.pickT = 0; setOver(onHer(P.cursor[0], P.cursor[1])); }
  // attention: look at a nearby cursor, turn around if it stays behind her
  if (P.cursor && !P.drag && !p.held && !p.airborne) {
    const [hx, hy] = lab.headPx(), st = lab.stage();
    const near = Math.hypot(P.cursor[0] - hx, P.cursor[1] - hy) < st.k * 2.6;
    P.near = near;
    if (near) lab.lookAt(P.cursor[0], P.cursor[1]); else lab.lookAt(null);
    if (P.over) {
      P.hoverT += dt;
      if (P.state === 'sleep' && P.hoverT > 1.2) { touched(); observe(M, 'hover'); enter('wake', { dur: 1.3 }); }
      else if (P.state === 'idle' && P.hoverT > 0.5) { observe(M, 'hover'); feel('happy'); }
    } else P.hoverT = 0;
    const behind = p.view === 'side' && near && Math.sign(P.cursor[0] - hx) === -p.facing;
    P.behindT = behind ? P.behindT + dt : 0;
    if (P.behindT > 0.8 && !p.turning && !p.speed) { lab.turnTo(-p.facing); P.behindT = 0; }
  }
  if (P.drag && P.drag.moved) lab.holdAt(P.cursor[0], P.cursor[1]);
  placeBubble();   // the bubble follows her head in every mode, not only when the autopilot is running
  // watchdog: if a mouseup was ever lost we would hold the pointer - and, being click-through only while she is
  // NOT under the cursor, we would swallow every click on the desktop. Recover as soon as the rig says she is free.
  if ((P.drag || P.state === 'held') && !p.held && p.action !== 'dangle') { endDrag(); if (P.auto && P.state === 'held') enter('idle', { dur: 1 }); }
  if (!P.auto) return;
  if (P.state === 'held' || P.state === 'fall') {
    if (P.state === 'fall' && !p.airborne && p.action !== 'fall' && p.action !== 'dangle') { observe(M, 'drop', { impact: p.landed || 0 }); recordMemory(MEM, 'drop', { impact: p.landed || 0 }); saveSoon(); say(vReact(V, P.t, 'drop', { impact: p.landed || 0 })); enter('landed', { dur: 1.6, emotion: p.action === 'stumble' ? 'hurt' : 'awkward' }); }
    return;
  }
  if (P.state === 'wander') {
    const arrived = Math.abs(p.x - P.target) < 0.06 || (p.facing > 0 ? p.x > P.target : p.x < P.target);
    if ((arrived && !p.turning) || P.t >= P.until) enter('idle', { dur: rnd(1.5, 4) });
    return;
  }
  if (P.t > P.nextIdleLine) { P.nextIdleLine = P.t + 25 + Math.random() * 50; const l = idleLine(V, P.t, M, ctxNow()); if (l) say(l); }
  if (P.t - P.lastSave > 30) { P.lastSave = P.t; saveMemory(); }
  if (P.t > P.nextThought) { P.nextThought = P.t + 50; consult(); }
  if (shouldChange(M, mindCtx()) || P.t >= P.until) decide();
}
lab.onTick(onTick);

// ------------------------------------------------------------------ pointer
function pointerDown(x, y) {
  P.cursor = [x, y];
  if (!onHer(x, y)) return false;
  P.drag = { x0: x, y0: y, moved: false }; setOver(true); document.body.style.cursor = 'grabbing';
  return true;
}
function pointerMove(x, y) {
  P.cursor = [x, y];
  if (P.drag) {
    if (!P.drag.moved && Math.hypot(x - P.drag.x0, y - P.drag.y0) > 5) {
      P.drag.moved = true; touched(); observe(M, 'grab'); say(vReact(V, P.t, 'grab')); lab.hold(P.drag.x0, P.drag.y0); if (P.auto) enter('held', { dur: 999 }); else lab.emotion('panic');
    }
    if (P.drag.moved) lab.holdAt(x, y);
  }
}
function pointerUp(x, y) {
  P.cursor = [x, y];
  const d = P.drag; endDrag();
  if (!d) return;
  touched();
  if (d.moved) { lab.release(); if (P.auto) enter('fall', { dur: 999 }); }
  else if (P.auto) { const zone = lab.zone(x, y); observe(M, 'pet', { zone }); recordMemory(MEM, 'pet'); saveSoon(); say(vReact(V, P.t, 'pet', { zone })); if (P.state === 'sleep') enter('wake', { dur: 1.3 }); else enter('react', { dur: 2.6, ...(REACT[zone] || {}) }); }
  else lab.start(pick(['wave', 'celebrate', 'tail_react']));
}
window.addEventListener('mousedown', (e) => { if (e.button === 0) pointerDown(e.clientX, e.clientY); });
window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
window.addEventListener('mouseup', (e) => { if (e.button === 0) pointerUp(e.clientX, e.clientY); });
window.addEventListener('mouseleave', () => { if (!P.drag) { P.cursor = null; setOver(false); lab.lookAt(null); } });
// losing focus or pointer capture mid-drag must end the drag, or the click-through window stays off for good
const bail = () => { if (!P.drag) return; const c = P.cursor || [0, 0]; pointerUp(c[0], c[1]); };
window.addEventListener('blur', bail);
window.addEventListener('pointercancel', bail);
document.addEventListener('visibilitychange', () => { if (document.hidden) bail(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bridge) bridge.quit();
  if (e.key.toLowerCase() === 'p') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); }
});
if (bridge && bridge.onIdle) bridge.onIdle((sec) => { P.userIdle = sec; });
if (bridge && bridge.onCommand) bridge.onCommand((cmd) => { try { if (cmd === 'plain' || cmd === 'character') { P.quiet = cmd === 'plain'; if (P.quiet && bubble) bubble.classList.remove('on'); } else if (cmd === 'auto') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); } else if (cmd === 'sleep') enter('sleep', { dur: 60 }); else if (cmd === 'wave') enter('react', { dur: 2.6, action: 'wave' }); } catch (err) { window.__error = String(err.stack || err); } });

// Things worth remembering are saved as they happen, not only on the 30 s timer: a pat that arrives seconds
// before you close her should still be there tomorrow.
function saveSoon() { if (P.t - P.lastSave > 5) { P.lastSave = P.t; saveMemory(); } }
function saveMemory() {
  if (!bridge || !bridge.saveMemory) return;
  bridge.saveMemory(snapshotMemory(MEM, Date.now(), M, P.t - (P.savedAt || 0)));
  P.savedAt = P.t;
}
// On startup: pick up where she left off, and greet you according to how long you were away.
async function wakeUp() {
  if (bridge && bridge.loadMemory) {
    try { MEM = loadMemory(await bridge.loadMemory()); } catch (e) { MEM = blankMemory(); }
  }
  const r = resumeMemory(MEM, Date.now(), M);
  note('woke', { away: Math.round(r.awaySeconds), history: describeMemory(MEM, Date.now()) });
  if (P.auto) setTimeout(() => say(vReact(V, P.t, 'greet', { awaySeconds: r.awaySeconds })), 900);
}

const pet = window.pet = {
  info: () => ({ auto: P.auto, state: P.state, over: P.over, bridge: !!bridge, mind: summarise(M, mindCtx()) }),
  mind: () => summarise(M, mindCtx()),
  needs: () => ({ ...M.needs }),
  feels: () => M.mood,
  setIdle(seconds) { P.userIdle = seconds; },
  state: () => ({ ...P, log: undefined, cursor: P.cursor }),
  auto(v) { P.auto = !!v; if (P.auto) enter('idle', { dur: 1 }); },
  go(state, opts) { enter(state, opts || {}); },
  simulate(ev) { if (ev.type === 'down') return pointerDown(ev.x, ev.y); if (ev.type === 'move') return pointerMove(ev.x, ev.y); if (ev.type === 'up') return pointerUp(ev.x, ev.y); throw new Error('unknown event ' + ev.type); },
  log: () => P.log.slice(),
  say: (line) => say(speak(V, P.t, line)),
  history: () => describeMemory(MEM, Date.now()),
  memory: () => ({ ...MEM }),
  saveNow: () => saveMemory(),
  think: () => consult(),
  brain: () => (bridge && bridge.brainInfo ? bridge.brainInfo() : { enabled: false }),
};
if (P.auto) { P.lastTouch = 0; enter('idle', { dur: 2 }); }
wakeUp();
window.addEventListener('beforeunload', saveMemory);
