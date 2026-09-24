// Turning words into movement.
//
// She already writes what she is physically doing: her chat replies open with a stage direction like
// （尾巴轻轻拍打着水面，歪着头看你） or （开心地转起圈来）. That is a description of an action, in her own words,
// which we can read and actually perform. Nothing about the reply format has to change to support this.
//
// Two sources are read, in this order:
//   1. what the user asked for  - "跳个舞", "过来", "去左边", "坐下"  (an instruction beats a description)
//   2. her own stage directions - （转着圈跳舞）, （拍了拍尾鳍）, （打了个哈欠）
// Pure text in, a small plan out. No DOM, no network, so it can be tested headlessly.

// Each entry: the action she performs, an optional mood, an optional place to walk to, and the words that mean it.
// Ordered: the first match wins, so put the specific ones first.
const RULES = [
  { action: 'dance',      emotion: 'cheerful',  words: ['跳舞', '跳个舞', '跳支舞', '舞一个', '转圈', '转个圈', '转起圈', '旋转', 'dance'] },
  { action: 'celebrate',  emotion: 'cheerful',  words: ['欢呼', '庆祝', '举起手', '万岁', '好耶', 'celebrate', 'cheer'] },
  { action: 'hop',        emotion: 'happy',     words: ['跳起来', '跳一下', '蹦', '跳了跳', '蹦跶', 'jump', 'hop'] },
  { action: 'wave',       emotion: 'happy',     words: ['挥手', '挥个手', '挥挥手', '招手', '挥了挥', '打招呼', 'wave'] },
  { action: 'wake',       emotion: 'neutral',   words: ['醒醒', '醒一醒', '醒来', '起床', 'wake up'] },
  { action: 'sleep',      emotion: 'sleepy',    words: ['睡觉', '睡一觉', '睡了', '睡一会', '午睡', '打盹', '去睡', 'sleep', 'nap'] },
  { action: 'sit',        emotion: 'relaxed',   words: ['坐下', '坐一下', '坐好', '坐着', '趴下', '趴着', 'sit down', 'sit'] },
  { action: 'stretch',    emotion: 'sleepy',    words: ['伸懒腰', '伸了个懒腰', '舒展', 'stretch'] },
  { action: 'tail_react', emotion: 'happy',     words: ['尾鳍', '尾巴', '拍水', '拍打水面', 'tail'] },
  { action: 'stumble',    emotion: 'panic',     words: ['摔', '绊', '踉跄', 'stumble', 'trip'] },
  { action: 'look',       emotion: 'curious',   words: ['歪着头', '歪头', '看着你', '看向', '张望', '抬起头', 'look'] },
  { action: 'talk',       emotion: null,        words: ['嘟囔', '小声说', '碎碎念'] },
];

// Where she should stand. Fractions of the usable width, not pixels, so it works on any screen.
// In English a bare "left" or "right" is usually not a direction at all ("I left my phone", "you're right"), so an
// English direction needs a word of movement or place in front of it.
const toward = (dir) => ['go', 'move', 'walk', 'run', 'swim', 'head', 'stand', 'over', 'to the', 'on the', 'to your', 'far'].map((v) => `${v} ${dir}`);
const PLACES = [
  { at: 0.12, words: ['左边', '左侧', '去左', '最左', ...toward('left'), 'left side'] },
  { at: 0.88, words: ['右边', '右侧', '去右', '最右', ...toward('right'), 'right side'] },
  { at: 0.5,  words: ['中间', '正中', '中央', ...['middle', 'centre', 'center'].flatMap((w) => [`to the ${w}`, `in the ${w}`, `the ${w} of`])] },
  { at: 'cursor', words: ['过来', '到我这', '来我这', '靠近我', '来这里', 'come here', 'come over', 'come'] },
];

