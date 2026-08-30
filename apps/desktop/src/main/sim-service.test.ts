import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels, SimSnapshotSchema } from '@ds/protocol';
import { getKv, openDb, setKv } from '@ds/memory';
import { SIM_DEFAULTS, SIM_SNAPSHOT_VERSION, SimPersistedSchema } from '@ds/sim';
import type { ActivityDerived, ActivitySample, ActivitySensor } from './activity-sensor';

const sent = vi.fn<(win: unknown, channel: string, payload: unknown) => void>();
vi.mock('electron', () => ({ BrowserWindow: class {} }));
vi.mock('./ipc', () => ({ sendTo: (w: unknown, c: string, p: unknown) => sent(w, c, p) }));

const {
  KV_SIM_AFFECTION, KV_SIM_DAYS_SEEN, KV_SIM_LIVELINESS, KV_SIM_PROACTIVE_MUTED, KV_SIM_SNAPSHOT,
  ON_FLOOR_TOLERANCE_DIP, SimService,
} = await import('./sim-service');

const PET = { id: 'pet' } as never;
const BUBBLE = { id: 'bubble' } as never;
const WORK = { x: 0, y: 0, width: 2560, height: 1400 };
/** 2025-03-10 14:00 local — a 'day' phase, far from any meal cue or midnight. */
const WALL0 = new Date(2025, 2, 10, 14, 0, 0).getTime();

function fakeSensor(): ActivitySensor & { sample: ActivitySample; derived: ActivityDerived; fireWiggle(): void } {
  const wiggleSubs = new Set<() => void>();
  return {
    sample: { inputAgeMs: 1_000, cursor: { x: 2000, y: 1300 }, cursorDeltaDip: 0, dnd: false, battery: { charging: true, level: null }, tsMono: 0 },
    derived: { probableTyping: false, typingStreakStartedMono: null, typingFellAtMono: null, wiggle: false, healthy: true },
    start() {}, stop() {},
    onInput: () => () => {}, onForegroundChanged: () => () => {}, onDndChanged: () => () => {}, onBattery: () => () => {},
    // R3-36 / A3-2: the predicate itself is activity-sensor.test.ts's; here we only need the edge.
    onWiggle(cb) { wiggleSubs.add(cb); return () => { wiggleSubs.delete(cb); }; },
    fireWiggle() { for (const cb of wiggleSubs) cb(); },
  };
}

let dir: string;
let db: DatabaseSync;
let mono = 10_000;
let wall = WALL0;
const clock = { nowMono: () => mono, nowWall: () => wall };
/**
 * Moves BOTH clocks and the fake timers together — the only shape production can ever be in.
 *
 * FIX ROUND 1, finding 3: the two coalescing cases below used to run their "no send" tail on a
 * mono-only helper that froze the wall clock, because `SimSnapshot.energy` moves continuously with
 * it and defeated the exact field-by-field guard on every tick. A frozen wall clock is a state
 * production cannot reach, so the guard was never actually exercised. It now compares `energy`
 * (and `valence`/`arousal`) at broadcast resolution (`BROADCAST_QUANTUM`, sim-service.ts), so both
 * tails run on the real `advance()` again and exercise the production path.
 */
const advance = (ms: number): void => { mono += ms; wall += ms; vi.advanceTimersByTime(ms); };

