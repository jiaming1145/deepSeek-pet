// Her mind: what she wants, and what she therefore does.
//
// Every open-source desktop pet I know of picks its next animation by rolling dice. This does not. She carries
// four needs that drift over time, and each thing she can do is scored by how well it serves the needs she
// actually has right now. The highest score wins. That is the same idea The Sims uses, and it is the difference
// between "random animation player" and "seems to want things".
//
// This file is deliberately free of three.js, the DOM and Electron: it is pure arithmetic over a small state
// object, so it can be run and tested headlessly (see mind.test.mjs) and swapped for a smarter brain later.
// Nothing in here reaches out to the network. An optional language model can *suggest* an activity through
// `suggest()`, but she keeps running perfectly without one.

// --- needs -----------------------------------------------------------------------------------------------
// Each runs 0..1. Higher is better satisfied, so a LOW value is an itch that wants scratching.
//   rest    sleeping and standing still restore it, running burns it
//   company your attention fills it, being ignored drains it
//   play    doing something novel fills it, standing around drains it
//   safety  dropped hard or thrown, it plummets, then recovers slowly
export const NEEDS = ['rest', 'company', 'play', 'safety'];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How fast each need drains per second when nothing is acting on it. Tuned so a left-alone pet grows visibly
// bored in a couple of minutes and sleepy in twenty to forty, rather than on the timescale of a screensaver.
// Tuned against mind_trace.mjs and a simulated day, not by eye; the numbers below are what that produced.
const DRAIN = { rest: 1 / 3600, company: 1 / 300, play: 1 / 700, safety: -1 / 60 };   // negative = recovers
// With nothing going on she gets drowsy: rest drains this much faster while you are away. This is what separates
// the two situations. At the desk, sitting holds her at a moderate level indefinitely; alone, the same sitting can
// no longer keep up, so she slides below the nap line and sleeps instead of hovering just above it all day.
const DROWSY_ALONE = 1.8;
// ...and resting on her feet does her less good: sitting alone she half dozes rather than recovering. This is a
// separate knob on purpose. DROWSY_ALONE sets how soon she gets tired; this sets where sitting can hold her once
// she is, and it has to hold her clearly BELOW the nap line, or she hovers a hair above it and never sleeps.
const RESTS_ALONE = 0.5;

// How fast an activity fills the need it serves. Needs move on the scale of minutes, not seconds: with a faster
// rate she topped every need up instantly, so she was never tired, never bored, and never went anywhere.
const SERVE_RATE = 1 / 600;

// What each activity does to her needs, per second spent doing it, and how long she wants to stay in it.
// `serves` is what the activity is FOR; the scorer reads it directly, so adding an activity is a data change.
// A negative entry is a cost: dancing and walking tire her, and a nap leaves her a little lonelier.
// `cap` is the most a need can be topped up to by this activity. Resting on your feet takes the edge off being
// tired but never leaves you fresh - only a real nap does that - and without this she never slept.
// Standing about (idling, looking at you, talking) only keeps pace with the drain while you are there (0.15 of
// SERVE_RATE is about DRAIN.rest), so on her feet she neither recovers nor tires. When idling and sitting both
// restored rest quickly she settled at about two thirds rested for good, never got tired enough to nap, and a
// whole simulated day passed without one.
export const ACTIVITIES = {
  idle:    { serves: { rest: 0.15 },                caps: { rest: 0.65 }, dur: [5, 11],  view: 'front', baseline: 0.34 },
  // a walk is one trip to somewhere on the screen: the body ends it on arrival, which is a few seconds, not the
  // 10-24 s this once said. Tuning against the longer walk the body never took made her dance a fifth of the day.
  wander:  { serves: { play: 2.6, rest: -0.5 },     dur: [3, 8], view: 'side'  },
  look:    { serves: { play: 0.6, company: 1.0, rest: 0.15 },   dur: [3, 7],   view: 'front', needsYou: true },
  sit:     { serves: { rest: 1.2 },                 caps: { rest: 0.6 },  dur: [10, 22], view: 'front', baseline: 0.16 },
  stretch: { serves: { rest: 0.9, play: 0.4 },      caps: { rest: 0.7 },  dur: [2.6, 2.6], view: 'front', baseline: 0.10 },
  tail:    { serves: { play: 1.6 },                 dur: [2.2, 4.5], view: 'front' },
  // exactly one pass of her routine (24 beats, 13.33 s) and a little over: a longer slot cut the second pass off
  // mid-move, a shorter one cut the first. Dancing again is then a fresh decision, not an accident of the timer.
  dance:   { serves: { play: 2.0, rest: -0.4 },     dur: [13.5, 13.5], view: 'front' },
  talk:    { serves: { company: 1.6, play: 0.5, rest: 0.15 },   dur: [4, 9],   view: 'front', needsYou: true },
  sleep:   { serves: { rest: 1.5, company: -0.3 },  dur: [240, 600], view: 'side'  },
};

