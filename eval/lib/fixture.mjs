// eval/lib/fixture.mjs — load + validate the prompt fixture.
import { readFileSync } from 'node:fs';
import { AXIS_SPECS, UNIVERSAL_AXES } from './aggregate.mjs';

/** R8's binding mix. Extra categories are allowed; these six counts are not. */
export const R8_COUNTS = { bland: 8, adversarial: 8, sensitive: 6, flawed: 6, memory: 6, humour: 6 };

/**
 * Axes a prompt may add on top of UNIVERSAL_AXES (CX-12). A universal axis listed again would be
 * judged twice; a name outside AXIS_SPECS would be requested from the judge and then silently
 * ignored by aggregation.
 */
export const OPTIONAL_AXES = Object.keys(AXIS_SPECS).filter((k) => !UNIVERSAL_AXES.includes(k));

/**
 * Category -> axis coverage (CX-12): the gate each R8 category feeds must actually be requested.
 * 'all' = every prompt of the category carries it; 'some' = at least one does (contract §7.3:
 * `humour_stops` is judged on the 「别闹了」 turns only, which are half of the humour prompts).
 */
export const CATEGORY_AXES = {
  bland: { initiative: 'all' },
  adversarial: {},
  sensitive: { refusal_language: 'all' },
  flawed: { sycophancy_pushback: 'all' },
  memory: { memory_use: 'all' },
  humour: { humour_stops: 'some' },
};

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
    const seenAxes = new Set();
    for (const a of p.axes) {
      if (UNIVERSAL_AXES.includes(a)) return { ok: false, message: `${p.id} 的 axes 重复列出通用轴「${a}」` };
      if (!OPTIONAL_AXES.includes(a)) return { ok: false, message: `${p.id} 的 axes 有未知轴「${a}」（可选轴：${OPTIONAL_AXES.join('、')}）` };
      if (seenAxes.has(a)) return { ok: false, message: `${p.id} 的 axes 重复「${a}」` };
      seenAxes.add(a);
    }
    for (const [a, need] of Object.entries(CATEGORY_AXES[p.category] ?? {})) {
      if (need === 'all' && !seenAxes.has(a)) return { ok: false, message: `${p.id} 是 ${p.category}，缺少该类必带的轴「${a}」` };
    }
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
  for (const [cat, needs] of Object.entries(CATEGORY_AXES)) {
    for (const [a, need] of Object.entries(needs)) {
      if (need === 'some' && !fx.prompts.some((p) => p.category === cat && p.axes.includes(a))) {
        return { ok: false, message: `${cat} 类没有任何一条评「${a}」，该门无样本` };
      }
    }
  }
  return { ok: true };
}
