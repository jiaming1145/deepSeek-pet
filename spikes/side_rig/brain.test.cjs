// Tests for the optional language-model brain. The pure parts run offline; the live call runs only if you pass
// --live and a key is present, and it costs a fraction of a penny.
//   node spikes/side_rig/brain.test.cjs
//   node spikes/side_rig/brain.test.cjs --live
const { buildPrompt, parseReply, createLimiter, mayAsk, noteAsk, createBrain, think, chat, splitAction, readKey, personaFor } = require('./brain.js');

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
  // env: {} so the test means the same thing on a machine where DEEPSEEK_API_KEY is set
  const b = createBrain({ keyFile: 'C:/definitely/not/a/key/file', env: {} });
  ok('no key means disabled', b.enabled === false);
  think(b, STATE, '', ACTS).then((r) => ok('and thinking simply returns nothing', r === null));
}

console.log('the key can come from the environment instead of the key file');
{
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
  const keyFile = path.join(dir, 'deepseek.key');
  fs.writeFileSync(keyFile, 'sk-file\n');
  ok('DEEPSEEK_API_KEY wins even over an existing key file', readKey(keyFile, { DEEPSEEK_API_KEY: ' sk-env ' }) === 'sk-env');
  ok('a blank variable falls through to the file', readKey(keyFile, { DEEPSEEK_API_KEY: '  ' }) === 'sk-file');
  ok('and no variable at all reads the file', readKey(keyFile, {}) === 'sk-file');
  ok('neither means no key', readKey('C:/definitely/not/a/key/file', {}) === null);
  ok('createBrain passes the environment through', createBrain({ keyFile: 'C:/definitely/not/a/key/file', env: { DEEPSEEK_API_KEY: 'sk-env' } }).enabled === true);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('a key that cannot go in a header is refused up front, with a reason and without the key');
{
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
  const keyFile = path.join(dir, 'deepseek.key');
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(String(m));
  for (const [name, k] of [['a zero-width space', 'sk-abc​def'], ['a full-width letter', 'ｓk-abcdef'], ['an internal line break', 'sk-abc\ndef']]) {
    fs.writeFileSync(keyFile, k + '\n');
    const why = {};
    ok(`${name} in the key file means no key`, readKey(keyFile, {}, why) === null && /HTTP header/.test(why.reason || ''));
    const b = createBrain({ keyFile, env: {} });
    ok(`${name}: the brain is off and says why`, b.enabled === false && /HTTP header/.test(b.lastError || ''), String(b.lastError));
    ok(`${name}: the reason never contains the key`, !(b.lastError || '').includes('abc') && !warned.join(' ').includes('abc'));
  }
  const direct = createBrain({ key: 'sk-abc​def' });
  ok('a key handed in directly is held to the same rule', direct.enabled === false && /U\+200B/.test(direct.lastError || ''));
  console.warn = warn;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('the chat prompt out of character is a real assistant that still moves her');
{
  const plain = personaFor('plain', 'chat');
  ok('it does not tell her to pick an activity and keep quiet', !plain.includes('选择一个活动') && !plain.includes('不要说话'));
  ok('it carries the 【动作】 first-line contract', plain.includes('【动作】{"do"'));
  ok('with the same action and mood vocabulary as in character', ['stumble', 'follow', 'cursor', 'cheerful', 'shocked'].every((w) => plain.includes(w)));
  ok('and without her persona', !plain.includes('鲸鱼娘」') && !plain.includes('PERSONA_LOAD'));
  ok('the bubble prompt out of character is unchanged', personaFor('plain', 'bubble').includes('选择一个活动'));
  ok('in character the chat prompt is unchanged', personaFor('character', 'chat').includes('人家、本鲸'));
}

console.log('the action marker is taken off wherever the model put it');
{
  const A = '{"do":"dance","to":null,"mood":"happy","for":4}';
  const cases = [
    ['on its own first line', `【动作】${A}\n\n（转圈）好呀主人`, '（转圈）好呀主人', 'dance'],
    ['with its JSON on the next line', `【动作】\n${A}\n\n（转圈）好呀主人`, '（转圈）好呀主人', 'dance'],
    ['at the end of a line of speech', `（转圈）好呀主人【动作】${A}`, '（转圈）好呀主人', 'dance'],
    ['with the reply starting on the same line', '【动作】{"do":"sit","to":null,"mood":"relaxed","for":4}（坐下来）主人你看，人家坐好啦。\n\n第二段', '（坐下来）主人你看，人家坐好啦。\n\n第二段', 'sit'],
    ['inside a code fence', '```\n【动作】{"do":"wave","to":null,"mood":"happy","for":3}\n```\n\n（挥手）嗨', '（挥手）嗨', 'wave'],
    ['inside a json code fence', '```json\n【动作】{"do":"wave","to":null,"mood":"happy","for":3}\n```\n\n（挥手）嗨', '（挥手）嗨', 'wave'],
    ['after an unclosed fence', '```\n【动作】{"do":"wave","to":null,"mood":"happy","for":3}\n\n（挥手）嗨', '（挥手）嗨', 'wave'],
    ['with half-width brackets', '[动作]{"do":"wave","to":null,"mood":"happy","for":3}\n\n（挥手）嗨', '（挥手）嗨', 'wave'],
    ['twice (the first one counts)', '【动作】{"do":"wave","to":null,"mood":"happy","for":3}\n\n（挥手）嗨\n【动作】{"do":"sit"}', '（挥手）嗨', 'wave'],
    ['alone, with nothing to say', `【动作】${A}`, '', 'dance'],
    ['with malformed JSON (the marker still goes)', '【动作】{"do":"dance", mood: happy}\n\n（转圈）好呀', '（转圈）好呀', null],
    ['with an unclosed brace', '【动作】{"do":"dance"\n\n（转圈）好呀', '（转圈）好呀', null],
    ['with English after it and no JSON (the rest of the line stays)', '【动作】 Sure, here is the answer.', 'Sure, here is the answer.', null],
    ['followed by a lone closing fence', '【动作】{"do":"wave"}\n```\n你好', '你好', 'wave'],
    ['with an unclosed brace and a later } in her reply', '【动作】{"do":"wave"\n今天好开心}\n结束', '今天好开心}\n结束', null],
    ['with pretty-printed JSON over several lines', '【动作】{\n  "do": "sit",\n  "for": 3\n}\n\n好', '好', 'sit'],
    ['with nested JSON', '【动作】{"do":"hop","to":null,"mood":"happy","for":2,"x":{"y":1}}\n\n嗯', '嗯', 'hop'],
  ];
  for (const [name, raw, text, did] of cases) {
    const r = splitAction(raw);
    ok(`${name}`, r.text === text && (did === null ? r.act === null : r.act && r.act.do === did), JSON.stringify(r));
  }
  const code = '【动作】{"do":"none","to":null,"mood":"focused","for":0}\n\n像这样：\n```\nnpm test\n```\n\n```\nnpm run build\n```';
  ok('a real code block in the reply keeps its fences', splitAction(code).text === '像这样：\n```\nnpm test\n```\n\n```\nnpm run build\n```', JSON.stringify(splitAction(code).text));
  ok('a reply with no marker is left alone', splitAction('  （挥手）嗨  ').text === '（挥手）嗨' && splitAction('（挥手）嗨').act === null);
}

// --- the network, offline: brain.js's https.request is pointed at a local server that misbehaves on purpose ----
const http = require('node:http');
const https = require('node:https');
const ACTED = '【动作】{"do":"wave","to":null,"mood":"happy","for":3}\n\n（挥手）主人好呀，人家是鲸鱼娘啦！';
const reply = (content) => JSON.stringify({ choices: [{ message: { content } }] });

async function offlineNetwork() {
  let mode = 'ok', hits = 0, lastBody = null;
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      hits++; lastBody = JSON.parse(b);
      if (mode === 'reset') {                    // headers, half a body, then the socket dies
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 500 });
        res.write('{"choices":[{"mess');
        setTimeout(() => req.socket.destroy(), 50);
      } else if (mode === 'keepalive') {         // DeepSeek's queue: blank lines, then (much later) the answer
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const iv = setInterval(() => res.write('\n'), 100);
        const end = setTimeout(() => { clearInterval(iv); res.end(reply('{"activity":"sit","line":""}')); }, 3000);
        res.on('close', () => { clearInterval(iv); clearTimeout(end); });
      } else if (mode === 'split') {             // a Chinese character cut in half between two packets
        const body = Buffer.from(reply(ACTED), 'utf8');
        const cut = body.indexOf(Buffer.from('主人', 'utf8')) + 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(body.subarray(0, cut));
        setTimeout(() => res.end(body.subarray(cut)), 30);
      } else if (mode === '402' || mode === '401') { res.writeHead(Number(mode)); res.end('{}'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(reply(ACTED)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const real = https.request;
  https.request = (opts, cb) => http.request({ ...opts, host: '127.0.0.1', port }, cb);
  const timed = async (p) => { const t0 = Date.now(); const v = await p; return { v, ms: Date.now() - t0 }; };
  const within = (p, ms) => Promise.race([p.then((v) => ({ settled: true, v })), new Promise((r) => setTimeout(() => r({ settled: false }), ms))]);
  try {
    console.log('a request always ends, and ends on time');
    mode = 'reset';
    let b = createBrain({ key: 'sk-test', timeoutMs: 5000 });
    let r = await within(timed(think(b, STATE, '', ACTS)), 4000);
    ok('a socket that dies mid-body settles think() at once, not never', r.settled && r.v.v === null && r.v.ms < 2000, JSON.stringify(r));
    ok('and it is counted as a failure with a reason', b.failed === 1 && /network/.test(b.lastError || ''), String(b.lastError));
    b = createBrain({ key: 'sk-test', chatTimeoutMs: 5000 });
    r = await within(chat(b, [{ role: 'you', text: 'hi' }], STATE, ''), 4000);
    ok('the same for chat()', r.settled && typeof r.v.error === 'string', JSON.stringify(r));

    mode = 'keepalive';
    b = createBrain({ key: 'sk-test', timeoutMs: 600 });
    r = await within(timed(think(b, STATE, '', ACTS)), 2500);
    ok('keep-alive newlines do not push the deadline back', r.settled && r.v.v === null && r.v.ms < 1200, JSON.stringify(r));
    ok('the failure says timeout', /timeout/.test(b.lastError || ''), String(b.lastError));

    console.log('Chinese survives a character split across two packets');
    mode = 'split';
    b = createBrain({ key: 'sk-test' });
    let c = await chat(b, [{ role: 'you', text: '你好' }], STATE, '');
    ok('no U+FFFD in her reply', c.text === '（挥手）主人好呀，人家是鲸鱼娘啦！', JSON.stringify(c));

    console.log('chat hands back the raw reply and sends a clean history');
    mode = 'ok';
    b = createBrain({ key: 'sk-test' });
    let now = 1e9;
    c = await chat(b, [{ role: 'you', text: '挥个手' }], STATE, '', now);
    ok('raw is the reply before the marker was taken off', c.raw === ACTED && c.text === '（挥手）主人好呀，人家是鲸鱼娘啦！' && c.act.do === 'wave');
    await chat(b, [{ role: 'you', text: '挥个手' }, { role: 'her', text: c.raw }, { role: 'you', text: '再跳个舞' }], STATE, '', now += 2500);
    const sent = lastBody.messages;
    ok('her raw turn goes back to the model as she wrote it, marker and all', sent[2].role === 'assistant' && sent[2].content === ACTED);
    ok('the situation rides on the newest user message', sent[3].role === 'user' && sent[3].content.endsWith('再跳个舞') && sent[3].content.startsWith('（她此刻在'));
    await chat(b, [{ role: 'you', text: 'a' }, { role: 'you', text: 'b' }], STATE, '', now += 2500);
    ok('a failed turn\'s two user messages are merged into one', lastBody.messages.map((m) => m.role).join(',') === 'system,user' && /a\n\nb$/.test(lastBody.messages[1].content));
    await chat(b, [], STATE, '', now += 2500);
    ok('with no turns the situation is a user message, not glued to the system prompt',
      lastBody.messages.map((m) => m.role).join(',') === 'system,user' && lastBody.messages[0].content.startsWith('【PERSONA_LOAD】'));
    b.mode = 'plain';
    await chat(b, [{ role: 'you', text: 'hello' }], STATE, '', now += 2500);
    ok('out of character, chat sends the plain chat prompt', lastBody.messages[0].content === personaFor('plain', 'chat'));

    console.log('chat has its own light rate limit');
    b = createBrain({ key: 'sk-test' });
    const h0 = hits; now = 2e9;
    ok('the first message goes', !(await chat(b, [{ role: 'you', text: '1' }], STATE, '', now)).error);
    const quick = await chat(b, [{ role: 'you', text: '2' }], STATE, '', now + 500);
    ok('one half a second later is refused out loud, without a request', typeof quick.error === 'string' && hits === h0 + 1, JSON.stringify(quick));
    ok('two seconds later is fine', !(await chat(b, [{ role: 'you', text: '3' }], STATE, '', now + 2100)).error);
    ok('chat calls are counted', b.chats === 2 && b.calls === 2 && b.chatLimiter.times.length === 2, `${b.chats} ${b.calls}`);
    for (let i = 0; i < 118; i++) noteAsk(b.chatLimiter, now + 3000 + i * 2000);
    ok('the hourly ceiling holds at 120', !!(await chat(b, [{ role: 'you', text: 'x' }], STATE, '', now + 3000 + 118 * 2000)).error);

    console.log('an account problem in chat switches the brain off, as in think()');
    for (const code of ['402', '401']) {
      mode = code;
      b = createBrain({ key: 'sk-test' });
      const hb = hits;
      c = await chat(b, [{ role: 'you', text: 'hi' }], STATE, '', 3e9);
      const again = await chat(b, [{ role: 'you', text: 'hi' }], STATE, '', 3e9 + 5000);
      ok(`chat ${code} disables the brain`, b.enabled === false && typeof c.error === 'string');
      ok(`and the next message does not reach the endpoint (${code})`, hits === hb + 1 && again.error === c.error, again.error);
    }

    console.log('a bad key that gets past readKey still fails cleanly');
    mode = 'ok';
    b = createBrain({ key: 'sk-test' });
    b.key = 'sk-abc​def';                     // as if set some other way: https.request throws synchronously
    let threw = false, v;
    try { v = await think(b, STATE, '', ACTS); } catch (e) { threw = true; }
    ok('think() resolves null instead of rejecting', !threw && v === null);
    ok('and records the failure', b.failed === 1 && /network/.test(b.lastError || '') && !b.lastError.includes('abc'), String(b.lastError));
  } finally {
    https.request = real;
    server.close();
  }
}

(async () => {
  await offlineNetwork();
  if (process.argv.includes('--live')) {
    console.log('\nlive calls to DeepSeek (cost a fraction of a penny)');
    const b = createBrain({});
    if (!b.enabled) console.log(`  skipped: ${b.lastError || 'no key at ~/.ds/deepseek.key'}`);
    else {
      const r = await think(b, STATE, 'you met her today, 3 times together', ACTS);
      ok('the model answered with something she can actually do', r && ACTS.includes(r.activity), JSON.stringify(r) + ' ' + (b.lastError || ''));
      if (r) console.log(`  she would: ${r.activity}${r.line ? `, saying "${r.line}"` : ' (in silence)'}`);
      for (const mode of ['character', 'plain']) {
        b.mode = mode;
        const c = await chat(b, [{ role: 'you', text: '跳个舞给我看，然后告诉我一加一等于几' }], STATE, 'you met her today', Date.now() + (mode === 'plain' ? 3000 : 0));
        ok(`${mode}: chat answered, the marker parsed and none of it is on screen`, c && !c.error && c.act && typeof c.act.do === 'string' && !/动作/.test(c.text) && c.text.length > 0,
          JSON.stringify(c && (c.error || c.act)));
        if (c && c.text) console.log(`  ${mode}: act ${JSON.stringify(c.act)} | ${c.text.replace(/\n+/g, ' / ').slice(0, 120)}`);
      }
      console.log(`  calls ${b.calls} ok ${b.ok} failed ${b.failed}${b.lastError ? ' last error: ' + b.lastError : ''}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
