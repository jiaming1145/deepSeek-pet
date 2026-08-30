import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUNS } from './notification-state';
import type { ActivityWin32 } from './activity-sensor';

const idleSeconds = vi.fn<() => number>(() => 0);
const powerListeners = new Map<string, () => void>();
vi.mock('electron', () => ({
  BrowserWindow: class {},
  powerMonitor: {
    getSystemIdleTime: () => idleSeconds(),
    on: (ev: string, cb: () => void) => { powerListeners.set(ev, cb); },
    off: (ev: string) => { powerListeners.delete(ev); },
  },
}));

const {
  DND_EVERY_N_TICKS, EXE_CATEGORIES, KV_SENSING_TIER, POWER_EVERY_N_TICKS, SENSOR_TICK_MS,
  WIGGLE_COOLDOWN_MS, WIGGLE_FAST_TICK_MS, WIGGLE_MIN_DX_DIP, WIGGLE_MIN_REVERSALS, WIGGLE_NEAR_DIP,
  WIGGLE_RING, WIGGLE_SUBTICKS_PER_FULL, WIGGLE_WINDOW_MS,
  WRAP_SANITY_MS, createActivitySensor, foregroundCategory, inputAgeFrom,
} = await import('./activity-sensor');

type Power = { ACLineStatus: number; BatteryFlag: number; BatteryLifePercent: number };

/** A scripted Win32: `age` is what GetLastInputInfo/GetTickCount will yield, `quns` the DND value. */
function fakeWin32(o: { age?: () => number | null; quns?: () => number | null; power?: () => Power | null } = {}): ActivityWin32 {
  const now = 1_000_000;
  return {
    GetLastInputInfo: (info) => {
      const age = (o.age ?? (() => 5_000))();
      if (age === null) return false;
      info.dwTime = now - age;
      return true;
    },
    GetTickCount: () => now,
    GetSystemPowerStatus: (out) => {
      const p = (o.power ?? (() => ({ ACLineStatus: 1, BatteryFlag: 128, BatteryLifePercent: 255 })))();
      if (p === null) return false;
      Object.assign(out, p);
      return true;
    },
    SHQueryUserNotificationState: o.quns ?? (() => QUNS.ACCEPTS_NOTIFICATIONS),
  };
}

function make(win32: ActivityWin32 | null, cursor = { x: 100, y: 100 }) {
  const pos = { ...cursor };
  const sensor = createActivitySensor({ cursor: () => ({ ...pos }), scaleFactor: () => 1, win32 });
  return { sensor, pos };
}

