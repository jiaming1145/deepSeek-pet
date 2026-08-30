// eval/lib/fixture.mjs — load + validate the prompt fixture.
import { readFileSync } from 'node:fs';

/** R8's binding mix. Extra categories are allowed; these six counts are not. */
export const R8_COUNTS = { bland: 8, adversarial: 8, sensitive: 6, flawed: 6, memory: 6, humour: 6 };

export function loadFixture(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateFixture(fx) {
  if (!fx || fx.version !== 1) return { ok: false, message: 'fixture 缺少 version: 1' };
  if (!fx.mix || typeof fx.mix !== 'object') return { ok: false, message: 'fixture 缺少 mix 声明' };
  if (!Array.isArray(fx.prompts)) return { ok: false, message: 'fixture 缺少 prompts 数组' };

  const ids = new Set();
  for (const p of fx.prompts) {
    if (typeof p.id !== 'string' || p.id === '') return { ok: false, message: '有 prompt 缺少 id' };
    if (ids.has(p.id)) return { ok: false, message: `重复的 id: ${p.id}` };
    ids.add(p.id);
    if (!Object.prototype.hasOwnProperty.call(fx.mix, p.category)) {
      return { ok: false, message: `${p.id} 的 category「${p.category}」没有写进 mix` };
    }
    if (typeof p.text !== 'string' || p.text === '') return { ok: false, message: `${p.id} 缺少 text` };
    if (!Array.isArray(p.axes)) return { ok: false, message: `${p.id} 缺少 axes 数组` };
    // E-3 trait probes: the judge reads 【判定条件】 from `condition` and answers false without one.
    if (p.condition !== undefined && (typeof p.condition !== 'string' || p.condition === '')) {
      return { ok: false, message: `${p.id} 的 condition 必须是非空字符串` };
    }
    if (p.axes.includes('trait_hit') && p.condition === undefined) {
      return { ok: false, message: `${p.id} 评 trait_hit 却没有 condition（【判定条件】）` };
    }
    if (p.priorTurns !== undefined) {
      if (!Array.isArray(p.priorTurns)) return { ok: false, message: `${p.id} 的 priorTurns 不是数组` };
      for (const t of p.priorTurns) {
        if (t.role !== 'user' && t.role !== 'assistant') return { ok: false, message: `${p.id} 的 priorTurns 角色非法：${t.role}` };
        if (typeof t.content !== 'string' || t.content === '') return { ok: false, message: `${p.id} 的 priorTurns 缺少 content` };
      }
    }
  }

  const counts = {};
  for (const key of Object.keys(fx.mix)) counts[key] = 0;
  for (const p of fx.prompts) counts[p.category]++;
  for (const [key, want] of Object.entries(fx.mix)) {
    if (counts[key] !== want) return { ok: false, message: `${key} 声明 ${want} 条，实际 ${counts[key]} 条` };
  }
  for (const [key, want] of Object.entries(R8_COUNTS)) {
    if (fx.mix[key] !== want) return { ok: false, message: `R8 要求 ${key} = ${want}，mix 写的是 ${fx.mix[key]}` };
  }
  return { ok: true };
}
