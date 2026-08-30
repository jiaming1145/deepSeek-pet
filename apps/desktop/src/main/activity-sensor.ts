import { powerMonitor } from 'electron';
import { SIM_DEFAULTS } from '@ds/sim';
import {
  createNotificationState, loadNotificationQuery, type NotificationQuery, type NotificationState,
} from './notification-state';

// ---- §10.3 the one timer ----------------------------------------------------------------------
export const SENSOR_TICK_MS = 500;          // signals 1 and 3, every tick
export const DND_EVERY_N_TICKS = 10;        // signal 4: 0.2 Hz
export const POWER_EVERY_N_TICKS = 20;      // signal 6: 0.1 Hz
/** A GetLastInputInfo age above this is a wrap artefact or a SendInput-supplied tick; report 0. */
export const WRAP_SANITY_MS = 7 * 24 * 3_600_000;         // 7 days

// ---- §10.4 D11 cursor-wiggle predicate — OWNED HERE (R3-36 / contract Amendment A3-2) ----------
// A3-2 supersedes §10.4's draft block (2 Hz, 3 reversals, travel/net DIP, 45 s): 2 Hz cannot see a
// wiggle at all, and "flips on either axis" double-counts a diagonal shake. The ratified predicate
// is one-dimensional and rate-adaptive, and it costs nothing when she is not being poked:
//   * only while the cursor is within WIGGLE_NEAR_DIP of the pet window CENTRE is the cursor
//     sampled at WIGGLE_FAST_TICK_MS (10 Hz) into a WIGGLE_RING-slot ring — exactly one window;
//   * a REVERSAL is a sign change of the x-delta where |dx| >= WIGGLE_MIN_DX_DIP (so a slow drift,
//     a hand tremor and a straight sweep all count zero);
//   * WIGGLE_MIN_REVERSALS inside WIGGLE_WINDOW_MS emits `sim:event {kind:'cursorWiggle'}` through
//     `onWiggle`, then nothing for WIGGLE_COOLDOWN_MS;
//   * outside the radius the pump falls back to SENSOR_TICK_MS and the ring is cleared.
// The radius is measured in DIP against `deps.petCentre()`, which is in the SAME coordinate space
// as `deps.cursor()` (physical px on this machine — the same convention `cursorDeltaDip` uses).
export const WIGGLE_NEAR_DIP = 240;
export const WIGGLE_FAST_TICK_MS = 100;     // 10 Hz inside the radius
export const WIGGLE_SUBTICKS_PER_FULL = SENSOR_TICK_MS / WIGGLE_FAST_TICK_MS;   // 5
export const WIGGLE_RING = 15;              // 15 x 100 ms == WIGGLE_WINDOW_MS
export const WIGGLE_MIN_DX_DIP = 6;         // below this an x-delta is not a stroke
export const WIGGLE_MIN_REVERSALS = 4;
export const WIGGLE_WINDOW_MS = 1_500;
export const WIGGLE_COOLDOWN_MS = 20_000;

// ---- §10.6 the opt-in tier: the flag and the plumbing, wired to NOTHING in Phase 3 -------------
export const KV_SENSING_TIER = 'sensing_tier';     // '' (default) | 'exe-category'
export const EXE_CATEGORIES = {
  editor:  ['code.exe', 'devenv.exe', 'idea64.exe', 'sublime_text.exe', 'notepad++.exe'],
  browser: ['chrome.exe', 'msedge.exe', 'firefox.exe'],
  terminal:['windowsterminal.exe', 'powershell.exe', 'wt.exe', 'cmd.exe'],
  media:   ['vlc.exe', 'mpv.exe', 'spotify.exe'],
} as const;
export type ExeCategory = keyof typeof EXE_CATEGORIES;
/** Basename in, category out. Titles are never read at any tier; the path is not retained. */
export function foregroundCategory(basename: string): ExeCategory | null {
  const b = basename.toLowerCase();
  for (const k of Object.keys(EXE_CATEGORIES) as ExeCategory[]) {
    if ((EXE_CATEGORIES[k] as readonly string[]).includes(b)) return k;
  }
  return null;
}

