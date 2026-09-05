// Pet layer on top of rig.js: pointer interaction (hover, click, drag, throw) and an autopilot that keeps her busy
// (wander, look, sit, stretch, nap). In the pet window a preload bridge (window.petBridge) tells the main process when
// the cursor is over her so the window stops being click-through; in the lab the same code runs without the bridge.
import './rig.js';
import { createMind, observe, tick as mindTick, decide as mindDecide, shouldChange, summarise, suggest, ACTIVITIES } from './mind.js';
import { createVoice, react as vReact, idleLine, speak, readTime } from './voice.js';
import { readPerformance } from './perform.js';
import { blank as blankMemory, load as loadMemory, resume as resumeMemory, record as recordMemory, snapshot as snapshotMemory, describe as describeMemory } from './memory.js';
const lab = window.lab, bridge = window.petBridge || null;
const M = createMind();          // what she wants; see mind.js. The dice are gone.
const V = createVoice();         // what she says; see voice.js
let MEM = blankMemory();         // what she remembers about you; see memory.js
const bubble = document.getElementById('say');
let bubbleUntil = 0;
const chatBox = document.getElementById('chat');
const chatLog = document.getElementById('chatLog');
const chatIn = document.getElementById('chatIn');
const chatSend = document.getElementById('chatSend');
const turns = [];              // the conversation so far, newest last
let chatBusy = false;
const Q = new URLSearchParams(location.search);
const rnd = (a, b) => a + Math.random() * (b - a), pick = (a) => a[Math.floor(Math.random() * a.length)];
const P = { auto: Q.get('pet') === '1', state: 'idle', since: 0, until: 0, t: 0, target: null, gait: 'walk', cursor: null, over: false, drag: null, lastTouch: 0, hoverT: 0, behindT: 0, pickT: 0, userIdle: null, near: false, capture: null, obeyUntil: 0, carryMood: null, carryAt: 0, nextIdleLine: 20, nextThought: 35, lastSave: 0, quiet: false, hintShown: false, log: [] };
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
const GRAB_PAD = 14;          // px of slack around her silhouette that still counts as grabbable
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
      if (opts.target != null) tx = Math.max(0.6, Math.min(st.w - 0.6, opts.target));
      else while (Math.abs(tx - p.x) < Math.min(1.2, st.w * 0.3) && tries++ < 20) tx = rnd(0.9, Math.max(0.9, st.w - 0.9));
      P.target = tx; P.gait = opts.gait || (Math.abs(tx - p.x) > st.w * 0.45 || Math.random() < 0.2 ? 'run' : 'walk');
      lab.turnTo(tx > p.x ? 1 : -1); lab.start(P.gait); if (P.gait === 'run') lab.emotion('cheerful'); else feel();
      P.until = P.t + 40; note('wander', { target: +tx.toFixed(2), gait: P.gait });
      break;
    }
    case 'look': lab.start('look'); lab.emotion('curious'); break;
    case 'sit': lab.start('sit'); feel('relaxed'); break;
    case 'stretch': lab.start('stretch'); lab.emotion('sleepy'); break;
    case 'tail': lab.start('tail_react'); feel('happy'); break;
    case 'dance': lab.start('dance'); if (opts.emotion) lab.emotion(opts.emotion); else feel('cheerful'); break;
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

// --- doing what was said ------------------------------------------------------------------------------------
// Ask her to dance, or to go and stand on the left, and she should actually do it. perform.js reads both your
// instruction and the bracketed stage directions in her reply; this turns that into movement.
const AS_STATE = { sit: 'sit', sleep: 'sleep', stretch: 'stretch', look: 'look', talk: 'talk', tail_react: 'tail', dance: 'dance' };
const AS_REACTION = { wave: 'wave', celebrate: 'celebrate', hop: 'hop', stumble: 'stumble' };
// The model's own statement of intent wins; the keyword reader is the fallback when there is no brain, or when
// the model did not emit the line.
const DO_MAP = { walk: 'wander', run: 'wander', follow: 'wander', stop: 'idle', idle: 'idle', sit: 'sit', sleep: 'sleep',
  wake: 'wake', stretch: 'stretch', tail: 'tail_react', look: 'look', talk: 'talk', dance: 'dance',
  wave: 'wave', hop: 'hop', celebrate: 'celebrate', stumble: 'stumble' };
