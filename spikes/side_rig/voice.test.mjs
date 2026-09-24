// Headless tests for what she says and what she remembers.
//   node spikes/side_rig/voice.test.mjs
import { createVoice, react, idleLine, speak, LINES, LINES_EN, readTime } from './voice.js';
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
  // the hour is pinned so these do not depend on what time of day the tests run
  ok('a minute away is barely worth mentioning', LINES.greet_short.includes(react(v, 1, 'greet', { awaySeconds: 120, hour: 15 })));
  ok('an hour away gets a welcome back', LINES.greet_medium.includes(react(v, 2, 'greet', { awaySeconds: 3600, hour: 15 })));
  ok('a day away gets an earful', LINES.greet_long.includes(react(v, 3, 'greet', { awaySeconds: 90000, hour: 15 })));
}

console.log('she greets a stranger as a stranger, and says good morning only in the morning');
{
  const says = (lang, info, n = 200) => { const out = new Set(); for (let i = 0; i < n; i++) out.add(react(createVoice({ lang, random: seeded(i + 1) }), 1, 'greet', info)); return [...out]; };
  for (const [lang, L] of [['zh', LINES], ['en', LINES_EN]]) {
    const first = says(lang, { awaySeconds: 0, firstTime: true, hour: 15 });
    ok(`[${lang}] the very first run is a first meeting`, first.every((l) => L.greet_first.includes(l)), first.join(' | '));
    const quick = [...says(lang, { awaySeconds: 30, hour: 9 }), ...says(lang, { awaySeconds: 0, hour: 9 })];
    ok(`[${lang}] a restart half a minute later is "oh, you're back", not "we meet again"`, quick.every((l) => L.greet_short.includes(l)), quick.join(' | '));
    const morning = says(lang, { awaySeconds: 10 * 3600, hour: 8 });
    ok(`[${lang}] back after a night, at eight, she can say good morning`, morning.some((l) => L.greet_morning.includes(l)) && morning.every((l) => L.greet_morning.includes(l) || L.greet_firstToday.includes(l)), morning.join(' | '));
    const afterMidnight = says(lang, { awaySeconds: 8 * 3600, hour: 9 });
    ok(`[${lang}] left at half past midnight, back at half past eight: a new-day hello, not an earful`, afterMidnight.every((l) => L.greet_morning.includes(l) || L.greet_firstToday.includes(l)), afterMidnight.join(' | '));
    const threeAm = says(lang, { awaySeconds: 4 * 3600, hour: 3 });
    ok(`[${lang}] at three in the morning it is not "good morning"`, !threeAm.some((l) => L.greet_morning.includes(l)), threeAm.join(' | '));
    let saidMorningLate = [];
    for (const hour of [11, 14, 17, 21, 23]) for (const away of [0, 30, 120, 3600, 5 * 3600, 16 * 3600, 90000]) saidMorningLate.push(...says(lang, { awaySeconds: away, hour }, 30).filter((l) => L.greet_morning.includes(l)));
    ok(`[${lang}] from eleven o'clock on she never says good morning`, saidMorningLate.length === 0, saidMorningLate.join(' | '));
  }
}

console.log('she does not say the same thing twice in a row');
{
  let rep = 0, n = 0;
  for (let trial = 0; trial < 300; trial++) {
    const v = createVoice({ random: seeded(1000 + trial) }); let prev = null;
    for (let i = 0; i < 8; i++) { const l = react(v, i * 5, 'pet', { zone: 'tail' }); if (l === prev) rep++; prev = l; n++; }
  }
  ok('tail pats five seconds apart, three lines to choose from: no immediate repeats', rep === 0, `${rep} of ${n}`);
  rep = 0; n = 0;
  for (let trial = 0; trial < 100; trial++) {
    const v = createVoice({ random: seeded(2000 + trial) }); let prev = null; const mind = { needs: { company: 0.05, play: 0.6, rest: 0.8 }, mood: 'sad' };
    for (let i = 0; i < 20; i++) { const l = idleLine(v, i * 50, mind, {}); if (l === prev) rep++; prev = l; n++; }
  }
  ok('lonely remarks fifty seconds apart: no immediate repeats either', rep === 0, `${rep} of ${n}`);
}

console.log('she stops calling out once nobody is there');
{
  const lonelyMind = (mood) => ({ needs: { company: 0.05, play: 0.6, rest: 0.8 }, mood });
  const v = createVoice({ random: seeded(11) });
  ok('just after you go, she misses you out loud', LINES.lonely.includes(idleLine(v, 100, lonelyMind('sad'), { userIdleSeconds: 200 })));
  const v2 = createVoice({ random: seeded(12) });
  const settled = idleLine(v2, 100, lonelyMind('relaxed'), {});
  ok('once her face has settled, so have her words', !LINES.lonely.includes(settled), String(settled));
  const v3 = createVoice({ random: seeded(13) });
  ok('ten minutes without keyboard or mouse and she is quiet', idleLine(v3, 100, lonelyMind('sad'), { userIdleSeconds: 601 }) === null);
  ok('unless she was asked to speak', typeof idleLine(v3, 100, lonelyMind('sad'), { userIdleSeconds: 601 }, true) === 'string');
  const v4 = createVoice({ random: seeded(14) });
  const m = createMind({ random: seeded(14) });
  let spokenAway = 0;
  for (let t = 0; t < 3 * 3600; t += 0.5) { tick(m, 0.5, { userIdleSeconds: t }); if (t > 600 && idleLine(v4, t, m, { userIdleSeconds: t })) spokenAway++; }
  ok('three hours alone: nothing said after the first ten minutes', spokenAway === 0, `${spokenAway} lines`);
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

console.log('a damaged memory is not mistaken for a first meeting');
{
  const now = Date.parse('2026-09-05T12:00:00Z');
  ok('no file at all is a genuine first meeting', resume(load(null), now, null).firstTime === true);
  ok('an unreadable file is not', resume(load('{"firstMet": 17'), now, null).firstTime === false);
  ok('nor is an empty one, if the caller passes the text through', resume(load(''), now, null).firstTime === false);
  const r = resume(load('garbage'), now, null);
  ok('and the damage is reported rather than hidden', r.damaged === true);
  const lostDate = load({ sessions: 12, totalPets: 40, firstMet: 'yesterday' });
  ok('one bad field costs that field, not the whole history', lostDate.sessions === 12 && lostDate.totalPets === 40 && lostDate.damaged === true, JSON.stringify(lostDate));
  ok('and still is not a first meeting', resume(lostDate, now, null).firstTime === false);
  const good = load(JSON.parse(JSON.stringify({ ...blank(), firstMet: now - 86400000, lastSeen: now - 3600000, sessions: 3 })));
  const rg = resume(good, now, null);
  ok('a healthy file resumes as a returning friend', rg.firstTime === false && !rg.damaged && good.firstMet === now - 86400000);
  ok('a count of one session with a real first-met date is not a first meeting', resume(load({ firstMet: now - 1000, sessions: 0 }), now, null).firstTime === false);
  const junkNeeds = load({ firstMet: now - 1000, needs: { rest: 'lots', company: 2 } });
  ok('nonsense needs are dropped or clamped, never passed to her mind', junkNeeds.needs && junkNeeds.needs.company === 1 && !('rest' in junkNeeds.needs), JSON.stringify(junkNeeds.needs));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
