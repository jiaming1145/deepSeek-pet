// What she says, and when.
//
// A desktop pet that only animates is a toy. One that says the right small thing at the right moment reads as
// aware. This file holds the words and the rule for choosing them; it knows nothing about drawing or windows.
//
// Lines are grouped by situation. The chooser prefers the most specific situation that applies, never repeats
// something she said recently, and stays quiet unless she has a reason to speak - a pet that talks constantly
// is worse than one that never does. If a language model is connected it can put a line in her mouth instead
// (see `say()` in brain.js); everything here is the floor she never drops below, offline and free.

// {name} is replaced with what she calls you.
export const LINES = {
  // --- greeting, weighted by how long you were gone
  greet_short:   ['oh, hello', 'back already?', 'hi', 'there you are'],
  greet_medium:  ['you were gone a while', 'welcome back', 'I kept your seat warm', 'hi, I missed you a bit'],
  greet_long:    ['you were gone AGES', 'I thought you had forgotten about me', 'finally! where were you?', 'I waited'],
  greet_firstToday: ['morning', 'hello again', 'good to see you'],

  // --- being touched
  pet_head:      ['ehehe', 'that is nice', 'more please', 'mm'],
  pet_body:      ['hey', 'careful', 'hehe', 'that tickles'],
  pet_tail:      ['not the tail!', 'hey! that is my tail', 'eep'],
  pet_repeat:    ['okay okay', 'you really like doing that', 'I am not a button'],

  // --- being handled
  grabbed:       ['wh- hey!', 'put me down', 'aaah', 'this is very high up'],
  dropped_soft:  ['oof', 'rude', 'I meant to do that'],
  dropped_hard:  ['OW', 'that HURT', 'why would you do that'],

  // --- her own state
  bored:         ['I am bored', 'nothing to do', 'entertain me', 'hmm'],
  lonely:        ['are you there?', 'hello?', 'I am still here you know'],
  sleepy:        ['I am sleepy', 'five more minutes', 'yawn'],
  content:       ['this is nice', 'comfy', 'good day'],
  playful:       ['catch me', 'hehe', 'wheee'],

  // --- noticing you
  cursor_near:   ['hm?', 'yes?', 'what is it?'],
  you_are_busy:  ['you look busy', 'do not mind me', 'working hard?'],
  late_night:    ['it is late', 'you should sleep', 'still up?'],
};

// How long a line stays on screen, by length: short quips vanish, longer lines linger.
export const readTime = (text) => Math.min(6, 1.6 + text.length * 0.055);

export function createVoice(opts = {}) {
  return {
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
    pool = v.petStreak >= 4 ? LINES.pet_repeat
      : info.zone === 'head' || info.zone === 'hair' ? LINES.pet_head
        : info.zone === 'tail' ? LINES.pet_tail : LINES.pet_body;
  } else if (event === 'grab') pool = LINES.grabbed;
  else if (event === 'drop') pool = (info.impact || 0) > 5 ? LINES.dropped_hard : LINES.dropped_soft;
  else if (event === 'greet') {
    const away = info.awaySeconds ?? 0;
    pool = away > 6 * 3600 ? LINES.greet_long : away > 900 ? LINES.greet_medium : away > 60 ? LINES.greet_short : LINES.greet_firstToday;
  }
  if (!pool) return null;
  v.lastSpoke = t;
  v.said++;
  return pickFrom(v, pool);
}

// She is not reacting to anything; should she say something unprompted? Usually the answer is no.
export function idleLine(v, t, mind, ctx = {}, force = false) {
  if (!force && t - v.lastSpoke < v.minGap) return null;
  const n = mind.needs;
  let pool = null;
  if (ctx.hourOfDay != null && (ctx.hourOfDay >= 1 && ctx.hourOfDay < 5)) pool = LINES.late_night;
  else if (mind.mood === 'sleepy') pool = LINES.sleepy;
  else if (n.company < 0.2) pool = LINES.lonely;
  else if (n.play < 0.25) pool = LINES.bored;
  else if (ctx.cursorNear) pool = LINES.cursor_near;
  else if (ctx.userIdleSeconds != null && ctx.userIdleSeconds < 5 && n.company > 0.5) pool = LINES.you_are_busy;
  else if (n.company > 0.7 && n.rest > 0.5) pool = LINES.content;
  else if (n.play > 0.7) pool = LINES.playful;
  // she chose to speak, so she says SOMETHING: falling back to a greeting mid-session made her say "morning"
  // half an hour in, which is exactly the kind of detail that breaks the illusion.
  if (!pool && force) pool = LINES.content;
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
