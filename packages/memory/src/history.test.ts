import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, MetricsRecord, Summarize, TrimPlan } from '@ds/brain';
import { estimateTokens, planTrim } from '@ds/brain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KV_LAST_TRIM_ID, getKv, openDb, setKv } from './db.ts';
import { HISTORY_WINDOW_SAFETY_TOKENS, HistoryStore } from './history.ts';
import { RunningSummary } from './summary.ts';

const NOW = 1_700_000_000_000;

let dir: string;
let db: DatabaseSync;
let clock: number;
let summarizeCalls: Array<[string, ChatMessage[]]>;
let store: HistoryStore;

const okSummarize: Summarize = (oldSummary, dropped) => {
  summarizeCalls.push([oldSummary, dropped]);
  return Promise.resolve('这是摘要。');
};

function makeStore(overrides: { maxTokens?: number; summarize?: Summarize } = {}): HistoryStore {
  return new HistoryStore({
    db,
    summary: new RunningSummary(db, () => clock),
    summarize: overrides.summarize ?? okSummarize,
    maxTokens: overrides.maxTokens,
    now: () => clock,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ds-memory-hist-'));
  db = openDb(join(dir, 'ds.sqlite'));
  clock = NOW;
  summarizeCalls = [];
  store = makeStore();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('append then window() returns rows oldest-first with roles preserved', async () => {
    await store.append('user', '在吗');
    await store.append('assistant', '在的。', { turnId: 't1', kind: 'chat' });
    await store.append('user', '今天累死了');

    expect(await store.window()).toEqual([
      { role: 'user', content: '在吗' },
      { role: 'assistant', content: '在的。' },
      { role: 'user', content: '今天累死了' },
    ]);
    expect(await store.facts()).toEqual([]);

    const row = db.prepare('SELECT tokens FROM messages WHERE id = 1').get() as { tokens: number };
    expect(row.tokens).toBe(estimateTokens('在吗'));
  });

  it('window() truncates from the oldest end to respect the token budget', async () => {
    // 100 rows, each `第<i>条` + 1500 hanzi -> ceil(1502 / 1.5 + 1 * 1.3) = 1003 tokens per row.
    for (let i = 0; i < 100; i++) {
      await store.append(i % 2 === 0 ? 'user' : 'assistant', `第${i}条${'话'.repeat(1500)}`);
    }
    expect(estimateTokens(`第0条${'话'.repeat(1500)}`)).toBe(1003);

    const budgeted = makeStore({ maxTokens: 24_000 });
    const msgs = await budgeted.window();
    const total = msgs.reduce((n, m) => n + estimateTokens(m.content), 0);

    expect(msgs.length).toBe(23); // 23 x 1003 = 23069 <= 24000 < 24 x 1003
    expect(total).toBe(23_069);
    expect(msgs[msgs.length - 1].content).toBe(`第99条${'话'.repeat(1500)}`);
  });

  it('the 32_000 safety net leaves planTrim a non-empty drop', async () => {
    // 30 turns = 60 rows. Each row is 900 hanzi = ceil(900 / 1.5) = exactly 600 estimated
    // tokens, so one turn costs 1_200 and the whole history costs 36_000.
    const LINE = '话'.repeat(900);
    expect(estimateTokens(LINE)).toBe(600);
    expect(HISTORY_WINDOW_SAFETY_TOKENS).toBe(32_000);
    for (let i = 0; i < 60; i++) {
      await store.append(i % 2 === 0 ? 'user' : 'assistant', LINE);
    }

    // Shipped default (32_000): 36_000 - 7 x 600 = 31_800 <= 32_000 < 31_800 + 600.
    const win = await store.window();
    expect(win.length).toBe(53);
    expect(win.reduce((n, m) => n + estimateTokens(m.content), 0)).toBe(31_800);
    expect(win[0].role).toBe('assistant'); // ids 1..7 fell out; the window starts at id 8

    // planTrim's own trigger is still 24_000, so 31_800 trims: 14 rows reach 8_400 >= 8_000,
    // then one more row is dropped so the first kept message is a user turn again.
    const plan = planTrim(win);
    expect(plan.drop.length).toBe(15);
    expect(plan.droppedTokens).toBe(9_000);
    expect(plan.keep.length).toBe(38);
    expect(plan.keep[0].role).toBe('user');

    // The rejected 24_000 default, for contrast: window() would truncate to exactly 24_000
    // first and planTrim would find nothing to drop, so onTrimNeeded could never fire and
    // the running summary could never refresh. This is the bug contracts §4.3 prevents.
    const naive = makeStore({ maxTokens: 24_000 });
    const naiveWin = await naive.window();
    expect(naiveWin.length).toBe(40);
    expect(naiveWin.reduce((n, m) => n + estimateTokens(m.content), 0)).toBe(24_000);
    expect(planTrim(naiveWin).drop).toEqual([]);
    expect(planTrim(naiveWin).droppedTokens).toBe(0);
  });

  it('onTrimNeeded summarizes exactly plan.drop, stores it and advances last_trim_id', async () => {
    await store.append('user', '一', { turnId: 't1' });
    await store.append('assistant', '二', { turnId: 't1' });
    await store.append('user', '三', { turnId: 't2' });
    await store.append('assistant', '四', { turnId: 't2' });
    await store.append('user', '五', { turnId: 't3' });
    await store.append('assistant', '六', { turnId: 't3' });

    const drop: ChatMessage[] = [
      { role: 'user', content: '一' },
      { role: 'assistant', content: '二' },
    ];
    const keep: ChatMessage[] = [
      { role: 'user', content: '三' },
      { role: 'assistant', content: '四' },
      { role: 'user', content: '五' },
      { role: 'assistant', content: '六' },
    ];
    const plan: TrimPlan = { keep, drop, droppedTokens: 2 };

    await store.onTrimNeeded(plan);

    expect(summarizeCalls).toEqual([['', drop]]);
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('2');
    expect(await store.summary()).toBe('这是摘要。');
    expect((await store.window()).map((m) => m.content)).toEqual(['三', '四', '五', '六']);
    expect(store.list({}).length).toBe(6); // dropped rows stay readable in the history pane (X5)
  });

  it('an empty plan.drop calls nothing and writes nothing', async () => {
    await store.append('user', '一');
    await store.onTrimNeeded({ keep: [{ role: 'user', content: '一' }], drop: [], droppedTokens: 0 });
    expect(summarizeCalls).toEqual([]);
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe(null);
    expect(await store.summary()).toBe('');
  });

  it('a rejecting summarize leaves last_trim_id and the summary unchanged', async () => {
    await store.append('user', '一');
    await store.append('assistant', '二');
    await store.append('user', '三');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = makeStore({ summarize: () => Promise.reject(new Error('boom')) });
    const plan: TrimPlan = {
      keep: [{ role: 'user', content: '三' }],
      drop: [
        { role: 'user', content: '一' },
        { role: 'assistant', content: '二' },
      ],
      droppedTokens: 2,
    };

    await expect(failing.onTrimNeeded(plan)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    expect(getKv(db, KV_LAST_TRIM_ID)).toBe(null);
    expect(await failing.summary()).toBe('');
    expect((await failing.window()).length).toBe(3);
  });

  it('I-10: a history:delete of a dropped row during the summarize await does not move last_trim_id past kept turns', async () => {
    await store.append('user', '一', { turnId: 't1' });
    await store.append('assistant', '二', { turnId: 't1' });
    await store.append('user', '三', { turnId: 't2' });
    await store.append('assistant', '四', { turnId: 't2' });
    await store.append('user', '五', { turnId: 't3' });
    await store.append('assistant', '六', { turnId: 't3' });

    let release: (s: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const slow = makeStore({ summarize: () => gate });
    const plan: TrimPlan = {
      keep: [
        { role: 'user', content: '三' },
        { role: 'assistant', content: '四' },
        { role: 'user', content: '五' },
        { role: 'assistant', content: '六' },
      ],
      drop: [
        { role: 'user', content: '一' },
        { role: 'assistant', content: '二' },
      ],
      droppedTokens: 2,
    };

    const trimming = slow.onTrimNeeded(plan);
    // The chat window deletes the very turn being summarised while the network call is in flight.
    expect(slow.deleteTurn('t1')).toBe(2);
    release('摘要。');
    await trimming;

    // Bounded by the id resolved BEFORE the await: rows 3..6 stay inside the window.
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('2');
    expect((await slow.window()).map((m) => m.content)).toEqual(['三', '四', '五', '六']);
    expect(await slow.summary()).toBe('摘要。');
  });

  it('G2-3 / CX-4: two overlapping trims resolving in reverse order advance the pointer once and skip no rows', async () => {
    for (let i = 0; i < 6; i++) await store.append(i % 2 === 0 ? 'user' : 'assistant', `第${i}条`);
    const gates: Array<(s: string) => void> = [];
    const serial = makeStore({
      summarize: (old, dropped) => {
        summarizeCalls.push([old, dropped]);
        return new Promise<string>((resolve) => gates.push(resolve));
      },
    });
    const plan: TrimPlan = {
      keep: [2, 3, 4, 5].map((i): ChatMessage => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `第${i}条` })),
      drop: [
        { role: 'user', content: '第0条' },
        { role: 'assistant', content: '第1条' },
      ],
      droppedTokens: 2,
    };

    // Two turns, both planning the same trim (the superseded one's summarisation is still on the wire).
    const first = serial.onTrimNeeded(plan);
    const second = serial.onTrimNeeded(plan);
    expect(gates).toHaveLength(1); // the second trim is queued, not on the wire
    gates[0]('第一份摘要');
    await first;
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('2');
    expect(await serial.summary()).toBe('第一份摘要');

    // The queued trim now finds the pointer past its plan: a stale plan aborts without a network
    // call and without writing — the newer summary is never overwritten.
    await second;
    expect(gates).toHaveLength(1);
    expect(summarizeCalls).toHaveLength(1);
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('2');
    expect(await serial.summary()).toBe('第一份摘要');
    expect((await serial.window()).map((m) => m.content)).toEqual(['第2条', '第3条', '第4条', '第5条']);
    await expect(serial.trimSettled()).resolves.toBeUndefined();
  });

  it('G2-3: a trim whose pointer moved under it during the await aborts inside the transaction without writing', async () => {
    for (let i = 0; i < 4; i++) await store.append(i % 2 === 0 ? 'user' : 'assistant', `第${i}条`);
    let release: (s: string) => void = () => {};
    const slow = makeStore({ summarize: () => new Promise<string>((resolve) => { release = resolve; }) });
    const plan: TrimPlan = {
      keep: [{ role: 'user', content: '第2条' }, { role: 'assistant', content: '第3条' }],
      drop: [{ role: 'user', content: '第0条' }, { role: 'assistant', content: '第1条' }],
      droppedTokens: 2,
    };
    const trimming = slow.onTrimNeeded(plan);
    setKv(db, KV_LAST_TRIM_ID, '3'); // something else moved the pointer while the summary was on the wire
    release('迟到的摘要');
    await trimming;
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('3');
    expect(await slow.summary()).toBe('');
  });

  it('CX-5: a plan built from a safety-truncated window commits the exact cutoff id, not a length', async () => {
    // Same shape as the 32_000 safety-net case: 60 rows x 600 tokens; window() starts at id 8.
    const LINE = '话'.repeat(900);
    for (let i = 0; i < 60; i++) await store.append(i % 2 === 0 ? 'user' : 'assistant', LINE);
    const win = await store.window();
    expect(win.length).toBe(53);
    const plan = planTrim(win);
    expect(plan.drop.length).toBe(15); // rows 8..22 of the table

    await store.onTrimNeeded(plan);

    // A length-derived pointer would have been 0 + 15 = 15 and left rows 16..22 — which were
    // summarised — back inside the prompt window.
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe('22');
    expect((await store.window()).length).toBe(plan.keep.length);
    expect(summarizeCalls[0][1]).toEqual(plan.drop);
  });

  it('CX-4: a plan that no longer describes the window writes nothing and calls no summariser', async () => {
    await store.append('user', '一');
    await store.append('assistant', '二');
    await store.append('user', '三');
    await store.onTrimNeeded({
      keep: [{ role: 'user', content: '三' }],
      drop: [{ role: 'user', content: '别的' }, { role: 'assistant', content: '二' }],
      droppedTokens: 2,
    });
    expect(summarizeCalls).toEqual([]);
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe(null);
  });

  it('G2-2: a summariser that resolves after close() touches nothing and rejects nothing', async () => {
    await store.append('user', '一');
    await store.append('assistant', '二');
    await store.append('user', '三');
    let release: (s: string) => void = () => {};
    const slow = makeStore({ summarize: () => new Promise<string>((resolve) => { release = resolve; }) });
    const trimming = slow.onTrimNeeded({
      keep: [{ role: 'user', content: '三' }],
      drop: [{ role: 'user', content: '一' }, { role: 'assistant', content: '二' }],
      droppedTokens: 2,
    });
    // The quit's drain timed out on this summariser: the store is fenced and the db closed under it.
    slow.close();
    db.close();
    release('太晚的摘要');
    await expect(trimming).resolves.toBeUndefined();
    await expect(slow.trimSettled()).resolves.toBeUndefined();
    // Nothing was written: reopen and look.
    db = openDb(join(dir, 'ds.sqlite'));
    expect(getKv(db, KV_LAST_TRIM_ID)).toBe(null);
    expect(new RunningSummary(db).getSync()).toBe('');
  });

  it('deleteTurn removes both rows of a turn and returns 2', async () => {
    await store.append('user', '你好', { turnId: 'turn-a' });
    await store.append('assistant', '你好呀。', { turnId: 'turn-a' });
    await store.append('user', '再见', { turnId: 'turn-b' });

    expect(store.deleteTurn('turn-a')).toBe(2);
    expect(store.list({}).map((r) => r.content)).toEqual(['再见']);
    expect(store.deleteTurn('turn-a')).toBe(0);
  });

  it('recentAssistant(5) returns assistant rows only, oldest-first, capped at 5', async () => {
    for (let i = 1; i <= 6; i++) {
      await store.append('user', `u${i}`);
      await store.append('assistant', `a${i}`);
    }
    expect(await store.recentAssistant(5)).toEqual(['a2', 'a3', 'a4', 'a5', 'a6']);
    expect(await store.recentAssistant(2)).toEqual(['a5', 'a6']);
  });

  it('record() round-trips a MetricsRecord with lint stored as JSON', async () => {
    const m: MetricsRecord = {
      turnId: 'turn-1',
      ts: NOW,
      ttftMs: 420,
      totalMs: 1980,
      promptTokens: 1200,
      cacheHit: 1024,
      cacheMiss: 176,
      completion: 88,
      complianceMiss: false,
      regenerated: true,
      sensitive: false,
      lint: { violations: [{ rule: 'markdown', detail: '**b**' }], severity: 'strip' },
      errorCode: null,
    };
    await store.record(m);

    const row = db.prepare('SELECT * FROM metrics WHERE turn_id = ?').get('turn-1') as Record<
      string,
      unknown
    >;
    expect(row.ts).toBe(NOW);
    expect(row.ttft_ms).toBe(420);
    expect(row.total_ms).toBe(1980);
    expect(row.prompt_tokens).toBe(1200);
    expect(row.cache_hit).toBe(1024);
    expect(row.cache_miss).toBe(176);
    expect(row.completion).toBe(88);
    expect(row.compliance_miss).toBe(0);
    expect(row.regenerated).toBe(1);
    expect(row.sensitive).toBe(0);
    expect(row.lint).toBe('[{"rule":"markdown","detail":"**b**"}]');
    expect(row.error_code).toBe(null);

    await store.record({ ...m, ttftMs: null, errorCode: 'rate' });
    const again = db.prepare('SELECT COUNT(*) AS n, ttft_ms, error_code FROM metrics').get() as {
      n: number;
      ttft_ms: number | null;
      error_code: string | null;
    };
    expect(again.n).toBe(1); // the same turn_id replaces
    expect(again.ttft_ms).toBe(null);
    expect(again.error_code).toBe('rate');
  });

  it('list() maps the interruption marker, turn id and kind (R2)', async () => {
    await store.append('user', '给我讲个故事', { turnId: 't1', kind: 'chat' });
    await store.append('assistant', '从前有座山。', {
      turnId: 't1',
      kind: 'chat',
      interrupted: true,
    });
    await store.append('assistant', '你今天没喝水吧。', { turnId: 't2', kind: 'proactive' });

    const rows = store.list({});
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]); // newest first
    expect(rows[1]).toEqual({
      id: 2,
      ts: NOW,
      role: 'assistant',
      content: '从前有座山。',
      turnId: 't1',
      kind: 'chat',
      interrupted: true,
    });
    expect(rows[0].kind).toBe('proactive');
    expect(rows[0].interrupted).toBe(false);
    expect(rows[2].turnId).toBe('t1');
  });

  it('list() paginates with before', async () => {
    for (let i = 1; i <= 5; i++) await store.append('user', `m${i}`);

    expect(store.list({ limit: 2 }).map((r) => r.id)).toEqual([5, 4]);
    expect(store.list({ before: 4, limit: 2 }).map((r) => r.id)).toEqual([3, 2]);
    expect(store.list({ before: 2, limit: 2 }).map((r) => r.id)).toEqual([1]);
    expect(store.list({ before: 1, limit: 2 })).toEqual([]);
    expect(store.list({}).length).toBe(5); // default limit is 50
  });

  it('countSince counts rows at or after the timestamp', async () => {
    clock = 1000;
    await store.append('user', 'a');
    clock = 2000;
    await store.append('assistant', 'b');
    clock = 3000;
    await store.append('user', 'c');

    expect(store.countSince(2000)).toBe(2); // inclusive
    expect(store.countSince(3001)).toBe(0);
    expect(store.countSince(0)).toBe(3);
  });

  it('lastMessageTs returns the newest ts, or null on an empty store', async () => {
    expect(store.lastMessageTs()).toBe(null);
    clock = 1000;
    await store.append('user', 'a');
    clock = 5000;
    await store.append('assistant', 'b');
    expect(store.lastMessageTs()).toBe(5000);
  });
});