beforeEach(() => { vi.useFakeTimers(); idleSeconds.mockReturnValue(0); powerListeners.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('constants', () => {
  it('pins §10.3, §10.2, §10.4 and §10.6 values', () => {
    expect([SENSOR_TICK_MS, DND_EVERY_N_TICKS, POWER_EVERY_N_TICKS]).toEqual([500, 10, 20]);
    expect(WRAP_SANITY_MS).toBe(7 * 24 * 3_600_000);
    // R3-36 / Amendment A3-2 — these supersede §10.4's five draft constants (2 Hz, 3 reversals,
    // travel/net DIP, 45 s). A3-2 is the authority; §10.4's block is superseded, not re-read.
    expect([WIGGLE_NEAR_DIP, WIGGLE_FAST_TICK_MS, WIGGLE_RING, WIGGLE_MIN_DX_DIP, WIGGLE_MIN_REVERSALS,
      WIGGLE_WINDOW_MS, WIGGLE_COOLDOWN_MS]).toEqual([240, 100, 15, 6, 4, 1_500, 20_000]);
    // The ring is exactly one window at the fast rate, and the fast rate divides the slow one.
    expect(WIGGLE_RING * WIGGLE_FAST_TICK_MS).toBe(WIGGLE_WINDOW_MS);
    expect(WIGGLE_SUBTICKS_PER_FULL).toBe(SENSOR_TICK_MS / WIGGLE_FAST_TICK_MS);
    expect(KV_SENSING_TIER).toBe('sensing_tier');
    expect(EXE_CATEGORIES).toEqual({
      editor: ['code.exe', 'devenv.exe', 'idea64.exe', 'sublime_text.exe', 'notepad++.exe'],
      browser: ['chrome.exe', 'msedge.exe', 'firefox.exe'],
      terminal: ['windowsterminal.exe', 'powershell.exe', 'wt.exe', 'cmd.exe'],
      media: ['vlc.exe', 'mpv.exe', 'spotify.exe'],
    });
  });
  it('foregroundCategory matches the lowercased basename only, null off-list', () => {
    expect(foregroundCategory('Code.exe')).toBe('editor');
    expect(foregroundCategory('MSEDGE.EXE')).toBe('browser');
    expect(foregroundCategory('explorer.exe')).toBeNull();
  });
});

describe('inputAgeFrom — wrap-safe subtraction', () => {
  it('is plain subtraction when no wrap happened', () => expect(inputAgeFrom(10_000, 4_000)).toBe(6_000));
  it('survives the 49.7-day GetTickCount wrap', () => expect(inputAgeFrom(100, 0xFFFF_FF00)).toBe(356));
  it('reports 0 above WRAP_SANITY_MS (a wrap artefact or a SendInput tick)', () => {
    expect(inputAgeFrom(0, 0x8000_0000)).toBe(0);   // 2^31 ms > 7 days
  });
});

describe('createActivitySensor — default tier', () => {
  it('samples signals 1 and 3 every tick, DND every 10th, power every 20th', () => {
    const age = vi.fn(() => 5_000);
    const quns = vi.fn(() => QUNS.ACCEPTS_NOTIFICATIONS);
    const power = vi.fn(() => ({ ACLineStatus: 0, BatteryFlag: 1, BatteryLifePercent: 80 }));
    const { sensor } = make(fakeWin32({ age, quns, power }));
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS * 40);
    // R3-51 DERIVATION, recomputed from the shipped constants (the plan's generated numbers, 4 and
    // 2, were counted without the first-tick poll the implementation performs):
    //   start() arms the pump at SENSOR_TICK_MS; with no `petCentre` dep `nearPet` is always false,
    //   so every reschedule is SENSOR_TICK_MS and every pump is a FULL tick. 20 000 ms of fake time
    //   therefore fires pumps at 500, 1 000, … 20 000 => 40 full ticks, tickN = 1…40.
    //   signal 1 runs on every full tick                    => 40.
    //   signal 4 runs when tickN === 1 || tickN % 10 === 0  => {1,10,20,30,40} => 5.
    //   signal 6 runs when tickN === 1 || tickN % 20 === 0  => {1,20,40}       => 3.
    expect(age).toHaveBeenCalledTimes(40);
    expect(quns).toHaveBeenCalledTimes(5);
    expect(power).toHaveBeenCalledTimes(3);
    expect(sensor.sample.inputAgeMs).toBe(5_000);
    expect(sensor.sample.dnd).toBe(false);
    expect(sensor.sample.battery).toEqual({ charging: false, level: 0.8 });
    expect(sensor.sample.cursor).toEqual({ x: 100, y: 100 });
    expect(sensor.sample.cursorDeltaDip).toBe(0);
    expect(sensor.derived.healthy).toBe(true);
    sensor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('owns exactly one interval', () => {
    const { sensor } = make(fakeWin32());
    sensor.start();
    expect(vi.getTimerCount()).toBe(1);
    sensor.stop();
  });

  it('cursorDeltaDip is the DIP distance from the previous sample, scaled by scaleFactor', () => {
    const pos = { x: 0, y: 0 };
    const sensor = createActivitySensor({ cursor: () => ({ ...pos }), scaleFactor: () => 2, win32: fakeWin32() });
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.cursorDeltaDip).toBeNull();   // first sample has no previous
    pos.x = 6; pos.y = 8;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.cursorDeltaDip).toBe(5);      // hypot(6,8)=10 physical / 2
    sensor.stop();
  });

  it('onInput fires the MOMENT input age drops below SENSOR_TICK_MS, once per edge', () => {
    let age = 60_000;
    const { sensor } = make(fakeWin32({ age: () => age }));
    const onInput = vi.fn();
    sensor.onInput(onInput);
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS * 3);
    expect(onInput).not.toHaveBeenCalled();
    age = 120;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(onInput).toHaveBeenCalledTimes(1);
    age = 300;                                      // still typing: same edge, no re-fire
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(onInput).toHaveBeenCalledTimes(1);
    age = 900; vi.advanceTimersByTime(SENSOR_TICK_MS);
    age = 100; vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(onInput).toHaveBeenCalledTimes(2);
    sensor.stop();
  });

  it('probableTyping: 4 samples with age < 1 s and delta < 2 DIP enter, 2 non-matching exit (R3-9)', () => {
    let age = 200;
    const { sensor, pos } = make(fakeWin32({ age: () => age }));
    sensor.start();
    // R3-51 DERIVATION (the plan's generated case flipped one tick early). `cursorDeltaDip` is
    // `null` on the FIRST sample — there is no previous cursor to subtract — and the predicate
    // requires `cursorDeltaDip !== null && < TYPING_CURSOR_DELTA_MAX_DIP`, so tick 1 is not a
    // typing sample. Ticks 2…5 are, and TYPING_ENTER_SAMPLES === 4, so `probableTyping` flips on
    // tick 5, i.e. after SENSOR_TICK_MS * 5 — not * 4.
    vi.advanceTimersByTime(SENSOR_TICK_MS * 4);
    expect(sensor.derived.probableTyping).toBe(false);
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.derived.probableTyping).toBe(true);
    expect(sensor.derived.typingStreakStartedMono).toBe(sensor.sample.tsMono - 4 * SENSOR_TICK_MS);
    expect(sensor.derived.typingFellAtMono).toBeNull();
    pos.x += 3;                                     // the cursor moved 3 DIP: not a typing sample
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.derived.probableTyping).toBe(true);
    age = 5_000;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.derived.probableTyping).toBe(false);
    expect(sensor.derived.typingFellAtMono).toBe(sensor.sample.tsMono);
    sensor.stop();
  });

  it('onDndChanged relays NotificationState edges; a failed query is DND on and healthy=false', () => {
    let q: number | null = QUNS.ACCEPTS_NOTIFICATIONS;
    const { sensor } = make(fakeWin32({ quns: () => q }));
    const cb = vi.fn();
    sensor.onDndChanged(cb);
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);          // first tick polls DND immediately
    expect(cb.mock.calls).toEqual([[false]]);
    q = null;
    vi.advanceTimersByTime(SENSOR_TICK_MS * DND_EVERY_N_TICKS);
    expect(cb.mock.calls).toEqual([[false], [true]]);
    expect(sensor.sample.dnd).toBeNull();
    expect(sensor.derived.healthy).toBe(false);
    sensor.stop();
  });

  it('onBattery fires on change and on powerMonitor on-ac / on-battery', () => {
    let p: Power = { ACLineStatus: 0, BatteryFlag: 1, BatteryLifePercent: 50 };
    const { sensor } = make(fakeWin32({ power: () => p }));
    const cb = vi.fn();
    sensor.onBattery(cb);
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(cb.mock.calls).toEqual([[{ charging: false, level: 0.5 }]]);
    p = { ACLineStatus: 1, BatteryFlag: 8, BatteryLifePercent: 50 };
    powerListeners.get('on-ac')!();
    expect(cb.mock.calls[1]).toEqual([{ charging: true, level: 0.5 }]);
    p = { ACLineStatus: 1, BatteryFlag: 128, BatteryLifePercent: 255 };   // desktop: no battery
    vi.advanceTimersByTime(SENSOR_TICK_MS * POWER_EVERY_N_TICKS);
    expect(cb.mock.calls[2]).toEqual([{ charging: true, level: null }]);
    sensor.stop();
    expect(powerListeners.size).toBe(0);
  });

  it('relays foreground changes from the injected watch', () => {
    const subs = new Set<() => void>();
    const sensor = createActivitySensor({
      cursor: () => ({ x: 0, y: 0 }), scaleFactor: () => 1, win32: fakeWin32(),
      foreground: { onForegroundChanged: (cb) => { subs.add(cb); return () => subs.delete(cb); } },
    });
    const cb = vi.fn();
    const off = sensor.onForegroundChanged(cb);
    for (const s of subs) s();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(subs.size).toBe(0);
  });
});

