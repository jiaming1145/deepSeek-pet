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
export function load(raw) {
  const m = blank();
  if (!raw || typeof raw !== 'object') return m;
  for (const k of Object.keys(m)) if (raw[k] != null) m[k] = raw[k];
  m.version = CURRENT_VERSION;
  if (m.needs && typeof m.needs !== 'object') m.needs = null;
  return m;
}

// How long she was away, and what that should do to her. Being switched off is not the same as being ignored:
// she comes back rested, but company drains while she is gone, and after a very long absence she has settled.
export function resume(mem, now, mind) {
  const away = mem.lastSeen ? Math.max(0, (now - mem.lastSeen) / 1000) : 0;
  mem.sessions += 1;
  if (!mem.firstMet) mem.firstMet = now;
  if (mind && mem.needs) {
    mind.needs = { ...mind.needs, ...mem.needs };
    mind.needs.rest = Math.min(1, mind.needs.rest + Math.min(1, away / 3600));   // she rested while off
    mind.needs.company = Math.max(0, mind.needs.company - Math.min(0.9, away / 1800));
    mind.needs.safety = 1;                                                       // nothing frightened her while off
    mind.needs.play = Math.max(0, mind.needs.play - Math.min(0.5, away / 7200));
  }
  return { awaySeconds: away, firstTime: mem.sessions === 1, daysKnown: mem.firstMet ? (now - mem.firstMet) / 86400000 : 0 };
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
