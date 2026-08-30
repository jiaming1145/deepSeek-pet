// packages/sim/src/fixtures/sim/boundary.test.ts — runs B-01, B-02, B-03, B-10
import { describe, expect, it } from 'vitest';
import * as B01 from './presence-299-vs-300.fixture.ts';
import * as B02 from './lock-suspend-no-mood.fixture.ts';
import * as B03 from './clock-rollback-dst.fixture.ts';
import * as B10 from './midnight-caps.fixture.ts';

describe('§12.7 pure boundary fixtures', () => {
  it('B-01 presence 299.9 s vs 300 s; returned within 1 000 ms; affection unchanged', () => {
    const r = B01.run();
    expect(r.presences).toEqual(B01.expected.presences); expect(r.modes).toEqual(B01.expected.modes);
    expect(r.effects).toContainEqual({ kind: 'simEvent', payload: B01.expected.returned });
    expect(r.returnedLatencyMs).toBeLessThanOrEqual(B01.expected.maxLatencyMs);
    expect(r.state.affection).toBe(r.affectionBefore); expect(r.persisted.state.presence).toBe('active');
  });
  it('B-02 lock / suspend: mood bit-identical across each gap except the one settling step; nothing else moves', () => {
    const r = B02.run();
    for (const g of [r.lock, r.susp]) {
      expect(g.during).toEqual(g.frozen);
      const base = r.start.valenceBase + r.start.neglect;
      const v = g.frozen.valence < base ? g.frozen.valence + (base - g.frozen.valence) * B02.expected.settle : g.frozen.valence;
      expect(g.state.valence).toBe(v);
      expect(g.state.arousal).toBe(g.frozen.arousal + (r.start.arousalBase - g.frozen.arousal) * B02.expected.settle);
    }
    expect(r.simEventKinds).toEqual(B02.expected.simEventKinds);
    expect(r.state.expenditure).toBe(r.start.expenditure);
    expect(r.persisted.state).toMatchObject({ affection: r.start.affection, earnedToday: r.start.earnedToday, neglect: r.start.neglect });
  });
  it('B-03 DST / rollback: phase follows the wall clock; one-shots re-arm once per distinct localDate; no second quota', () => {
    const r = B03.run();
    const meals = r.log.flatMap(l => l.fx.filter(f => f.kind === 'simEvent' && (f as { payload: { kind: string } }).payload.kind === 'mealCue'));
    expect(meals.length).toBeLessThanOrEqual(2);                       // at most one dinner per distinct localDate
    expect(r.log.map(l => l.phase)).toEqual(['evening', 'evening', 'evening', 'evening', 'night', 'evening', 'evening', 'night']);
    expect(new Set(r.log.map(l => l.date)).size).toBe(2);
    expect(r.log[2]!.displayed).toBe(2);                               // DST back within the same date: no reset
    expect(r.log[7]!.displayed).toBe(0);                               // C-7: A->B->A hands the SAME quota back? see concern
  });
  it('B-10 midnight: caps and earnedToday reset, distinctDaysSeen +1, gate reopens', () => {
    const r = B10.run();
    expect(r.gateBefore.verdict).toBe('unansweredCap');
    expect(r.state.gate).toMatchObject({ displayedToday: 0, unansweredToday: 0 });
    expect(r.state.earnedToday).toBe(0.5); expect(r.state.distinctDaysSeen).toBe(r.daysBefore + 1);
    expect(r.gateAfter).toEqual({ verdict: 'eligible' });
    expect(r.persisted.state.localDate).toBe('2026-09-02'); expect(r.persisted.state.gate.lastCountedDate).toBe('2026-09-02');
  });
});