function make(o: { sensor?: ActivitySensor; petBounds?: () => typeof WORK; trace?: (r: Record<string, unknown>) => void } = {}) {
  return new SimService({
    pet: PET, bubble: BUBBLE, db,
    sensor: o.sensor ?? fakeSensor(),
    petBounds: o.petBounds ?? (() => ({ x: 2000, y: 1100, width: 300, height: 300 })),   // on the floor
    workArea: () => WORK,
    ...clock, seed: 7, trace: o.trace,
  });
}
const stateSends = () => sent.mock.calls.filter((c) => c[1] === Channels.simState);
const eventSends = () => sent.mock.calls.filter((c) => c[1] === Channels.simEvent);

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'ds-sim-'));
  db = openDb(join(dir, 'ds.sqlite'));
  mono = 10_000; wall = WALL0;
  sent.mockReset();
});
afterEach(() => { vi.useRealTimers(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('SimService.start — restore', () => {
  it('starts from initialSimState with no kv, sends one sim:state to pet AND bubble, owns one timer', () => {
    const sim = make();
    sim.start();
    expect(vi.getTimerCount()).toBe(1);
    const s = sim.snapshot();
    expect(SimSnapshotSchema.safeParse(s).success).toBe(true);
    expect(s.liveliness).toBe(SIM_DEFAULTS.LIVELINESS_DEFAULT);
    expect(s.phase).toBe('day');
    expect(stateSends().map((c) => c[0])).toEqual([PET, BUBBLE]);
    return sim.dispose();
  });

  it('restores a valid snapshot with monotonic rebase (first tick integrates 0 downtime)', async () => {
    const a = make();
    a.start();
    a.dispatch({ type: 'TOUCH', part: 'head', annoyed: false });   // affection 0.5, arousal nudge
    advance(SIM_DEFAULTS.TICK_MS * 4);
    const before = a.snapshot();
    await a.dispose();
    expect(getKv(db, KV_SIM_SNAPSHOT)).not.toBeNull();
    expect(getKv(db, KV_SIM_AFFECTION)).toBe(String(before.affection));

    mono += 3 * 3_600_000;                     // 3 h of downtime on the monotonic clock only
    const b = make();
    b.start();
    advance(SIM_DEFAULTS.TICK_MS);
    const after = b.snapshot();
    expect(after.affection).toBe(before.affection);
    // R3-51 DERIVATION: `after` carries ONE extra 500 ms PRESENT tick of mood decay that `before`
    // does not (b.start() is followed by advance(TICK_MS)). With MOOD_HALF_LIFE_PRESENT_MS =
    // 3 000 000 and the TOUCH having lifted valence ~0.02 above VALENCE_BASE, that tick is worth
    // 0.02 * (1 - 2^(-500/3e6)) ~= 2.3e-6 — inside precision 5 (5e-6) and outside the plan's
    // over-tight 6 (5e-7). The 3 h of monotonic downtime itself still integrates exactly 0, which
    // is what this case exists to prove; Step 22's twin case uses precision 4 for the same reason.
    expect(after.valence).toBeCloseTo(before.valence, 5);
    expect(after.arousal).toBeCloseTo(before.arousal, 5);
    await b.dispose();
  });

  it('discards a version-mismatched snapshot with one warn and reads the two scalar mirrors back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setKv(db, KV_SIM_SNAPSHOT, JSON.stringify({ version: SIM_SNAPSHOT_VERSION + 1 }));
    setKv(db, KV_SIM_AFFECTION, '42.5');
    setKv(db, KV_SIM_DAYS_SEEN, '9');
    const sim = make();
    sim.start();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[sim] snapshot discarded:');
    expect(sim.snapshot().affection).toBe(42.5);   // 9 days -> floor 30 < 42.5, raw wins
    await sim.dispose();
    expect(getKv(db, KV_SIM_DAYS_SEEN)).toBe('9');
  });

  it('discards unparsable JSON and out-of-range mirrors without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setKv(db, KV_SIM_SNAPSHOT, '{not json');
    setKv(db, KV_SIM_AFFECTION, '999');
    setKv(db, KV_SIM_DAYS_SEEN, '-3');
    const sim = make();
    sim.start();
    expect(sim.snapshot().affection).toBe(0);
    await sim.dispose();
  });

  it('restores sim_liveliness (clamped) and sim_proactive_muted', async () => {
    setKv(db, KV_SIM_LIVELINESS, '0.7');
    setKv(db, KV_SIM_PROACTIVE_MUTED, String(WALL0 + 3_600_000));
    const sim = make();
    sim.start();
    expect(sim.liveliness).toBe(0.7);
    expect(sim.snapshot().liveliness).toBe(0.7);
    await sim.dispose();
    const p = SimPersistedSchema.parse(JSON.parse(getKv(db, KV_SIM_SNAPSHOT)!));
    expect(p.state.gate.mutedUntilWall).toBe(WALL0 + 3_600_000);

    setKv(db, KV_SIM_LIVELINESS, '4');
    const c = make();
    c.start();
    expect(c.liveliness).toBe(1);
    await c.dispose();
  });

  it('3 h of wall AND monotonic downtime changes neither mood nor energy expenditure on restore', async () => {
    const a = make();
    a.start();
    for (let i = 0; i < 20; i++) { a.dispatch({ type: 'EMOTION', emotion: 'happy' }); }
    advance(SIM_DEFAULTS.TICK_MS * 4);
    const before = a.snapshot();
    await a.dispose();
    mono += 3 * 3_600_000; wall += 3 * 3_600_000;
    const b = make();
    b.start();
    advance(SIM_DEFAULTS.TICK_MS);
    const after = b.snapshot();
    // R3-51 DERIVATION. The plan's precision 4 (5e-5) is too tight for a valence the 20 `happy`
    // nudges have pinned at the +1 clamp: mood.ts decays as `base + (x - base) * exp(-ln2*dt/hl)`
    // with base = VALENCE_BASE (0.10) and hl = MOOD_HALF_LIFE_PRESENT_MS, so b's single 500 ms
    // PRESENT tick is worth (1 - 0.10) * (1 - exp(-ln2 * 500 / 3e6)) ~= 1.04e-4. Precision 3 covers
    // it, and the second assertion is the decisive one: had ANY of the 3 h been integrated the
    // delta would be (0.9) * (1 - exp(-ln2 * 10 800 000 / 3e6)) ~= 0.83 — four orders of magnitude
    // over the one-tick bound. `fromPersisted` rebasing lastMono to nowMono is what makes it 0.
    expect(after.valence).toBeCloseTo(before.valence, 3);
    const oneTickDecay = (before.valence - SIM_DEFAULTS.VALENCE_BASE)
      * (1 - Math.exp(-Math.LN2 * SIM_DEFAULTS.TICK_MS / SIM_DEFAULTS.MOOD_HALF_LIFE_PRESENT_MS));
    expect(before.valence - after.valence).toBeLessThanOrEqual(oneTickDecay * 1.01);
    expect(after.affection).toBe(before.affection);
    await b.dispose();
  });
});

describe('dispatch / broadcast policy (§2.3, §3.11)', () => {
  it('sim:event is sent immediately, un-coalesced, to the pet only', () => {
    const sensor = fakeSensor();
    sensor.sample.inputAgeMs = 400_000;          // > PRESENT_INPUT_MAX_MS: idle-present
    const sim = make({ sensor });
    sim.start();
    advance(SIM_DEFAULTS.TICK_MS);
    expect(sim.snapshot().presence).toBe('idle-present');
    sent.mockReset();
    sim.dispatch({ type: 'USER_INPUT' });
    const ev = eventSends();
    expect(ev).toHaveLength(1);
    expect(ev[0][0]).toBe(PET);
    expect(ev[0][2]).toMatchObject({ kind: 'returned' });
    return sim.dispose();
  });

  it('coalesces sim:state to <= 1 send per TICK_MS and only when a field changed', () => {
    const sim = make();
    sim.start();
    sent.mockReset();
    sim.dispatch({ type: 'LIVELINESS', value: 0.5 });
    sim.dispatch({ type: 'LIVELINESS', value: 0.6 });
    sim.dispatch({ type: 'LIVELINESS', value: 0.7 });
    expect(stateSends().filter((c) => c[0] === PET)).toHaveLength(0);   // within TICK_MS of the start send
    advance(SIM_DEFAULTS.TICK_MS);
    const pet = stateSends().filter((c) => c[0] === PET);
    expect(pet).toHaveLength(1);
    expect((pet[0][2] as { liveliness: number }).liveliness).toBe(0.7);
    sent.mockReset();
    // FIX ROUND 1, finding 3: real time, BOTH clocks. Over these 2 s `energy` slides
    // 5/3600 * 2 = 0.0028 down from 73.0 — inside the 0.1 broadcast quantum — and nothing else in
    // the subset moves, so the guard suppresses all four ticks.
    advance(SIM_DEFAULTS.TICK_MS * 4);            // nothing but tsMain changes: no send
    expect(stateSends()).toHaveLength(0);
    return sim.dispose();
  });

  // FIX ROUND 1, finding 3: the twin of the suppression tail above. The broadcast quantum is a
  // RESOLUTION, not a mute — a real energy slide still reaches both windows. Over 5 min of wall
  // time between the 13:00 (78) and 15:00 (68) circadian anchors energy falls 5/12 = 0.417, four
  // quanta, so a handful of sends get through; the point is that it is a handful and not the 600
  // ticks that an exact field-by-field comparison would have sent.
  it('a real energy change still sends: the quantum is a resolution, not a mute', () => {
    const sim = make();
    sim.start();
    sent.mockReset();
    advance(60_000 * 5);
    const sends = stateSends().filter((c) => c[0] === PET).length;
    expect(sends).toBeGreaterThan(0);
    expect(sends).toBeLessThan(10);
    return sim.dispose();
  });

  it('resend() sends the current snapshot unconditionally (stage:ready)', () => {
    const sim = make();
    sim.start();
    sent.mockReset();
    sim.resend();
    expect(stateSends().map((c) => c[0])).toEqual([PET, BUBBLE]);
    return sim.dispose();
  });

  it('TICK carries cursorNear / onFloor / nearEdge derived from petBounds and workArea', () => {
    const sensor = fakeSensor();
    // R3-51 DERIVATION (the plan's generated case put the cursor 400 DIP BELOW the pet rect, where
    // no x-coordinate can satisfy the predicate). §3.3 / contract line 640: `cursorNear` is
    // "within CURSOR_NEAR_DIP of the pet window RECT" — a 2-D distance to the rectangle, not to its
    // x-span. With petBounds y 500…800, a cursor at y = 1200 is already 400 DIP away, so
    // hypot(dx, 400) > 160 for every dx. Putting the cursor at the rect's vertical mid-line
    // (y = 650, dy = 0) makes the distance exactly |dx| and pins the intended x boundary:
    //   x = 2000 - 160 - 1 -> dx = 161 > 160 -> false;  x = 2000 - 160 -> dx = 160 <= 160 -> true.
    sensor.sample.cursor = { x: 2000 - SIM_DEFAULTS.CURSOR_NEAR_DIP - 1, y: 650 };
    const sim = make({ sensor, petBounds: () => ({ x: 2000, y: 500, width: 300, height: 300 }) });
    sim.start();
    advance(SIM_DEFAULTS.TICK_MS);
    let s = sim.snapshot();
    expect(s.cursorNear).toBe(false);
    expect(s.onFloor).toBe(false);
    expect(s.nearEdge).toBe(false);
    sensor.sample.cursor = { x: 2000 - SIM_DEFAULTS.CURSOR_NEAR_DIP, y: 650 };
    advance(SIM_DEFAULTS.TICK_MS);
    expect(sim.snapshot().cursorNear).toBe(true);
    return sim.dispose().then(() => {
      const t = make({ petBounds: () => ({ x: WORK.width - 300 - SIM_DEFAULTS.NEAR_EDGE_DIP, y: WORK.height - 300 - ON_FLOOR_TOLERANCE_DIP, width: 300, height: 300 }) });
      t.start();
      advance(SIM_DEFAULTS.TICK_MS);
      s = t.snapshot();
      expect(s.onFloor).toBe(true);
      expect(s.nearEdge).toBe(true);
      return t.dispose();
    });
  });

  it('forwards the reducer typingGlance on the rising edge of probableTyping (A22, §13.1 item 1)', () => {
    const sensor = fakeSensor();
    sensor.sample.inputAgeMs = 200;
    sensor.sample.cursorDeltaDip = 0;
    const sim = make({ sensor });
    sim.start();
    sent.mockReset();
    advance(SIM_DEFAULTS.TICK_MS * SIM_DEFAULTS.TYPING_ENTER_SAMPLES);
    const glances = eventSends().filter((c) => (c[2] as { kind: string }).kind === 'typingGlance');
    expect(glances).toHaveLength(1);
    expect(sim.snapshot().probableTyping).toBe(true);
    advance(SIM_DEFAULTS.TICK_MS * 10);          // still typing: no second glance
    expect(eventSends().filter((c) => (c[2] as { kind: string }).kind === 'typingGlance')).toHaveLength(1);
    return sim.dispose();
  });

  // R3-36 / A3-2: the predicate lives in the sensor and changes NO reducer state, so SimService is a
  // pure fan-out — one `sim:event {kind:'cursorWiggle'}` to the pet, immediately, un-coalesced, and
  // nothing to the bubble. The 240 DIP radius, the 10 Hz ring and the 20 s cooldown are the
  // sensor's, pinned in `activity-sensor.test.ts`; this pins only that the edge reaches the pet by
  // the exact name Task 13's arbiter switches on.
  it('relays the sensor wiggle to sim:event {kind: cursorWiggle} on the pet, and unsubscribes on dispose', async () => {
    const sensor = fakeSensor();
    const sim = make({ sensor });
    sim.start();
    sent.mockReset();
    sensor.fireWiggle();
    const wiggles = eventSends().filter((c) => (c[2] as { kind: string }).kind === 'cursorWiggle');
    expect(wiggles).toHaveLength(1);
    expect(wiggles[0][0]).toBe(PET);
    expect(wiggles[0][2]).toMatchObject({ kind: 'cursorWiggle', tsMain: mono });
    expect(stateSends()).toHaveLength(0);        // a wiggle is not a state change
    await sim.dispose();
    sent.mockReset();
    sensor.fireWiggle();
    expect(eventSends()).toHaveLength(0);
  });

  // R3-35 / A3-1: `uiWorkMode` / `uiSfxMuted` are NOT reducer state — the tray writes the kv keys and
  // index.ts (Task 15) hands the pair here, so §5.9's fade and §5.12's mute become reachable in the
  // pet renderer. They ride the existing snapshot, so no channel is added.
  it('setUiFlags puts the two tray booleans on the next sim:state; an unchanged pair broadcasts nothing', () => {
    const sim = make();
    sim.start();
    expect(sim.snapshot().uiWorkMode).toBe(false);
    expect(sim.snapshot().uiSfxMuted).toBe(false);
    sent.mockReset();
    sim.setUiFlags({ workMode: true, sfxMuted: true });
    advance(SIM_DEFAULTS.TICK_MS);
    const pet = stateSends().filter((c) => c[0] === PET);
    expect(pet).toHaveLength(1);
    expect(pet[0][2]).toMatchObject({ uiWorkMode: true, uiSfxMuted: true });
    expect(SimSnapshotSchema.safeParse(pet[0][2]).success).toBe(true);
    sent.mockReset();
    sim.setUiFlags({ workMode: true, sfxMuted: true });   // idempotent
    advance(SIM_DEFAULTS.TICK_MS * 4);                   // FIX ROUND 1, finding 3: real time
    expect(stateSends()).toHaveLength(0);
    return sim.dispose();
  });

  it('a null sensor inputAge is dispatched as 0 (present, conservative)', () => {
    const sensor = fakeSensor();
    sensor.sample.inputAgeMs = null;
    const sim = make({ sensor });
    sim.start();
    advance(SIM_DEFAULTS.TICK_MS);
    expect(sim.snapshot().userIdleS).toBe(0);
    return sim.dispose();
  });

  // FIX ROUND 1, finding 4: the plan's assertion was `cb.mock.calls.length >= 0` — a tautology that
  // passed even if `apply()` stored the callback and never called it, or if the `proactiveEvaluate`
  // branch of `apply()` were deleted. A TICK emits no `proactiveEvaluate` at all (reduce.ts pushes
  // it from UNLOCKED / RESUME / FULLSCREEN-off / DND-off / CHAT_OPEN-off / MODE / TURN_DONE /
  // PROACTIVE_MUTE and from `applyPresence`'s return edge, never from the 2 Hz tick), so the relay
  // is pinned with an event the reducer emits it for UNCONDITIONALLY: PROACTIVE_MUTE (reduce.ts:182).
  it('onProactiveEvaluate relays the reducer effect, and the unsubscribe stops it', () => {
    const sim = make();
    const cb = vi.fn();
    const off = sim.onProactiveEvaluate(cb);
    sim.start();
    advance(SIM_DEFAULTS.TICK_MS * 4);                    // ticks alone must not evaluate
    expect(cb).not.toHaveBeenCalled();
    sim.dispatch({ type: 'PROACTIVE_MUTE', untilWall: null });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    sim.dispatch({ type: 'PROACTIVE_MUTE', untilWall: wall + 3_600_000 });
    expect(cb).toHaveBeenCalledTimes(1);
    return sim.dispose();
  });
});

describe('persist (§3.12)', () => {
  it('writes the snapshot and both mirrors in ONE transaction every 60 s and on dispose', async () => {
    const sim = make();
    sim.start();
    sim.dispatch({ type: 'TOUCH', part: 'head', annoyed: false });
    expect(getKv(db, KV_SIM_SNAPSHOT)).toBeNull();
    advance(60_000);
    const raw = getKv(db, KV_SIM_SNAPSHOT);
    expect(raw).not.toBeNull();
    const p = SimPersistedSchema.parse(JSON.parse(raw!));
    expect(p.version).toBe(SIM_SNAPSHOT_VERSION);
    expect(p.writtenWall).toBe(wall);
    // R3-51 DERIVATION: the mirror is the RAW `state.affection`, and one TOUCH is not the only
    // credit in flight. The first TICK also lifts `distinctDaysSeen` 0 -> 1 and pays
    // AFFECTION_PER_NEW_DAY. So: AFFECTION_PER_TOUCH (0.5) + AFFECTION_PER_NEW_DAY (0.5) = 1 at the
    // 60-s write, and + a second AFFECTION_PER_TOUCH = 1.5 at dispose. The plan's generated 0.5 / 1
    // counted the touches only. Both are far under AFFECTION_DAILY_CAP (12), so nothing is clipped.
    expect(getKv(db, KV_SIM_AFFECTION)).toBe('1');
    expect(getKv(db, KV_SIM_DAYS_SEEN)).toBe(String(p.state.distinctDaysSeen));
    sim.dispatch({ type: 'TOUCH', part: 'head', annoyed: false });
    await sim.dispose();
    expect(getKv(db, KV_SIM_AFFECTION)).toBe('1.5');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failing write rolls back and leaves the previous snapshot intact', async () => {
    const sim = make();
    sim.start();
    advance(60_000);
    const first = getKv(db, KV_SIM_SNAPSHOT);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prepare = db.prepare.bind(db);
    let calls = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      // The mirrors are the 2nd and 3rd statements inside the transaction: fail the 3rd.
      if (sql.startsWith('INSERT OR REPLACE INTO kv') && ++calls === 3) throw new Error('disk full');
      return prepare(sql);
    });
    sim.dispatch({ type: 'TOUCH', part: 'head', annoyed: false });
    advance(60_000);
    expect(warn).toHaveBeenCalledWith('[sim] persist failed:', expect.anything());
    vi.mocked(db.prepare).mockRestore();
    expect(getKv(db, KV_SIM_SNAPSHOT)).toBe(first);
    await sim.dispose();
  });
});

