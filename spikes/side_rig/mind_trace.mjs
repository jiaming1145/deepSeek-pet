// Run her mind for a simulated hour against a scripted day, and write the timeline to JSON so it can be charted.
//   node spikes/side_rig/mind_trace.mjs > shots_mind/trace.json
// The point is to be able to SEE that her behaviour follows her needs rather than a dice roll.
import { createMind, observe, tick, decide, shouldChange, NEEDS } from './mind.js';

function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

// A plausible hour: you are around and playing with her, you go away for a long stretch, then you come back.
function userAt(t) {
  if (t < 300) return { cursorNear: t % 60 < 25, userIdleSeconds: t % 60 < 25 ? 0 : 40, pet: t % 90 < 0.2 };
  if (t < 2400) return { cursorNear: false, userIdleSeconds: t - 300, pet: false };      // away from the desk
  return { cursorNear: t % 45 < 30, userIdleSeconds: t % 45 < 30 ? 0 : 20, pet: t % 120 < 0.2 };
}

const m = createMind({ random: seeded(20260905) });
const dt = 0.5, hours = 1;
const samples = [], events = [];
for (let i = 0; i * dt < hours * 3600; i++) {
  const t = i * dt;
  const u = userAt(t);
  const ctx = { cursorNear: u.cursorNear, userIdleSeconds: u.userIdleSeconds };
  if (u.pet) observe(m, 'pet', { zone: 'head' });
  if (t >= 1800 && t < 1800 + dt) observe(m, 'drop', { impact: 7 });     // one accidental throw, mid-absence
  tick(m, dt, ctx);
  if (shouldChange(m, ctx)) {
    const c = decide(m, ctx);
    events.push({ t: Math.round(t), activity: c.activity, reason: c.reason, mood: c.mood });
  }
  if (i % 4 === 0) samples.push({ t, activity: m.activity, mood: m.mood, ...Object.fromEntries(NEEDS.map((n) => [n, +m.needs[n].toFixed(3)])) });
}
const counts = {};
for (const e of events) counts[e.activity] = (counts[e.activity] || 0) + 1;
process.stdout.write(JSON.stringify({ samples, events, counts, decisions: events.length }, null, 1));