const PLACE_MAP = { left: 0.12, right: 0.88, middle: 0.5, cursor: 'cursor' };
function planFromAct(act) {
  if (!act || !act.do || act.do === 'none') return act && act.mood ? { action: null, emotion: act.mood, target: null, from: 'model' } : null;
  const action = DO_MAP[act.do] === 'wander' ? null : DO_MAP[act.do] || null;
  const target = act.to && PLACE_MAP[act.to] !== undefined ? PLACE_MAP[act.to]
    : (act.do === 'walk' || act.do === 'run' || act.do === 'follow') ? 'cursor' : null;
  return { action, emotion: act.mood || null, target, from: 'model', dur: act.for || null, gait: act.do === 'run' ? 'run' : 'walk' };
}
function performFrom(asked, said, act) {
  const plan = planFromAct(act) || readPerformance(asked, said);
  if (!plan) return null;
  const st = lab.stage();
  if (plan.emotion) { try { lab.emotion(plan.emotion); } catch (e) { /* unknown mood, leave her face alone */ } }
  if (plan.target != null) {
    const x = plan.target === 'cursor'
      ? (P.cursor ? P.cursor[0] / st.k : lab.pos().x)
      : plan.target * st.w;
    enter('wander', { target: x, gait: plan.gait || 'walk', dur: 40, emotion: plan.emotion || undefined });
  } else if (AS_STATE[plan.action]) {
    enter(AS_STATE[plan.action], { dur: plan.dur || (plan.action === 'dance' ? 9 : 6), emotion: plan.emotion || undefined });
  } else if (AS_REACTION[plan.action]) {
    enter('react', { dur: plan.dur || 3, action: AS_REACTION[plan.action], emotion: plan.emotion || undefined });
  }
  // Told to do something, she should stay doing it. Without this her own mind reconsiders within a second or
  // two and the order looks ignored - which is most of why she seemed not to listen.
  if (plan.action || plan.target != null) {
    P.obeyUntil = P.t + Math.max(3, plan.dur || 6);
    if (plan.action && ACTIVITIES[AS_STATE[plan.action]]) suggest(M, AS_STATE[plan.action], 'because you asked');
  }
  note('perform', plan);
  return plan;
}

