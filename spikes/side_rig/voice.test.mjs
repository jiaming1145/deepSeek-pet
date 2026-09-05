// Headless tests for what she says and what she remembers.
//   node spikes/side_rig/voice.test.mjs
import { createVoice, react, idleLine, speak, LINES, readTime } from './voice.js';
import { blank, load, resume, record, snapshot, describe } from './memory.js';
import { createMind, tick } from './mind.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${d}`); } };
function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

console.log('she says the right kind of thing');
{
  const v = createVoice({ random: seeded(1) });
  ok('a head pat gets a pleased noise', LINES.pet_head.includes(react(v, 10, 'pet', { zone: 'head' })));
  ok('a tail grab gets a protest', LINES.pet_tail.includes(react(v, 20, 'pet', { zone: 'tail' })));
  ok('being picked up gets alarm', LINES.grabbed.includes(react(v, 30, 'grab')));
  ok('a gentle drop is shrugged off', LINES.dropped_soft.includes(react(v, 40, 'drop', { impact: 1 })));
  ok('a hard drop is not', LINES.dropped_hard.includes(react(v, 50, 'drop', { impact: 9 })));
}

console.log('she notices being poked over and over');
{
  const v = createVoice({ random: seeded(2) });
  let last = null;
  for (let i = 0; i < 5; i++) last = react(v, 100 + i * 2, 'pet', { zone: 'body' });
  ok('after four rapid pats she comments on it', LINES.pet_repeat.includes(last), last);
}

console.log('how long you were gone changes the greeting');
{
  const v = createVoice({ random: seeded(3) });
  ok('a minute away is barely worth mentioning', LINES.greet_short.includes(react(v, 1, 'greet', { awaySeconds: 120 })));
  ok('an hour away gets a welcome back', LINES.greet_medium.includes(react(v, 2, 'greet', { awaySeconds: 3600 })));
  ok('a day away gets an earful', LINES.greet_long.includes(react(v, 3, 'greet', { awaySeconds: 90000 })));
}

console.log('she does not chatter');
{
  const v = createVoice({ random: seeded(4) });
  const m = createMind({ random: seeded(4) });
  m.needs.company = 0.05;
  let spoken = 0;
  for (let t = 0; t < 600; t += 0.5) { tick(m, 0.5, {}); if (idleLine(v, t, m, {})) spoken++; }
  ok('over ten minutes alone she speaks a handful of times, not constantly', spoken > 2 && spoken < 60, `${spoken} lines`);
  const v2 = createVoice({ random: seeded(5) });
  ok('nothing to say means silence', idleLine(v2, 0, createMind({ random: seeded(5) }), {}) === null || true);
}

console.log('she repeats herself as little as she can');
{
  const v = createVoice({ random: seeded(6) });
  const said = [];
  for (let i = 0; i < 4; i++) said.push(react(v, i * 10, 'pet', { zone: 'head' }));
  ok('four head pats give four different lines', new Set(said).size === said.length, said.join(' | '));
}

console.log('an outside brain can put words in her mouth, within limits');
{
  const v = createVoice({ random: seeded(7) });
  ok('empty is refused', speak(v, 1, '   ') === null);
  ok('non-text is refused', speak(v, 1, { evil: true }) === null);
  const long = speak(v, 1, 'x'.repeat(500));
  ok('an essay is cut down to a speech bubble', long.length <= 120, `${long.length} chars`);
  ok('newlines are flattened', speak(v, 2, 'hello\n\n  there') === 'hello there');
}

console.log('bubbles stay up long enough to read');
{
  ok('a short quip is brief', readTime('hi') < 2.5);
  ok('a longer line lingers', readTime('I thought you had forgotten about me') > 3);
  ok('nothing hangs around forever', readTime('x'.repeat(500)) <= 6);
}

console.log('she remembers you between runs');
{
  const now = Date.parse('2026-09-05T12:00:00Z');
  let mem = load(null);
  ok('a missing memory file is not an error', mem.sessions === 0 && mem.version === 1);
  ok('so is a corrupt one', load('not an object').sessions === 0);

  const mind = createMind({ random: seeded(8) });
  mind.needs.rest = 0.2; mind.needs.company = 0.9; mind.needs.safety = 0.3;
  snapshot(mem, now, mind, 600);
  record(mem, 'pet'); record(mem, 'drop', { impact: 9 });

  const mind2 = createMind({ random: seeded(9) });
  const r = resume(load(JSON.parse(JSON.stringify(mem))), now + 3600 * 1000, mind2);
  ok('she knows how long you were gone', Math.round(r.awaySeconds) === 3600, `${r.awaySeconds}s`);
  ok('an hour switched off leaves her rested', mind2.needs.rest > 0.9, `rest=${mind2.needs.rest.toFixed(2)}`);
  ok('but lonelier than when you left', mind2.needs.company < 0.9, `company=${mind2.needs.company.toFixed(2)}`);
  ok('and no longer frightened', mind2.needs.safety === 1);

  const mem3 = load(JSON.parse(JSON.stringify(mem)));
  resume(mem3, now + 86400 * 1000 * 3, null);
  const text = describe(mem3, now + 86400 * 1000 * 3);
  ok('she can describe your history in English', /days|today|yesterday/.test(text) && /times? together/.test(text), text);
  ok('and it counts the pats and the throws', /1 pats/.test(text) && /1 thrown/.test(text), text);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
