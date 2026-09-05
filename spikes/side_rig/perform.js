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
  { action: 'sleep',      emotion: 'sleepy',    words: ['睡觉', '睡一觉', '睡了', '睡一会', '午睡', '打盹', '去睡', 'sleep', 'nap'] },
  { action: 'sit',        emotion: 'relaxed',   words: ['坐下', '坐一下', '坐好', '坐着', '趴下', '趴着', 'sit down', 'sit'] },
  { action: 'stretch',    emotion: 'sleepy',    words: ['伸懒腰', '伸了个懒腰', '舒展', 'stretch'] },
  { action: 'tail_react', emotion: 'happy',     words: ['尾鳍', '尾巴', '拍水', '拍打水面', 'tail'] },
  { action: 'stumble',    emotion: 'panic',     words: ['摔', '绊', '踉跄', 'stumble', 'trip'] },
  { action: 'look',       emotion: 'curious',   words: ['歪着头', '歪头', '看着你', '看向', '张望', '抬起头', 'look'] },
  { action: 'talk',       emotion: null,        words: ['嘟囔', '小声说', '碎碎念'] },
];

// Where she should stand. Fractions of the usable width, not pixels, so it works on any screen.
const PLACES = [
  { at: 0.12, words: ['左边', '左侧', '去左', '最左', 'left'] },
  { at: 0.88, words: ['右边', '右侧', '去右', '最右', 'right'] },
  { at: 0.5,  words: ['中间', '正中', '中央', 'middle', 'centre', 'center'] },
  { at: 'cursor', words: ['过来', '到我这', '来我这', '靠近我', '来这里', 'come here', 'come'] },
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

// What should she do, given what you said and what she said back?
// `said` is her full reply; only its bracketed parts are read, so the spoken text cannot trigger anything by
// accident - her saying "主人要不要去睡觉" should not put HER to sleep.
export function readPerformance(asked, said) {
  const request = typeof asked === 'string' ? asked : '';
  const directions = stageDirections(said);
  const out = { action: null, emotion: null, target: null, from: null };

  const place = findIn(request, PLACES) || findIn(directions, PLACES);
  if (place) { out.target = place.at; out.from = findIn(request, PLACES) ? 'you' : 'her'; }

  const rule = findIn(request, RULES) || findIn(directions, RULES);
  if (rule) {
    out.action = rule.action;
    out.emotion = rule.emotion;
    out.from = out.from || (findIn(request, RULES) ? 'you' : 'her');
  }
  const mood = findIn(directions, MOODS, 'words') || findIn(request, MOODS, 'words');
  if (mood) out.emotion = mood.emotion;

  return out.action || out.target || out.emotion ? out : null;
}

export const ACTIONS = RULES.map((r) => r.action);
export { RULES, PLACES, MOODS };
