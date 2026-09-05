// What she says, and when.
//
// A desktop pet that only animates is a toy. One that says the right small thing at the right moment reads as
// aware. This file holds the words and the rule for choosing them; it knows nothing about drawing or windows.
//
// Lines are grouped by situation. The chooser prefers the most specific situation that applies, never repeats
// something she said recently, and stays quiet unless she has a reason to speak - a pet that talks constantly
// is worse than one that never does. If a language model is connected it can put a line in her mouth instead
// (see `say()` in brain.js); everything here is the floor she never drops below, offline and free.

// Two line sets. Chinese is the default because the persona card is LANG_ZH_CN_ONLY; if the language model is
// reachable it writes her lines instead, and these are the floor she never drops below. Keeping both languages
// in character matters: a pet that speaks Chinese online and English offline is obviously a machine.
export const LINES_ZH = {
  // --- greeting, weighted by how long you were gone
  greet_short:   ['哦，回来啦', '这么快就回来了', '哼，来了啊', '在呢在呢'],
  greet_medium:  ['人家等你好久了', '欢迎回来，主人', '才、才不是在等你', '你终于回来了'],
  greet_long:    ['你跑哪儿去了啦', '还以为主人把人家忘了', '这么久才回来……', '本鲸都快睡着了'],
  greet_firstToday: ['主人早', '又见面了', '今天也要好好的哦'],

  // --- being touched
  pet_head:      ['唔……', '再摸一下嘛', '好舒服哦', '哼、勉强让你摸'],
  pet_body:      ['诶', '别乱戳啦', '痒痒的', '喂——'],
  pet_tail:      ['别碰尾巴！', '那是人家的尾鳍啦', '呀！'],
  pet_repeat:    ['好啦好啦', '主人很喜欢戳人家吗', '人家又不是按钮'],

  // --- being handled
  grabbed:       ['诶诶诶！', '放人家下来啦', '好高……', '哇啊'],
  dropped_soft:  ['唔', '过分', '人、人家是故意的'],
  dropped_hard:  ['好痛！', '真的很痛啦', '主人干嘛啦'],

  // --- her own state
  bored:         ['好无聊哦', '没事做……', '陪人家玩嘛', '唔……'],
  lonely:        ['主人？', '有人在吗', '人家还在这里哦'],
  sleepy:        ['困了……', '再睡五分钟', '哈啊……'],
  content:       ['这样就很好', '舒服', '今天不错哦'],
  playful:       ['来抓人家呀', '嘿嘿', '哇——'],
  food:          ['想吃米饭了', '白米饭最好吃', '什么菜都能配米饭的'],
  not_fat:       ['这是浮力！', '才、才不是胖', '鲸鱼都这样的啦'],

  // --- noticing you
  cursor_near:   ['嗯？', '干嘛啦', '有什么事吗'],
  you_are_busy:  ['主人在忙吗', '那人家不吵你', '工作辛苦啦'],
  late_night:    ['很晚了哦', '主人该睡了', '还不睡吗'],
};

export const LINES_EN = {
  greet_short:   ['oh, hello', 'back already?', 'hi', 'there you are'],
  greet_medium:  ['you were gone a while', 'welcome back', 'I kept your seat warm', 'hi, I missed you a bit'],
  greet_long:    ['you were gone AGES', 'I thought you had forgotten about me', 'finally! where were you?', 'I waited'],
  greet_firstToday: ['morning', 'hello again', 'good to see you'],
  pet_head:      ['ehehe', 'that is nice', 'more please', 'mm'],
  pet_body:      ['hey', 'careful', 'hehe', 'that tickles'],
  pet_tail:      ['not the tail!', 'hey! that is my tail', 'eep'],
  pet_repeat:    ['okay okay', 'you really like doing that', 'I am not a button'],
  grabbed:       ['wh- hey!', 'put me down', 'aaah', 'this is very high up'],
  dropped_soft:  ['oof', 'rude', 'I meant to do that'],
  dropped_hard:  ['OW', 'that HURT', 'why would you do that'],
  bored:         ['I am bored', 'nothing to do', 'entertain me', 'hmm'],
  lonely:        ['are you there?', 'hello?', 'I am still here you know'],
  sleepy:        ['I am sleepy', 'five more minutes', 'yawn'],
  content:       ['this is nice', 'comfy', 'good day'],
  playful:       ['catch me', 'hehe', 'wheee'],
  food:          ['I want rice', 'rice goes with everything', 'thinking about rice'],
  not_fat:       ['it is BUOYANCY', 'I am not fat', 'whales are just like this'],
  cursor_near:   ['hm?', 'yes?', 'what is it?'],
  you_are_busy:  ['you look busy', 'do not mind me', 'working hard?'],
  late_night:    ['it is late', 'you should sleep', 'still up?'],
};

