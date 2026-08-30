// eval/lib/persona-bleed.mjs — A8 "3 personas × 20 prompts → blind judge attributes >= 85 %".
import { fileURLToPath } from 'node:url';
import { extractJson } from './judge.mjs';

export const PERSONA_IDS = ['haru', 'quiet', 'blunt'];
export const ATTRIBUTION_PASS_MIN = 0.85;
export const LABELS = ['甲', '乙', '丙'];

export function personaPath(id) {
  return fileURLToPath(new URL(`../personas/${id}.json`, import.meta.url));
}

/** Blind: the judge sees description + personality under 甲/乙/丙, never a name. */
export function buildAttributionSystem(cards) {
  const blocks = cards.map((c, i) => `【${LABELS[i]}】\n${c.description}\n${c.personality}`);
  return `你是中文对话的评审。下面有三个角色的设定，不给名字。之后会给你一条回复，判断它是哪个角色说的。\n只输出一个 JSON 对象：{"persona":"甲"}，值只能是 甲、乙、丙 之一。不要输出解释。\n\n${blocks.join('\n\n')}`;
}

export function buildAttributionUser(promptText, reply) {
  return `【对话】\n用户：${promptText}\n角色：${reply}\n\n只输出 JSON。`;
}

/** -> index 0..2, or null when the judge did not answer in shape. */
export function parseAttribution(text) {
  const obj = extractJson(text);
  if (!obj || typeof obj.persona !== 'string') return null;
  const i = LABELS.indexOf(obj.persona);
  return i < 0 ? null : i;
}

/** Deterministic label order per (seed, promptId): the true persona is not always 甲. */
export function shuffledOrder(seed, promptId) {
  let h = seed >>> 0;
  for (const ch of promptId) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619)) >>> 0;
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; const j = h % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

export function scoreAttribution(rows) {
  const answered = rows.filter((r) => r.judged !== null);
  const correct = answered.filter((r) => r.judged === r.truth).length;
  const pct = rows.length === 0 ? 0 : Math.round((correct / rows.length) * 1000) / 1000;
  return { n: rows.length, answered: answered.length, correct, pct, pass: pct >= ATTRIBUTION_PASS_MIN };
}