// ---- §10.4 the derived-state schema --------------------------------------------------------------
export interface ActivitySample {
  /** null when the sensor could not read it (koffi missing, API failure). */
  inputAgeMs: number | null;
  cursor: { x: number; y: number } | null;
  /** Distance in DIP from the previous sample's cursor, or null on the first sample. */
  cursorDeltaDip: number | null;
  dnd: boolean | null;
  battery: { charging: boolean; level: number | null } | null;
  tsMono: number;
}

export interface ActivityDerived {
  /** R3-9: 4 consecutive samples (2 s) with input age < 1 s and cursor delta < 2 DIP. */
  probableTyping: boolean;
  /** Monotonic ms the current streak started, or null. */
  typingStreakStartedMono: number | null;
  /** Monotonic ms probableTyping last went true->false, or null. Drives breakpoint (b). */
  typingFellAtMono: number | null;
  /**
   * R3-36 / A3-2: true for the ONE sub-tick on which the wiggle predicate fired — an edge, not a
   * level, so a consumer that polls `derived` cannot re-fire the reaction. `onWiggle` is the
   * push form and is what `SimService` uses.
   */
  wiggle: boolean;
  /** False after any hard sensor failure; suppresses proactive (R3-9). */
  healthy: boolean;
}

// ---- §10.2 koffi signatures --------------------------------------------------------------------
export type LastInputInfo = { cbSize: number; dwTime: number };
export type SystemPowerStatus = {
  ACLineStatus: number; BatteryFlag: number; BatteryLifePercent: number;
  SystemStatusFlag: number; BatteryLifeTime: number; BatteryFullLifeTime: number;
};
/**
 * CONTRACT GAP: §10.5 names `ActivityWin32` without declaring it. This is its shape — the three
 * §10.2 functions of this file plus shell32's query, so tests inject all four in one object.
 */
export interface ActivityWin32 {
  GetLastInputInfo(info: LastInputInfo): boolean;
  GetTickCount(): number;
  GetSystemPowerStatus(out: SystemPowerStatus): boolean;
  SHQueryUserNotificationState: NotificationQuery | null;
}

/** Unsigned 32-bit wrap-safe subtraction with the WRAP_SANITY_MS clamp (§10.2, research §6.1). */
export function inputAgeFrom(now: number, dwTime: number): number {
  const ageMs = ((now >>> 0) - (dwTime >>> 0)) >>> 0;
  return ageMs > WRAP_SANITY_MS ? 0 : ageMs;
}

let win32Cache: ActivityWin32 | null | undefined;
function loadWin32(): ActivityWin32 | null {
  if (win32Cache !== undefined) return win32Cache;
  try {
    // Loaded lazily through require(), exactly as foreground.ts does, so a missing or incompatible
    // native binary degrades to "unknown" instead of taking the app down at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    // Namespaced struct names, because koffi.struct() throws when a name is registered twice and
    // foreground.ts already registers DS_RECT in this process.
    koffi.struct('DS_LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
    koffi.struct('DS_SYSTEM_POWER_STATUS', {
      ACLineStatus: 'uint8', BatteryFlag: 'uint8', BatteryLifePercent: 'uint8',
      SystemStatusFlag: 'uint8', BatteryLifeTime: 'uint32', BatteryFullLifeTime: 'uint32',
    });
    win32Cache = {
      GetLastInputInfo: user32.func('bool __stdcall GetLastInputInfo(_Inout_ DS_LASTINPUTINFO* plii)'),
      GetTickCount: kernel32.func('uint32 __stdcall GetTickCount()'),
      GetSystemPowerStatus:
        kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ DS_SYSTEM_POWER_STATUS* status)'),
      SHQueryUserNotificationState: loadNotificationQuery(),
    } as unknown as ActivityWin32;
  } catch (err) {
    console.warn('[activity-sensor] koffi unavailable, degrading to powerMonitor idle seconds:', err);
    win32Cache = null;
  }
  return win32Cache;
}

