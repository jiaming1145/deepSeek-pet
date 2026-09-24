// Her optional language-model brain.
//
// Everything she does works without this file. mind.js already decides what she wants and voice.js already
// gives her something to say; the brain only ever gets to make a *suggestion*, which is validated and honoured
// once. If the network is down, the key is missing, the account is empty or the model returns nonsense, she
// carries on exactly as before and nothing on screen changes. That is deliberate: a desktop pet that freezes
// when an API call hangs is worse than one that never had a brain.
//
// This module runs in Electron's MAIN process, never the renderer, so the API key is never handed to a web page.
// The pure parts (prompt building, reply parsing, validation, rate limiting) are exported for headless testing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const ENDPOINT = { host: 'api.deepseek.com', path: '/chat/completions' };
const MODEL = 'deepseek-v4-flash';
const KEY_FILE = path.join(os.homedir(), '.ds', 'deepseek.key');

// Who she is. See persona.js: the character card is the Chinese expansion from the community preset the owner
// asked for, not the ALL_CAPS token line, because the tokens are only labels on those Chinese rules.
const { personaFor } = require('./persona.js');

// The key comes from the DEEPSEEK_API_KEY environment variable, or else from the key file. Either way it is
// read here, in the main process, and never reaches the page.
//
// A key pasted from a web page or a chat app can carry a zero-width space, a full-width letter or a line break.
// Node refuses to put any of those in a header and throws synchronously from inside https.request, which used to
// escape the promise with no error recorded anywhere. So a key must be printable ASCII with no spaces, or it is
// treated as no key at all. The reason goes into `why.reason` and the log; the key itself never does.
function keyProblem(k) {
  if (/^[\x21-\x7e]+$/.test(k)) return null;
  const bad = [...k].find((ch) => !/[\x21-\x7e]/.test(ch));
  const code = 'U+' + bad.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  return `the API key contains a character an HTTP header cannot carry (${code}; a pasted space, line break, `
    + 'zero-width or full-width character), so the brain stays off until the key is re-copied';
}
function readKey(file = KEY_FILE, env = process.env, why = {}) {
  let k = (env.DEEPSEEK_API_KEY || '').trim();
  if (!k) {
    try { k = fs.readFileSync(file, 'utf8').trim(); } catch (e) { return null; }
    if (!k) return null;
  }
  const problem = keyProblem(k);
  if (!problem) return k;
  why.reason = problem;
  console.warn(`brain: ${problem}`);
  return null;
}

// --- the pure parts -----------------------------------------------------------------------------------------

// What the model is told. `state` is mind.summarise(), `history` is memory.describe().
function buildPrompt(state, history, activities) {
  const lines = [
    '以下是她此刻的状态，请据此决定她接下来做什么，以及要不要说一句话。',
    `Right now she is ${state.doing} because ${state.because}. She feels ${state.mood}.`,
    `Her needs out of 100 - rest ${state.needs.rest}, company ${state.needs.company}, play ${state.needs.play}, safety ${state.needs.safety}.`,
    state.youHaveBeenIdleFor != null ? `The user has not touched their keyboard for ${state.youHaveBeenIdleFor} seconds.` : null,
    `It has been ${state.secondsSinceYouTouchedHer} seconds since the user last interacted with her.`,
    history ? `History: ${history}.` : null,
    '',
    `Choose what she does next from exactly this list: ${activities.join(', ')}.`,
    'Reply with only JSON, no prose, no code fence, in this shape:',
    '{"activity":"<one from the list>","line":"<她说的一句中文，最多十五个字；没什么好说的就留空>"}',
    'Prefer silence (empty line) unless she has a real reason to speak.',
  ].filter(Boolean);
  return lines.join('\n');
}

// Pull the decision out of whatever the model returned. Models add prose and code fences; assume nothing.
function parseReply(text, activities) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const activity = typeof obj.activity === 'string' ? obj.activity.trim().toLowerCase() : null;
  const line = typeof obj.line === 'string' ? obj.line.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim().slice(0, 120) : '';
  if (!activity || !activities.includes(activity)) return null;   // it may only pick from the list she can do
  return { activity, line };
}

// She consults rarely: it costs money, and a pet whose every move needs a round trip is not a pet.
function createLimiter({ minGapMs = 45000, maxPerHour = 60 } = {}) {
  return { last: -Infinity, times: [], minGapMs, maxPerHour };
}
function mayAsk(lim, now) {
  if (now - lim.last < lim.minGapMs) return false;
  lim.times = lim.times.filter((t) => now - t < 3600000);
  return lim.times.length < lim.maxPerHour;
}
function noteAsk(lim, now) { lim.last = now; lim.times.push(now); }

// --- the impure part ----------------------------------------------------------------------------------------