const MOODS = [
  { emotion: 'shy',       words: ['脸红', '泛红', '微红', '害羞', '不好意思', '红着脸'] },
  { emotion: 'pouty',     words: ['鼓着腮', '嘟嘴', '哼了一声', '别过脸', '撇过头'] },
  { emotion: 'affection', words: ['蹭', '抱住', '凑过去', '贴过来'] },
  { emotion: 'panic',     words: ['吓', '慌', '炸毛', '哇啊'] },
  { emotion: 'sleepy',    words: ['哈欠', '揉眼', '困'] },
  { emotion: 'smug',      words: ['得意', '骄傲', '抬起下巴', '挺起胸'] },
  { emotion: 'happy',     words: ['笑', '开心', '高兴', '眼睛一亮'] },
];

// Everything inside （…） or (…), joined. That is where she describes what she is doing.
export function stageDirections(text) {
  if (typeof text !== 'string') return '';
  return (text.match(/（[^）]*）|\([^)]*\)/g) || []).join(' ');
}

function findIn(haystack, table, key = 'words') {
  for (const rule of table) {
    for (const w of rule[key]) {
      if (haystack.includes(w)) return rule;
    }
  }
  return null;
}

// Chinese has no spaces, so a Chinese keyword counts wherever it appears. An English one must be a whole word, or
// "alright" walked her right, "I left my phone" walked her left, "welcome" called her over and "detail" set her
// tail going. A single English verb also matches its plain inflections, so "dancing" and "napping" still count.
const ASCII = /^[\x00-\x7f]+$/;
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function wordPattern(w, inflect) {
  if (!inflect || /\s/.test(w)) return new RegExp(`\\b${escape(w)}\\b`, 'gi');
  const stem = w.endsWith('e') ? `${escape(w.slice(0, -1))}(?:e|es|ed|ing)` : `${escape(w)}${escape(w.slice(-1))}?(?:s|es|ed|ing)?`;
  return new RegExp(`\\b${stem}\\b`, 'gi');
}
// Every index at which `word` occurs in `text`.
function occurrences(text, word, inflect = false) {
  const at = [];
  if (!ASCII.test(word)) { for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) at.push(i); return at; }
  const re = wordPattern(word, inflect);
  for (let m = re.exec(text); m; m = re.exec(text)) at.push(m.index);
  return at;
}

// What should she do, given what you said and what she said back?
// `said` is her full reply; only its bracketed parts are read, so the spoken text cannot trigger anything by
// accident - her saying "主人要不要去睡觉" should not put HER to sleep.
// "别睡了" is an instruction NOT to sleep. Without this the keyword reader saw 睡 and put her to bed, which is
// worse than doing nothing at all.
// Words that stop or cancel ("停", "stop", "醒醒") are not negators: "不停地跳舞" is dancing nonstop, "don't stop
// dancing" is more dancing, and "醒醒" is an instruction of its own (the `wake` rule above).
const NEGATORS = ['不要', '别', '不用', '不许', '不准', '不想', '不能', '住手', "don't", 'don’t', 'do not', 'no more', 'never'];
const STOPPERS = ['停下', '停一下', '停止', '别动', '站住', '不要动', '停', 'stop', 'freeze', 'hold on', 'stay still', 'stay put'];
// A negation reaches back at most this far, and never past the end of the previous clause: "别跳舞了，去睡觉吧" is
// one refusal and one request, and reading them as one threw the request away.
const CLAUSE_END = /[，。！？；、,.!?;]/;
const REACH = (word) => (ASCII.test(word) ? 12 : 6);