// ---- §10.5 the API ------------------------------------------------------------------------------
export interface ActivitySensor {
  start(): void;
  stop(): void;
  /** The latest sample; `SimService` reads it on every TICK. */
  readonly sample: ActivitySample;
  readonly derived: ActivityDerived;
  /** Fired the MOMENT input age drops below SENSOR_TICK_MS — this is R3-1's immediate USER_INPUT. */
  onInput(cb: () => void): () => void;
  onForegroundChanged(cb: () => void): () => void;
  onDndChanged(cb: (dnd: boolean) => void): () => void;
  onBattery(cb: (b: { charging: boolean; level: number | null }) => void): () => void;
  /** R3-36 / A3-2: D11's "wiggle near her -> curiosity". Fires at most once per WIGGLE_COOLDOWN_MS. */
  onWiggle(cb: () => void): () => void;
}

export interface ActivitySensorDeps {
  cursor(): { x: number; y: number };
  scaleFactor(): number;                    // to convert the cursor delta into DIP
  win32?: ActivityWin32 | null;             // tests inject; production loads koffi
  /**
   * CONTRACT GAP: §10.5's deps carry no source for `onForegroundChanged`; signal 5 lives in
   * `startForegroundWatch` (§10.1). index.ts passes the ForegroundWatch here. Absent => no-op.
   */
  foreground?: { onForegroundChanged(cb: () => void): () => void };
  /**
   * R3-36 / A3-2: the pet window's centre, in the SAME coordinate space `cursor()` reports. Absent
   * or returning null (browser lane, before the window exists) => the cursor is never "near", the
   * pump stays at SENSOR_TICK_MS and no wiggle can fire. `index.ts` passes
   * `() => { const b = petWin.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }`
   * scaled the same way `cursor()` is.
   */
  petCentre?(): { x: number; y: number } | null;
  nowMono?: () => number;
}

const NO_BATTERY_FLAG = 128;          // BatteryFlag: "No system battery"
const UNKNOWN_PERCENT = 255;          // BatteryLifePercent: unknown