// Resolves exactly once, always: {status, data} for a whole reply, {status: 0, data, error} for anything else.
// Three ways it used to hang or lie, each seen in a probe:
// - A socket that dies after the headers ends the response without 'end', so a promise that only listened for
//   'data' and 'end' stayed pending for ever. The response's own 'error', 'aborted' and 'close' settle it now.
// - The `timeout` option is only a socket-IDLE timer. DeepSeek sends blank lines as keep-alive while a request
//   waits in its queue, each of which resets that timer, so a 6 s timeout settled at 15 s. The overall deadline
//   below is wall-clock and nothing the server sends can push it back.
// - Chunks were glued together as strings, which splits a Chinese character that straddles two packets into
//   U+FFFD. setEncoding('utf8') holds a partial character back until the rest of it arrives.
function request(key, body, timeoutMs) {
  return new Promise((resolve) => {
    let done = false, deadline = null;
    const settle = (v) => { if (done) return; done = true; clearTimeout(deadline); resolve(v); };
    const fail = (e) => { const error = String((e && e.message) || e); settle({ status: 0, data: error, error }); };
    const payload = JSON.stringify(body);
    let req;
    try {
      req = https.request({
        host: ENDPOINT.host, path: ENDPOINT.path, method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      }, (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => settle({ status: res.statusCode, data }));
        res.on('aborted', () => fail('the connection closed in the middle of the reply'));
        res.on('error', fail);
        res.on('close', () => { if (!res.complete) fail('the connection closed in the middle of the reply'); });
      });
    } catch (e) {
      fail(e);                          // an invalid header throws here, synchronously, not through 'error'
      return;
    }
    deadline = setTimeout(() => { fail('timeout'); req.destroy(new Error('timeout')); }, timeoutMs);
    req.on('timeout', () => { fail('timeout'); req.destroy(new Error('timeout')); });
    req.on('error', fail);
    req.write(payload);
    req.end();
  });
}

// What a failed request is called in brain.lastError: the network's own words when there was no HTTP answer.
function describeFailure(res) {
  if (res.status === 402) return 'the DeepSeek account is out of credit';
  if (res.status === 401) return 'the DeepSeek key was refused (401)';
  if (res.status === 0) return `network: ${res.error || res.data || 'no answer'}`;
  return `http ${res.status}`;
}

function createBrain(opts = {}) {
  const why = {};
  let key = opts.key || readKey(opts.keyFile, opts.env, why);
  if (key && keyProblem(key)) { why.reason = keyProblem(key); key = null; }   // a key handed in directly is held to the same rule
  return {
    enabled: !!key,
    key,                              // never leaves this process
    limiter: createLimiter(opts),
    // The chat box has its own, much lighter limit: the owner is typing, so it only has to stop a stuck Enter key
    // or a runaway script from running up the bill.
    chatLimiter: createLimiter({ minGapMs: 2000, maxPerHour: 120 }),
    timeoutMs: opts.timeoutMs || 6000,
    chatTimeoutMs: opts.chatTimeoutMs || 30000,
    calls: 0, chats: 0, ok: 0, failed: 0, lastError: why.reason || null,
    mode: opts.mode || 'character',   // 'character' = 鲸鱼娘; 'plain' = the preset's TIMEOUT_SIGNAL, as a real switch
  };
}

// Returns {activity, line} or null. Never throws, never blocks longer than the timeout.
async function think(brain, state, history, activities, now = Date.now()) {
  if (!brain.enabled || !mayAsk(brain.limiter, now)) return null;
  noteAsk(brain.limiter, now);
  brain.calls++;
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: personaFor(brain.mode, 'bubble') }, { role: 'user', content: buildPrompt(state, history, activities) }],
    max_tokens: 60,
    temperature: 1.0,
    thinking: { type: 'disabled' },
  };
  const res = await request(brain.key, body, brain.timeoutMs);
  if (res.status !== 200) {
    brain.failed++;
    // 402 means the account is out of credit. Say so once, in words, and stop pestering the endpoint.
    brain.lastError = describeFailure(res);
    if (res.status === 401 || res.status === 402) brain.enabled = false;
    return null;
  }
  let text = null;
  try { text = JSON.parse(res.data).choices[0].message.content; } catch (e) { text = null; }
  const out = parseReply(text, activities);
  if (out) brain.ok++; else { brain.failed++; brain.lastError = 'unparseable reply'; }
  return out;
}

