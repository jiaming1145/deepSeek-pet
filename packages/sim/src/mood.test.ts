import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '@ds/protocol';
import { MOOD_NUDGES, applyNudge, decayToward, moodNudge, moodTick, neglectTick, settleOnReturn } from './mood.ts';
import { SIM_DEFAULTS, initialSimState } from './state.ts';

const base = () => initialSimState(0, 1_700_000_000_000);
const HL = SIM_DEFAULTS.MOOD_HALF_LIFE_PRESENT_MS;

describe('decayToward (§3.7.1 — R3-8 equation verbatim)', () => {
  it('halves the distance to base after one half-life of PRESENT time', () => {
    expect(decayToward(1, 0, HL, HL)).toBeCloseTo(0.5, 12);
    expect(decayToward(-0.6, 0.1, HL, HL)).toBeCloseTo(-0.25, 12);
    expect(decayToward(0.9, 0.1, 2 * HL, HL)).toBeCloseTo(0.3, 12);
  });
  it('is the identity for presentDelta <= 0 (mood is frozen while absent)', () => {
    expect(decayToward(0.9, 0.1, 0, HL)).toBe(0.9);
    expect(decayToward(0.9, 0.1, -5, HL)).toBe(0.9);
  });
  it('a 2 s tick moves by exp(-ln2 * 2000/3000000)', () => {
    const k = Math.exp(-Math.LN2 * 2000 / HL);
    expect(decayToward(1, 0, 2000, HL)).toBeCloseTo(k, 15);
  });
});

describe('moodNudge (§3.7.2 table)', () => {
  it('pins every row', () => {
    expect(moodNudge({ kind: 'emotion', emotion: 'happy' })).toEqual({ dValence: 0.05, dArousal: 0.04 });
    expect(moodNudge({ kind: 'emotion', emotion: 'surprised' })).toEqual({ dValence: 0.02, dArousal: 0.10 });
    expect(moodNudge({ kind: 'emotion', emotion: 'curious' })).toEqual({ dValence: 0.02, dArousal: 0.04 });
    expect(moodNudge({ kind: 'emotion', emotion: 'think' })).toEqual({ dValence: 0, dArousal: -0.02 });
    expect(moodNudge({ kind: 'emotion', emotion: 'question' })).toEqual({ dValence: 0, dArousal: 0.01 });
    expect(moodNudge({ kind: 'emotion', emotion: 'neutral' })).toEqual({ dValence: 0, dArousal: 0 });
    expect(moodNudge({ kind: 'emotion', emotion: 'awkward' })).toEqual({ dValence: -0.01, dArousal: 0.03 });
    expect(moodNudge({ kind: 'emotion', emotion: 'sad' })).toEqual({ dValence: -0.05, dArousal: -0.04 });
    expect(moodNudge({ kind: 'emotion', emotion: 'angry' })).toEqual({ dValence: -0.04, dArousal: 0.08 });
    expect(moodNudge({ kind: 'touch', annoyed: false })).toEqual({ dValence: 0.02, dArousal: 0.03 });
    expect(moodNudge({ kind: 'touch', annoyed: true })).toEqual({ dValence: -0.05, dArousal: 0.10 });
    expect(moodNudge({ kind: 'turnInterrupted' })).toEqual({ dValence: -0.02, dArousal: 0 });
    expect(moodNudge({ kind: 'proactiveUnanswered' })).toEqual({ dValence: 0, dArousal: -0.03 });
  });
  it('covers every Emotion of the Phase 2 vocabulary', () => {
    expect(Object.keys(MOOD_NUDGES.emotion).sort()).toEqual([...EMOTIONS].sort());
  });
  it('applyNudge clamps valence to [-1,1] and arousal to [0,1]', () => {
    expect(applyNudge(0.99, 0.99, { kind: 'emotion', emotion: 'happy' })).toEqual({ valence: 1, arousal: 1 });
    expect(applyNudge(-0.98, 0.01, { kind: 'emotion', emotion: 'sad' })).toEqual({ valence: -1, arousal: 0 });
    const r = applyNudge(0.1, 0.35, { kind: 'touch', annoyed: false });
    expect(r.valence).toBeCloseTo(0.12, 12);
    expect(r.arousal).toBeCloseTo(0.38, 12);
  });
});