describe('§10.4 cursor wiggle — R3-36 / contract Amendment A3-2', () => {
  const CENTRE = { x: 500, y: 500 };
  let mono = 0;
  const pos = { x: 500, y: 500 };
  let sensor: ReturnType<typeof createActivitySensor> | undefined;

  /** A sensor whose pet centre is `centre`, driven by an injected monotonic clock so the 1.5 s
   *  window and the 20 s cooldown are exercised for real (vitest's fake timers do not move
   *  `process.hrtime`, which is what the production default reads). */
  function makeWiggler(centre: { x: number; y: number }) {
    mono = 0;
    pos.x = CENTRE.x; pos.y = CENTRE.y;
    const s = createActivitySensor({
      cursor: () => ({ ...pos }), scaleFactor: () => 1, win32: fakeWin32(),
      petCentre: () => centre, nowMono: () => mono,
    });
    const f = vi.fn();
    s.onWiggle(f);
    s.start();
    return { s, f };
  }
  /** Advance the fake timer AND the injected monotonic clock together. */
  const step = (ms: number): void => { mono += ms; vi.advanceTimersByTime(ms); };
  /** One 10 Hz sub-tick with the cursor jumped `dx` DIP along x. */
  const jog = (dx: number): void => { pos.x += dx; step(WIGGLE_FAST_TICK_MS); };
  /** Five alternating jogs of `mag` DIP produce exactly four x-delta sign changes. */
  const fourReversals = (mag: number): void => { for (let i = 0; i < 5; i++) jog(i % 2 === 0 ? mag : -mag); };

  afterEach(() => { sensor?.stop(); sensor = undefined; });

  it('samples at 10 Hz inside WIGGLE_NEAR_DIP and stays at 2 Hz outside it, with ONE timer either way', () => {
    const cursor = vi.fn(() => ({ x: 0, y: 0 }));
    const far = createActivitySensor({
      cursor, scaleFactor: () => 1, win32: fakeWin32(), petCentre: () => ({ x: 5_000, y: 0 }),
    });
    far.start();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(cursor).toHaveBeenCalledTimes(2);                  // 2 Hz: 500 ms and 1 000 ms
    expect(vi.getTimerCount()).toBe(1);                       // §10.3: still exactly one timer
    far.stop();
    expect(vi.getTimerCount()).toBe(0);

    cursor.mockClear();
    const near = createActivitySensor({
      cursor, scaleFactor: () => 1, win32: fakeWin32(), petCentre: () => ({ x: 0, y: 0 }),
    });
    near.start();
    vi.advanceTimersByTime(1_000);
    // The first pump is still scheduled at SENSOR_TICK_MS; it discovers the cursor is inside the
    // radius and drops the period to WIGGLE_FAST_TICK_MS, so 1 000 ms yields 1 + 5 samples.
    expect(cursor).toHaveBeenCalledTimes(1 + 5);
    expect(vi.getTimerCount()).toBe(1);
    near.stop();
  });

  it('the 500 ms signals still fire at exactly 2 Hz while the fast ring is running', () => {
    const age = vi.fn(() => 5_000);
    mono = 0; pos.x = CENTRE.x; pos.y = CENTRE.y;
    sensor = createActivitySensor({
      cursor: () => ({ ...pos }), scaleFactor: () => 1, win32: fakeWin32({ age }),
      petCentre: () => CENTRE, nowMono: () => mono,
    });
    sensor.start();
    step(SENSOR_TICK_MS);                       // pump 1: full tick, switches to 10 Hz
    for (let i = 0; i < 95; i++) step(WIGGLE_FAST_TICK_MS);   // 9 500 ms more, all at 10 Hz
    // 10 000 ms of sensing = 20 FULL ticks whatever the pump rate: the fast sub-ticks read the
    // cursor and nothing else, so GetLastInputInfo is still polled at exactly 2 Hz (§10.3).
    expect(age).toHaveBeenCalledTimes(10_000 / SENSOR_TICK_MS);
  });

  it('>= 4 reversals of >= 6 DIP inside 1.5 s fire cursorWiggle once, and derived.wiggle is a one-tick edge', () => {
    const { s, f } = makeWiggler(CENTRE);
    sensor = s;
    expect(s.derived.wiggle).toBe(false);
    step(SENSOR_TICK_MS);                       // enter the radius, switch to 10 Hz
    fourReversals(10);
    expect(f).toHaveBeenCalledTimes(1);
    expect(s.derived.wiggle).toBe(true);
    jog(10);
    expect(s.derived.wiggle).toBe(false);       // an edge, not a level
  });

  it('a straight sweep and sub-threshold jitter never fire (|dx| must reach WIGGLE_MIN_DX_DIP)', () => {
    const { s, f } = makeWiggler(CENTRE);
    sensor = s;
    step(SENSOR_TICK_MS);
    for (let i = 0; i < 12; i++) jog(20);                       // one direction: zero reversals
    expect(f).not.toHaveBeenCalled();
    for (let i = 0; i < 12; i++) jog(i % 2 === 0 ? WIGGLE_MIN_DX_DIP - 1 : -(WIGGLE_MIN_DX_DIP - 1));
    expect(f).not.toHaveBeenCalled();           // reversals, but each delta is below the floor
  });

  it('three reversals are not enough, and the fourth outside the 1.5 s window does not count', () => {
    const { s, f } = makeWiggler(CENTRE);
    sensor = s;
    step(SENSOR_TICK_MS);
    for (let i = 0; i < 4; i++) jog(i % 2 === 0 ? 10 : -10);    // three reversals
    expect(f).not.toHaveBeenCalled();
    step(WIGGLE_WINDOW_MS + WIGGLE_FAST_TICK_MS);               // the three age out of the window
    jog(10);
    expect(f).not.toHaveBeenCalled();
  });

  it('cooldown: a second wiggle inside 20 s is swallowed, one after it fires again', () => {
    const { s, f } = makeWiggler(CENTRE);
    sensor = s;
    step(SENSOR_TICK_MS);
    fourReversals(10);
    expect(f).toHaveBeenCalledTimes(1);
    fourReversals(10);
    expect(f).toHaveBeenCalledTimes(1);         // still inside WIGGLE_COOLDOWN_MS
    step(WIGGLE_COOLDOWN_MS);
    fourReversals(10);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('outside the radius the ring is dead: the same gesture fires nothing and the rate stays 2 Hz', () => {
    const { s, f } = makeWiggler({ x: 5_000, y: 5_000 });
    sensor = s;
    step(SENSOR_TICK_MS);
    for (let i = 0; i < 12; i++) { pos.x += i % 2 === 0 ? 10 : -10; step(SENSOR_TICK_MS); }
    expect(f).not.toHaveBeenCalled();
    expect(s.derived.wiggle).toBe(false);
  });

  it('no petCentre dep (browser/test wiring) means no radius, no fast rate and no wiggle', () => {
    const cursor = vi.fn(() => ({ x: 0, y: 0 }));
    const s = createActivitySensor({ cursor, scaleFactor: () => 1, win32: fakeWin32() });
    const f = vi.fn();
    s.onWiggle(f);
    s.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS * 10);
    expect(cursor).toHaveBeenCalledTimes(10);
    expect(f).not.toHaveBeenCalled();
    s.stop();
  });
});

describe('degradation ladder (§10.5)', () => {
  it('rung 2: koffi missing -> powerMonitor.getSystemIdleTime seconds, healthy=false, typing never true, one warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    idleSeconds.mockReturnValue(0);
    const { sensor } = make(null);
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS * 8);
    expect(sensor.sample.inputAgeMs).toBe(0);
    expect(sensor.derived.healthy).toBe(false);
    expect(sensor.derived.probableTyping).toBe(false);   // permanently: second resolution
    expect(sensor.sample.dnd).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    idleSeconds.mockReturnValue(7);
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.inputAgeMs).toBe(7_000);
    sensor.stop();
  });

  it('rung 2 via GetLastInputInfo returning false, mid-run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let age: number | null = 3_000;
    const { sensor } = make(fakeWin32({ age: () => age }));
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.derived.healthy).toBe(true);
    age = null;
    idleSeconds.mockReturnValue(4);
    vi.advanceTimersByTime(SENSOR_TICK_MS * 3);
    expect(sensor.sample.inputAgeMs).toBe(4_000);
    expect(sensor.derived.healthy).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    sensor.stop();
  });

  it('both fallbacks failing -> inputAgeMs null, still no throw', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    idleSeconds.mockImplementation(() => { throw new Error('no powerMonitor'); });
    const { sensor } = make(null);
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.inputAgeMs).toBeNull();
    sensor.stop();
  });
});

