// Pet layer on top of rig.js: pointer interaction (hover, click, drag, throw) and an autopilot that keeps her busy
// (wander, look, sit, stretch, nap). In the pet window a preload bridge (window.petBridge) tells the main process when
// the cursor is over her so the window stops being click-through; in the lab the same code runs without the bridge.
import './rig.js';
import { createMind, observe, tick as mindTick, decide as mindDecide, shouldChange, summarise, suggest, commit, ACTIVITIES } from './mind.js';
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
// `over` starts unknown rather than false. After a page reload the main process still remembers the last hit state
// it was sent, which may be "clickable"; starting at false made the first setOver(false) look like no change, so it
// was never sent and the whole window went on swallowing clicks.
const P = { auto: Q.get('pet') === '1', state: 'idle', since: 0, until: 0, t: 0, target: null, dir: 1, walkOrder: null, gait: 'walk', cursor: null, over: null, drag: null, lastTouch: 0, hoverT: 0, behindT: 0, pickT: 0, userIdle: null, near: false, capture: null, obeyUntil: 0, pendingPat: null, laterOrder: null, carryMood: null, carryAt: 0, nextIdleLine: 20, nextThought: 35, lastSave: 0, quiet: false, hintShown: false, log: [] };
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
const DOUBLE_CLICK = 0.45;    // s between two clicks that makes them one double-click
const onHer = (x, y) => lab.pick(x, y);
// Within GRAB_PAD px of her actual pixels. lab.pick already looks at a 15 px square around the point, so four picks
// offset by half the pad tile a (2 * GRAB_PAD + 1) px square around the cursor with no gap. This, not her bounding
// box, is what makes the window clickable: the box was measured at 31-41 % empty space, and every click meant for
// an app behind her that landed in that space was eaten by a window that then did nothing with it.
const grabbable = (x, y) => {
  const o = GRAB_PAD / 2;
  return onHer(x - o, y - o) || onHer(x + o, y - o) || onHer(x - o, y + o) || onHer(x + o, y + o);
};