// The model states what she should DO in a 【动作】 marker, which the owner must never see. Pull it off, keep
// what survives as her reply, and hand the parsed intent back separately. A missing or malformed marker is not an
// error: the keyword reader in perform.js is still there as the fallback.
// The contract asks for the marker alone on the first line, but models drift from it, and each drift used to leak
// the machine line onto the screen or eat part of her reply. What is matched now is the marker wherever it sits,
// with half-width brackets as well as full-width ones, plus the JSON after it even when that is on the next line,
// and every marker in the reply rather than only the first. Only that span is removed, so a reply that starts on
// the marker's own line keeps its first sentence. The JSON after a marker is still for us when it is malformed:
// an unclosed brace runs to the end of the line, and the owner never sees it. A JSON object may span lines (a
// pretty-printed one) but never Chinese text, so an unclosed brace cannot swallow the reply up to some later '}'.
// A code fence the model wrapped round the marker goes with it, and so does a lone fence line straight after the
// marker when the reply's fences do not pair up; fences round real code are left alone.
const FENCED_ACT = /^[^\S\n]*```[\w-]*[^\S\n]*\n([^\S\n]*[【\[]动作[】\]][^`]*?)\n[^\S\n]*```[^\S\n]*$/gm;
const ACT_MARK = /(?:^[^\S\n]*```[\w-]*[^\S\n]*\n[^\S\n]*)?[【\[]动作[】\]](?:\s*(\{[^{}\u3000-\u9fff\uff00-\uffef]*\}|\{[^\n]*))?/gm;
const FENCE_AFTER_ACT = /^([^\S\n]*[【\[]动作[】\]][^\n]*)\n[^\S\n]*```[^\S\n]*$/m;
function parseAct(json) {
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== 'object') return null;
    const act = {
      do: typeof o.do === 'string' ? o.do.trim().toLowerCase() : null,
      to: typeof o.to === 'string' ? o.to.trim().toLowerCase() : null,
      mood: typeof o.mood === 'string' ? o.mood.trim().toLowerCase() : null,
      for: typeof o.for === 'number' && isFinite(o.for) ? Math.max(0, Math.min(60, o.for)) : null,
    };
    if (act.to === 'null' || act.to === 'none') act.to = null;
    return act;
  } catch (e) { return null; }
}
function splitAction(raw) {
  let act = null, found = false;
  let unwrapped = raw.replace(FENCED_ACT, '$1');
  if ((unwrapped.match(/^[^\S\n]*```/gm) || []).length % 2) unwrapped = unwrapped.replace(FENCE_AFTER_ACT, '$1');
  const stripped = unwrapped.replace(ACT_MARK, (_m, json) => {
    found = true;
    if (!act && json) act = parseAct(json);   // the first marker that parses is what she does
    return '';
  });
  if (!found) return { text: raw.trim(), act: null };
  const text = stripped.replace(/[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, act };   // the machine span never reaches the screen, even when its JSON is malformed
}

// A real conversation. Separate from think(): no activity to choose, a much longer answer, and the last few turns
// for context. It has a light rate limit of its own (2 s apart, 120 an hour). The owner is waiting for this one,
// so a refused message comes back as an error they can read, never as a silent drop.
async function chat(brain, turns, state, history, now = Date.now()) {
  if (!brain.enabled) return { error: brain.lastError || 'no API key: set DEEPSEEK_API_KEY or write it to ~/.ds/deepseek.key' };
  if (!mayAsk(brain.chatLimiter, now)) return { error: 'too many messages too quickly: wait a moment and send it again' };
  noteAsk(brain.chatLimiter, now);
  brain.calls++;
  brain.chats++;
  const context = [
    `（她此刻在${state.doing}，心情${state.mood}。`,
    `需要：休息 ${state.needs.rest}、陪伴 ${state.needs.company}、玩 ${state.needs.play}、安全感 ${state.needs.safety}。`,
    history ? `你们的相处：${history}。）` : '）',
  ].join('');
  // Her turns arrive RAW, action marker included, so the model sees what she did last time as well as what she
  // said, and keeps writing the marker. A failed turn leaves two of the owner's messages in a row; neighbours with
  // the same role are merged into one message so the roles alternate.
  const messages = [{ role: 'system', content: personaFor(brain.mode, 'chat') }];
  for (const t of turns.slice(-8)) {
    const role = t.role === 'her' ? 'assistant' : 'user';
    const content = String((t.role === 'her' && t.raw) || t.text || '');
    if (!content.trim()) continue;
    const prev = messages[messages.length - 1];
    if (prev.role === role) prev.content += `\n\n${content}`; else messages.push({ role, content });
  }
  // The situation rides on the owner's newest message. With none to ride on it goes in a message of its own,
  // not onto the end of the system prompt.
  const last = messages[messages.length - 1];
  if (last.role === 'user') last.content = `${context}\n\n${last.content}`; else messages.push({ role: 'user', content: context });
  const res = await request(brain.key, { model: MODEL, messages, max_tokens: 700, temperature: 1.1, thinking: { type: 'disabled' } }, brain.chatTimeoutMs);
  if (res.status !== 200) {
    brain.failed++;
    brain.lastError = describeFailure(res);
    if (res.status === 401 || res.status === 402) brain.enabled = false;   // as in think(): stop, do not retry
    return { error: brain.lastError };
  }
  try {
    const raw = JSON.parse(res.data).choices[0].message.content.trim();
    if (!raw) { brain.failed++; return { error: 'empty reply' }; }
    brain.ok++;
    return { ...splitAction(raw), raw };   // raw is what pet.js keeps in the history
  } catch (e) {
    brain.failed++;
    return { error: 'unreadable reply' };
  }
}

module.exports = { createBrain, think, chat, splitAction, buildPrompt, parseReply, createLimiter, mayAsk, noteAsk, readKey, personaFor, MODEL, KEY_FILE };