describe('fix round 1 — the ONE sensing timer survives its subscribers and its deps (§10.3)', () => {
  it('a throwing onInput listener neither kills the pump nor suppresses the next listener', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let age = 60_000;
    const { sensor } = make(fakeWin32({ age: () => age }));
    const bad = vi.fn(() => { throw new Error('dispatch to a destroyed window'); });
    const good = vi.fn();
    sensor.onInput(bad);
    sensor.onInput(good);
    sensor.start();
    age = 100;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);              // the one timer is still armed
    age = 5_000;
    vi.advanceTimersByTime(SENSOR_TICK_MS * 4);      // ... and still sampling
    expect(sensor.sample.inputAgeMs).toBe(5_000);
    sensor.stop();
    warn.mockRestore();
  });

  it('an exception raised inside the pump is logged and the pump still reschedules', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const age = vi.fn(() => 5_000);
    let boom = false;
    const sensor = createActivitySensor({
      cursor: () => ({ x: 0, y: 0 }),
      scaleFactor: () => { if (boom) throw new Error('display gone'); return 1; },
      win32: fakeWin32({ age }),
    });
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS * 2);
    boom = true;
    vi.advanceTimersByTime(SENSOR_TICK_MS);          // tick 3 throws after reading the input age
    expect(warn).toHaveBeenCalledWith('[activity-sensor] pump failed:', expect.anything());
    expect(vi.getTimerCount()).toBe(1);
    boom = false;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(age).toHaveBeenCalledTimes(4);            // ticks 1, 2, 3 (which threw) and 4
    sensor.stop();
    warn.mockRestore();
  });

  it('a listener that calls stop() from inside the fan-out leaves no zombie pump', () => {
    let age = 60_000;
    const { sensor } = make(fakeWin32({ age: () => age }));
    sensor.onInput(() => { sensor.stop(); });
    sensor.start();
    age = 100;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    // Without the `armed` guard, stop() nulled `timer` and the pump's tail then reassigned it:
    // a pump nothing could cancel any more.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('derived.healthy RECOVERS — it is recomputed per tick, not latched (§10.5, R3-9)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let age: number | null = 3_000;
    let q: number | null = QUNS.ACCEPTS_NOTIFICATIONS;
    const { sensor } = make(fakeWin32({ age: () => age, quns: () => q }));
    sensor.start();
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.derived.healthy).toBe(true);
    q = null;                                        // one transient SHQueryUserNotificationState HRESULT
    vi.advanceTimersByTime(SENSOR_TICK_MS * DND_EVERY_N_TICKS);
    expect(sensor.derived.healthy).toBe(false);
    q = QUNS.ACCEPTS_NOTIFICATIONS;
    vi.advanceTimersByTime(SENSOR_TICK_MS * DND_EVERY_N_TICKS);
    expect(sensor.sample.dnd).toBe(false);
    expect(sensor.derived.healthy).toBe(true);       // ... and proactive speech is possible again
    age = null;                                      // one transient GetLastInputInfo false
    idleSeconds.mockReturnValue(4);
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.inputAgeMs).toBe(4_000);
    expect(sensor.derived.healthy).toBe(false);
    age = 3_000;
    vi.advanceTimersByTime(SENSOR_TICK_MS);
    expect(sensor.sample.inputAgeMs).toBe(3_000);    // millisecond resolution came back
    expect(sensor.derived.healthy).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);           // warnDegraded is still once-only
    sensor.stop();
    warn.mockRestore();
  });
});

