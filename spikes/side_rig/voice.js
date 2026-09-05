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
  greet_short:   ['（抬起头）哦，回来啦', '（尾鳍拍了下水）这么快就回来了', '（别过脸去）哼，来了啊', '（小声）在呢在呢'],
  greet_medium:  ['（鼓着腮帮子）人家等你好久了', '（尾巴轻轻摇）欢迎回来，主人', '（撇过头）才、才不是在等你', '（眼睛一亮）你终于回来了'],
  greet_long:    ['（叉着腰）你跑哪儿去了啦', '（小声嘀咕）还以为主人把人家忘了', '（吸了吸鼻子）这么久才回来……', '（打了个哈欠）本鲸都快睡着了'],
  greet_firstToday: ['（揉揉眼睛）主人早', '（尾鳍拍拍水）又见面了', '（歪着头笑）今天也要好好的哦'],

  // --- being touched
  pet_head:      ['（眯起眼睛）唔……', '（把头凑过去）再摸一下嘛', '（尾巴摇个不停）好舒服哦', '（红着脸别开）哼、勉强让你摸'],
  pet_body:      ['（缩了一下）诶', '（拍开你的手）别乱戳啦', '（笑出声）痒痒的', '（鼓起腮帮子）喂——'],
  pet_tail:      ['（尾巴猛地一收）别碰尾巴！', '（炸毛）那是人家的尾鳍啦', '（跳起来）呀！'],
  pet_repeat:    ['（无奈地垂下尾巴）好啦好啦', '（斜眼看你）主人很喜欢戳人家吗', '（叉腰）人家又不是按钮'],

  // --- being handled
  grabbed:       ['（四肢乱蹬）诶诶诶！', '（拍打你的手）放人家下来啦', '（往下看，脸都白了）好高……', '（尾巴僵住）哇啊'],
  dropped_soft:  ['（揉着屁股）唔', '（瞪你一眼）过分', '（假装拍拍身上）人、人家是故意的'],
  dropped_hard:  ['（眼眶红了）好痛！', '（捂着头）真的很痛啦', '（尾巴都不摇了）主人干嘛啦'],

  // --- her own state
  bored:         ['（趴在地上）好无聊哦', '（用尾巴戳地板）没事做……', '（拽你的袖子）陪人家玩嘛', '（吐了个泡泡）唔……'],
  lonely:        ['（四处张望）主人？', '（小声）有人在吗', '（晃了晃尾鳍）人家还在这里哦'],
  sleepy:        ['（揉眼睛）困了……', '（把脸埋进尾巴）再睡五分钟', '（打哈欠）哈啊……'],
  content:       ['（尾巴慢慢摇）这样就很好', '（眯着眼）舒服', '（哼着小调）今天不错哦'],
  playful:       ['（转着圈）来抓人家呀', '（吐泡泡）嘿嘿', '（尾鳍啪啪拍水）哇——'],
  food:          ['（眼睛发亮）想吃米饭了', '（舔了下嘴角）白米饭最好吃', '（认真点头）什么菜都能配米饭的'],
  not_fat:       ['（炸毛）这是浮力！', '（鼓起腮帮子）才、才不是胖', '（挺起胸）鲸鱼都这样的啦'],

  // --- noticing you
  cursor_near:   ['（抬起头）嗯？', '（歪着头）干嘛啦', '（眨眨眼）有什么事吗'],
  you_are_busy:  ['（探头看屏幕）主人在忙吗', '（放轻声音）那人家不吵你', '（小声）工作辛苦啦'],
  late_night:    ['（揉着眼睛）很晚了哦', '（拽拽你袖子）主人该睡了', '（担心地看你）还不睡吗'],
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
