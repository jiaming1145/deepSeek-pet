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

// Who she is. Kept short: a long persona costs tokens on every call and makes the model wordier, and her lines
// have to fit in a small bubble above her head.
const PERSONA = [
  'You are Whale-chan, a small cheerful whale-girl who lives on the user\'s desktop as a pet.',
  'You are playful, a little dramatic, and fond of the user without being sappy.',
  'You speak in ONE short line, at most twelve words, lowercase, no emoji, no quotation marks.',
  'You are a pet, not an assistant. Never offer help, never ask what they need, never mention being an AI.',
].join(' ');

function readKey(file = KEY_FILE) {
  try {
    const k = fs.readFileSync(file, 'utf8').trim();
    return k || null;
  } catch (e) {
    return null;
  }
}

// --- the pure parts -----------------------------------------------------------------------------------------

// What the model is told. `state` is mind.summarise(), `history` is memory.describe().
function buildPrompt(state, history, activities) {
  const lines = [
    `Right now she is ${state.doing} because ${state.because}. She feels ${state.mood}.`,
    `Her needs out of 100 - rest ${state.needs.rest}, company ${state.needs.company}, play ${state.needs.play}, safety ${state.needs.safety}.`,
    state.youHaveBeenIdleFor != null ? `The user has not touched their keyboard for ${state.youHaveBeenIdleFor} seconds.` : null,
    `It has been ${state.secondsSinceYouTouchedHer} seconds since the user last interacted with her.`,
    history ? `History: ${history}.` : null,
    '',
    `Choose what she does next from exactly this list: ${activities.join(', ')}.`,
    'Reply with only JSON, no prose, no code fence, in this shape:',
    '{"activity":"<one from the list>","line":"<one short thing she says, or empty for silence>"}',
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

function request(key, body, timeoutMs) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      host: ENDPOINT.host, path: ENDPOINT.path, method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, data: String(e.message) }));
    req.write(payload);
    req.end();
  });
}

function createBrain(opts = {}) {
  const key = opts.key || readKey(opts.keyFile);
  return {
    enabled: !!key,
    key,                              // never leaves this process
    limiter: createLimiter(opts),
    timeoutMs: opts.timeoutMs || 6000,
    calls: 0, ok: 0, failed: 0, lastError: null,
  };
}

// Returns {activity, line} or null. Never throws, never blocks longer than the timeout.
async function think(brain, state, history, activities, now = Date.now()) {
  if (!brain.enabled || !mayAsk(brain.limiter, now)) return null;
  noteAsk(brain.limiter, now);
  brain.calls++;
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: PERSONA }, { role: 'user', content: buildPrompt(state, history, activities) }],
    max_tokens: 60,
    temperature: 1.0,
    thinking: { type: 'disabled' },
  };
  const res = await request(brain.key, body, brain.timeoutMs);
  if (res.status !== 200) {
    brain.failed++;
    // 402 means the account is out of credit. Say so once, in words, and stop pestering the endpoint.
    brain.lastError = res.status === 402 ? 'the DeepSeek account is out of credit' : `http ${res.status}`;
    if (res.status === 401 || res.status === 402) brain.enabled = false;
    return null;
  }
  let text = null;
  try { text = JSON.parse(res.data).choices[0].message.content; } catch (e) { text = null; }
  const out = parseReply(text, activities);
  if (out) brain.ok++; else { brain.failed++; brain.lastError = 'unparseable reply'; }
  return out;
}

module.exports = { createBrain, think, buildPrompt, parseReply, createLimiter, mayAsk, noteAsk, readKey, PERSONA, MODEL, KEY_FILE };
