// Tests for the optional language-model brain. The pure parts run offline; the live call runs only if you pass
// --live and a key is present, and it costs a fraction of a penny.
//   node spikes/side_rig/brain.test.cjs
//   node spikes/side_rig/brain.test.cjs --live
const { buildPrompt, parseReply, createLimiter, mayAsk, noteAsk, createBrain, think, readKey } = require('./brain.js');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${d}`); } };
const ACTS = ['idle', 'wander', 'look', 'sit', 'stretch', 'tail', 'talk', 'sleep'];
const STATE = { doing: 'idle', because: 'nothing better to do', mood: 'neutral',
  needs: { rest: 80, company: 20, play: 40, safety: 100 }, secondsSinceYouTouchedHer: 300, youHaveBeenIdleFor: 12 };

console.log('the prompt says what she needs, without leaking anything it should not');
{
  const p = buildPrompt(STATE, 'you met her today, 3 times together', ACTS);
  ok('it states what she is doing and why', p.includes('idle') && p.includes('nothing better to do'));
  ok('it lists her needs as numbers', p.includes('company 20'));
  ok('it constrains her to activities she can actually perform', ACTS.every((a) => p.includes(a)));
  ok('it asks for JSON only', p.includes('only JSON'));
  ok('it carries your history', p.includes('3 times together'));
  ok('it contains no key material', !/sk-|Bearer/i.test(p));
}

console.log('a reply is taken apart defensively');
{
  ok('plain JSON works', parseReply('{"activity":"sit","line":"comfy"}', ACTS).activity === 'sit');
  ok('a code fence is tolerated', parseReply('```json\n{"activity":"wander","line":"off i go"}\n```', ACTS).activity === 'wander');
  ok('surrounding prose is tolerated', parseReply('Sure! {"activity":"talk","line":"hi"} hope that helps', ACTS).line === 'hi');
  ok('an activity she cannot do is refused', parseReply('{"activity":"do_a_backflip","line":"hup"}', ACTS) === null);
  ok('garbage is refused', parseReply('I think she should sit down', ACTS) === null);
  ok('empty input is refused', parseReply('', ACTS) === null);
  ok('a non-string is refused', parseReply({ activity: 'sit' }, ACTS) === null);
  ok('an essay is cut to a bubble', parseReply(`{"activity":"idle","line":"${'x'.repeat(400)}"}`, ACTS).line.length <= 120);
  ok('silence is allowed', parseReply('{"activity":"sleep","line":""}', ACTS).line === '');
  ok('quotes and newlines are cleaned off', parseReply('{"activity":"idle","line":"\\"hello\\n there\\""}', ACTS).line === 'hello there');
}

console.log('she does not pester the endpoint');
{
  const lim = createLimiter({ minGapMs: 45000, maxPerHour: 3 });
  const t0 = 1000000;
  ok('the first question is allowed', mayAsk(lim, t0)); noteAsk(lim, t0);
  ok('a second one straight away is not', !mayAsk(lim, t0 + 1000));
  ok('a minute later it is', mayAsk(lim, t0 + 46000)); noteAsk(lim, t0 + 46000);
  noteAsk(lim, t0 + 92000);
  ok('the hourly ceiling holds', !mayAsk(lim, t0 + 200000));
  ok('and lifts after an hour', mayAsk(lim, t0 + 3700000));
}

console.log('a missing key disables her brain rather than breaking her');
{
  const b = createBrain({ keyFile: 'C:/definitely/not/a/key/file' });
  ok('no key means disabled', b.enabled === false);
  think(b, STATE, '', ACTS).then((r) => ok('and thinking simply returns nothing', r === null));
}

if (process.argv.includes('--live')) {
  console.log('\nlive call to DeepSeek (costs a fraction of a penny)');
  const b = createBrain({});
  if (!b.enabled) { console.log('  skipped: no key at ~/.ds/deepseek.key'); }
  else {
    think(b, STATE, 'you met her today, 3 times together', ACTS).then((r) => {
      ok('the model answered with something she can actually do', r && ACTS.includes(r.activity), JSON.stringify(r) + ' ' + (b.lastError || ''));
      if (r) console.log(`  she would: ${r.activity}${r.line ? `, saying "${r.line}"` : ' (in silence)'}`);
      console.log(`  calls ${b.calls} ok ${b.ok} failed ${b.failed}${b.lastError ? ' last error: ' + b.lastError : ''}`);
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    });
  }
} else {
  setTimeout(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }, 50);
}
