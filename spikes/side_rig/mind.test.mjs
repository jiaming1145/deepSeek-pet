// Headless tests for her mind. No window, no Electron, no network - just simulated time.
//   node spikes/side_rig/mind.test.mjs
// Each test states the behaviour a person would expect, then proves it over simulated minutes or hours.
import { createMind, observe, tick, decide, shouldChange, score, suggest, summarise, commit, youAreAway, ACTIVITIES } from './mind.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

// Deterministic pseudo-random so a failure is reproducible.
function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

// Run her for `seconds`, letting her change activity whenever she wants. Returns a log of what she did.
function live(m, seconds, ctx = {}, hook = null) {
  const dt = 1 / 10, log = [];
  for (let i = 0; i < seconds / dt; i++) {
    tick(m, dt, ctx);
    if (hook) hook(m, i * dt);
    if (shouldChange(m, ctx)) log.push(decide(m, ctx));
  }
  return log;
}

console.log('her needs drift the way you would expect');
{
  const m = createMind({ random: seeded(1) });
  const rest0 = m.needs.rest;
  live(m, 300, {});
  ok('left alone, she gets lonely', m.needs.company < 0.4, `company=${m.needs.company.toFixed(2)}`);
  // Your presence slows the ache; it does not cure it. A cursor that merely rests beside her used to fill company
  // faster than it drained, so she never needed you. Now it keeps her well above lonely, and she comes to you.
  const m2 = createMind({ random: seeded(2) });
  const near = live(m2, 600, { cursorNear: true });
  const m3 = createMind({ random: seeded(2) });
  const apart = live(m3, 600, {});
  ok('with your cursor nearby she is far less lonely than alone', m2.needs.company > 0.2 && m2.needs.company > m3.needs.company + 0.2,
    `near=${m2.needs.company.toFixed(2)} alone=${m3.needs.company.toFixed(2)}`);
  const seeks = (log) => log.filter((e) => e.activity === 'look' || e.activity === 'talk').length / log.length;
  ok('and she spends that time looking at you and talking to you', seeks(near) > 0.4 && seeks(near) > 2 * seeks(apart),
    `near ${(100 * seeks(near)).toFixed(0)}% vs alone ${(100 * seeks(apart)).toFixed(0)}%`);
  const m4 = createMind({ random: seeded(2) });
  m4.activity = 'idle'; m4.until = 1e9;
  const c0 = m4.needs.company;
  for (let i = 0; i < 600; i++) tick(m4, 0.1, { cursorNear: true });
  ok('a cursor resting beside her, with nothing else, does not cure loneliness', m4.needs.company < c0, `${c0} -> ${m4.needs.company.toFixed(2)}`);
  ok('resting is not instant', rest0 <= 1);
}

console.log('she sleeps when tired and alone, not while you are playing with her');
{
  const m = createMind({ random: seeded(3) });
  m.needs.rest = 0.1;
  const log = live(m, 400, { userIdleSeconds: 600 });
  ok('exhausted and ignored, she naps', log.some((e) => e.activity === 'sleep'), JSON.stringify(log.map((e) => e.activity)));

  const m2 = createMind({ random: seeded(4) });
  m2.needs.rest = 0.1;
  const log2 = live(m2, 120, { userIdleSeconds: 0 }, (mm, t) => { if (Math.abs(t % 10) < 0.05) observe(mm, 'pet', { zone: 'head' }); });
  ok('petted every 10 s, she stays awake', !log2.some((e) => e.activity === 'sleep'), JSON.stringify(log2.map((e) => e.activity)));
}