// The default set, and what the tests read.
export const LINES = LINES_ZH;

// How long a line stays on screen, by length: short quips vanish, longer lines linger.
export const readTime = (text) => Math.min(6, 1.6 + text.length * 0.055);

export function createVoice(opts = {}) {
  return {
    lines: opts.lang === 'en' ? LINES_EN : LINES_ZH,
    rng: opts.random || Math.random,
    recent: [],            // things she said lately, so she does not loop
    lastSpoke: -1e9,
    minGap: opts.minGap ?? 12,       // seconds of silence between unprompted lines
    petStreak: 0,
    said: 0,
  };
}

function pickFrom(v, pool) {
  const fresh = pool.filter((l) => !v.recent.includes(l));
  const from = fresh.length ? fresh : pool;
  const line = from[Math.floor(v.rng() * from.length)];
  v.recent = [line, ...v.recent].slice(0, 8);
  return line;
}

// Something happened to her and she should respond right away. Always allowed to interrupt her silence.
export function react(v, t, event, info = {}) {
  let pool = null;
  if (event === 'pet') {
    v.petStreak = t - (v.lastPet ?? -99) < 4 ? v.petStreak + 1 : 1;
    v.lastPet = t;
    const L = v.lines;
    pool = v.petStreak >= 4 ? L.pet_repeat
      : info.zone === 'head' || info.zone === 'hair' ? L.pet_head
        : info.zone === 'tail' ? L.pet_tail : L.pet_body;
  } else if (event === 'grab') pool = v.lines.grabbed;
  else if (event === 'drop') pool = (info.impact || 0) > 5 ? v.lines.dropped_hard : v.lines.dropped_soft;
  else if (event === 'greet') {
    const away = info.awaySeconds ?? 0;
    const L = v.lines;
    pool = away > 6 * 3600 ? L.greet_long : away > 900 ? L.greet_medium : away > 60 ? L.greet_short : L.greet_firstToday;
  }
  if (!pool) return null;
  v.lastSpoke = t;
  v.said++;
  return pickFrom(v, pool);
}

// She is not reacting to anything; should she say something unprompted? Usually the answer is no.
export function idleLine(v, t, mind, ctx = {}, force = false) {
  if (!force && t - v.lastSpoke < v.minGap) return null;
  const n = mind.needs, L = v.lines;
  let pool = null;
  if (ctx.hourOfDay != null && (ctx.hourOfDay >= 1 && ctx.hourOfDay < 5)) pool = L.late_night;
  else if (mind.mood === 'sleepy') pool = L.sleepy;
  else if (n.company < 0.2) pool = L.lonely;
  else if (n.play < 0.25) pool = L.bored;
  else if (ctx.cursorNear) pool = L.cursor_near;
  else if (ctx.userIdleSeconds != null && ctx.userIdleSeconds < 5 && n.company > 0.5) pool = L.you_are_busy;
  else if (n.company > 0.7 && n.rest > 0.5) pool = v.rng() < 0.25 ? L.food : L.content;   // rice is a fixation
  else if (n.play > 0.7) pool = L.playful;
  // she chose to speak, so she says SOMETHING: falling back to a greeting mid-session made her say "morning"
  // half an hour in, which is exactly the kind of detail that breaks the illusion.
  if (!pool && force) pool = L.content;
  if (!pool) return null;
  v.lastSpoke = t;
  v.said++;
  return pickFrom(v, pool);
}

// An outside brain may put words in her mouth. Kept short and cleaned so a model cannot paste an essay onto
// the desktop, and rejected outright if it comes back empty.
export function speak(v, t, text) {
  if (typeof text !== 'string') return null;
  const line = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!line) return null;
  v.lastSpoke = t;
  v.said++;
  v.recent = [line, ...v.recent].slice(0, 8);
  return line;
}
