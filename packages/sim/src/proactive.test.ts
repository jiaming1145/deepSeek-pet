import { describe, expect, it } from 'vitest';
import { PROACTIVE_VERDICTS } from '@ds/protocol';
import { initialSimState, SIM_DEFAULTS, type SimState } from './state.ts';
import { nextLocalMidnight } from './phases.ts';
import { GATE_REASONS, shouldSpeak, bucketFor, backoffDelay, sensorsUnknown, type GateInput } from './proactive.ts';

const D = SIM_DEFAULTS;
const WALL = new Date(2026, 8, 1, 14, 0, 0).getTime();          // local 14:00 -> phase 'day'
const base = (over: Partial<SimState> = {}): SimState =>
  ({ ...initialSimState(1_000_000, WALL), inputAgeMs: 120_000, ...over });
const input = (state: SimState, over: Partial<GateInput> = {}): GateInput =>
  ({ state, nowMono: 1_000_000, nowWall: WALL, personaCap: 2, turnActive: false, chatOpen: false, roll: 0, ...over });

describe('§3.10.1 shape', () => {
  it('has the 18 reason codes in order', () => {
    expect([...GATE_REASONS]).toEqual(['rate-20min', 'backoff', 'unanswered-3', 'persona-cap', 'muted',
      'typing', 'fullscreen', 'locked', 'suspended', 'dnd', 'user-hidden', 'recent-input', 'turn-active',
      'chat-open', 'asleep', 'plain-mode', 'sensor-unknown', 'liveliness-roll']);
  });
  it('GateVerdict verdicts are a strict subset of ProactiveVerdict (§3.10.5)', () => {
    const gate = ['eligible', 'rateLimited', 'unansweredCap', 'personaCap', 'suppressed', 'muted'];
    for (const v of gate) expect(PROACTIVE_VERDICTS).toContain(v);
    expect(PROACTIVE_VERDICTS.length).toBeGreaterThan(gate.length);
  });
});

describe('§3.10.2 layers in order', () => {
  it('eligible on the quiet baseline', () => {
    expect(shouldSpeak(input(base()))).toEqual({ verdict: 'eligible' });
  });
  it('layer 0 muted wins over everything, nextEligibleAt = mutedUntilWall', () => {
    const s = base({ locked: true, gate: { ...base().gate, mutedUntilWall: WALL + 5 } });
    expect(shouldSpeak(input(s))).toEqual({ verdict: 'muted', reason: 'muted', nextEligibleAt: WALL + 5 });
  });
  it('layer 1 rate: 20 min rolling, nextEligibleAt in wall ms', () => {
    const s = base({ gate: { ...base().gate, lastDisplayedMono: 1_000_000 - 600_000 } });
    expect(shouldSpeak(input(s))).toEqual({ verdict: 'rateLimited', reason: 'rate-20min',
      nextEligibleAt: WALL + (D.PROACTIVE_RATE_WINDOW_MS - 600_000) });
    expect(shouldSpeak(input(s, { nowMono: 1_000_000 + 600_000, nowWall: WALL + 600_000 }))).toEqual({ verdict: 'eligible' });
  });
  it('layer 2 unanswered-3 then backoff', () => {
    const s3 = base({ gate: { ...base().gate, unansweredToday: 3 } });
    expect(shouldSpeak(input(s3))).toEqual({ verdict: 'unansweredCap', reason: 'unanswered-3', nextEligibleAt: nextLocalMidnight(WALL) });
    const sb = base({ gate: { ...base().gate, backoffUntilMono: 1_000_000 + 30_000 } });
    expect(shouldSpeak(input(sb))).toEqual({ verdict: 'rateLimited', reason: 'backoff', nextEligibleAt: WALL + 30_000 });
  });
  it('layer 3 persona cap on DISPLAYED lines', () => {
    const s = base({ gate: { ...base().gate, displayedToday: 2 } });
    expect(shouldSpeak(input(s))).toEqual({ verdict: 'personaCap', reason: 'persona-cap', nextEligibleAt: nextLocalMidnight(WALL) });
    expect(shouldSpeak(input(s, { personaCap: 5 }))).toEqual({ verdict: 'eligible' });
  });
  it.each<[string, Partial<SimState>, Partial<GateInput>]>([
    ['plain-mode', { mode: 'plain' }, {}],
    ['typing', { probableTyping: true }, {}],
    ['fullscreen', { fullscreen: true }, {}],
    ['locked', { locked: true }, {}],
    ['suspended', { suspended: true }, {}],
    ['dnd', { dnd: true }, {}],
    ['user-hidden', { userHidden: true }, {}],
    ['recent-input', { inputAgeMs: 59_999 }, {}],
    ['turn-active', {}, { turnActive: true }],
    ['chat-open', {}, { chatOpen: true }],
    ['asleep', { phase: 'night', presentationMode: 'nap' }, {}],
  ])('layer 4 suppression %s has nextEligibleAt null', (reason, so, io) => {
    expect(shouldSpeak(input(base(so), io))).toEqual({ verdict: 'suppressed', reason, nextEligibleAt: null });
  });
  it('layer 4 order: plain-mode is reported before typing', () => {
    // DEVIATION: the plan reads `.reason` straight off the verdict, but `{ verdict: 'eligible' }`
    // carries no `reason` — TS2339. Asserting the whole verdict keeps the intent and typechecks.
    expect(shouldSpeak(input(base({ mode: 'plain', probableTyping: true }))))
      .toEqual({ verdict: 'suppressed', reason: 'plain-mode', nextEligibleAt: null });
  });
  it('night + awake is NOT asleep', () => {
    expect(shouldSpeak(input(base({ phase: 'night', presentationMode: 'awake' })))).toEqual({ verdict: 'eligible' });
  });
  it('liveliness roll: at L=0.30 eligibility is 0.65; roll 0.65 suppresses, 0.6499 passes; never widens a cap', () => {
    expect(shouldSpeak(input(base(), { roll: 0.65 }))).toEqual({ verdict: 'suppressed', reason: 'liveliness-roll', nextEligibleAt: null });
    expect(shouldSpeak(input(base(), { roll: 0.6499 }))).toEqual({ verdict: 'eligible' });
    const capped = base({ gate: { ...base().gate, displayedToday: 2 } });
    expect(shouldSpeak(input(capped, { roll: 0 })).verdict).toBe('personaCap');
  });
  it('sensorsUnknown is false on a default state (C-2: no field carries it yet)', () => {
    expect(sensorsUnknown(base())).toBe(false);
  });
});