describe('moodTick (§3.7.1 — both axes toward their bases, valence base includes neglect)', () => {
  it('decays valence toward valenceBase + neglect and arousal toward arousalBase', () => {
    const s = { ...base(), valence: 0.8, arousal: 0.9, neglect: -0.1 };
    const r = moodTick(s, HL);
    expect(r.valence).toBeCloseTo(0 + (0.8 - 0) * 0.5, 12); // base = 0.1 + (-0.1) = 0
    expect(r.arousal).toBeCloseTo(0.35 + (0.9 - 0.35) * 0.5, 12);
  });
  it('does nothing with presentDelta 0 (B-02: bit-identical across lock/suspend)', () => {
    const s = { ...base(), valence: 0.8, arousal: 0.9 };
    expect(moodTick(s, 0)).toEqual({ valence: 0.8, arousal: 0.9 });
  });
});

describe('settleOnReturn (§3.7.3 — adverse component only)', () => {
  it('moves valence 70 % toward base only when below base; arousal always 70 % toward base', () => {
    const s = { ...base(), valence: -0.5, arousal: 0.95, neglect: 0 };
    const r = settleOnReturn(s);
    expect(r.valence).toBeCloseTo(-0.5 + (0.1 - -0.5) * 0.7, 12);
    expect(r.arousal).toBeCloseTo(0.95 + (0.35 - 0.95) * 0.7, 12);
  });
  it('positive valence survives absence intact', () => {
    const s = { ...base(), valence: 0.9, arousal: 0.35 };
    expect(settleOnReturn(s)).toEqual({ valence: 0.9, arousal: 0.35 });
  });
  it('uses valenceBase + neglect as the base and never touches neglect', () => {
    const s = { ...base(), valence: -0.5, neglect: -0.2 };
    const r = settleOnReturn(s);
    expect(r.valence).toBeCloseTo(-0.5 + (-0.1 - -0.5) * 0.7, 12);
    expect('neglect' in r).toBe(false);
  });
});

describe('neglectTick (§3.7.4 — the ONLY downward pressure)', () => {
  it('steps -0.05 per 45-min window of PRESENT time, floor -0.2, carrying the remainder', () => {
    expect(neglectTick(0, 0, 2000)).toEqual({ sinceInteractionMs: 2000, neglect: 0 });
    expect(neglectTick(2_699_000, 0, 2000)).toEqual({ sinceInteractionMs: 1000, neglect: -0.05 });
    expect(neglectTick(2_700_000, -0.15, 0)).toEqual({ sinceInteractionMs: 0, neglect: -0.2 });
    expect(neglectTick(2_700_000, -0.2, 2000)).toEqual({ sinceInteractionMs: 2000, neglect: -0.2 });
  });
  it('reaches the floor after exactly four unattended windows and never passes it', () => {
    let st = { sinceInteractionMs: 0, neglect: 0 };
    for (let i = 0; i < 4 * 1350; i++) st = neglectTick(st.sinceInteractionMs, st.neglect, 2000); // 4 x 45 min in 2-s ticks
    expect(st.neglect).toBeCloseTo(-0.2, 12);
    for (let i = 0; i < 1350; i++) st = neglectTick(st.sinceInteractionMs, st.neglect, 2000);
    expect(st.neglect).toBeCloseTo(-0.2, 12);
  });
  it('a corrupted sinceInteractionMs cannot spin: one window per call at most is consumed in bounded time', () => {
    const r = neglectTick(2_700_000 * 1000, 0, 0);
    expect(r.neglect).toBe(-0.2);
    expect(r.sinceInteractionMs).toBe(0);
  });
});