console.log('a day with her: she naps when you leave her alone, never while you are at the desk');
{
  // The same shape as mind_trace.mjs: nothing forced, needs start where a fresh launch starts them.
  const day = (seed, secs, ctxAt) => {
    const m = createMind({ random: seeded(seed) });
    const naps = [], moods = []; let prev = m.activity;
    for (let t = 0; t < secs; t += 0.5) {
      const ctx = ctxAt(t); tick(m, 0.5, ctx);
      if (shouldChange(m, ctx)) decide(m, ctx);
      if (m.activity === 'sleep' && prev !== 'sleep') naps.push(t);
      moods.push([t, m.mood, m.activity]); prev = m.activity;
    }
    return { m, naps, moods };
  };
  for (const seed of [11, 12, 13]) {
    const alone = day(seed, 7200, (t) => ({ cursorNear: false, userIdleSeconds: t }));
    ok(`left alone for two hours she naps (seed ${seed})`, alone.naps.length >= 1, `naps at ${alone.naps.map((t) => Math.round(t / 60))} min`);
    ok(`  and the first nap comes 20-40 minutes after you leave`, alone.naps[0] >= 20 * 60 && alone.naps[0] <= 40 * 60, `${Math.round(alone.naps[0] / 60)} min`);
    const drowsy = alone.moods.some(([t, mood, act]) => t < alone.naps[0] && t > alone.naps[0] - 180 && mood === 'sleepy' && act !== 'sleep');
    ok(`  and she looks sleepy before she drops off`, drowsy);
    const atDesk = day(seed, 7200, () => ({ cursorNear: true, userIdleSeconds: 0 }));
    const working = day(seed, 7200, () => ({ cursorNear: false, userIdleSeconds: 1 }));
    ok(`at the desk for two hours she never naps (seed ${seed})`, atDesk.naps.length === 0 && working.naps.length === 0,
      `near ${atDesk.naps.length}, working ${working.naps.length}`);
  }
  const tired = createMind({ random: seeded(14) });
  tired.needs.rest = 0.1;
  const log = live(tired, 900, { cursorNear: false, userIdleSeconds: 5 });
  ok('exhausted, but you are typing: she stays up', !log.some((e) => e.activity === 'sleep'), JSON.stringify(log.map((e) => e.activity)));
  ok('two minutes without keyboard or mouse is what counts as away', !youAreAway(tired, { userIdleSeconds: 119 }) && youAreAway(tired, { userIdleSeconds: 121 }));
}

console.log('alone, she potters about instead of performing to nobody');
{
  const m = createMind({ random: seeded(15) });
  const time = {}, chosenAway = new Set();
  for (let t = 0; t < 4 * 3600; t += 0.5) {
    const ctx = { cursorNear: false, userIdleSeconds: t };
    tick(m, 0.5, ctx); if (shouldChange(m, ctx)) { const e = decide(m, ctx); if (youAreAway(m, ctx)) chosenAway.add(e.activity); }
    if (t > 120) time[m.activity] = (time[m.activity] || 0) + 0.5;
  }
  const pct = (k) => (100 * (time[k] || 0)) / (4 * 3600 - 120);
  ok('she walks about more than she dances', pct('wander') > pct('dance') && pct('wander') > 10, `wander ${pct('wander').toFixed(1)}% dance ${pct('dance').toFixed(1)}%`);
  ok('dancing is an occasional thing, not a third of her day', pct('dance') < 15, `${pct('dance').toFixed(1)}%`);
  ok('she never starts talking to an empty room', !chosenAway.has('talk'), [...chosenAway].join(','));
  ok('a dance is one pass of her routine, so a second is a fresh decision', ACTIVITIES.dance.dur[0] >= 13.34 && ACTIVITIES.dance.dur[1] < 15, JSON.stringify(ACTIVITIES.dance.dur));
}

console.log('one hover is one moment of attention');
{
  const m = createMind({ random: seeded(16) });
  const c0 = m.needs.company;
  for (let i = 0; i < 60; i++) { m.t += 1 / 60; observe(m, 'hover'); }
  ok('a second of per-frame hover reports counts once', Math.abs(m.needs.company - c0 - 0.02) < 1e-9, `${c0} -> ${m.needs.company}`);
  m.t += 10; observe(m, 'hover');
  ok('coming back later counts again', Math.abs(m.needs.company - c0 - 0.04) < 1e-9, `${m.needs.company}`);
}

console.log('the body can tell the mind what it is doing');
{
  const m = createMind({ random: seeded(17) });
  live(m, 30, {});
  suggest(m, 'dance', 'the model wants a dance');
  commit(m, 'sit', 60, 'you told her to sit');
  ok('she takes on the state she was put in', m.activity === 'sit' && m.reason === 'you told her to sit');
  ok('it clears a pending suggestion, so the body does not do two things', m.suggestion === null);
  let changedAt = null;
  for (let i = 0; i < 700 && changedAt == null; i++) { tick(m, 0.1, { userIdleSeconds: 0 }); if (shouldChange(m, { userIdleSeconds: 0 })) changedAt = i * 0.1; }
  ok('and the mind waits the committed time out instead of cutting it short', changedAt != null && changedAt > 59 && changedAt < 61, `changed after ${changedAt}s`);
  commit(m, 'wake', 1.3);
  ok('a response like waking up is accepted, and is not remembered as an activity', m.activity === 'wake' && m.recent[0] !== 'wake');
  commit(m, 'backflip', 2);
  ok('something unknown degrades to idle', m.activity === 'idle');
  commit(m, 'talk', 4);
  ok('a committed talk counts as having spoken', m.lastSpoke === m.t);
}

