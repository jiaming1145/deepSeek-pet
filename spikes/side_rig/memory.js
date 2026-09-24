// What she remembers between runs.
//
// Close the pet and open it tomorrow and she should not be a blank slate: she should know roughly how long you
// were gone, that she has met you before, and how much you tend to fuss over her. That is the difference between
// a program that starts up and a character that comes back.
//
// The store is a single small JSON blob. This file is pure logic over that blob so it can be tested headlessly;
// the actual reading and writing of the file happens in the Electron main process, through the preload bridge.

export const CURRENT_VERSION = 1;

export function blank() {
  return {
    version: CURRENT_VERSION,
    firstMet: null,          // ms since epoch, the first time she was ever run
    lastSeen: null,          // ms since epoch, when she was last closed
    sessions: 0,
    totalPets: 0,
    totalThrows: 0,
    secondsTogether: 0,
    needs: null,             // her needs at shutdown, so a nap is not undone by a restart
  };
}

// Merge whatever was on disk with the defaults, tolerating a missing, truncated or older file. She must always
// start, so anything unreadable degrades to a fresh memory rather than an error.
// `raw` may be the parsed object or the file's text. Passing the text is better: `null` then means "no file", and
// an empty or garbled file is recognisably DAMAGED rather than indistinguishable from a first launch. A damaged
// memory is flagged (`damaged: true`) so she does not greet an old friend as a stranger, and so the caller can
// keep the bad file aside before the next save overwrites it.
const COUNTS = ['sessions', 'totalPets', 'totalThrows', 'secondsTogether'];
const STAMPS = ['firstMet', 'lastSeen'];
export function load(raw) {
  const m = blank();
  if (raw == null) return m;                                   // nothing on disk: genuinely the first launch
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { raw = undefined; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { m.damaged = true; return m; }
  // field by field, so one bad value costs that value and not the whole history
  for (const k of STAMPS) if (Number.isFinite(raw[k]) && raw[k] > 0) m[k] = raw[k]; else if (raw[k] != null) m.damaged = true;
  for (const k of COUNTS) if (Number.isFinite(raw[k]) && raw[k] >= 0) m[k] = raw[k]; else if (raw[k] != null) m.damaged = true;
  if (raw.needs && typeof raw.needs === 'object') {
    const needs = {};
    for (const [k, v] of Object.entries(raw.needs)) if (Number.isFinite(v)) needs[k] = Math.min(1, Math.max(0, v));
    m.needs = Object.keys(needs).length ? needs : null;
  }
  if (!m.firstMet && (m.sessions > 0 || m.lastSeen)) m.damaged = true;   // she has been run before, but lost the date
  return m;
}

// How long she was away, and what that should do to her. Being switched off is not the same as being ignored:
// she comes back rested, but company drains while she is gone, and after a very long absence she has settled.
// `firstTime` is true only when there is no sign she has ever met you: not merely a session count of one, which a
// damaged file also produces.
export function resume(mem, now, mind) {
  const away = mem.lastSeen ? Math.max(0, (now - mem.lastSeen) / 1000) : 0;
  const firstTime = !mem.firstMet && !mem.damaged;
  mem.sessions += 1;
  if (!mem.firstMet) mem.firstMet = now;
  if (mind && mem.needs) {
    mind.needs = { ...mind.needs, ...mem.needs };
    mind.needs.rest = Math.min(1, mind.needs.rest + Math.min(1, away / 3600));   // she rested while off
    mind.needs.company = Math.max(0, mind.needs.company - Math.min(0.9, away / 1800));
    mind.needs.safety = 1;                                                       // nothing frightened her while off
    mind.needs.play = Math.max(0, mind.needs.play - Math.min(0.5, away / 7200));
  }
  return { awaySeconds: away, firstTime, damaged: !!mem.damaged, daysKnown: mem.firstMet ? (now - mem.firstMet) / 86400000 : 0 };
}

export function record(mem, event, info = {}) {
  if (event === 'pet') mem.totalPets += 1;
  else if (event === 'drop' && (info.impact || 0) > 5) mem.totalThrows += 1;
  return mem;
}

export function snapshot(mem, now, mind, sessionSeconds) {
  mem.lastSeen = now;
  mem.secondsTogether = Math.round((mem.secondsTogether || 0) + (sessionSeconds || 0));
  if (mind) mem.needs = { ...mind.needs };
  return mem;
}

// A short, human description of your history together, suitable for a prompt or an about box.
export function describe(mem, now) {
  if (!mem.firstMet) return 'you have only just met';
  const days = Math.floor((now - mem.firstMet) / 86400000);
  const hours = Math.floor((mem.secondsTogether || 0) / 3600);
  const bits = [];
  bits.push(days < 1 ? 'you met her today' : days === 1 ? 'you met her yesterday' : `you have known her ${days} days`);
  bits.push(`${mem.sessions} time${mem.sessions === 1 ? '' : 's'} together`);
  if (hours >= 1) bits.push(`about ${hours} hour${hours === 1 ? '' : 's'} in her company`);
  if (mem.totalPets) bits.push(`${mem.totalPets} pats`);
  if (mem.totalThrows) bits.push(`${mem.totalThrows} thrown across the screen`);
  return bits.join(', ');
}