// A negator right in front of a stop word refuses the STOP, not what follows it: "不要停，继续跳舞" and "don't stop
// dancing" both ask for more dancing.
const STOP_WORDS = ['停', 'stop'];
// Words that CONTAIN a negator without negating anything: "你能不能跳个舞" and "要不要跳个舞" are requests, and 特别,
// 别扭, 别人 have nothing to do with 别 ("don't"). They are blanked out before looking for a refusal.
const NOT_NEGATIONS = ['能不能', '要不要', '用不用', '想不想', '特别', '别扭', '别人', '别的', '区别', '分别', '告别', '差别', '级别', '性别'];
function unrefused(text) {
  let out = text;
  for (const w of NOT_NEGATIONS) out = out.split(w).join('□'.repeat(w.length));
  return out;
}
// Where negator `n` occurs in `s`; an English one only as a whole word, so "whenever" does not contain "never".
function negatorsIn(s, n) {
  if (!ASCII.test(n)) return occurrences(s, n);
  const at = [], re = new RegExp(`(?:^|[^a-z'’])${escape(n)}(?![a-z])`, 'g');
  for (let m = re.exec(s); m; m = re.exec(s)) { at.push(m.index + m[0].length - n.length); re.lastIndex = m.index + 1; }
  return at;
}
function negatedAt(text, at, word) {
  let before = unrefused(text).slice(Math.max(0, at - REACH(word)), at);
  for (let i = before.length - 1; i >= 0; i--) if (CLAUSE_END.test(before[i])) { before = before.slice(i + 1); break; }
  before = before.toLowerCase();
  return NEGATORS.some((n) => negatorsIn(before, n).some((j) => {
    const rest = before.slice(j + n.length).trimStart();
    return !STOP_WORDS.some((w) => rest.startsWith(w));
  }));
}

export function isNegated(text, word) {
  if (typeof text !== 'string') return false;
  const at = occurrences(text, word, true);
  return at.length > 0 && negatedAt(text, at[0], word);
}

// A bare 停 is "stop" only on its own - 停, 停!, 停吧 - never inside 不停 ("nonstop") or another word.
function stopsHere(text, word, at) {
  if (word !== '停') return true;
  const prev = text[at - 1], next = text[at + 1];
  return prev !== '不' && (next === undefined || CLAUSE_END.test(next) || '下一止吧啦呀啊'.includes(next) || /\s/.test(next));
}

// The first entry in `table`, in its priority order, that the text asks for and does not refuse. Checking only the
// first keyword found meant "别去左边，去右边" found 左边, saw it refused, and gave up without looking at 右边.
// `refusable` is off for her own stage directions: they describe what she is doing, and reading them for refusals
// only found false ones ("（特别开心地转起圈来）").
function firstAsked(text, table, inflect, refusable = true) {
  for (const entry of table) {
    for (const w of entry.words) {
      if (occurrences(text, w, inflect).some((at) => !refusable || !negatedAt(text, at, w))) return entry;
    }
  }
  return null;
}

export function readPerformance(asked, said) {
  const request = typeof asked === 'string' ? asked : '';
  const directions = stageDirections(said);
  const out = { action: null, emotion: null, target: null, from: null };

  const placeAsked = firstAsked(request, PLACES, false);
  const place = placeAsked || firstAsked(directions, PLACES, false, false);
  if (place) { out.target = place.at; out.from = placeAsked ? 'you' : 'her'; }

  // an explicit "stop" outranks everything else - unless it is "不要停" or "don't stop", which ask for the opposite
  const stop = STOPPERS.some((w) => occurrences(request, w).some((at) => stopsHere(request, w, at) && !negatedAt(request, at, w)));
  if (stop) return { action: 'idle', emotion: null, target: null, from: 'you' };
  const ruleAsked = firstAsked(request, RULES, true);                 // "别睡了" is skipped here, not obeyed
  const rule = ruleAsked || firstAsked(directions, RULES, true, false);
  if (rule) {
    out.action = rule.action;
    out.emotion = rule.emotion;
    out.from = out.from || (ruleAsked ? 'you' : 'her');
  }
  const mood = findIn(directions, MOODS, 'words') || findIn(request, MOODS, 'words');
  if (mood) out.emotion = mood.emotion;

  return out.action || out.target || out.emotion ? out : null;
}

export const ACTIONS = RULES.map((r) => r.action);
export { RULES, PLACES, MOODS };
