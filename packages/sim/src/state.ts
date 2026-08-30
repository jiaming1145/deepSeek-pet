import { z } from 'zod';
import {
  ClockPhaseSchema, PresenceSchema, PresentationModeSchema, PersonaModeIpcSchema,
  LIVELINESS_PRESETS,
} from '@ds/protocol';
import { localDateString, localHour, mealJitter, phaseOf } from './phases.ts';
import { RNG_DEFAULT_SEED, seedRng } from './rng.ts';

export const SimStateSchema = z.object({
  // ---- clocks (monotonic ms unless stated) -------------------------------------------------
  /** Last `nowMono` the reducer saw. Used only to compute deltas; never persisted raw (§3.12). */
  lastMono: z.number().nonnegative(),
  /** Last `nowWall` the reducer saw, epoch ms. Persisted, so a rollback is detectable (§3.10 and B-03). */
  lastWall: z.number().nonnegative(),
  /** Local calendar day of `lastWall`, 'YYYY-MM-DD'. The only day key anything uses. */
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  // ---- presence (R3-1) -----------------------------------------------------------------------
  /** ms since the last OS input, from GetLastInputInfo. Clamped to 7 days. */
  inputAgeMs: z.number().min(0).max(604_800_000),
  locked: z.boolean(),
  suspended: z.boolean(),
  fullscreen: z.boolean(),
  dnd: z.boolean(),
  /** Tray/hotkey user-hide (Phase 1 `VisibilityFlag 'user'`). Does NOT affect presence. */
  userHidden: z.boolean(),
  presence: PresenceSchema,
  presentationMode: PresentationModeSchema,
  probableTyping: z.boolean(),
  /** Consecutive 2 Hz samples matching the typing predicate (R3-9). */
  typingSamples: z.number().int().min(0),
  /** Consecutive 2 Hz samples NOT matching it, while probableTyping is true. */
  typingIdleSamples: z.number().int().min(0),
  /** Monotonic ms the current typing streak started, or null. */
  typingStreakStartedMono: z.number().nonnegative().nullable(),
  cursorNear: z.boolean(),
  onFloor: z.boolean(),
  nearEdge: z.boolean(),
  /** Accumulated PRESENT time since the last tick that changed anything, ms. Diagnostics only. */
  presentMsToday: z.number().min(0),
  /** Monotonic ms of the last PRESENT->absent transition, or null while present. */
  absentSinceMono: z.number().nonnegative().nullable(),

  // ---- mood (R3-8: 2-D, present-time only) ---------------------------------------------------
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  /** Persona baseline. Read from character.json `sim.moodBase`, defaulted in SIM_DEFAULTS. */
  valenceBase: z.number().min(-1).max(1),
  arousalBase: z.number().min(0).max(1),
  /** The neglect accumulator (R3-8). Separate field so the -0.2 floor is STRUCTURAL. */
  neglect: z.number().min(-0.2).max(0),
  /** PRESENT ms since the last pet interaction (touch, chat turn, answered proactive). */
  sinceInteractionMs: z.number().min(0),

  // ---- energy --------------------------------------------------------------------------------
  /** Present-time expenditure subtracted from the circadian curve, points. */
  expenditure: z.number().min(0).max(40),

  // ---- affection (R3-8: monotonic) -----------------------------------------------------------
  affection: z.number().min(0).max(100),
  /** Points granted during `localDate`. Reset on a local-date change, never carried over. */
  earnedToday: z.number().min(0),
  /** Distinct local dates on which at least one PRESENT tick happened. */
  distinctDaysSeen: z.number().int().min(0),

  // ---- rhythm --------------------------------------------------------------------------------
  phase: ClockPhaseSchema,
  /** localDate strings of the phase/meal one-shots already fired today. */
  firedToday: z.object({
    morningGreeting: z.boolean(),
    nightEntry: z.boolean(),
    breakfast: z.boolean(),
    lunch: z.boolean(),
    dinner: z.boolean(),
  }),
  /** Per-day deterministic meal jitter in ms, derived from hash(localDate) (§3.9). */
  mealJitterMs: z.object({ breakfast: z.number(), lunch: z.number(), dinner: z.number() }),

  // ---- knobs ---------------------------------------------------------------------------------
  liveliness: z.number().min(0).max(1),
  mode: PersonaModeIpcSchema,

  // ---- power ---------------------------------------------------------------------------------
  battery: z.object({ charging: z.boolean(), level: z.number().min(0).max(1).nullable() }),
  batteryLowFired: z.boolean(),

  // ---- proactive gate state (never broadcast) ------------------------------------------------
  gate: z.object({
    /** Monotonic ms of the last DISPLAYED proactive line, or null. */
    lastDisplayedMono: z.number().nonnegative().nullable(),
    displayedToday: z.number().int().min(0),
    unansweredToday: z.number().int().min(0),
    /** Back-off exponent n (R3-7 layer 2). Reset to 0 by any user turn. */
    backoffN: z.number().int().min(0).max(8),
    /** Monotonic ms before which layer 2 refuses, or null. Full-jitter draw (§3.10.3). */
    backoffUntilMono: z.number().nonnegative().nullable(),
    /** The single in-flight INTENT, or null. */
    intent: z.object({
      reservationId: z.string().min(1),
      templateId: z.string().min(1),
      bucket: z.string().min(1),
      reservedMono: z.number().nonnegative(),
      /** Monotonic deadline: reservedMono + PROACTIVE_DEFER_MAX_MS. */
      deferUntilMono: z.number().nonnegative(),
    }).nullable(),
    /** Epoch ms until which 别打扰 is on; null = off; 8.64e15 = off forever. */
    mutedUntilWall: z.number().nonnegative().nullable(),
    /**
     * The last `localDate` whose quota was handed out, 'YYYY-MM-DD'. The local-day rule of §3.10
     * depends on it: a rollback to an EARLIER date resets the counters only if that date string is
     * not this one, so a backwards clock can never hand out a second quota for the same day.
     * Initialised to `localDateString(nowWall)` by `initialSimState`.
     */
    lastCountedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),

  // ---- rng -----------------------------------------------------------------------------------
  /** mulberry32 state. Serialised so a snapshot replays bit-identically (R3-1). */
  rngState: z.number().int().nonnegative(),
});
export type SimState = z.infer<typeof SimStateSchema>;

export const SIM_DEFAULTS = {
  // presence (R3-1 / D5: ">= 5 min without input -> nap/slack state")
  PRESENT_INPUT_MAX_MS: 300_000,      // 300 s — the PRESENT boundary AND D5's nap threshold
  IDLE_PRESENT_MAX_MS: 1_800_000,     // 30 min — beyond this a present-but-idle user is 'absent'
  NAP_IDLE_MS: 300_000,               // presentationMode -> 'nap'
  SLEEP_PHASE_IDLE_MS: 900_000,       // 15 min of idle DURING the 'night' phase -> 'sleep'
  TICK_MS: 500,                       // R3-1: 2 Hz
  TICK_DELTA_CAP_MS: 2_000,           // R3-1: never one decision per missed tick after sleep
  CURSOR_NEAR_DIP: 160,               // cursorNear predicate, distance from the pet window rect
  NEAR_EDGE_DIP: 64,                  // nearEdge predicate, distance from the work-area edge

  // mood (R3-8)
  MOOD_HALF_LIFE_PRESENT_MS: 3_000_000,   // 50 min of PRESENT time
  RETURN_SETTLE_AFTER_MS: 7_200_000,      // > 2 h absent triggers the one settling step
  RETURN_SETTLE_FRACTION: 0.70,           // only the ADVERSE component moves (R3-8)
  NEGLECT_WINDOW_MS: 2_700_000,           // 45 min PRESENT with zero interaction
  NEGLECT_STEP: -0.05,                    // per window
  NEGLECT_FLOOR: -0.2,                    // hard floor, structural (own field)
  VALENCE_BASE: 0.10,
  AROUSAL_BASE: 0.35,

  // energy
  ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS: 1_500_000,  // 25 min of PRESENT time
  ENERGY_PER_EXCHANGE: 0.5,
  ENERGY_PER_TOUCH: 0.15,
  ENERGY_EXPENDITURE_MAX: 40,

  // affection (R3-8)
  AFFECTION_DAILY_CAP: 12,
  AFFECTION_PER_EXCHANGE: 1.0,
  AFFECTION_PER_TOUCH: 0.5,
  AFFECTION_PER_NEW_DAY: 0.5,

  // rhythm (D4) — configurable; these are the defaults
  PHASE_HOURS: { morning: 6, day: 11, evening: 18, night: 22 },
  MEAL_HOURS: { breakfast: 8.0, lunch: 12.5, dinner: 19.0 },
  MEAL_JITTER_MAX_MS: 1_800_000,          // +/- 30 min, deterministic per local date

  // touch (D6). NOT re-declared: `packages/sim` cannot import from `apps/desktop` (§1.2), so these
  // three are DECLARED in `renderer/shared/lane-metrics.ts` (§5.11/§5.13) and MIRRORED here, with
  // `state.test.ts` importing both and asserting equality. One home, one assertion, no drift.
  TAP_BURST_COUNT: 7,                     // ">= 7 taps in 1 s -> annoyed"
  TAP_BURST_WINDOW_MS: 1_000,
  ANNOY_COOLDOWN_MS: 4_000,               // research 4.x: 3-5 s; 4 s is the shipped value

  // typing (R3-9)
  TYPING_ENTER_SAMPLES: 4,                // 4 consecutive 2 Hz samples = 2 s
  TYPING_EXIT_SAMPLES: 2,
  TYPING_INPUT_AGE_MAX_MS: 1_000,
  TYPING_CURSOR_DELTA_MAX_DIP: 2,
  TYPING_GLANCE_COOLDOWN_MS: 60_000,      // D11 glance, at most one per minute
  TYPING_CHEER_MIN_STREAK_MS: 300_000,    // D11 cheer: >= 5 min streak
  TYPING_CHEER_COOLDOWN_MS: 900_000,      // >= 15 min apart
  TYPING_CHEER_DELAY_MS: 5_000,           // fires on the FALLING edge, 5 s after typing stops

  // power (D11)
  BATTERY_LOW_LEVEL: 0.20,

  // proactive (R3-7 / bar §0)
  PROACTIVE_RATE_WINDOW_MS: 1_200_000,    // "<= 1 / 20 min"
  PROACTIVE_UNANSWERED_CAP: 3,            // "<= 3 unanswered per day"
  PROACTIVE_UNANSWERED_AFTER_MS: 600_000, // R3-7: unanswered = displayed and no input within 10 min
  PROACTIVE_PERSONA_CAP_DEFAULT: 2,       // "persona cap (default 2/day)"
  PROACTIVE_PERSONA_CAP_MAX: 5,           // R3-7: persona may set <= 5
  PROACTIVE_BACKOFF_BASE_MS: 2_400_000,   // R3-7: base 40 min
  PROACTIVE_BACKOFF_CAP_MS: 14_400_000,   // R3-7: cap 4 h
  PROACTIVE_SINCE_INPUT_MIN_MS: 60_000,   // "within 60 s of user input"
  PROACTIVE_DEFER_MAX_MS: 120_000,        // R3-7 layer 5
  PROACTIVE_TYPING_FALLING_EDGE_MS: 5_000,
  PROACTIVE_RESERVATION_STALE_MS: 300_000,// R3-7: a reservation older than 5 min at startup is void
  PROACTIVE_TEMPLATE_NO_REPEAT_MS: 2_592_000_000, // 30 days
  PROACTIVE_EVAL_INTERVAL_MS: 10_000,     // how often SimService asks the pure gate

  // liveliness (R3-13)
  LIVELINESS_DEFAULT: LIVELINESS_PRESETS.default,  // 0.30
} as const;
export type SimDefaults = typeof SIM_DEFAULTS;

/** §3.5: out-of-range inputs are clamped, never rejected. NaN collapses to `lo`. */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Every field at its §3.1 default; `phase` and `localDate` from `nowWall`;
 * `rngState = opts?.seed ?? 0x9e3779b9`. The user is assumed present and awake at launch — the
 * first TICK corrects that from the real sensors within 500 ms.
 */
export function initialSimState(nowMono: number, nowWall: number, opts?: { seed?: number }): SimState {
  const localDate = localDateString(nowWall);
  return {
    lastMono: nowMono,
    lastWall: nowWall,
    localDate,
    inputAgeMs: 0,
    locked: false,
    suspended: false,
    fullscreen: false,
    dnd: false,
    userHidden: false,
    presence: 'active',
    presentationMode: 'awake',
    probableTyping: false,
    typingSamples: 0,
    typingIdleSamples: 0,
    typingStreakStartedMono: null,
    cursorNear: false,
    onFloor: true,
    nearEdge: false,
    presentMsToday: 0,
    absentSinceMono: null,
    valence: SIM_DEFAULTS.VALENCE_BASE,
    arousal: SIM_DEFAULTS.AROUSAL_BASE,
    valenceBase: SIM_DEFAULTS.VALENCE_BASE,
    arousalBase: SIM_DEFAULTS.AROUSAL_BASE,
    neglect: 0,
    sinceInteractionMs: 0,
    expenditure: 0,
    affection: 0,
    earnedToday: 0,
    distinctDaysSeen: 0,
    phase: phaseOf(localHour(nowWall), SIM_DEFAULTS.PHASE_HOURS),
    firedToday: { morningGreeting: false, nightEntry: false, breakfast: false, lunch: false, dinner: false },
    mealJitterMs: {
      breakfast: mealJitter(localDate, 'breakfast'),
      lunch: mealJitter(localDate, 'lunch'),
      dinner: mealJitter(localDate, 'dinner'),
    },
    liveliness: SIM_DEFAULTS.LIVELINESS_DEFAULT,
    mode: 'character',
    battery: { charging: true, level: null },
    batteryLowFired: false,
    gate: {
      lastDisplayedMono: null,
      displayedToday: 0,
      unansweredToday: 0,
      backoffN: 0,
      backoffUntilMono: null,
      intent: null,
      mutedUntilWall: null,
      lastCountedDate: localDate,
    },
    rngState: seedRng(opts?.seed ?? RNG_DEFAULT_SEED),
  };
}
