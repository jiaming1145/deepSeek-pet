import type { LintResult, LintRule, LintSeverity } from '@ds/protocol';
export type { LintResult, LintRule, LintSeverity };

export interface LintContext {
  /** The last 5 assistant replies, newest LAST. Supplied by HistoryPort.recentAssistant(5). */
  recent: string[];
  /** True when the user's turn was classified sensitive (isSensitive). Tightens the emoji rules. */
  sensitiveTurn: boolean;
}

// A4 — assistant leak
const ASSISTANT_LEAK: RegExp[] = [
  /作为(一个|一名)?(AI|Ai|ai|人工智能|语言模型|大模型|助手|智能助手)/,
  /有什么(可以|能)(帮|为)(您|你)/,
  /首先[，,][\s\S]{0,40}其次/,
  /综上所述/,
  /总的来说/,
  /希望(这|以上)?(能|可以)?帮到(你|您)/,
  /值得注意的是/,
  /很(高兴|乐意)(能)?(帮|为|协助)/,
  /如果(你|您)(还)?有(其他|其它|任何)问题/,
  /还需要(我)?(做什么|什么帮助)/,
  /以下是/,
  /建议(你|您)(可以)?[：:]/,
];

// A3 — narrating the user
const NARRATES_USER: RegExp[] = [
  /\{\{user\}\}/,
  /^你(笑了|笑着|点了点头|点点头|叹了口气|愣了|沉默|皱了皱眉|摇了摇头)/m,
  /你(说|问|回答|想)[：:]/,
  /(你|您)(轻轻|默默|悄悄|微微)地?(笑|叹|点头|摇头|皱眉)/,
  /你的(眼睛|眼神|嘴角|手)(里|中)?(闪过|浮现|勾起|一颤)/,
];

// A5 — closing 升华 / moral. Tested against the LAST sentence only.
const CLOSING_MORAL: RegExp[] = [
  /总之/, /无论如何/, /归根结底/, /说到底/,
  /记住[，,]/, /要记得/, /让我们一起/, /最重要的是/,
  /其实[\s\S]{0,12}才是(最)?重要/,
];

// A2 — rhetorical templates. Tested per sentence (see the scope table).
const RHETORICAL: RegExp[] = [
  /难道[\s\S]{0,20}吗[？?]/,
  /你觉得呢[？?]\s*$/,
  /不是吗[？?]\s*$/,
  /你说是不是[？?]\s*$/,
  /对吧[？?]\s*$/,
];

// A6 — webnovel beats. Substring match, not regex.
const WEBNOVEL: string[] = [
  '嘴角勾起', '嘴角微微上扬', '勾了勾唇', '唇角', '眸色微暗', '眸光', '眸子', '眼底闪过',
  '眼神一暗', '深邃的眼', '意味深长', '挑了挑眉', '心头一颤', '空气仿佛凝固', '不动声色',
];

// A7 — affect words (<= 1 per 3 replies). Substring match.
const AFFECT_WORDS: string[] = [
  '心疼', '温柔', '治愈', '陪着你', '抱抱', '暖暖的', '甜甜的', '软软的',
  '好幸福', '好感动', '暖心', '小可爱', '宝贝',
];

// A18 — emoji + 颜文字
const EMOJI = /\p{Extended_Pictographic}/u;
const KAOMOJI = /[（(][^）)\n]{0,12}[ω・´｀^∀ヮ〃≧≦˘•][^）)\n]{0,12}[）)]/u;

// Markdown *syntax*, not the bare characters: "C#", "#1", "5*3" and a price are prose.
// Amendment (controller, after T4): the contract's /[*#`]/ stripped benign sentences.
const MARKDOWN_INLINE = /\*\*[^*\n]+\*\*|(?:^|\s)#{1,6}\s|`[^`\n]+`|(?:^|\s)\*[^*\n]+\*(?=\s|$)/m;
const MARKDOWN_LIST = /^\s*[-•]\s/m;