export function createActivitySensor(deps: ActivitySensorDeps): ActivitySensor {
  const nowMono = deps.nowMono ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
  const win32 = deps.win32 === undefined ? loadWin32() : deps.win32;
  const notification: NotificationState =
    createNotificationState(win32 ? win32.SHQueryUserNotificationState : null);

  const sample: ActivitySample = {
    inputAgeMs: null, cursor: null, cursorDeltaDip: null, dnd: null, battery: null, tsMono: 0,
  };
  const derived: ActivityDerived = {
    probableTyping: false, typingStreakStartedMono: null, typingFellAtMono: null, wiggle: false, healthy: true,
  };

  const inputSubs = new Set<() => void>();
  const batterySubs = new Set<(b: { charging: boolean; level: number | null }) => void>();
  const wiggleSubs = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * FIX ROUND 1, finding 1. `stop()` clears this BEFORE it nulls `timer`, and `pump`'s `finally`
   * reschedules only while it is set: a subscriber that calls `stop()` from inside a fan-out can no
   * longer resurrect a zombie pump that `stop()` has already lost the handle to.
   */
  let armed = false;
  let tickN = 0;
  let inputDegraded = win32 === null;       // rung 2 entered
  let warnedInput = false;
  let prevCursor: { x: number; y: number } | null = null;
  let prevAge: number | null = null;
  let typingSamples = 0;
  let typingIdleSamples = 0;
  let offDnd: (() => void) | null = null;
  // ---- R3-36 / A3-2 wiggle state. `stop()` clears the ring, `prevWiggleCursor`, `nearPet` and the
  // `wiggle` edge; `start()` reseeds `subTicks`/`pendingUnits`. `lastWiggleMono` deliberately
  // SURVIVES a stop/start so a restart cannot be used to skip the 20 s cooldown. ----
  const ring: { tsMono: number; dx: number }[] = [];
  let prevWiggleCursor: { x: number; y: number } | null = null;
  let lastWiggleMono = Number.NEGATIVE_INFINITY;
  let nearPet = false;
  /** Sub-ticks accumulated since the last FULL sample, in WIGGLE_FAST_TICK_MS units. */
  let subTicks = 0;
  /** How many units the period we just waited was worth (5 at 2 Hz, 1 at 10 Hz). */
  let pendingUnits = WIGGLE_SUBTICKS_PER_FULL;

  const warnDegraded = (why: string): void => {
    if (warnedInput) return;
    warnedInput = true;
    console.warn('[activity-sensor] input age degraded to powerMonitor.getSystemIdleTime():', why);
  };

  /**
   * FIX ROUND 1, finding 1. Every subscriber is called inside its own try/catch: one bad listener
   * (Task 17 wires `onInput` straight into `SimService.dispatch`) must not suppress the others and
   * must never reach the pump, whose single timer IS the sensing loop (§10.3).
   */
  const fanOut = (subs: Iterable<() => void>, what: string): void => {
    for (const cb of subs) {
      try { cb(); } catch (err) { console.warn(`[activity-sensor] ${what} listener threw:`, err); }
    }
  };

  /**
   * §10.5 rungs 1-2. FIX ROUND 1, finding 5: `inputDegraded` is recomputed on EVERY read instead of
   * latching. A single transient `GetLastInputInfo` false must not pin the sensor to
   * second-resolution `powerMonitor` — which would make `probableTyping` permanently false and,
   * through `derived.healthy`, refuse every proactive line under `sensor-unknown` (R3-9) for the
   * rest of the session. `warnDegraded` stays once-only so a permanently broken API does not turn
   * the fallback into a 2 Hz log stream.
   */
  const readInputAge = (): number | null => {
    if (win32) {
      try {
        const info: LastInputInfo = { cbSize: 8, dwTime: 0 };
        if (win32.GetLastInputInfo(info)) {
          inputDegraded = false;
          return inputAgeFrom(win32.GetTickCount(), info.dwTime);
        }
        inputDegraded = true;
        warnDegraded('GetLastInputInfo returned false');
      } catch (err) {
        inputDegraded = true;
        warnDegraded(String(err));
      }
    } else {
      inputDegraded = true;
      warnDegraded('koffi unavailable');
    }
    try {
      return powerMonitor.getSystemIdleTime() * 1000;   // second resolution: typing stays false
    } catch {
      return null;
    }
  };

  const readBattery = (): void => {
    if (!win32) return;
    let next: ActivitySample['battery'] = null;
    try {
      const out = {
        ACLineStatus: 0, BatteryFlag: 0, BatteryLifePercent: 0,
        SystemStatusFlag: 0, BatteryLifeTime: 0, BatteryFullLifeTime: 0,
      };
      if (win32.GetSystemPowerStatus(out)) {
        const noBattery = (out.BatteryFlag & NO_BATTERY_FLAG) !== 0;
        next = {
          charging: out.ACLineStatus === 1,
          level: noBattery || out.BatteryLifePercent === UNKNOWN_PERCENT ? null : out.BatteryLifePercent / 100,
        };
      }
    } catch {
      next = null;
    }
    const changed = next === null
      ? sample.battery !== null
      : sample.battery === null || sample.battery.charging !== next.charging || sample.battery.level !== next.level;
    sample.battery = next;
    if (changed && next) {
      const b = next;
      for (const cb of batterySubs) {
        // FIX ROUND 1, finding 1 — see `fanOut`; this one carries an argument, and each listener
        // still gets its own copy so a mutating listener cannot corrupt the next one's.
        try { cb({ ...b }); } catch (err) { console.warn('[activity-sensor] onBattery listener threw:', err); }
      }
    }
  };

  const updateTyping = (now: number): void => {
    // Rung 2 is permanent for the predicate: second-resolution age can never be < 1 s honestly.
    const isTypingSample = !inputDegraded
      && sample.inputAgeMs !== null && sample.inputAgeMs < SIM_DEFAULTS.TYPING_INPUT_AGE_MAX_MS
      && sample.cursorDeltaDip !== null && sample.cursorDeltaDip < SIM_DEFAULTS.TYPING_CURSOR_DELTA_MAX_DIP;
    if (isTypingSample) { typingSamples++; typingIdleSamples = 0; }
    else { typingIdleSamples++; typingSamples = 0; }
    if (!derived.probableTyping && typingSamples >= SIM_DEFAULTS.TYPING_ENTER_SAMPLES) {
      derived.probableTyping = true;
      derived.typingStreakStartedMono = now - SIM_DEFAULTS.TYPING_ENTER_SAMPLES * SENSOR_TICK_MS;
    }
    if (derived.probableTyping && typingIdleSamples >= SIM_DEFAULTS.TYPING_EXIT_SAMPLES) {
      derived.probableTyping = false;
      derived.typingStreakStartedMono = null;
      derived.typingFellAtMono = now;
    }
  };

  /** R3-36 / A3-2. True only inside the radius, with a live `petCentre` dep. */
  const cursorNearPet = (cursor: { x: number; y: number } | null): boolean => {
    if (cursor === null || !deps.petCentre) return false;
    let centre: { x: number; y: number } | null = null;
    try { centre = deps.petCentre(); } catch { centre = null; }
    if (centre === null) return false;
    const scale = deps.scaleFactor() || 1;
    return Math.hypot(cursor.x - centre.x, cursor.y - centre.y) / scale <= WIGGLE_NEAR_DIP;
  };

  /**
   * R3-36 / A3-2's predicate. Returns true on the sub-tick the wiggle fires. Outside the radius the
   * ring is cleared, so a cursor that sweeps in from across the screen starts from nothing. Firing
   * clears the ring too, so one gesture cannot fire twice; the WIGGLE_COOLDOWN_MS check is second,
   * and samples older than WIGGLE_WINDOW_MS are ignored, so a wiggle held down for the whole
   * cooldown does not queue a second event the instant it expires.
   */
  const updateWiggle = (now: number, cursor: { x: number; y: number } | null): boolean => {
    if (!nearPet || cursor === null) {
      ring.length = 0;
      prevWiggleCursor = cursor;
      return false;
    }
    const scale = deps.scaleFactor() || 1;
    if (prevWiggleCursor !== null) {
      ring.push({ tsMono: now, dx: (cursor.x - prevWiggleCursor.x) / scale });
      if (ring.length > WIGGLE_RING) ring.shift();
    }
    prevWiggleCursor = cursor;
    let reversals = 0;
    let lastSign = 0;
    for (const s of ring) {
      if (now - s.tsMono > WIGGLE_WINDOW_MS) continue;
      if (Math.abs(s.dx) < WIGGLE_MIN_DX_DIP) continue;
      const sign = s.dx > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) reversals++;
      lastSign = sign;
    }
    if (reversals < WIGGLE_MIN_REVERSALS) return false;
    if (now - lastWiggleMono < WIGGLE_COOLDOWN_MS) return false;
    lastWiggleMono = now;
    ring.length = 0;
    return true;
  };

  /** The 500 ms sample: signals 1, 3, 4, 6 and the typing predicate. `cursor` is the read the pump
   *  already did, so `deps.cursor()` is still called exactly once per pump. */
  const fullTick = (now: number, cursor: { x: number; y: number } | null): void => {
    tickN++;
    sample.tsMono = now;

    // signal 1
    const age = readInputAge();
    sample.inputAgeMs = age;
    const edge = age !== null && age < SENSOR_TICK_MS && (prevAge === null || prevAge >= SENSOR_TICK_MS);
    prevAge = age;

    // signal 3
    if (cursor && prevCursor) {
      const scale = deps.scaleFactor() || 1;
      sample.cursorDeltaDip = Math.hypot(cursor.x - prevCursor.x, cursor.y - prevCursor.y) / scale;
    } else {
      sample.cursorDeltaDip = null;
    }
    sample.cursor = cursor;
    prevCursor = cursor;

    // signal 4 — first tick and every DND_EVERY_N_TICKS
    if (tickN === 1 || tickN % DND_EVERY_N_TICKS === 0) {
      notification.poll();
      sample.dnd = notification.dnd;
    }
    // signal 6 — first tick and every POWER_EVERY_N_TICKS
    if (tickN === 1 || tickN % POWER_EVERY_N_TICKS === 0) readBattery();

    // §10.5 health. FIX ROUND 1, finding 5: recomputed from the live reads on every full tick, never
    // latched. Rung 2 (no millisecond input age) and rung 3 (`dnd === null`, the last poll's
    // verdict) both clear it, and both RESTORE it the moment the underlying call succeeds again.
    derived.healthy = !inputDegraded && sample.dnd !== null;

    updateTyping(now);
    if (edge) fanOut(inputSubs, 'onInput');
  };

  /**
   * §10.3's ONE timer, self-rescheduling so its period can follow the cursor (R3-36 / A3-2): every
   * pump reads the cursor once and feeds the wiggle ring; the FULL sample runs once every
   * WIGGLE_SUBTICKS_PER_FULL units, which is exactly SENSOR_TICK_MS at either rate. Unit counting
   * rather than clock comparison keeps the cadence exact under fake timers, whose `hrtime` does not
   * move. There is still exactly one pending timer at all times, which `activity-sensor.test.ts`
   * asserts with `vi.getTimerCount()`.
   */
  const pump = (): void => {
    try {
      const now = nowMono();
      let cursor: { x: number; y: number } | null = null;
      try { cursor = deps.cursor(); } catch { cursor = null; }
      nearPet = cursorNearPet(cursor);

      derived.wiggle = updateWiggle(now, cursor);
      if (derived.wiggle) fanOut(wiggleSubs, 'onWiggle');

      subTicks += pendingUnits;
      if (subTicks >= WIGGLE_SUBTICKS_PER_FULL) {
        subTicks = 0;
        fullTick(now, cursor);
      }
    } catch (err) {
      // FIX ROUND 1, finding 1. The reschedule below is the LAST statement of the pump and this
      // process owns exactly ONE sensing timer, so an exception escaping here would kill sensing
      // permanently and silently: input age, DND, battery, typing and wiggle would all freeze while
      // `SimService.tick` kept reading the stale `sample` at 2 Hz forever. The old §10.3
      // fixed-interval shape lost one tick; the R3-36 self-rescheduling shape loses the sensor.
      console.warn('[activity-sensor] pump failed:', err);
    } finally {
      if (armed) {
        pendingUnits = nearPet ? 1 : WIGGLE_SUBTICKS_PER_FULL;
        timer = setTimeout(pump, nearPet ? WIGGLE_FAST_TICK_MS : SENSOR_TICK_MS);
      }
    }
  };

  const onPowerEvent = (): void => readBattery();

  return {
    get sample() { return sample; },
    get derived() { return derived; },
    start() {
      if (timer !== null) return;
      armed = true;
      offDnd = notification.onChange(() => { sample.dnd = notification.dnd; });
      powerMonitor.on('on-ac', onPowerEvent);
      powerMonitor.on('on-battery', onPowerEvent);
      subTicks = 0;
      pendingUnits = WIGGLE_SUBTICKS_PER_FULL;    // the first pump completes a full sample
      timer = setTimeout(pump, SENSOR_TICK_MS);   // the ONE timer (§10.3)
    },
    stop() {
      armed = false;                     // FIX ROUND 1, finding 1: cleared BEFORE `timer` is nulled
      if (timer !== null) clearTimeout(timer);
      timer = null;
      offDnd?.();
      offDnd = null;
      powerMonitor.off('on-ac', onPowerEvent);
      powerMonitor.off('on-battery', onPowerEvent);
      ring.length = 0;
      prevWiggleCursor = null;
      nearPet = false;
      derived.wiggle = false;
    },
    onInput(cb) { inputSubs.add(cb); return () => { inputSubs.delete(cb); }; },
    onForegroundChanged(cb) {
      return deps.foreground ? deps.foreground.onForegroundChanged(cb) : () => { /* no signal 5 */ };
    },
    onDndChanged(cb) { return notification.onChange(cb); },
    onBattery(cb) { batterySubs.add(cb); return () => { batterySubs.delete(cb); }; },
    onWiggle(cb) { wiggleSubs.add(cb); return () => { wiggleSubs.delete(cb); }; },
  };
}