function note(state, extra) { P.log.push({ t: +P.t.toFixed(1), state, mood: M.mood, ...(extra || {}) }); if (P.log.length > 300) P.log.shift(); }
// A mood name can come from a language model, and a model invents moods ('excited', 'proud'). lab.emotion throws on
// a face she does not have, and a throw inside enter() used to escape all the way out of the chat handler before it
// could re-enable the box, so one made-up word killed the chat for the rest of the session. Every mood goes through
// here: a face she has is shown, anything else falls back, and nothing ever throws. (A rig that ignores an unknown
// name returns false instead of throwing; that counts as "not a face she has" too.)
let KNOWN_MOODS = null;
function safeEmotion(name, fallback) {
  if (!KNOWN_MOODS) {
    try { const i = lab.info(); KNOWN_MOODS = new Set([...(i.emotions || []), ...(i.kitMoods || [])]); } catch (e) { KNOWN_MOODS = new Set(); }
  }
  const tries = [name, fallback].filter((n) => typeof n === 'string' && n);
  for (const n of tries) {
    if (!KNOWN_MOODS.has(n)) continue;
    try { if (lab.emotion(n) !== false) return n; } catch (e) { /* try the next one */ }
  }
  // Without the face kit (the lab, no front rig) the list above is only the basic faces, while the rig still takes
  // its aliases ('relaxed', 'cheerful'); so there, and only there, ask the rig directly before giving up.
  if (!KNOWN_MOODS.has('cheerful')) {
    for (const n of tries) { try { if (lab.emotion(n) !== false) return n; } catch (e) { /* not a face she has */ } }
  }
  return null;
}
const feel = (fallback) => safeEmotion(M.mood, fallback || 'neutral');
// Every state she enters that her own mind did not choose - an order, the tray, a pat, a landing, waking up - is
// committed to the mind for as long as it lasts. Without that the mind's old timer kept running underneath and cut
// the new state short on the very next frame: a wake-up lasted one frame, the tray's nap about six seconds, and a
// pat reaction was cut off whenever the timer happened to have run out already. `opts.chosen` marks the one path
// where the mind did choose, so it is not told twice.
function enter(state, opts = {}) {
  P.state = state; P.since = P.t; P.until = P.t + (opts.dur ?? 3);
  P.obeyUntil = 0; P.walkOrder = null;        // anything new ends the last order; an order re-pins itself after this
  note(state, opts.note ? { note: opts.note } : undefined);
  switch (state) {
    case 'idle': lab.start('idle'); if (!opts.emotion || !safeEmotion(opts.emotion)) feel(); break;
    case 'wander': {
      const st = lab.stage(), p = lab.pos();
      let tx = p.x, tries = 0;
      if (opts.target != null) tx = Math.max(0.6, Math.min(st.w - 0.6, opts.target));
      else while (Math.abs(tx - p.x) < Math.min(1.2, st.w * 0.3) && tries++ < 20) tx = rnd(0.9, Math.max(0.9, st.w - 0.9));
      P.target = tx; P.gait = opts.gait || (Math.abs(tx - p.x) > st.w * 0.45 || Math.random() < 0.2 ? 'run' : 'walk');
      // The direction is kept, not read back off her facing: a walk ordered while she is mid-turn has its turnTo
      // ignored by the rig, and judging arrival by whichever way she happened to face abandoned the walk.
      P.dir = tx > p.x ? 1 : -1;
      lab.turnTo(P.dir); lab.start(P.gait);
      if (lab.walkTo) lab.walkTo(tx);          // she eases off over the last stretch and stands at the target
      if (P.gait === 'run') safeEmotion('cheerful'); else if (!opts.emotion || !safeEmotion(opts.emotion)) feel();
      P.until = P.t + 40; note('wander', { target: +tx.toFixed(2), gait: P.gait });
      break;
    }
    case 'look': lab.start('look'); safeEmotion('curious'); break;
    case 'sit': lab.start('sit'); if (!opts.emotion || !safeEmotion(opts.emotion)) feel('relaxed'); break;
    case 'stretch': lab.start('stretch'); safeEmotion(opts.emotion, 'sleepy'); break;
    case 'tail': lab.start('tail_react'); if (!opts.emotion || !safeEmotion(opts.emotion)) feel('happy'); break;
    case 'dance': lab.start('dance'); if (!opts.emotion || !safeEmotion(opts.emotion)) feel('cheerful'); break;
    // `line` is what she says while she talks: a chat reply passes its own words, `null` keeps her silent, and
    // only a talk her own mind chose picks a line of her own.
    case 'talk':
      lab.start('talk'); if (!opts.emotion || !safeEmotion(opts.emotion)) feel('happy');
      say(opts.line !== undefined ? opts.line : idleLine(V, P.t, M, ctxNow(), true));
      break;
    case 'sleep': lab.start('sleep'); safeEmotion('sleepy'); break;
    case 'wake': lab.start('wake'); safeEmotion('neutral'); break;
    case 'react': lab.start(opts.action || pick(['wave', 'celebrate', 'tail_react', 'talk'])); safeEmotion(opts.emotion || pick(['happy', 'cheerful', 'affection', 'surprised']), 'happy'); break;
    case 'held': safeEmotion('panic'); break;        // lab.hold() already started the dangle
    case 'fall': safeEmotion('shocked'); break;
    case 'landed': safeEmotion(opts.emotion || 'awkward', 'awkward'); break;
  }
  if (!opts.chosen) commit(M, state, P.until - P.t, opts.why || 'because you asked');
  return state;
}
function decide() {
  // She no longer rolls dice. mind.js scores everything she could do against the needs she actually has and
  // hands back a choice with a plain-English reason, which is kept in the log so her behaviour is explainable.
  if (P.state === 'sleep') return enter('wake', { dur: 1.3, why: 'slept enough' });
  if (P.state === 'wake') return enter('idle', { dur: rnd(2, 4), why: 'just woke up' });
  const c = mindDecide(M, mindCtx());
  return enter(c.activity, { dur: Math.max(1.2, c.until - M.t), note: c.reason, chosen: true });
}
function touched() { P.lastTouch = P.t; }