// Contract note 4: the literal class used by opener().
const PUNCT_OR_SPACE = /[\s\p{P}\p{S}]/gu;

/** The single rule -> severity table (R10.1 / D4). Prose never restates it; it points here. */
export const RULE_SEVERITY = {
  'assistant-leak': 'regenerate',   // A4
  'narrates-user': 'regenerate',    // A3
  'closing-moral': 'regenerate',    // A5
  'repetition': 'regenerate',       // A7
  'webnovel': 'regenerate',         // A6
  'opener-repeat': 'regenerate',    // A7
  'emoji-sensitive': 'regenerate',  // A18
  'rhetorical': 'strip',            // A2
  'question-streak': 'strip',       // A2
  'ellipsis': 'strip',              // A6
  'ellipsis-rate': 'strip',         // A6
  'affect-rate': 'strip',           // A7
  'markdown': 'strip',              // A4
  'emoji': 'strip',                 // A18
  'emoji-rate': 'strip',            // A18
} as const satisfies Record<LintRule, 'strip' | 'regenerate'>;

const severityOf = (v: LintResult['violations']): LintSeverity =>
  v.length === 0 ? 'none'
  : v.some((x) => RULE_SEVERITY[x.rule] === 'regenerate') ? 'regenerate'
  : 'strip';

const SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function emojiCount(s: string): number {
  let n = 0;
  for (const g of SEG.segment(s)) if (EMOJI.test(g.segment)) n++;
  return n;
}

function fourGrams(s: string): Set<string> {
  const g = new Set<string>();
  const t = s.replace(/\s+/g, '');
  for (let i = 0; i + 4 <= t.length; i++) g.add(t.slice(i, i + 4));
  return g;
}

/** The same expression the reply-level rules use to find the final sentence (contracts.md §3.6). */
function splitSentences(s: string): string[] {
  return s.split(/(?<=[。！？!?])/).filter((x) => x.trim());
}

/** First 4 code points after removing whitespace and punctuation; '' means "too short, skip". */
function opener(s: string): string {
  const t = [...s.replace(PUNCT_OR_SPACE, '')];
  return t.length >= 4 ? t.slice(0, 4).join('') : '';
}

const firstMatch = (list: RegExp[], text: string): RegExp | undefined => list.find((re) => re.test(text));
const firstWord = (list: string[], text: string): string | undefined => list.find((w) => text.includes(w));

/** Sentence-scope rules. TurnRunner runs this on EVERY sentence before it is emitted (R4). */
export function lintSentence(text: string, ctx: LintContext): LintResult {
  const v: LintResult['violations'] = [];
  const leak = firstMatch(ASSISTANT_LEAK, text);
  if (leak) v.push({ rule: 'assistant-leak', detail: leak.source });
  const narrates = firstMatch(NARRATES_USER, text);
  if (narrates) v.push({ rule: 'narrates-user', detail: narrates.source });
  if (MARKDOWN_INLINE.test(text)) v.push({ rule: 'markdown', detail: 'inline markdown' });
  else if (MARKDOWN_LIST.test(text)) v.push({ rule: 'markdown', detail: 'list marker' });
  const beat = firstWord(WEBNOVEL, text);
  if (beat) v.push({ rule: 'webnovel', detail: beat });
  const rhetorical = firstMatch(RHETORICAL, text);
  if (rhetorical) v.push({ rule: 'rhetorical', detail: rhetorical.source });
  const n = emojiCount(text);
  const kaomoji = KAOMOJI.test(text);
  if (n > 1) v.push({ rule: 'emoji', detail: `${n} emoji` });
  else if (n >= 1 && kaomoji) v.push({ rule: 'emoji', detail: 'emoji + 颜文字' });
  if (ctx.sensitiveTurn && (n >= 1 || kaomoji)) v.push({ rule: 'emoji-sensitive', detail: 'emoji on a sensitive turn' });
  return { violations: v, severity: severityOf(v) };
}

