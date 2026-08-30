// eval/lib/ablation.mjs — P5: the four-way persona-load ablation (research §4.5 E-1).
// Four raw deepseek-v4-flash calls, same user turn, differing only in the system message.
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, sanitizeForDisplay } from '@ds/brain';
import { shapeOf } from './shape.mjs';

export const ABLATION_USER_TEXT = '你好呀';
export const MARKER_PREFIX = '【PERSONA_LOAD】';

/** Fixed nonsense identifiers for arm 2 — same shape, no meaning. */
export const RANDOM_TOKENS = [
  'AAA_BBB', 'CCC_DDD', 'EEE_FFF', 'GGG_HHH', 'III_JJJ',
  'KKK_LLL', 'MMM_NNN', 'OOO_PPP', 'QQQ_RRR', 'SSS_TTT',
];

/** The marker block = from 【PERSONA_LOAD】 up to the first blank line. */
export function splitMarker(staticSystem) {
  const start = staticSystem.indexOf(MARKER_PREFIX);
  if (start !== 0) return { marker: null, rest: staticSystem };
  const end = staticSystem.indexOf('\n\n');
  if (end < 0) return { marker: staticSystem.trim(), rest: '' };
  return { marker: staticSystem.slice(0, end).trim(), rest: staticSystem.slice(end + 2) };
}

export function randomizeMarker(marker) {
  let i = 0;
  return marker.replace(/[A-Z][A-Z0-9_]{2,}/g, () => RANDOM_TOKENS[i++ % RANDOM_TOKENS.length]);
}

export function buildArms(staticSystem) {
  const { marker, rest } = splitMarker(staticSystem);
  if (marker === null) {
    return { ok: false, message: `静态系统块没有以 ${MARKER_PREFIX} 开头，消融实验没法切分（P1）。` };
  }
  return {
    ok: true,
    arms: [
      { id: 'marker-only', label: '只有标记行', system: marker },
      { id: 'random-tokens', label: '标记行换成无意义标识符', system: randomizeMarker(marker) },
      { id: 'chinese-only', label: '只有中文展开，没有标记行', system: rest.trim() },
      { id: 'full', label: '中文展开 + 标记行（线上用的）', system: staticSystem },
    ],
  };
}

/** Local, checkable trait markers so E-1's prediction is testable without a judge. */
export const TRAIT_PROBES = {
  first_person: /人家|本鲸/,
  rice: /米饭|白饭|米/,
  whale_action: /尾鳍|拍水|吐泡|泡泡|翻肚皮/,
  buoyancy: /浮力/,
};

export function probeTraits(reply) {
  const out = {};
  for (const [key, re] of Object.entries(TRAIT_PROBES)) out[key] = re.test(reply);
  return out;
}

export async function runAblation({ apiKey, model = DEEPSEEK_MODEL, baseUrl = DEEPSEEK_BASE_URL, staticSystem, fetchImpl = fetch }) {
  const built = buildArms(staticSystem);
  if (!built.ok) return built;
  const results = [];
  for (const arm of built.arms) {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: arm.system }, { role: 'user', content: ABLATION_USER_TEXT }],
        stream: false,
        thinking: { type: 'disabled' },
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 300,
      }),
    });
    if (!res.ok) return { ok: false, message: `${arm.id}: HTTP ${res.status}` };
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content ?? '';
    const reply = sanitizeForDisplay(raw);
    results.push({ id: arm.id, label: arm.label, systemChars: arm.system.length, raw, reply, shape: shapeOf(reply), traits: probeTraits(reply) });
  }
  return { ok: true, userText: ABLATION_USER_TEXT, model, results };
}

export function renderAblationMarkdown(report) {
  const L = [];
  L.push(`# 人格加载消融实验（P5 / E-1） — ${report.startedAt}`);
  L.push('');
  L.push(`模型 \`${report.model}\`，四路只差 system 消息，用户输入都是「${report.userText}」。`);
  L.push('');
  L.push('| 臂 | system 字数 | 人家/本鲸 | 米饭 | 鲸鱼动作 | 浮力 | 汉字 | 句数 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of report.results) {
    L.push(`| \`${r.id}\` | ${r.systemChars} | ${r.traits.first_person ? '✓' : '—'} | ${r.traits.rice ? '✓' : '—'} | ${r.traits.whale_action ? '✓' : '—'} | ${r.traits.buoyancy ? '✓' : '—'} | ${r.shape.hanzi} | ${r.shape.sentences} |`);
  }
  L.push('');
  for (const r of report.results) {
    L.push(`## \`${r.id}\` — ${r.label}`);
    L.push('');
    L.push('```');
    L.push(r.reply);
    L.push('```');
    L.push('');
  }
  L.push('## 怎么读这张表（研究 §4.5 的预测）');
  L.push('');
  L.push('- `marker-only` 应该给出一个泛泛的鲸鱼娘：没有米饭梗、没有浮力梗、没有人家/本鲸。');
  L.push('- `random-tokens` 应该什么角色特征都没有。');
  L.push('- `chinese-only` 和 `full` 应该分不出来——如果分得出来，标记行不是白加的，记下来。');
  L.push('- 如果 `marker-only` 复现了源提示词里的特有说法，说明另有来源，**上线前先查清楚**。');
  L.push('');
  return L.join('\n');
}