// --- her voice -------------------------------------------------------------------------------------------
// The bubble follows her head, so it reads as her speaking rather than as a notification.
function say(line) {
  if (!line || !bubble || P.quiet) return;   // out-of-character mode keeps her quiet
  bubble.textContent = line;
  bubble.classList.add('on');
  bubbleUntil = P.t + readTime(line);
  // her mouth moves for as long as the words are up, whatever her body is doing
  if (lab.talking) { try { lab.talking(readTime(line)); } catch (e) { /* a still mouth is no reason to fail */ } }
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
const AS_STATE = { idle: 'idle', wake: 'wake', sit: 'sit', sleep: 'sleep', stretch: 'stretch', look: 'look', talk: 'talk', tail_react: 'tail', dance: 'dance' };
const AS_REACTION = { wave: 'wave', celebrate: 'celebrate', hop: 'hop', stumble: 'stumble' };
// The model's own statement of intent wins; the keyword reader is the fallback when there is no brain, or when
// the model did not emit the line.
const DO_MAP = { walk: 'wander', run: 'wander', follow: 'wander', stop: 'idle', idle: 'idle', sit: 'sit', sleep: 'sleep',
  wake: 'wake', stretch: 'stretch', tail: 'tail_react', look: 'look', talk: 'talk', dance: 'dance',
  wave: 'wave', hop: 'hop', celebrate: 'celebrate', stumble: 'stumble' };
const PLACE_MAP = { left: 0.12, right: 0.88, middle: 0.5, cursor: 'cursor' };
const STAY_PUT = 20;          // s she stays where she was sent before her own mind takes over again
function planFromAct(act) {
  if (!act || !act.do || act.do === 'none') return act && act.mood ? { action: null, emotion: act.mood, target: null, from: 'model' } : null;
  const action = DO_MAP[act.do] === 'wander' ? null : DO_MAP[act.do] || null;
  const target = act.to && PLACE_MAP[act.to] !== undefined ? PLACE_MAP[act.to]
    : (act.do === 'walk' || act.do === 'run' || act.do === 'follow') ? 'cursor' : null;
  return { action, emotion: act.mood || null, target, from: 'model', dur: act.for || null, gait: act.do === 'run' ? 'run' : 'walk' };
}
// How long an order lasts. Her dance routine is 24 beats (about 13.5 s), and an order to nap is a nap, not a doze.
function orderDur(plan) {
  if (plan.action === 'dance') return Math.max(plan.dur || 0, 13.5);
  if (plan.action === 'sleep') return plan.dur || 60;
  if (plan.action === 'wake') return 1.3;
  return plan.dur || 6;
}
// Enter the state an order names and hold her own mind off for exactly as long as it lasts. Returns the state, or
// null when the order asked for nothing she can do - and then nothing is pinned either, or an order she could not
// follow would freeze whatever she happened to be doing.
function obey(plan) {
  const why = 'because you asked';
  let state = null, dur = 0;
  if (plan.action === 'wake') {
    if (P.state !== 'sleep') return null;         // "别睡了" to someone already awake asks for nothing
    dur = 1.3; state = enter('wake', { dur, why });
  } else if (AS_STATE[plan.action]) {
    dur = orderDur(plan);
    state = enter(AS_STATE[plan.action], { dur, emotion: plan.emotion || undefined, line: null, why });
  } else if (AS_REACTION[plan.action]) {
    dur = plan.dur || 3;
    state = enter('react', { dur, action: AS_REACTION[plan.action], emotion: plan.emotion || undefined, why });
  }
  // Told to do something, she should stay doing it. Without this her own mind reconsiders within a second or
  // two and the order looks ignored - which is most of why she seemed not to listen.
  if (state) P.obeyUntil = P.t + dur;
  return state;
}
function performFrom(asked, said, act) {
  const plan = planFromAct(act) || readPerformance(asked, said);
  if (!plan) return null;
  if (plan.emotion) safeEmotion(plan.emotion);
  // In your hand, in the air, landing or still getting up, an order waits until she is back on her feet. Carried
  // out at once it cut the wake-up short, or took her out of 'fall' so the landing was never noticed.
  if (P.auto && BUSY.has(P.state) && (plan.action || plan.target != null)) {
    P.laterOrder = plan;
    note('perform', { ...plan, entered: 'later' });
    return { ...plan, entered: 'later' };
  }
  return carryOut(plan);
}
function carryOut(plan) {
  P.laterOrder = null;
  const st = lab.stage();
  let entered = null;
  if (plan.target != null) {
    const x = plan.target === 'cursor'
      ? (P.cursor ? P.cursor[0] / st.k : lab.pos().x)
      : plan.target * st.w;
    entered = enter('wander', { target: x, gait: plan.gait || 'walk', dur: 40, emotion: plan.emotion || undefined, why: 'because you asked' });
    // The walk pins itself (the wander branch never consults her mind). What matters is what happens on arrival:
    // she stays there, or does what you asked for once she gets there ("去左边跳舞").
    P.walkOrder = { then: plan.action ? { ...plan, target: null } : null };
  } else entered = obey(plan);
  note('perform', { ...plan, entered });
  return { ...plan, entered };
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
  // The pet window never takes focus on its own, so patting her cannot steal it from whatever you are typing in.
  // The chat box is the one thing that needs the keyboard, so it asks for focus while open and gives it back.
  if (bridge && bridge.focus) bridge.focus(!!on);
  if (on) {
    if (!P.hintShown) { P.hintShown = true; addLine('sys', '和她说说话吧。她会用鲸鱼娘的语气回答。'); }
    setOver(true);
    setTimeout(() => chatIn && chatIn.focus(), 30);
    if (P.auto && P.state === 'wander') enter('idle', { dur: 6, why: 'you opened the chat' });
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
// States a chat reply must not barge into: she is in your hand, in the air, or still getting up.
const BUSY = new Set(['held', 'fall', 'landed', 'wake']);
// Her reply has arrived. Her body does what the two of you just said; if that was nothing in particular, she turns
// to you and talks for as long as her words are up. It is her reply she says, never a random line of her own.
function answer(asked, reply, act) {
  const line = speak(V, P.t, reply);
  const done = performFrom(asked, reply, act);
  if (!line) return;                             // an order with no words: she just does it
  if (done && done.entered) { say(line); return; }
  // a reply that orders nothing does not cancel an order she is still carrying out; she just says it
  if (P.auto && !BUSY.has(P.state) && P.t >= P.obeyUntil) enter('talk', { dur: readTime(line || ''), line, emotion: (done && done.emotion) || undefined, why: 'answering you' });
  else say(line);
}
// No brain, or it failed: the keyword reader still gets to move her, so "跳个舞" works with no key at all.
function answerWithout(asked) { performFrom(asked, '', null); }
async function sendChat() {
  if (!chatIn || chatBusy) return;
  const text = chatIn.value.trim();
  if (!text) return;
  chatBusy = true;
  if (chatSend) chatSend.disabled = true;
  // Whatever goes wrong in here, the box must come back: a throw that skipped the lines in `finally` left it
  // disabled for the rest of the session.
  try {
    chatIn.value = '';
    turns.push({ role: 'you', text });
    addLine('you', text);
    touched();
    observe(M, 'pet', { zone: 'body' });        // being spoken to is attention
    // A small thinking beat while she waits for her reply, and only from a standstill: putting her in the talk
    // pose here is what froze her mid-stride for forty seconds when you wrote to her while she walked.
    // Nor while she is carrying out something you told her to do: a "谢谢" must not end the order it thanks her for.
    if (P.auto && P.state === 'sleep') enter('wake', { dur: 1.3, why: 'you spoke to her' });
    else if (P.auto && P.t >= P.obeyUntil && (P.state === 'idle' || P.state === 'look' || P.state === 'talk')) enter('idle', { dur: 4, emotion: 'think', why: 'thinking about what you said' });
    const waiting = addLine('her', '（……）');
    if (!bridge || !bridge.chat) {
      if (waiting) waiting.textContent = '（她现在听不见你——桌宠模式外没有接上大脑）';
      turns.pop();                              // nobody answered, so the next message must not follow an orphan
      answerWithout(text);
      return;
    }
    let res = null;
    try { res = await bridge.chat(turns, summarise(M, ctxNow()), describeMemory(MEM, Date.now())); } catch (e) { res = { error: String(e.message || e) }; }
    if (waiting) waiting.textContent = '';
    // A reply can be words, an action, or both: the model sometimes writes only the 【动作】 line, which is a silent
    // order and must be carried out, not reported as a failure.
    if (res && (res.text || res.act)) {
      const said = res.text || '';
      if (waiting) { if (said) renderHer(said, waiting); else waiting.remove(); }
      // the model is shown its own reply as it wrote it, action line included, or it stops writing that line
      turns.push({ role: 'her', text: res.raw || said });
      note('chat', { line: said.slice(0, 60), act: res.act || null });
      answer(text, said, res.act);
    } else {
      if (waiting) { waiting.className = 'msg sys'; waiting.textContent = `她没能回答：${(res && res.error) || 'unknown'}`; }
      // a question nobody answered is taken back, or the next request carries two of yours in a row
      if (turns.length && turns[turns.length - 1].role === 'you') turns.pop();
      answerWithout(text);
    }
    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
  } finally {
    chatBusy = false;
    if (chatSend) chatSend.disabled = false;
    if (chatIn && chatOpen()) chatIn.focus();
  }
}
if (chatSend) chatSend.addEventListener('click', sendChat);
// Enter while an IME is still composing picks the candidate; it is not "send". Typing Chinese depends on this.
if (chatIn) chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendChat(); } });
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
// The cursor is gone: out of the window, or out from under our knowledge of it. Everything that was following it
// lets go, including "you are near", which otherwise stayed true for hours and told her mind you were still there.
function cursorGone() { P.cursor = null; P.near = false; P.hoverT = 0; setOver(false); lab.lookAt(null); }
function onTick(dt) {
  P.t += dt;
  const p = lab.pos();
  mindTick(M, dt, mindCtx());
  // hit state follows her even when the mouse is still (she walks out from under the cursor)
  P.pickT += dt;
  // The window is click-through until we say otherwise, so a fast "swipe over and grab" can lose the press
  // through it (measured 15-64 ms of hover before it flips). So the test runs every frame while the cursor is
  // inside a generous box around her - but what it asks is "within GRAB_PAD of her pixels", not "inside the box".
  if (P.cursor && !P.drag) {
    const b = lab.bbox(GRAB_PAD);
    const nearBox = P.cursor[0] >= b.x0 && P.cursor[0] <= b.x1 && P.cursor[1] >= b.y0 && P.cursor[1] <= b.y1;
    if (nearBox || P.pickT >= 0.05) {
      P.pickT = 0;
      // outside the box (a raised arm or a flung tail can reach past it) the cheaper single pick, as before
      setOver(overChat(P.cursor[0], P.cursor[1]) || (nearBox ? grabbable(P.cursor[0], P.cursor[1]) : onHer(P.cursor[0], P.cursor[1])));
    }
  }
  // the window has no reliable mouseleave, so notice for ourselves when the cursor has left it entirely
  if (P.cursor && !P.drag && (P.cursor[0] < 0 || P.cursor[1] < 0 || P.cursor[0] > window.innerWidth || P.cursor[1] > window.innerHeight)) cursorGone();
  // attention: look at a nearby cursor, turn around if it stays behind her
  if (P.cursor && !P.drag && !p.held && !p.airborne) {
    const [hx, hy] = lab.headPx(), st = lab.stage();
    const near = Math.hypot(P.cursor[0] - hx, P.cursor[1] - hy) < st.k * 2.6;
    P.near = near;
    if (near) lab.lookAt(P.cursor[0], P.cursor[1]); else lab.lookAt(null);
    if (P.over && !overChat(P.cursor[0], P.cursor[1])) {   // resting on the chat panel is not hovering her
      const was = P.hoverT;
      P.hoverT += dt;
      if (P.state === 'sleep' && P.hoverT > 1.2) { touched(); observe(M, 'hover'); enter('wake', { dur: 1.3, why: 'you hovered over her' }); }
      else {
        // One hover is one bit of attention, noticed once it has lasted half a second. Counting it every frame
        // filled her need for company from empty to full in about a second of hovering.
        if (was < 0.5 && P.hoverT >= 0.5) observe(M, 'hover');
        if (P.state === 'idle' && P.hoverT > 0.5) feel('happy');
      }
    } else P.hoverT = 0;
    const behind = p.view === 'side' && near && Math.sign(P.cursor[0] - hx) === -p.facing;
    P.behindT = behind ? P.behindT + dt : 0;
    if (P.behindT > 0.8 && !p.turning && !p.speed) { lab.turnTo(-p.facing); P.behindT = 0; }
  } else if (!P.cursor) {
    // no cursor to look at: eyes front, or her gaze stays wherever the last 'look' left it
    P.near = false; lab.lookAt(null);
  }
  if (P.drag && P.drag.moved) lab.holdAt(P.cursor[0], P.cursor[1]);
  placeBubble();   // the bubble follows her head in every mode, not only when the autopilot is running
  // watchdog: if a mouseup was ever lost we would hold the pointer - and, being click-through only while she is
  // NOT under the cursor, we would swallow every click on the desktop. Recover as soon as the rig says she is free.
  // Only a drag that has actually TAKEN HOLD can be dropped by the rig. A press that has not yet moved 5 px is
  // deliberately not holding her, so the old condition fired one frame after every mousedown and cancelled it -
  // which is why she could not be picked up, patted, or double-clicked with a real mouse. The self-test never
  // saw it because it presses and moves inside one JS turn, before any frame runs.
  if (((P.drag && P.drag.moved) || P.state === 'held') && !p.held && p.action !== 'dangle') { endDrag(); if (P.auto && P.state === 'held') enter('idle', { dur: 1, why: 'let go' }); }
  // A press that never became a drag and never released is the other way to get stuck; give it its own timeout.
  // Not while we hold pointer capture, though: capture guarantees the release reaches us, so a long press is only
  // a long press, and timing it out meant that pressing, pausing to aim and then dragging never picked her up.
  if (P.drag && !P.drag.moved && P.capture == null && P.t - P.drag.t0 > 3) endDrag();
  // a click becomes a pat only once it is clear it was not the first half of a double-click
  if (P.pendingPat && P.t >= P.pendingPat.at) { const c = P.pendingPat; P.pendingPat = null; if (!P.drag) pat(c.zone); }
  if (!P.auto) return;
  // While she is in your hand her face should follow how she is being handled, not sit on one fixed mood.
  if (P.state === 'held') {
    const c = lab.carry();
    if (c) {
      const want = c.distress > 0.62 ? 'panic' : c.distress > 0.34 ? 'surprised'
        : c.zone === 'head' || c.zone === 'body' ? 'affection' : 'awkward';
      if (want !== P.carryMood && P.t - (P.carryAt || 0) > 0.6) { P.carryMood = want; P.carryAt = P.t; safeEmotion(want); }
    }
  }
  if (P.state === 'held' || P.state === 'fall') {
    if (P.state === 'fall' && !p.airborne && p.action !== 'fall' && p.action !== 'dangle') { observe(M, 'drop', { impact: p.landed || 0 }); recordMemory(MEM, 'drop', { impact: p.landed || 0 }); saveSoon(); say(vReact(V, P.t, 'drop', { impact: p.landed || 0 })); enter('landed', { dur: 1.6, emotion: p.action === 'stumble' ? 'hurt' : 'awkward', why: 'landed' }); }
    return;
  }
  if (P.state === 'wander') {
    // a turn the rig ignored (it was already turning) is asked for again as soon as it can be
    if (!p.turning && p.facing !== P.dir) lab.turnTo(P.dir);
    const arrived = Math.abs(p.x - P.target) < 0.06 || (P.dir > 0 ? p.x > P.target : p.x < P.target);
    if (arrived && !p.turning) {
      // Sent somewhere, she stays there: the order's pin was used up by the walk, so it is renewed on arrival.
      const order = P.walkOrder;
      if (order && order.then && obey(order.then)) { /* and does what she was sent there to do */ }
      else if (order) { enter('idle', { dur: STAY_PUT, why: 'you sent her here' }); P.obeyUntil = P.t + STAY_PUT; }
      else enter('idle', { dur: rnd(1.5, 4), why: 'got where she was going' });
    } else if (P.t >= P.until) enter('idle', { dur: rnd(1.5, 4), why: 'gave up on the walk' });
    return;
  }
  if (P.t > P.nextIdleLine) { P.nextIdleLine = P.t + 25 + Math.random() * 50; const l = idleLine(V, P.t, M, ctxNow()); if (l) say(l); }
  if (P.t - P.lastSave > 30) { P.lastSave = P.t; saveMemory(); }
  if (P.t > P.nextThought) { P.nextThought = P.t + 50; consult(); }
  if (P.t < P.obeyUntil) return;                 // she was told to do this; let her finish
  if (shouldChange(M, mindCtx()) || P.t >= P.until) {
    // an order that arrived while she was busy is what she does next, instead of whatever her mind would pick
    if (P.laterOrder && !(P.state === 'sleep')) carryOut(P.laterOrder);
    else decide();
  }
}
lab.onTick(onTick);