// Tiredness, in one place so the face and the behaviour agree. She looks sleepy a little before she is tired
// enough to nap, so there is a visible drowsy spell first rather than a wide-awake pet dropping off mid-stride.
const SLEEPY_BELOW = 0.45;
const NAP_BELOW = 0.4;
// You count as gone after two minutes without touching the keyboard or mouse. That is a hard rule for napping and
// for talking: she never naps while you are at your computer, and she does not chat to an empty room.
const AWAY_AFTER = 120;

// She will not abandon what she is doing the instant something else edges ahead; without a floor she twitches.
const MIN_DWELL = 2.5;

// Something she does because of you, not because of a need. These are never chosen by the scorer.
export const RESPONSES = ['react', 'held', 'fall', 'landed', 'wake'];

export function createMind(opts = {}) {
  const rng = opts.random || Math.random;
  return {
    t: 0,
    needs: { rest: 0.85, company: 0.5, play: 0.6, safety: 1 },
    activity: 'idle',
    since: 0,
    until: 3,
    recent: [],                 // last few activities, to stop her repeating herself
    lastTouch: 0,               // when you last interacted; starts at zero, she has only just met you
    lastSpoke: -60,
    lastHover: -1e9,            // when your cursor last settled on her, so one hover counts once
    reason: 'just woken up',
    mood: 'neutral',
    suggestion: null,           // an optional outside opinion (see suggest())
    rng,
  };
}

// --- what happened ---------------------------------------------------------------------------------------
// The interaction layer calls this. Everything she learns about you arrives through here.
export function observe(m, event, info = {}) {
  switch (event) {
    case 'hover':                                      // one hover is one moment of attention, however many frames it lasts
      if (m.t - m.lastHover > 3) m.needs.company = clamp01(m.needs.company + 0.02);
      m.lastHover = m.t;
      break;
    case 'pet':                                        // a click on her, with the body part you touched
      m.lastTouch = m.t;
      m.needs.company = clamp01(m.needs.company + 0.35);
      m.needs.play = clamp01(m.needs.play + 0.15);
      if (info.zone === 'head') m.needs.company = clamp01(m.needs.company + 0.15);
      if (info.zone === 'tail') m.needs.safety = clamp01(m.needs.safety - 0.1);
      break;
    case 'grab':    m.lastTouch = m.t; m.needs.safety = clamp01(m.needs.safety - 0.25); break;
    case 'drop':                                       // impact is how hard she hit the floor
      m.lastTouch = m.t;
      m.needs.safety = clamp01(m.needs.safety - Math.min(0.75, (info.impact || 0) / 8));
      m.needs.rest = clamp01(m.needs.rest - 0.05);
      break;
    case 'ignored': m.needs.company = clamp01(m.needs.company - 0.05); break;
  }
  return m;
}

// --- time passing ----------------------------------------------------------------------------------------
export function tick(m, dt, ctx = {}) {
  m.t += dt;
  const act = ACTIVITIES[m.activity];
  const dozing = m.activity !== 'sleep' && youAreAway(m, ctx);   // awake and alone; asleep, she is not getting drowsier
  for (const n of NEEDS) {
    let d = -DRAIN[n] * (n === 'rest' && dozing ? DROWSY_ALONE : 1) * dt;   // natural drift
    // what she is doing right now. Activities marked `needsYou` only pay off in company while you are actually
    // there - chatting to an empty room should not cure loneliness, and without this she never feels alone.
    if (act && act.serves[n]) {
      const alone = act.needsYou && n === 'company' && !ctx.cursorNear;
      const cap = act.caps && act.caps[n];
      const capped = cap != null && m.needs[n] >= cap && act.serves[n] > 0;
      const gain = act.serves[n] * SERVE_RATE * dt;
      if (!alone && !capped) d += n === 'rest' && gain > 0 && dozing ? gain * RESTS_ALONE : gain;
    }
    m.needs[n] = clamp01(m.needs[n] + d);
  }
  // being near your cursor is company in itself, even if you never click. It is kept below the drain on purpose:
  // at 0.005 a cursor resting beside her cured loneliness outright, so she never needed to talk to you.
  if (ctx.cursorNear) m.needs.company = clamp01(m.needs.company + 0.002 * dt);   // your presence slows the ache; it does not cure it
  m.mood = moodOf(m, ctx);
  return m;
}

