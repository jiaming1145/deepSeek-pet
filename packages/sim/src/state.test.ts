import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LIVELINESS_PRESETS } from '@ds/protocol';
import { SIM_DEFAULTS, SimStateSchema, clamp, initialSimState } from './state.ts';
import { localDateString, mealJitter, phaseOf, localHour } from './phases.ts';

process.env.TZ = 'Asia/Shanghai';
const wall = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime();
const SRC = new URL('./', import.meta.url);

describe('SIM_DEFAULTS (§3.1 — every number, pinned)', () => {
  it('is exactly the contract table', () => {
    expect(SIM_DEFAULTS).toEqual({
      PRESENT_INPUT_MAX_MS: 300_000, IDLE_PRESENT_MAX_MS: 1_800_000, NAP_IDLE_MS: 300_000,
      SLEEP_PHASE_IDLE_MS: 900_000, TICK_MS: 500, TICK_DELTA_CAP_MS: 2_000, CURSOR_NEAR_DIP: 160,
      NEAR_EDGE_DIP: 64,
      MOOD_HALF_LIFE_PRESENT_MS: 3_000_000, RETURN_SETTLE_AFTER_MS: 7_200_000, RETURN_SETTLE_FRACTION: 0.70,
      NEGLECT_WINDOW_MS: 2_700_000, NEGLECT_STEP: -0.05, NEGLECT_FLOOR: -0.2, VALENCE_BASE: 0.10, AROUSAL_BASE: 0.35,
      ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS: 1_500_000, ENERGY_PER_EXCHANGE: 0.5, ENERGY_PER_TOUCH: 0.15,
      ENERGY_EXPENDITURE_MAX: 40,
      AFFECTION_DAILY_CAP: 12, AFFECTION_PER_EXCHANGE: 1.0, AFFECTION_PER_TOUCH: 0.5, AFFECTION_PER_NEW_DAY: 0.5,
      PHASE_HOURS: { morning: 6, day: 11, evening: 18, night: 22 },
      MEAL_HOURS: { breakfast: 8.0, lunch: 12.5, dinner: 19.0 }, MEAL_JITTER_MAX_MS: 1_800_000,
      TAP_BURST_COUNT: 7, TAP_BURST_WINDOW_MS: 1_000, ANNOY_COOLDOWN_MS: 4_000,
      TYPING_ENTER_SAMPLES: 4, TYPING_EXIT_SAMPLES: 2, TYPING_INPUT_AGE_MAX_MS: 1_000, TYPING_CURSOR_DELTA_MAX_DIP: 2,
      TYPING_GLANCE_COOLDOWN_MS: 60_000, TYPING_CHEER_MIN_STREAK_MS: 300_000, TYPING_CHEER_COOLDOWN_MS: 900_000,
      TYPING_CHEER_DELAY_MS: 5_000,
      BATTERY_LOW_LEVEL: 0.20,
      PROACTIVE_RATE_WINDOW_MS: 1_200_000, PROACTIVE_UNANSWERED_CAP: 3, PROACTIVE_UNANSWERED_AFTER_MS: 600_000,
      PROACTIVE_PERSONA_CAP_DEFAULT: 2, PROACTIVE_PERSONA_CAP_MAX: 5, PROACTIVE_BACKOFF_BASE_MS: 2_400_000,
      PROACTIVE_BACKOFF_CAP_MS: 14_400_000, PROACTIVE_SINCE_INPUT_MIN_MS: 60_000, PROACTIVE_DEFER_MAX_MS: 120_000,
      PROACTIVE_TYPING_FALLING_EDGE_MS: 5_000, PROACTIVE_RESERVATION_STALE_MS: 300_000,
      PROACTIVE_TEMPLATE_NO_REPEAT_MS: 2_592_000_000, PROACTIVE_EVAL_INTERVAL_MS: 10_000,
      LIVELINESS_DEFAULT: 0.30,
    });
    expect(SIM_DEFAULTS.LIVELINESS_DEFAULT).toBe(LIVELINESS_PRESETS.default);
  });

  it('mirrors the three touch constants of renderer/shared/lane-metrics.ts exactly (§5.13, the ONE permitted duplicate)', () => {
    // Task 5 (T3-B) owns lane-metrics.ts; read it as text so this package never imports apps/desktop (§1.2).
    const file = new URL('../../../apps/desktop/src/renderer/shared/lane-metrics.ts', import.meta.url);
    expect(existsSync(file), 'lane-metrics.ts must exist (Task 5) before this mirror can be asserted').toBe(true);
    const src = readFileSync(file, 'utf8');
    const pick = (name: string): number => {
      const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)`));
      if (!m) throw new Error(`${name} not declared in lane-metrics.ts`);
      return Number(m[1].replace(/_/g, ''));
    };
    expect(SIM_DEFAULTS.TAP_BURST_COUNT).toBe(pick('TAP_BURST_COUNT'));
    expect(SIM_DEFAULTS.TAP_BURST_WINDOW_MS).toBe(pick('TAP_BURST_WINDOW_MS'));
    expect(SIM_DEFAULTS.ANNOY_COOLDOWN_MS).toBe(pick('ANNOY_COOLDOWN_MS'));
  });

  it('phases.ts private MEAL_JITTER_MAX_MS mirror equals SIM_DEFAULTS.MEAL_JITTER_MAX_MS', () => {
    const src = readFileSync(new URL('./phases.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const MEAL_JITTER_MAX_MS = 1_800_000;/);
    expect(SIM_DEFAULTS.MEAL_JITTER_MAX_MS).toBe(1_800_000);
  });
});

describe('§1.2 dependency direction', () => {
  it('no non-test source in src/ imports electron, node:* or @ds/stage', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(new URL(f, SRC), 'utf8');
      expect(src, f).not.toMatch(/from '(electron|node:)/);
      expect(src, f).not.toMatch(/from '@ds\/(stage|brain|memory)/);
      expect(src, f).not.toMatch(/Date\.now\(|performance\.|setTimeout|setInterval/);
    }
  });
});

describe('clamp (§3.5)', () => {
  it('clamps and treats NaN as the low bound', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('initialSimState (§3.1)', () => {
  const nowWall = wall(2026, 8, 30, 14, 5); // a 'day' afternoon, local
  it('parses against SimStateSchema with every default', () => {
    const s = initialSimState(1_000, nowWall);
    expect(SimStateSchema.safeParse(s).success).toBe(true);
    expect(s.lastMono).toBe(1_000);
    expect(s.lastWall).toBe(nowWall);
    expect(s.localDate).toBe(localDateString(nowWall));
    expect(s.phase).toBe(phaseOf(localHour(nowWall)));
    expect(s.phase).toBe('day');
    expect(s.presence).toBe('active');
    expect(s.presentationMode).toBe('awake');
    expect(s.valence).toBe(SIM_DEFAULTS.VALENCE_BASE);
    expect(s.arousal).toBe(SIM_DEFAULTS.AROUSAL_BASE);
    expect(s.valenceBase).toBe(0.10);
    expect(s.arousalBase).toBe(0.35);
    expect(s.neglect).toBe(0);
    expect(s.affection).toBe(0);
    expect(s.earnedToday).toBe(0);
    expect(s.distinctDaysSeen).toBe(0);
    expect(s.expenditure).toBe(0);
    expect(s.liveliness).toBe(0.30);
    expect(s.mode).toBe('character');
    expect(s.firedToday).toEqual({ morningGreeting: false, nightEntry: false, breakfast: false, lunch: false, dinner: false });
    expect(s.mealJitterMs).toEqual({
      breakfast: mealJitter(s.localDate, 'breakfast'),
      lunch: mealJitter(s.localDate, 'lunch'),
      dinner: mealJitter(s.localDate, 'dinner'),
    });
    expect(s.gate).toEqual({
      lastDisplayedMono: null, displayedToday: 0, unansweredToday: 0, backoffN: 0, backoffUntilMono: null,
      intent: null, mutedUntilWall: null, lastCountedDate: s.localDate,
    });
    expect(s.rngState).toBe(0x9e3779b9);
    expect(s.typingStreakStartedMono).toBeNull();
    expect(s.absentSinceMono).toBeNull();
  });
  it('accepts a seed and computes the night phase from the wall clock', () => {
    const s = initialSimState(0, wall(2026, 8, 30, 23, 30), { seed: 42 });
    expect(s.rngState).toBe(42);
    expect(s.phase).toBe('night');
  });
  it('schema rejects the structural floors: neglect < -0.2, backoffN > 8, affection > 100', () => {
    const s = initialSimState(0, nowWall);
    expect(SimStateSchema.safeParse({ ...s, neglect: -0.21 }).success).toBe(false);
    expect(SimStateSchema.safeParse({ ...s, gate: { ...s.gate, backoffN: 9 } }).success).toBe(false);
    expect(SimStateSchema.safeParse({ ...s, affection: 100.1 }).success).toBe(false);
    expect(SimStateSchema.safeParse({ ...s, localDate: '2026-8-30' }).success).toBe(false);
  });
});

// ---- §5.13: the ONLY permitted duplicate, with its equality test ----------------------------
import { TAP_BURST_COUNT, TAP_BURST_WINDOW_MS, ANNOY_COOLDOWN_MS } from '../../../apps/desktop/src/renderer/shared/lane-metrics';

describe('§5.13 lane-metrics mirror', () => {
  it('SIM_DEFAULTS mirrors the three touch constants exactly', () => {
    expect(SIM_DEFAULTS.TAP_BURST_COUNT).toBe(TAP_BURST_COUNT);
    expect(SIM_DEFAULTS.TAP_BURST_WINDOW_MS).toBe(TAP_BURST_WINDOW_MS);
    expect(SIM_DEFAULTS.ANNOY_COOLDOWN_MS).toBe(ANNOY_COOLDOWN_MS);
    expect([TAP_BURST_COUNT, TAP_BURST_WINDOW_MS, ANNOY_COOLDOWN_MS]).toEqual([7, 1_000, 4_000]);
  });
});