// ------------------------------------------------------------------ pointer
function pointerDown(x, y) {
  P.cursor = [x, y];
  if (overChat(x, y)) return false;      // clicks inside the panel belong to the panel, not to picking her up
  if (!grabbable(x, y)) return false;    // the same test that made the window clickable here, so no press is eaten
  P.drag = { x0: x, y0: y, moved: false, t0: P.t, zone: lab.zone(x, y) };   // zone decides how she hangs
  setOver(true); document.body.style.cursor = 'grabbing';
  return true;
}
function pointerMove(x, y) {
  P.cursor = [x, y];
  if (P.drag) {
    if (!P.drag.moved && Math.hypot(x - P.drag.x0, y - P.drag.y0) > 5) {
      P.drag.moved = true; P.pendingPat = null; touched(); observe(M, 'grab'); say(vReact(V, P.t, 'grab')); lab.hold(P.drag.x0, P.drag.y0, P.drag.zone); if (P.auto) enter('held', { dur: 999, why: 'you picked her up' }); else safeEmotion('panic');
    }
    if (P.drag.moved) lab.holdAt(x, y);
  }
}
function pat(zone) {
  if (P.auto && (P.state === 'held' || P.state === 'fall')) return;   // a click on her mid-air is not a pat
  if (P.auto) { observe(M, 'pet', { zone }); recordMemory(MEM, 'pet'); saveSoon(); say(vReact(V, P.t, 'pet', { zone })); if (P.state === 'sleep') enter('wake', { dur: 1.3, why: 'you woke her' }); else enter('react', { dur: 2.6, ...(REACT[zone] || {}), why: 'you patted her' }); }
  else lab.start(pick(['wave', 'celebrate', 'tail_react']));
}
function pointerUp(x, y) {
  P.cursor = [x, y];
  const d = P.drag; endDrag();
  if (!d) return;
  touched();
  if (d.moved) { lab.release(); if (P.auto) enter('fall', { dur: 999, why: 'you let go of her' }); return; }
  // Double-click her to talk to her: the tray item and the C key are both easy to miss. The first click of the
  // pair is held back for the double-click window instead of being a pat straight away, or every double-click
  // also patted her, said a line and added a pat to her memory.
  const dbl = P.t - (P.lastClickAt ?? -9) < DOUBLE_CLICK;
  if (dbl) { P.pendingPat = null; P.lastClickAt = -9; showChat(true); return; }
  P.lastClickAt = P.t;
  P.pendingPat = { zone: lab.zone(x, y), at: P.t + DOUBLE_CLICK };
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
window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  release(e);
  // clicking her while the chat is open must not leave your next keystrokes going nowhere
  if (chatOpen() && chatIn && !overChat(e.clientX, e.clientY)) chatIn.focus();
});
window.addEventListener('pointercancel', release);
window.addEventListener('lostpointercapture', () => { if (P.drag) { P.capture = null; pointerUp(...(P.cursor || [0, 0])); } });
// No DOM event can tell us the cursor has left: 'mouseleave' never reaches the window, and on the document it
// fires after EVERY forwarded mousemove while the window is click-through (measured 1:1 with a real mouse, and
// it made every real click and drag pass straight through her). The main process can see the real cursor, so
// it tells us when it is outside the window instead (`pet:cursor`).
// losing focus or pointer capture mid-drag must end the drag, or the click-through window stays off for good
const bail = () => { if (!P.drag) return; const c = P.cursor || [0, 0]; pointerUp(c[0], c[1]); };
window.addEventListener('blur', bail);
window.addEventListener('pointercancel', bail);
document.addEventListener('visibilitychange', () => { if (document.hidden) bail(); });
// Escape closes the chat and nothing else: quitting lives in the tray, where it cannot be hit by accident while
// you are typing. While the chat is open the letter keys belong to it, so outside the input they do nothing.
window.addEventListener('keydown', (e) => {
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
  if (e.key === 'Escape') { if (chatOpen()) showChat(false); return; }
  if (typing || chatOpen()) return;
  if (e.key.toLowerCase() === 'c') showChat(true);
  if (e.key.toLowerCase() === 'p') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); }
});
if (bridge && bridge.onIdle) bridge.onIdle((sec) => { P.userIdle = sec; });
if (bridge && bridge.onCursor) bridge.onCursor((inside) => { if (!inside && !P.drag && P.cursor) cursorGone(); });
// The tray's Nap is a nap: sixty seconds of sleep that her own mind is told about and held off from.
function trayNap() { enter('sleep', { dur: 60, why: 'you told her to nap' }); P.obeyUntil = P.t + 60; }
if (bridge && bridge.onCommand) bridge.onCommand((cmd) => { try { if (cmd === 'chat') { showChat(!chatOpen()); } else if (cmd === 'plain' || cmd === 'character') { P.quiet = cmd === 'plain'; if (P.quiet && bubble) bubble.classList.remove('on'); } else if (cmd === 'auto') { P.auto = !P.auto; if (P.auto) enter('idle', { dur: 1 }); } else if ((cmd === 'sleep' || cmd === 'wave') && (P.state === 'held' || P.state === 'fall')) { /* not while in the air */ } else if (cmd === 'sleep') trayNap(); else if (cmd === 'wave') enter('react', { dur: 2.6, action: 'wave' }); } catch (err) { window.__error = String(err.stack || err); } });

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
  if (P.auto) setTimeout(() => say(vReact(V, P.t, 'greet', { awaySeconds: r.awaySeconds, firstTime: r.firstTime })), 900);
}

const pet = window.pet = {
  info: () => ({ auto: P.auto, state: P.state, over: P.over, bridge: !!bridge, mind: summarise(M, mindCtx()) }),
  mind: () => summarise(M, mindCtx()),
  needs: () => ({ ...M.needs }),
  feels: () => M.mood,
  setIdle(seconds) { P.userIdle = seconds; },
  state: () => ({ ...P, log: undefined, cursor: P.cursor, chatBusy }),
  auto(v) { P.auto = !!v; if (P.auto) enter('idle', { dur: 1 }); },
  go(state, opts) { enter(state, opts || {}); },
  simulate(ev) { if (ev.type === 'down') return pointerDown(ev.x, ev.y); if (ev.type === 'move') return pointerMove(ev.x, ev.y); if (ev.type === 'up') return pointerUp(ev.x, ev.y); throw new Error('unknown event ' + ev.type); },
  grabbable: (x, y) => grabbable(x, y),
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
setOver(false);                   // tell the main process where we stand from the first frame, reloads included
if (P.auto) { P.lastTouch = 0; enter('idle', { dur: 2 }); }
wakeUp();
window.addEventListener('beforeunload', saveMemory);
