import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db.ts';
import { PROACTIVE_NO_REPEAT_MS, PROACTIVE_RESERVATION_STALE_MS, ProactiveLogStore } from './proactive-log.ts';

const DAY = '2026-08-30';
const T0 = Date.UTC(2026, 7, 30, 1, 0, 0);
let db: DatabaseSync;
let log: ProactiveLogStore;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  migrate(db);                       // Task 2's DDL_V2 creates proactive_log
  log = new ProactiveLogStore(db);
});

const reserve = (id: string, templateId = 'world_01', at = T0) =>
  log.reserve({ id, templateId, bucket: 'world', reservedAt: at, localDate: DAY });

describe('ProactiveLogStore (§3.10.6)', () => {
  it('constants', () => {
    expect(PROACTIVE_RESERVATION_STALE_MS).toBe(300_000);
    expect(PROACTIVE_NO_REPEAT_MS).toBe(30 * 86_400_000);
  });

  it('counts DISPLAYED rows only — reserved and generated rows never charge (R3-7)', () => {
    reserve('r1'); log.markGenerated('r1', T0 + 1);
    reserve('r2'); log.markGenerated('r2', T0 + 1); log.markDisplayed('r2', T0 + 2, 'turn-2');
    reserve('r3'); log.setOutcome('r3', 'discarded');
    expect(log.displayedToday(DAY)).toBe(1);
    expect(log.displayedToday('2026-08-29')).toBe(0);
  });

  it('unansweredToday = displayed AND answered_at IS NULL AND outcome = displayed', () => {
    reserve('a'); log.markDisplayed('a', T0 + 2, 't-a');            // displayed, unanswered
    reserve('b'); log.markDisplayed('b', T0 + 3, 't-b'); log.markAnswered('b', T0 + 4);
    reserve('c'); log.markDisplayed('c', T0 + 5, 't-c'); log.setOutcome('c', 'failed');
    expect(log.unansweredToday(DAY)).toBe(1);
    const row = log.get('a');
    expect(row?.outcome).toBe('displayed');
    expect(row?.turnId).toBe('t-a');
  });

  it('30-day no-repeat is on template_id over displayed rows', () => {
    reserve('x', 'greeting_03', T0); log.markDisplayed('x', T0, 't');
    reserve('y', 'greeting_04', T0);                         // reserved only, never displayed
    expect(log.templateDisplayedSince('greeting_03', T0 - 1)).toBe(true);
    expect(log.templateDisplayedSince('greeting_03', T0)).toBe(false);   // strictly greater
    expect(log.templateDisplayedSince('greeting_04', 0)).toBe(false);
    expect(log.displayedTemplateIdsSince(0)).toEqual(['greeting_03']);
  });

  it('voidStale voids in-flight reservations older than 5 min and leaves fresh ones as the live intent', () => {
    reserve('old', 'w1', T0);
    reserve('fresh', 'w2', T0 + PROACTIVE_RESERVATION_STALE_MS - 1);
    reserve('done', 'w3', T0); log.markDisplayed('done', T0 + 1, 't');
    const now = T0 + PROACTIVE_RESERVATION_STALE_MS;
    expect(log.voidStale(now)).toBe(1);
    expect(log.get('old')?.outcome).toBe('void');
    expect(log.get('done')?.outcome).toBe('displayed');
    expect(log.liveIntent(now)?.id).toBe('fresh');
    log.setOutcome('fresh', 'suppressed');
    expect(log.liveIntent(now)).toBeNull();
  });

  it('reserve refuses a duplicate id', () => {
    reserve('dup');
    expect(() => reserve('dup')).toThrow();
  });
});