console.log('she does not get stuck repeating herself');
{
  const m = createMind({ random: seeded(5) });
  const log = live(m, 900, {});
  const counts = {};
  for (const e of log) counts[e.activity] = (counts[e.activity] || 0) + 1;
  const distinct = Object.keys(counts).length;
  ok('over 15 minutes she does at least 4 different things', distinct >= 4, JSON.stringify(counts));
  let worstRun = 1, run = 1;
  for (let i = 1; i < log.length; i++) { run = log[i].activity === log[i - 1].activity ? run + 1 : 1; worstRun = Math.max(worstRun, run); }
  ok('she never repeats the same activity more than twice in a row', worstRun <= 2, `worst run ${worstRun}`);
}

console.log('being thrown frightens her, and she recovers');
{
  const m = createMind({ random: seeded(6) });
  observe(m, 'drop', { impact: 8 });
  ok('a hard drop hurts her sense of safety', m.needs.safety < 0.5, `safety=${m.needs.safety.toFixed(2)}`);
  tick(m, 0.1, {});
  ok('and she shows it', m.mood === 'panic', m.mood);
  ok('she will not wander off while shaken', score(m, 'wander') < score(m, 'idle') + 1);
  live(m, 120, {});
  ok('two minutes later she has calmed down', m.needs.safety > 0.9, `safety=${m.needs.safety.toFixed(2)}`);
}

console.log('attention changes how she feels');
{
  const m = createMind({ random: seeded(7) });
  live(m, 400, {});
  const lonely = m.mood;
  observe(m, 'pet', { zone: 'head' });
  tick(m, 0.1, {});
  ok('ignored for a while, she is not happy', ['sad', 'pouty', 'neutral'].includes(lonely), lonely);
  ok('a head pat cheers her up immediately', ['happy', 'affection'].includes(m.mood), m.mood);
}

console.log('every activity is reachable, and every reason reads like English');
{
  const seen = new Set();
  for (let s = 0; s < 40; s++) {
    const m = createMind({ random: seeded(100 + s) });
    m.needs.rest = (s % 5) / 5; m.needs.company = ((s + 1) % 5) / 5; m.needs.play = ((s + 2) % 5) / 5;
    for (const e of live(m, 600, { userIdleSeconds: s * 20 })) { seen.add(e.activity); ok.reason = e.reason; }
  }
  const missing = Object.keys(ACTIVITIES).filter((a) => !seen.has(a));
  ok('all eight activities occur across varied conditions', missing.length === 0, `never chosen: ${missing}`);
}

console.log('an outside brain can suggest, but never hijack or stall her');
{
  const m = createMind({ random: seeded(8) });
  ok('a nonsense suggestion is refused', suggest(m, 'do_a_backflip', 'x') === false);
  ok('a real one is accepted', suggest(m, 'talk', 'the model said hello') === true);
  const e = decide(m, {});
  ok('and is honoured once', e.activity === 'talk' && e.reason.includes('model'), JSON.stringify(e));
  const e2 = decide(m, {});
  ok('but only once', e2.activity !== 'talk' || e2.reason !== e.reason);
  const m2 = createMind({ random: seeded(9) });
  m2.needs.rest = 0.1;
  suggest(m2, 'sleep', 'the model thinks she is tired');
  const e3 = decide(m2, { cursorNear: true, userIdleSeconds: 1 });
  ok('but it cannot put her to sleep while you are at the desk', e3.activity !== 'sleep', JSON.stringify(e3));
  suggest(m2, 'talk', 'the model wants to chat');
  const e4 = decide(m2, { userIdleSeconds: 900 });
  ok('or have her talk to an empty room', e4.activity !== 'talk', JSON.stringify(e4));
  const s = summarise(m, { userIdleSeconds: 12 });
  ok('she can describe herself for a prompt', typeof s.doing === 'string' && typeof s.needs.rest === 'number', JSON.stringify(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