// --- how she feels ---------------------------------------------------------------------------------------
// A mood is not stored, it is read off the needs. That keeps feeling and behaviour from drifting apart.
export function moodOf(m, ctx = {}) {
  const n = m.needs;
  if (n.safety < 0.4) return 'panic';
  if (m.activity === 'sleep') return 'sleepy';
  if (n.rest < SLEEPY_BELOW) return 'sleepy';
  if (m.t - m.lastTouch < 3) return n.company > 0.8 ? 'affection' : 'happy';
  // She misses you when you first go, then settles. Looking miserable for the whole afternoon would be neither
  // lifelike nor pleasant to have on your desktop.
  if (n.company < 0.2) return m.t - m.lastTouch < 900 ? 'sad' : 'relaxed';
  if (n.play < 0.2) return 'pouty';
  if (ctx.cursorNear) return 'curious';
  if (n.company > 0.75 && n.rest > 0.6) return 'gentle';
  return 'neutral';
}

// --- are you there? --------------------------------------------------------------------------------------
// Electron's system idle time is the real answer. The lab window has no bridge to ask, so there she falls back on
// how long it has been since you last touched her, and there a cursor beside her counts as you being there.
export function youAreAway(m, ctx = {}) {
  if (ctx.userIdleSeconds != null) return ctx.userIdleSeconds > AWAY_AFTER;
  return !ctx.cursorNear && m.t - m.lastTouch > AWAY_AFTER;
}

// --- what to do next -------------------------------------------------------------------------------------
// Score every activity by how much it would help the needs she is short of, then take the best. Novelty and a
// little noise stop her locking onto one behaviour; context vetoes the ones that would look silly.
export function score(m, name, ctx = {}) {
  const a = ACTIVITIES[name];
  if (!a) return -Infinity;
  // `baseline` is how appealing the activity is for its own sake, before any need is considered: standing about
  // is what she does when nothing is pressing, and without it the needs-driven activities crowd it out entirely.
  let s = a.baseline || 0;
  const alone = a.needsYou && !ctx.cursorNear;
  for (const [need, power] of Object.entries(a.serves)) {
    const shortfall = 1 - m.needs[need];                 // how badly she wants it
    // a benefit counts for more the shorter she is; so does a cost. Weighing a cost by how much she HAS made a
    // tiring activity more attractive the more tired she got.
    let term = power * (power > 0 ? shortfall * shortfall : shortfall);
    // an activity that only pays off while you are there is nearly pointless when you are not. Without this she
    // scores it on a need she cannot possibly meet, and spends your whole absence calling out to an empty room.
    if (alone && need === 'company') term *= 0.25;
    s += term;
  }
  // novelty: doing the very same thing again reads as a stuck animation, so it is heavily penalised, and the
  // penalty fades as the activity recedes into her recent history.
  const ago = m.recent.indexOf(name);                    // 0 = did it last
  if (ago >= 0) s -= [1.0, 0.4, 0.2, 0.1][ago] ?? 0;
  const away = youAreAway(m, ctx);
  if (name === 'sleep') {
    // Both halves are hard rules, not weights: genuinely tired AND you genuinely gone. As a soft penalty the
    // "wide awake" rule sat below what idling and sitting topped her back up to, so it never lifted at all.
    if (!away || m.needs.rest >= NAP_BELOW) return -Infinity;
    if (m.t - m.lastTouch < 60) s -= 3;                   // nor anywhere near a moment when you were playing with her
    if (ctx.cursorNear) s -= 1.2;                        // nor while you are right there
    s += 1.2;                                            // tired and alone, a nap beats everything else
  }
  // talking needs someone to talk to. Scored down alone, she still spent a tenth of a day addressing nobody.
  if (name === 'talk' && away) return -Infinity;
  if (name === 'talk' && m.t - m.lastSpoke < (ctx.cursorNear ? 20 : 60)) s -= 0.8;
  if (a.needsYou && ctx.cursorNear) s += 0.3;            // you are right there: engaging with you beats sitting
  if (name === 'wander' && ctx.userIdleSeconds != null && ctx.userIdleSeconds < 3) s += 0.2;
  // with nobody to perform for she potters about rather than dancing; alone, dancing took a third of her day
  if (away && name === 'wander') s += 0.2;
  if (name === 'dance' && ctx.cursorNear) s += 0.2;     // and with you right there, she dances for you
  if (name === 'dance' && m.needs.rest < SLEEPY_BELOW) s -= 0.6;   // but not once she is visibly sleepy
  if (m.needs.safety < 0.5 && (name === 'wander' || name === 'tail')) s -= 0.5;   // shaken: stays put
  return s;
}