describe('§3.10.3 full-jitter back-off draw', () => {
  it('n=1 draws in [0, 40 min); n=8 is capped at 4 h; deterministic per rngState', () => {
    const a = backoffDelay(1, 12345); const b = backoffDelay(1, 12345);
    expect(a).toEqual(b);
    expect(a.delayMs).toBeGreaterThanOrEqual(0); expect(a.delayMs).toBeLessThan(D.PROACTIVE_BACKOFF_BASE_MS);
    expect(a.rngState).not.toBe(12345);
    for (let seed = 1; seed < 200; seed++) expect(backoffDelay(8, seed).delayMs).toBeLessThan(D.PROACTIVE_BACKOFF_CAP_MS);
    for (let seed = 1; seed < 200; seed++) expect(backoffDelay(3, seed).delayMs).toBeLessThan(D.PROACTIVE_BACKOFF_BASE_MS * 4);
  });
});

describe('§3.10.5 bucketFor', () => {
  it('greeting in the morning before the greeting fired; then night; then meal; then world', () => {
    expect(bucketFor(base({ phase: 'morning' }))).toBe('greeting');
    expect(bucketFor(base({ phase: 'morning', firedToday: { ...base().firedToday, morningGreeting: true } }))).toBe('world');
    expect(bucketFor(base({ phase: 'night', presentationMode: 'awake' }))).toBe('night');
    expect(bucketFor(base({ phase: 'night', presentationMode: 'nap' }))).toBe('world');
  });
  it('meal: within 20 min after a fired cue', () => {
    const lunchAt = new Date(2026, 8, 1, 12, 30, 0).getTime();
    const s = base({ lastWall: lunchAt + 60_000, mealJitterMs: { breakfast: 0, lunch: 0, dinner: 0 },
      firedToday: { ...base().firedToday, breakfast: true, lunch: true } });
    expect(bucketFor(s)).toBe('meal');
    expect(bucketFor({ ...s, lastWall: lunchAt + 21 * 60_000 })).toBe('world');
  });
  it('longGap and callback need externals (C-3); they never fire without them', () => {
    expect(bucketFor(base())).toBe('world');
    expect(bucketFor(base(), { returnedAwayMs: 6 * 3_600_000, spokenSinceReturn: false, hasCallbackMaterial: false })).toBe('longGap');
    expect(bucketFor(base(), { returnedAwayMs: 6 * 3_600_000, spokenSinceReturn: true, hasCallbackMaterial: true })).toBe('callback');
    expect(bucketFor(base(), { returnedAwayMs: null, spokenSinceReturn: false, hasCallbackMaterial: false })).toBe('world');
  });
});
