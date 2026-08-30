import { describe, expect, it } from 'vitest';
import { isPresent, presenceOf, presentationModeOf, typingStep, type TypingState } from './presence.ts';
import { SIM_DEFAULTS } from './state.ts';

describe('isPresent / presenceOf (§3.3 — PRESENT := !locked && !suspended && inputAgeMs < 300 s)', () => {
  it('B-01 boundary: 299 900 is present, 300 000 is not', () => {
    expect(isPresent({ locked: false, suspended: false, inputAgeMs: 299_900 })).toBe(true);
    expect(isPresent({ locked: false, suspended: false, inputAgeMs: 300_000 })).toBe(false);
    expect(isPresent({ locked: true, suspended: false, inputAgeMs: 0 })).toBe(false);
    expect(isPresent({ locked: false, suspended: true, inputAgeMs: 0 })).toBe(false);
  });
  it('visibility never enters the predicate (the type has no userHidden/fullscreen field)', () => {
    expect(isPresent({ locked: false, suspended: false, inputAgeMs: 0 })).toBe(true);
  });
  it('presenceOf: active < 300 s <= idle-present < 30 min <= absent; locked/suspended => absent', () => {
    expect(presenceOf({ locked: false, suspended: false, inputAgeMs: 299_900 })).toBe('active');
    expect(presenceOf({ locked: false, suspended: false, inputAgeMs: 300_000 })).toBe('idle-present');
    expect(presenceOf({ locked: false, suspended: false, inputAgeMs: 1_799_999 })).toBe('idle-present');
    expect(presenceOf({ locked: false, suspended: false, inputAgeMs: 1_800_000 })).toBe('absent');
    expect(presenceOf({ locked: true, suspended: false, inputAgeMs: 0 })).toBe('absent');
    expect(presenceOf({ locked: false, suspended: true, inputAgeMs: 0 })).toBe('absent');
  });
});

describe('presentationModeOf (D5 nap at >= 5 min; D4 sleep after 15 min idle during night)', () => {
  it('awake below NAP_IDLE_MS, nap at and above it', () => {
    expect(presentationModeOf('day', 0)).toBe('awake');
    expect(presentationModeOf('day', 299_999)).toBe('awake');
    expect(presentationModeOf('day', 300_000)).toBe('nap');
    expect(presentationModeOf('day', 3_600_000)).toBe('nap');
  });
  it('sleep only during night and only after SLEEP_PHASE_IDLE_MS', () => {
    expect(presentationModeOf('night', 899_999)).toBe('nap');
    expect(presentationModeOf('night', 900_000)).toBe('sleep');
    expect(presentationModeOf('evening', 900_000)).toBe('nap');
    expect(SIM_DEFAULTS.SLEEP_PHASE_IDLE_MS).toBe(900_000);
  });
});

describe('typingStep (§10.4 — the probableTyping predicate, exactly R3-9)', () => {
  const idle: TypingState = { probableTyping: false, typingSamples: 0, typingIdleSamples: 0, typingStreakStartedMono: null };
  const typing = { inputAgeMs: 200, cursorDeltaDip: 0 };
  const notTyping = { inputAgeMs: 200, cursorDeltaDip: 30 };
  const run = (start: TypingState, samples: { inputAgeMs: number | null; cursorDeltaDip: number | null }[], t0 = 10_000) => {
    let s: ReturnType<typeof typingStep> = { ...start, rose: false, fell: false };
    let t = t0;
    const edges: string[] = [];
    for (const smp of samples) { s = typingStep(s, smp, t); if (s.rose) edges.push(`rose@${t}`); if (s.fell) edges.push(`fell@${t}`); t += SIM_DEFAULTS.TICK_MS; }
    return { s, edges };
  };
  it('enters after 4 consecutive typing samples, with the streak start back-dated 4 samples', () => {
    const { s, edges } = run(idle, [typing, typing, typing, typing]);
    expect(s.probableTyping).toBe(true);
    expect(s.typingSamples).toBe(4);
    expect(edges).toEqual(['rose@11500']);
    expect(s.typingStreakStartedMono).toBe(11_500 - 4 * SIM_DEFAULTS.TICK_MS);
  });
  it('three typing samples then a moving cursor never enters', () => {
    const { s } = run(idle, [typing, typing, typing, notTyping, typing, typing, typing]);
    expect(s.probableTyping).toBe(false);
    expect(s.typingSamples).toBe(3);
  });
  it('exits after 2 consecutive non-typing samples and reports the falling edge once', () => {
    const { s, edges } = run(idle, [typing, typing, typing, typing, notTyping, notTyping, notTyping]);
    expect(s.probableTyping).toBe(false);
    expect(edges).toEqual(['rose@11500', 'fell@12500']);
    expect(s.typingStreakStartedMono).toBeNull();
  });
  it('one non-typing sample inside a streak does not exit', () => {
    const { s } = run(idle, [typing, typing, typing, typing, notTyping, typing]);
    expect(s.probableTyping).toBe(true);
    expect(s.typingIdleSamples).toBe(0);
  });
  it('null sensor values are never typing samples (degraded sensor => probableTyping stays false)', () => {
    const { s } = run(idle, Array(10).fill({ inputAgeMs: null, cursorDeltaDip: null }));
    expect(s.probableTyping).toBe(false);
    const { s: s2 } = run(idle, Array(10).fill({ inputAgeMs: 100, cursorDeltaDip: null }));
    expect(s2.probableTyping).toBe(false);
  });
  it('thresholds are strict: age 1000 and delta 2 are NOT typing samples; 999 and 1.99 are', () => {
    expect(typingStep({ ...idle, rose: false, fell: false }, { inputAgeMs: 1000, cursorDeltaDip: 0 }, 0).typingSamples).toBe(0);
    expect(typingStep({ ...idle, rose: false, fell: false }, { inputAgeMs: 0, cursorDeltaDip: 2 }, 0).typingSamples).toBe(0);
    expect(typingStep({ ...idle, rose: false, fell: false }, { inputAgeMs: 999, cursorDeltaDip: 1.99 }, 0).typingSamples).toBe(1);
  });
});