export function decide(m, ctx = {}) {
  if (m.suggestion && ACTIVITIES[m.suggestion.activity]) {   // an outside brain gets one free pick
    const s = m.suggestion; m.suggestion = null;
    // ...but not past the hard rules: a model cannot put her to sleep while you are at the desk, or have her talk
    // to an empty room. Anything the scorer rules out entirely is dropped and she decides for herself.
    if (score(m, s.activity, ctx) > -Infinity) return start(m, s.activity, s.reason || 'because I felt like it', ctx);
  }
  let best = 'idle', bestScore = -Infinity;
  for (const name of Object.keys(ACTIVITIES)) {
    const s = score(m, name, ctx) + m.rng() * 0.25;
    if (s > bestScore) { bestScore = s; best = name; }
  }
  return start(m, best, explain(m, best, ctx), ctx);
}

function start(m, name, reason, ctx) {
  const a = ACTIVITIES[name];
  const [lo, hi] = a.dur;
  m.activity = name;
  m.since = m.t;
  m.until = m.t + lo + m.rng() * (hi - lo);
  m.reason = reason;
  if (name === 'talk') m.lastSpoke = m.t;
  m.recent = [name, ...m.recent.filter((r) => r !== name)].slice(0, 4);
  return { activity: name, reason, mood: moodOf(m, ctx), until: m.until };
}

// A one-line, plain-English reason, so the HUD and the logs can say why she did something.
function explain(m, name, ctx) {
  const n = m.needs;
  if (name === 'sleep') return 'tired, and nobody is around';
  if (name === 'sit') return n.rest < 0.5 ? 'legs tired' : 'settling down for a bit';
  if (name === 'wander') return n.play < 0.4 ? 'bored, going for a walk' : 'stretching her legs';
  if (name === 'talk') return n.company < 0.4 ? 'wants your attention' : 'feeling chatty';
  if (name === 'look') return ctx.cursorNear ? 'watching your cursor' : 'looking around';
  if (name === 'tail') return 'playing with her tail';
  if (name === 'dance') return 'felt like dancing';
  if (name === 'stretch') return 'stiff from standing';
  return 'nothing better to do';
}

// Should she change what she is doing? Interruptions beat the clock: a fresh need spike cuts an activity short.
export function shouldChange(m, ctx = {}) {
  if (m.t - m.since < MIN_DWELL && m.needs.safety >= 0.4) return false;   // no twitching
  if (m.t >= m.until) return true;
  if (m.activity === 'sleep') return m.needs.rest > 0.95 || m.t - m.lastTouch < 1;
  if (m.needs.safety < 0.4 && m.activity === 'wander') return true;
  return false;
}

// --- something the body did without asking -----------------------------------------------------------
// The interaction layer sometimes puts her into a state the scorer never chose: a chat order, the tray's Nap,
// a pat reaction, a landing, waking up. Without telling the mind, its old timer keeps running and cuts the new
// state short on the next frame (a nap that lasts six seconds, a wake-up that lasts one frame). `commit` makes
// the mind own that state for `secs`, so `shouldChange` waits for it like any choice of her own.
export function commit(m, activity, secs, reason = 'because you asked') {
  const name = ACTIVITIES[activity] || RESPONSES.includes(activity) ? activity : 'idle';
  m.activity = name;
  m.since = m.t;
  m.until = m.t + Math.max(0, secs || 0);
  m.reason = reason;
  m.suggestion = null;                               // the body is already doing it; do not do it twice
  if (name === 'talk') m.lastSpoke = m.t;
  if (ACTIVITIES[name]) m.recent = [name, ...m.recent.filter((r) => r !== name)].slice(0, 4);
  return m;
}

// --- the optional outside opinion -------------------------------------------------------------------------
// A language model (or anything else) can drop a suggestion in. It is honoured once, only if it names a real
// activity, and only at the next decision point - so a slow or broken brain can never stall or hijack her.
export function suggest(m, activity, reason) {
  if (!ACTIVITIES[activity]) return false;
  m.suggestion = { activity, reason };
  return true;
}

// Everything a brain would need to know, small enough to put in a prompt.
export function summarise(m, ctx = {}) {
  const pct = (v) => Math.round(v * 100);
  return {
    doing: m.activity, because: m.reason, mood: m.mood,
    needs: Object.fromEntries(NEEDS.map((n) => [n, pct(m.needs[n])])),
    secondsSinceYouTouchedHer: Math.round(m.t - m.lastTouch),
    youHaveBeenIdleFor: ctx.userIdleSeconds ?? null,
  };
}