describe('preamble', () => {
  it('formats localTime/weekday like BrainService.state() and carries phrase-ready numbers', () => {
    const sim = make();
    sim.start();
    const p = sim.preamble('刚刚');
    expect(p.localTime).toBe('14:00');
    expect(p.weekday).toBe('周一');
    expect(p.sinceLastChat).toBe('刚刚');
    expect(p.mood).toBe(sim.snapshot().valence);
    expect(p.energy).toBe(sim.snapshot().energy);
    expect(p.affection).toBe(sim.snapshot().affection);
    return sim.dispose();
  });
});

describe('trace records (§12.2)', () => {
  it('writes a presence record on every snapshot change with exactly the allow-listed keys', () => {
    const trace = vi.fn();
    const sim = make({ trace });
    sim.start();
    sim.dispatch({ type: 'LIVELINESS', value: 0.9 });
    advance(SIM_DEFAULTS.TICK_MS);
    const presence = trace.mock.calls.map((c) => c[0]).filter((r) => r.t === 'presence');
    expect(presence.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(presence.at(-1)!).sort()).toEqual([
      'affection', 'arousal', 'energy', 'inputAgeMs', 'liveliness', 'phase', 'presence',
      'presentationMode', 'probableTyping', 't', 'valence',
    ]);
    return sim.dispose();
  });

  it('writes a resource record at 1 Hz only under DS_TRACE_RESOURCE=1', () => {
    const trace = vi.fn();
    const resources = vi.fn(() => ({ privateWorkingSetMb: 120.5, privateCommitMb: 300, processes: 4, cpuPct: 1.5 }));
    const sim = new SimService({
      pet: PET, bubble: BUBBLE, db, sensor: fakeSensor(),
      petBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), workArea: () => WORK, ...clock, trace, resources,
    });
    sim.start();
    advance(SIM_DEFAULTS.TICK_MS * 4);
    expect(resources).not.toHaveBeenCalled();
    return sim.dispose().then(() => {
      vi.stubEnv('DS_TRACE_RESOURCE', '1');
      const sim2 = new SimService({
        pet: PET, bubble: BUBBLE, db, sensor: fakeSensor(),
        petBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), workArea: () => WORK, ...clock, trace, resources,
      });
      sim2.start();
      advance(SIM_DEFAULTS.TICK_MS * 4);
      expect(resources).toHaveBeenCalledTimes(2);
      const rec = trace.mock.calls.map((c) => c[0]).filter((r) => r.t === 'resource');
      expect(rec).toHaveLength(2);
      expect(Object.keys(rec[0]).sort()).toEqual(['cpuPct', 'privateCommitMb', 'privateWorkingSetMb', 'processes', 't']);
      vi.unstubAllEnvs();
      return sim2.dispose();
    });
  });
});