// --- the chat box ------------------------------------------------------------------------------------------
// Her bubble is a line over her head; this is a real conversation, so it gets a panel with history and an input.
// The window is click-through everywhere except her pixels, so while the panel is open its rectangle has to
// count as "her" too, or you could see the box but never type into it.
function chatOpen() { return chatBox && chatBox.classList.contains('on'); }
function chatRect() { return chatBox ? chatBox.getBoundingClientRect() : null; }
function overChat(x, y) {
  if (!chatOpen()) return false;
  const r = chatRect();
  return r && x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
}
function showChat(on) {
  if (!chatBox) return;
  chatBox.classList.toggle('on', on);
  if (on) {
    if (!P.hintShown) { P.hintShown = true; addLine('sys', '和她说说话吧。她会用鲸鱼娘的语气回答。'); }
    setOver(true);
    setTimeout(() => chatIn && chatIn.focus(), 30);
    if (P.auto && P.state === 'wander') enter('idle', { dur: 6 });
  }
}
// Her （…） asides are rendered as stage directions rather than plain text, which is most of what makes a
// role-play reply readable. Built as DOM nodes, never innerHTML, because the text comes from a model.
function renderHer(text, into) {
  for (const part of String(text).split(/(（[^）]*）|\([^)]*\))/g)) {
    if (!part) continue;
    const node = document.createElement(/^[（(]/.test(part) ? 'span' : 'span');
    if (/^[（(]/.test(part)) node.className = 'act';
    node.textContent = part;
    into.appendChild(node);
  }
}
function addLine(kind, text) {
  if (!chatLog) return null;
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  if (kind === 'her') renderHer(text, el); else el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}
async function sendChat() {
  if (!chatIn || chatBusy) return;
  const text = chatIn.value.trim();
  if (!text) return;
  chatIn.value = '';
  turns.push({ role: 'you', text });
  addLine('you', text);
  touched();
  observe(M, 'pet', { zone: 'body' });        // being spoken to is attention
  lab.start('talk');
  chatBusy = true;
  if (chatSend) chatSend.disabled = true;
  const waiting = addLine('her', '（……）');
  if (!bridge || !bridge.chat) {
    waiting.textContent = '（她现在听不见你——桌宠模式外没有接上大脑）';
    chatBusy = false; if (chatSend) chatSend.disabled = false;
    return;
  }
  const res = await bridge.chat(turns, summarise(M, ctxNow()), describeMemory(MEM, Date.now()));
  waiting.textContent = '';
  if (res && res.text) {
    renderHer(res.text, waiting);
    turns.push({ role: 'her', text: res.text });
    note('chat', { line: res.text.slice(0, 60) });
    performFrom(text, res.text, res.act);   // her body does what the two of you just said
  } else {
    waiting.className = 'msg sys';
    waiting.textContent = `她没能回答：${(res && res.error) || 'unknown'}`;
  }
  chatLog.scrollTop = chatLog.scrollHeight;
  chatBusy = false;
  if (chatSend) chatSend.disabled = false;
  if (chatIn) chatIn.focus();
}
if (chatSend) chatSend.addEventListener('click', sendChat);
if (chatIn) chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
const chatClose = document.getElementById('chatClose');
if (chatClose) chatClose.addEventListener('click', () => showChat(false));

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

// Ending a drag must not slam the window back to click-through while the button may still be down - that is how
// a failed grab leaked the whole gesture onto the app behind her. Re-pick from the cursor on the next tick.
function endDrag() { P.drag = null; document.body.style.cursor = P.over ? 'grab' : 'default'; P.pickT = 999; }
function setOver(v) {
  if (P.drag) v = true;                    // never go click-through mid-gesture
  if (v === P.over) return;
  P.over = v; if (bridge) bridge.setHit(v);
  document.body.style.cursor = v ? (P.drag ? 'grabbing' : 'grab') : 'default';
}
function onTick(dt) {
  P.t += dt;
  const p = lab.pos();
  mindTick(M, dt, mindCtx());
  // hit state follows her even when the mouse is still (she walks out from under the cursor)
  P.pickT += dt;
  // The window is click-through until we say otherwise, so a fast "swipe over and grab" can lose the press
  // through it (measured 15-64 ms of hover before it flips). Test every frame while the cursor is anywhere near
  // her, and treat a generous box around her as interactive so the press always lands somewhere we own.
  if (P.cursor && !P.drag) {
    const b = lab.bbox(GRAB_PAD);
    const nearBox = P.cursor[0] >= b.x0 && P.cursor[0] <= b.x1 && P.cursor[1] >= b.y0 && P.cursor[1] <= b.y1;
    P.pickT += 0;
    if (nearBox || P.pickT >= 0.05) {
      P.pickT = 0;
      setOver(overChat(P.cursor[0], P.cursor[1]) || nearBox || onHer(P.cursor[0], P.cursor[1]));
    }
  }
  // the window has no reliable mouseleave, so notice for ourselves when the cursor has left it entirely
  if (P.cursor && !P.drag && (P.cursor[0] < 0 || P.cursor[1] < 0 || P.cursor[0] > window.innerWidth || P.cursor[1] > window.innerHeight)) {
    P.cursor = null; setOver(false); lab.lookAt(null);
  }
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
  // Only a drag that has actually TAKEN HOLD can be dropped by the rig. A press that has not yet moved 5 px is
  // deliberately not holding her, so the old condition fired one frame after every mousedown and cancelled it -
  // which is why she could not be picked up, patted, or double-clicked with a real mouse. The self-test never
  // saw it because it presses and moves inside one JS turn, before any frame runs.
  if (((P.drag && P.drag.moved) || P.state === 'held') && !p.held && p.action !== 'dangle') { endDrag(); if (P.auto && P.state === 'held') enter('idle', { dur: 1 }); }
  // a press that never became a drag and never released is the other way to get stuck; give it its own timeout
  if (P.drag && !P.drag.moved && P.t - P.drag.t0 > 3) endDrag();
  if (!P.auto) return;
  // While she is in your hand her face should follow how she is being handled, not sit on one fixed mood.
  if (P.state === 'held') {
    const c = lab.carry();
    if (c) {
      const want = c.distress > 0.62 ? 'panic' : c.distress > 0.34 ? 'surprised'
        : c.zone === 'head' || c.zone === 'body' ? 'affection' : 'awkward';
      if (want !== P.carryMood && P.t - (P.carryAt || 0) > 0.6) { P.carryMood = want; P.carryAt = P.t; lab.emotion(want); }
    }
  }
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
  if (P.t < P.obeyUntil) return;                 // she was told to do this; let her finish
  if (shouldChange(M, mindCtx()) || P.t >= P.until) decide();
}
lab.onTick(onTick);

// ------------------------------------------------------------------ pointer
function pointerDown(x, y) {
  P.cursor = [x, y];
  if (overChat(x, y)) return false;      // clicks inside the panel belong to the panel, not to picking her up
  if (!onHer(x, y)) return false;
  P.drag = { x0: x, y0: y, moved: false, t0: P.t, zone: lab.zone(x, y) };   // zone decides how she hangs
  setOver(true); document.body.style.cursor = 'grabbing';
  return true;
}
function pointerMove(x, y) {
  P.cursor = [x, y];
  if (P.drag) {
    if (!P.drag.moved && Math.hypot(x - P.drag.x0, y - P.drag.y0) > 5) {
      P.drag.moved = true; touched(); observe(M, 'grab'); say(vReact(V, P.t, 'grab')); lab.hold(P.drag.x0, P.drag.y0, P.drag.zone); if (P.auto) enter('held', { dur: 999 }); else lab.emotion('panic');
    }
    if (P.drag.moved) lab.holdAt(x, y);
  }
}
function pointerUp(x, y) {
  P.cursor = [x, y];
  const d = P.drag; endDrag();
  if (!d) return;
  touched();
  if (d.moved) { lab.release(); if (P.auto) enter('fall', { dur: 999 }); return; }
  // double-click her to talk to her: the tray item and the C key are both easy to miss
  const dbl = P.t - (P.lastClickAt ?? -9) < 0.45;
  P.lastClickAt = P.t;
  if (dbl) { showChat(true); return; }
  if (P.auto) { const zone = lab.zone(x, y); observe(M, 'pet', { zone }); recordMemory(MEM, 'pet'); saveSoon(); say(vReact(V, P.t, 'pet', { zone })); if (P.state === 'sleep') enter('wake', { dur: 1.3 }); else enter('react', { dur: 2.6, ...(REACT[zone] || {}) }); }
  else lab.start(pick(['wave', 'celebrate', 'tail_react']));
}
// Pointer events with capture, so a release outside her - or outside the window - still reaches us. Capture is
// taken only once a grab has actually started, or the chat box would stop receiving its own clicks.
const root = document.documentElement;
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  if (pointerDown(e.clientX, e.clientY)) {
    try { root.setPointerCapture(e.pointerId); P.capture = e.pointerId; } catch (err) { /* capture is a bonus */ }
  }
});
window.addEventListener('pointermove', (e) => pointerMove(e.clientX, e.clientY));
const release = (e) => {
  if (P.capture != null) { try { root.releasePointerCapture(P.capture); } catch (err) { /* already gone */ } P.capture = null; }
  pointerUp(e.clientX, e.clientY);
};
window.addEventListener('pointerup', (e) => { if (e.button === 0) release(e); });
window.addEventListener('pointercancel', release);
window.addEventListener('lostpointercapture', () => { if (P.drag) { P.capture = null; pointerUp(...(P.cursor || [0, 0])); } });
window.addEventListener('mouseleave', () => { if (!P.drag) { P.cursor = null; setOver(false); lab.lookAt(null); } });
// losing focus or pointer capture mid-drag must end the drag, or the click-through window stays off for good
const bail = () => { if (!P.drag) return; const c = P.cursor || [0, 0]; pointerUp(c[0], c[1]); };
window.addEventListener('blur', bail);
window.addEventListener('pointercancel', bail);
document.addEventListener('visibilitychange', () => { if (document.hidden) bail(); });
window.addEventListener('keydown', (e) => {
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
  if (e.key === 'Escape') { if (chatOpen()) showChat(false); else if (bridge) bridge.quit(); return; }
  if (typing) return;
  if (e.key.toLowerCase() === 'c') showChat(!chatOpen());
  if (e.key.toLowerCase() === 'p') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); }
});
if (bridge && bridge.onIdle) bridge.onIdle((sec) => { P.userIdle = sec; });
if (bridge && bridge.onCommand) bridge.onCommand((cmd) => { try { if (cmd === 'chat') { showChat(!chatOpen()); } else if (cmd === 'plain' || cmd === 'character') { P.quiet = cmd === 'plain'; if (P.quiet && bubble) bubble.classList.remove('on'); } else if (cmd === 'auto') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); } else if (cmd === 'sleep') enter('sleep', { dur: 60 }); else if (cmd === 'wave') enter('react', { dur: 2.6, action: 'wave' }); } catch (err) { window.__error = String(err.stack || err); } });

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
  chat: (on) => showChat(on !== false),
  ask: async (text) => { showChat(true); chatIn.value = text; await sendChat(); return turns[turns.length - 1]; },
  turns: () => turns.slice(),
  perform: (asked, said, act) => performFrom(asked, said, act),
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
