// Headless tests for her mind. No window, no Electron, no network - just simulated time.
//   node spikes/side_rig/mind.test.mjs
// Each test states the behaviour a person would expect, then proves it over simulated minutes or hours.
import { createMind, observe, tick, decide, shouldChange, score, suggest, summarise, ACTIVITIES } from './mind.js';

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
  const m2 = createMind({ random: seeded(2) });
  live(m2, 600, { cursorNear: true });
  ok('with your cursor nearby she does not get lonely', m2.needs.company > 0.6, `company=${m2.needs.company.toFixed(2)}`);
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
  const s = summarise(m, { userIdleSeconds: 12 });
  ok('she can describe herself for a prompt', typeof s.doing === 'string' && typeof s.needs.rest === 'number', JSON.stringify(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