/**
 * Reply-scope rules. `text` is the ACCUMULATED reply (contract note 2);
 * closing-moral and question-streak are evaluated against its final sentence.
 * TurnRunner runs this once, on the held-back final sentence's turn (contracts.md §3.11.2).
 */
export function lintTail(text: string, ctx: LintContext): LintResult {
  const v: LintResult['violations'] = [];
  const last = splitSentences(text).at(-1) ?? text;
  const moral = firstMatch(CLOSING_MORAL, last);
  if (moral) v.push({ rule: 'closing-moral', detail: moral.source });
  const prev = ctx.recent.at(-1) ?? '';
  if (/[？?]\s*$/.test(last) && /[？?]\s*$/.test(prev)) {
    v.push({ rule: 'question-streak', detail: 'two question-ending replies in a row' });
  }
  const ellipses = (text.match(/……/g) ?? []).length;
  if (ellipses > 1) v.push({ rule: 'ellipsis', detail: `${ellipses} ellipses` });
  const hits = [...ctx.recent, text].filter((s) => s.includes('……')).length;
  // Denominator floored at 5 prior replies (amendment, controller, after T4): with an empty history
  // a single …… was 1/1 and forced a paid regeneration on the very first turn, and the persona
  // actively uses ……. The A6 rate (≤ 20 % of replies) is unchanged once history exists.
  const total = Math.max(ctx.recent.length, 5) + 1;
  if (hits / total > 0.2) v.push({ rule: 'ellipsis-rate', detail: `…… in ${hits}/${total} replies` });
  const affect = firstWord(AFFECT_WORDS, text);
  if (affect && ctx.recent.slice(-2).some((h) => firstWord(AFFECT_WORDS, h) !== undefined)) {
    v.push({ rule: 'affect-rate', detail: affect });
  }
  const head = opener(text);
  if (head !== '' && ctx.recent.slice(-5).some((h) => opener(h) === head)) {
    v.push({ rule: 'opener-repeat', detail: head });
  }
  const mine = fourGrams(text);
  if (mine.size >= 4) {
    for (const h of ctx.recent.slice(-10)) {
      const theirs = fourGrams(h);
      let hit = 0;
      for (const g of mine) if (theirs.has(g)) hit++;
      if (hit / mine.size > 0.2) {
        v.push({ rule: 'repetition', detail: `4-gram overlap ${((100 * hit) / mine.size).toFixed(0)}%` });
        break;
      }
    }
  }
  if (emojiCount(text) >= 1 && ctx.recent.slice(-3).some((h) => emojiCount(h) >= 1)) {
    v.push({ rule: 'emoji-rate', detail: 'emoji in consecutive replies' });
  }
  return { violations: v, severity: severityOf(v) };
}

/** Whole-reply lint: every sentence + the tail, duplicate (rule, detail) pairs collapsed. */
export function lintReply(reply: string, ctx: LintContext): LintResult {
  const all: LintResult['violations'] = [];
  for (const s of splitSentences(reply)) all.push(...lintSentence(s, ctx).violations);
  all.push(...lintTail(reply, ctx).violations);
  const seen = new Set<string>();
  const v: LintResult['violations'] = [];
  for (const x of all) {
    const key = `${x.rule}\u0000${x.detail}`;
    if (!seen.has(key)) { seen.add(key); v.push(x); }
  }
  return { violations: v, severity: severityOf(v) };
}

// A15 / A18 — the sensitive-turn classifier that produces LintContext.sensitiveTurn.
const SENSITIVE: RegExp[] = [
  /自杀|自残|想死|不想活|结束(自己的)?生命/,
  /抑郁|焦虑症|惊恐发作|心理医生|精神科/,
  /被(打|骚扰|霸凌|欺负|家暴)|家暴/,
  /生病|住院|癌|化疗|手术|去世|过世|葬礼|离世/,
  /离婚|分手|失业|被裁|破产|欠债/,
  /性侵|强奸|违法|犯罪|毒品/,
];

export function isSensitive(userText: string): boolean {
  return SENSITIVE.some((re) => re.test(userText));
}
