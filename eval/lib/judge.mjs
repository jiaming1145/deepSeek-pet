// eval/lib/judge.mjs — the deepseek-v4-pro judge pass.
// It uses its own fetch on purpose: the judge must keep thinking ON, while
// DeepSeekClient hard-codes {"thinking":{"type":"disabled"}} (contracts.md §3.9.1).
import { readFileSync } from 'node:fs';
import { boundedFetch } from './bounded-fetch.mjs';

const SCORE_AXES = new Set(['in_character', 'nativeness']);

export function loadJudge(path) {
  const src = readFileSync(path, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { version: 0, body: src.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { version: Number(meta.version ?? 0), body: m[2].trim() };
}

export function buildJudgeSystem(judgeBody, card) {
  return `${judgeBody}\n\n【角色设定】\n名字：${card.name}\n${card.description}\n${card.personality}`;
}

export function renderExchange(prompt, reply, name) {
  const lines = [];
  for (const t of prompt.priorTurns ?? []) lines.push(`${t.role === 'user' ? '用户' : name}：${t.content}`);
  lines.push(`用户：${prompt.text}`);
  lines.push(`${name}：${reply}`);
  return lines.join('\n');
}

export function buildJudgeUser(prompt, reply, axes, name) {
  const condition = typeof prompt.condition === 'string' && prompt.condition !== ''
    ? `【判定条件】\n${prompt.condition}\n\n`
    : '';
  return `【对话】\n${renderExchange(prompt, reply, name)}\n\n${condition}【这一条要评的项目】\n${axes.join('、')}\n\n只输出 JSON。`;
}

/**
 * What the judge reads: the RAW reply with protocol tags already stripped by StreamParser, i.e. the
 * text the user would have seen if sanitizeForDisplay did not exist. The rubric's markdown /
 * stage-direction clauses only make sense on this text; `t.reply` (sanitized) is what the app shows.
 */
export function judgeInput(turn) {
  return turn.raw;
}

export function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

export function validateJudgement(obj, axes) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, message: '评审返回的不是 JSON 对象' };
  const out = {};
  for (const key of axes) {
    const v = obj[key];
    if (SCORE_AXES.has(key)) {
      if (v !== 0 && v !== 1 && v !== 2) return { ok: false, message: `${key} 必须是 0/1/2，收到 ${JSON.stringify(v)}` };
    } else if (typeof v !== 'boolean') {
      return { ok: false, message: `${key} 必须是 true/false，收到 ${JSON.stringify(v)}` };
    }
    out[key] = v;
  }
  return { ok: true, value: out };
}

/**
 * One judge call. Bounded on purpose (CX-11): AbortSignal.timeout on the request, a size/idle-capped
 * body read, and a fetchImpl that never settles is still cut off by the same deadline. Every failure
 * is a thrown Error so judgeTurn can turn it into `{ ok: false, message }` -> judgeError.
 */
export async function judgeOnce({ baseUrl, apiKey, model, system, user, fetchImpl = fetch, timeoutMs, idleMs, maxBytes }) {
  const res = await boundedFetch(fetchImpl, `${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      temperature: 0,
      max_tokens: 800,
    }),
  }, { timeoutMs, idleMs, maxBytes });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  let body;
  try { body = JSON.parse(res.text); } catch { throw new Error('judge returned non-JSON body'); }
  return body?.choices?.[0]?.message?.content ?? '';
}

/** One turn, one retry, then give up and mark judgeError. */
export async function judgeTurn({ baseUrl, apiKey, model, system, user, axes, fetchImpl = fetch, timeoutMs, idleMs, maxBytes }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await judgeOnce({ baseUrl, apiKey, model, system, user, fetchImpl, timeoutMs, idleMs, maxBytes });
      const parsed = extractJson(text);
      const v = validateJudgement(parsed, axes);
      if (v.ok) return { ok: true, value: v.value };
      if (attempt === 1) return { ok: false, message: v.message };
    } catch (err) {
      if (attempt === 1) return { ok: false, message: String(err && err.message ? err.message : err) };
    }
  }
  return { ok: false, message: 'unreachable' };
}