describe('§10.7 — every capability PRIVACY-SENSING.md denies is absent from the source', () => {
  it('grep over apps/desktop/src and packages returns nothing', () => {
    const root = new URL('../../../../', import.meta.url);
    // FIX ROUND 1, finding 7: the clipboard term is `clipboard[?.]*read`, not the bare token.
    // PRIVACY-SENSING.md denies READING the clipboard (「不读剪贴板」) and says nothing about a
    // write; the bare token also matched Phase 2's user-initiated "copy this message" button
    // (`renderer/chat/History.tsx:178`, `navigator.clipboard?.writeText`) in a file Task 12 does
    // not own, which forced a second allow-list entry that no reader of PRIVACY-SENSING.md could
    // see. The narrowed term denies exactly what the statement denies -- `clipboard.readText`,
    // `clipboard.read` and `navigator.clipboard?.readText` all match it -- so the denial and the
    // grep are back in step and the allow-list is down to this file alone (the brief's item).
    const pattern = 'SetWindowsHookEx\\|WH_KEYBOARD\\|RIDEV_INPUTSINK\\|GetAsyncKeyState\\|clipboard[?.]*read\\|GetWindowText\\|desktopCapturer\\|capturePage';
    let out = '';
    try {
      out = execFileSync('grep', ['-rn', pattern, 'apps/desktop/src', 'packages'], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;          // grep exit 1 = no match; anything else is a real error
      out = err.stdout ?? '';
    }
    // This file names the pattern once, in the string above; nothing else may.
    const hits = out.split('\n').filter((l) => l && !l.includes('activity-sensor.test.ts'));
    expect(hits).toEqual([]);
  });
  it('the privacy statement exists and carries the denial sentence', () => {
    const md = readFileSync(new URL('../../../../docs/PRIVACY-SENSING.md', import.meta.url), 'utf8');
    expect(md).toContain('## 她能感觉到什么');
    expect(md).toContain('不装键盘钩子，不读按键，不读剪贴板，不读窗口标题，不截屏');
  });
});
