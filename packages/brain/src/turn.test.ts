import { describe, expect, it, vi } from 'vitest';
import { CancelledError, DeepSeekError } from './deepseek.ts';
import type { ChatClient, ChatRequest, StreamChunk } from './deepseek.ts';
import type { HistoryPort, MessageMeta, MetricsPort, MetricsRecord, Role } from './ports.ts';
import { LINT_NUDGE, planTrim } from './prompt.ts';
import type { StatePreamble, TrimPlan } from './prompt.ts';
import { TurnRunner } from './turn.ts';
import type { TurnEvents } from './turn.ts';
import type { ChatMessage, SentenceEvent, Usage } from './types.ts';

// ---------------------------------------------------------------- fixtures

const STATE: StatePreamble = {
  localTime: '21:14',
  weekday: '周五',
  mood: 0.3,
  energy: 45,
  affection: 62,
  sinceLastChat: '3小时',
};

const PERSONA = {
  staticSystem: '【硬性规则】\n只说中文口语。一次一到三句话。\n',
  postHistoryInstructions: '',
  motionKeys: ['nod', 'shake'],
  cannedLines: {
    offline: ['网线好像断了……人家在这儿等着，别急。'],
    empty: ['……脑子空白了一下，主人再说一遍。', '刚才走神了啦，再讲一次？'],
  },
};

const DEFAULT_USAGE: Usage = { promptTokens: 120, cacheHit: 64, cacheMiss: 56, completionTokens: 18 };

/** Two sentences, and the ACT tag is split across a chunk boundary on purpose. */
const GREETING = ['<|ACT emotion=ha', 'ppy|>回来啦。<|ACT emotion=curious|>', '今天怎么样。'];

/** Splits into `作为一个AI助手，` (the first-sentence comma rule) + `我来帮你分析。`; the first trips A4. */
const LEAK = '<|ACT emotion=neutral|>作为一个AI助手，我来帮你分析。';

// ---------------------------------------------------------------- test doubles

interface Script {
  chunks: string[];
  usage?: Usage;
  error?: DeepSeekError;
  /** Stay open after the chunks until the caller aborts — keeps the runner in `speaking`. */
  hang?: boolean;
}

class FakeClient implements ChatClient {
  readonly requests: ChatRequest[] = [];
  private readonly scripts: Script[];
  private index = 0;

  constructor(scripts: Script[]) {
    this.scripts = scripts;
  }

  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    this.requests.push(req);
    const script = this.scripts[Math.min(this.index, this.scripts.length - 1)];
    this.index += 1;
    return this.play(script, signal);
  }

  private async *play(script: Script, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    for (const text of script.chunks) {
      if (signal.aborted) throw new CancelledError('aborted');
      await Promise.resolve();
      yield { kind: 'delta', text };
    }
    if (script.error !== undefined) throw script.error;
    if (script.hang === true) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => { resolve(); }, { once: true });
      });
      throw new CancelledError('aborted');
    }
    yield { kind: 'usage', usage: script.usage ?? DEFAULT_USAGE };
    yield { kind: 'done' };
  }

  async complete(): Promise<{ text: string; usage: Usage }> {
    throw new Error('FakeClient.complete is not used by TurnRunner');
  }

  async testKey(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

interface Row {
  role: Role;
  content: string;
  meta: MessageMeta | undefined;
}

class FakeHistory implements HistoryPort {
  readonly rows: Row[] = [];
  readonly trims: TrimPlan[] = [];
  windowRows: ChatMessage[] = [];
  summaryText = '';
  recent: string[] = [];

  async window(): Promise<ChatMessage[]> {
    return this.windowRows;
  }
  async summary(): Promise<string> {
    return this.summaryText;
  }
  async facts(): Promise<string[]> {
    return [];
  }
  async recentAssistant(n: number): Promise<string[]> {
    return this.recent.slice(-n);
  }
  async append(role: Role, content: string, meta?: MessageMeta): Promise<void> {
    this.rows.push({ role, content, meta });
  }
  async onTrimNeeded(plan: TrimPlan): Promise<void> {
    this.trims.push(plan);
    this.windowRows = plan.keep;
  }
}

class FakeMetrics implements MetricsPort {
  readonly records: MetricsRecord[] = [];
  async record(m: MetricsRecord): Promise<void> {
    this.records.push(m);
  }
}

function harness(
  scripts: Script[],
  options: { lint?: boolean; recent?: string[]; window?: ChatMessage[] } = {},
) {
  const client = new FakeClient(scripts);
  const history = new FakeHistory();
  history.recent = options.recent ?? [];
  history.windowRows = options.window ?? [];
  const metrics = new FakeMetrics();
  const states: string[] = [];
  const sentences: SentenceEvent[] = [];
  const turnDone: TurnEvents['turnDone'][] = [];
  const errors: TurnEvents['error'][] = [];
  const stateSpy = vi.fn((): StatePreamble => STATE);
  let clock = 1_000;
  let ids = 0;

  const runner = new TurnRunner({
    client,
    history,
    metrics,
    persona: PERSONA,
    state: stateSpy,
    lint: options.lint,
    now: () => {
      clock += 10;
      return clock;
    },
    idFactory: () => {
      ids += 1;
      return `t${ids}`;
    },
    random: () => 0,
  });

  runner.on('state', (p) => { states.push(p.state); });
  runner.on('sentence', (p) => { sentences.push(p); });
  runner.on('turnDone', (p) => { turnDone.push(p); });
  runner.on('error', (p) => { errors.push(p); });

  return { runner, client, history, metrics, states, sentences, turnDone, errors, stateSpy };
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  throw new Error(`timed out waiting for ${label}`);
}

// ---------------------------------------------------------------- the turn

describe('TurnRunner — the happy path', () => {
  it('goes thinking -> speaking -> idle and writes one user row and one assistant row', async () => {
    const h = harness([{ chunks: GREETING }]);
    const id = await h.runner.send('我回来了。');
    expect(id).toBe('t1');
    expect(h.states[0]).toBe('thinking');
    await until(() => h.turnDone.length === 1, 'turnDone');

    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。', '今天怎么样。']);
    expect(h.sentences.map((s) => s.emotion)).toEqual(['happy', 'curious']);
    expect(h.states).toEqual(['thinking', 'speaking']);
    expect(h.runner.state).toBe('speaking');

    h.runner.turnShown('t1');
    expect(h.states).toEqual(['thinking', 'speaking', 'idle']);
    expect(h.runner.state).toBe('idle');

    expect(h.history.rows).toEqual([
      { role: 'user', content: '我回来了。', meta: { turnId: 't1', kind: 'chat' } },
      { role: 'assistant', content: '回来啦。今天怎么样。', meta: { turnId: 't1', kind: 'chat' } },
    ]);
    expect(h.turnDone[0].usage).toEqual(DEFAULT_USAGE);
    expect(h.turnDone[0].complianceMiss).toBe(false);
    expect(h.turnDone[0].regenerated).toBe(false);
    expect(h.turnDone[0].lint.severity).toBe('none');
  });

  it('resolves send() with the turnId before the client is called', async () => {
    const h = harness([{ chunks: GREETING }]);
    const pending = h.runner.send('在吗？');
    expect(h.client.requests).toHaveLength(0);
    await expect(pending).resolves.toBe('t1');
    expect(h.runner.turnId).toBe('t1');
    await until(() => h.turnDone.length === 1, 'turnDone');
  });

  it('emits sanitized text while linting the raw sentence', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>回来啦,吃饭没?'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.sentences).toHaveLength(1);
    expect(h.sentences[0].text).toBe('回来啦，吃饭没？');
    expect(h.history.rows[1].content).toBe('回来啦，吃饭没？');
  });

  it('flags a reply with no leading ACT as a compliance miss', async () => {
    const h = harness([{ chunks: ['回来啦。', '<|ACT emotion=happy|>今天怎么样。'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.turnDone[0].complianceMiss).toBe(true);
    expect(h.sentences[0].emotion).toBe('neutral');
    expect(h.metrics.records[0].complianceMiss).toBe(true);
  });

  it('reports totalMs and never a ms field', async () => {
    const h = harness([{ chunks: GREETING }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    const payload = h.turnDone[0] as unknown as Record<string, unknown>;
    expect(typeof payload.totalMs).toBe('number');
    expect(payload.totalMs as number).toBeGreaterThan(0);
    expect('ms' in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(
      ['complianceMiss', 'lint', 'regenerated', 'totalMs', 'ttftMs', 'turnId', 'usage'].sort(),
    );
    expect(typeof h.turnDone[0].ttftMs).toBe('number');
  });

  it('on() returns an unsubscribe function', async () => {
    const h = harness([{ chunks: GREETING }]);
    const seen: SentenceEvent[] = [];
    const off = h.runner.on('sentence', (p) => { seen.push(p); });
    off();
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(seen).toHaveLength(0);
    expect(h.sentences).toHaveLength(2);
  });

  it('remembers a turnShown that arrives before the turn settles', async () => {
    const h = harness([{ chunks: GREETING }]);
    /**
     * The acknowledgement is delivered from inside the `sentence` handler on purpose. A script
     * without `hang: true` runs the whole turn inside ONE microtask drain, so no macrotask poll
     * can ever observe the runner mid-stream — `until(() => h.sentences.length === 1)` steps
     * straight from 0 to 2. Acknowledging on the first released sentence is the same situation
     * the case is about (turnShown before the turn settles) and it is deterministic.
     */
    const atAck: { state: string; turnDone: number }[] = [];
    let off = (): void => undefined;
    off = h.runner.on('sentence', (p) => {
      off();
      h.runner.turnShown(p.turnId);
      atAck.push({ state: h.runner.state, turnDone: h.turnDone.length });
    });

    const id = await h.runner.send('我回来了。');
    expect(id).toBe('t1');
    await until(() => h.turnDone.length === 1, 'turnDone');

    // The turn had not settled yet when turnShown arrived: still speaking, no turnDone.
    expect(atAck).toEqual([{ state: 'speaking', turnDone: 0 }]);
    expect(h.sentences).toHaveLength(2);
    expect(h.runner.state).toBe('idle');
    expect(h.states).toEqual(['thinking', 'speaking', 'idle']);
  });
});

describe('TurnRunner — turn commit and interruption', () => {
  it('does not append the user row before the window is read', async () => {
    const h = harness([{ chunks: GREETING }]);
    await h.runner.send('今天累死了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    const joined = h.client.requests[0].messages.map((m) => m.content).join(' ');
    expect(joined.split('今天累死了。')).toHaveLength(2);
    expect(h.history.rows.filter((r) => r.role === 'user')).toHaveLength(1);
  });

  it('merges a send that arrives while the first turn is still thinking', async () => {
    const h = harness([{ chunks: GREETING }]);
    const firstPending = h.runner.send('我回来了。');
    const second = await h.runner.send('顺便说一句。');
    expect(await firstPending).toBe('t1');
    expect(second).toBe('t2');
    await until(() => h.turnDone.length === 2, 'both turns done');
    const users = h.history.rows.filter((r) => r.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0].content).toBe('我回来了。\n顺便说一句。');
    expect(users[0].meta).toEqual({ turnId: 't2', kind: 'chat' });
    expect(h.client.requests).toHaveLength(1);
  });

  it('keeps only the acknowledged sentence when a new send interrupts speaking', async () => {
    const h = harness([
      // G-12: a terminal run at a chunk edge may still grow, so a delta must follow it before the
      // lookahead can release sentence 0.
      { chunks: ['<|ACT emotion=happy|>回来啦。', '<|ACT emotion=curious|>今天怎么样。', '嗯'], hang: true },
      { chunks: ['<|ACT emotion=sad|>好吧。'] },
    ]);
    const first = await h.runner.send('我回来了。');
    await until(() => h.sentences.length === 1, 'the first released sentence');
    h.runner.sentenceShown(first, 0);
    const second = await h.runner.send('那你先睡吧。');
    expect(second).toBe('t2');
    await until(() => h.turnDone.length === 2, 'both turns done');
    expect(h.history.rows).toEqual([
      { role: 'user', content: '我回来了。', meta: { turnId: 't1', kind: 'chat' } },
      { role: 'assistant', content: '回来啦。', meta: { turnId: 't1', kind: 'chat', interrupted: true } },
      { role: 'user', content: '那你先睡吧。', meta: { turnId: 't2', kind: 'chat' } },
      { role: 'assistant', content: '好吧。', meta: { turnId: 't2', kind: 'chat' } },
    ]);
    expect(h.client.requests).toHaveLength(2);
  });

  it('cancel() commits the user row and appends nothing the user never saw', async () => {
    const h = harness([
      { chunks: ['<|ACT emotion=happy|>回来啦。', '<|ACT emotion=curious|>今天怎么样。', '嗯'], hang: true },
    ]);
    await h.runner.send('我回来了。');
    await until(() => h.sentences.length === 1, 'the first released sentence');
    h.runner.cancel();
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.history.rows).toEqual([
      { role: 'user', content: '我回来了。', meta: { turnId: 't1', kind: 'chat' } },
    ]);
    expect(h.states).toEqual(['thinking', 'speaking', 'idle']);
    expect(h.runner.state).toBe('idle');
  });
});

describe('TurnRunner — streaming lint (R4)', () => {
  it('regenerates exactly once when the first sentence trips assistant-leak', async () => {
    const h = harness([{ chunks: [LEAK] }, { chunks: GREETING }]);
    await h.runner.send('帮我看看这个。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(2);
    expect(h.turnDone[0].regenerated).toBe(true);
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。', '今天怎么样。']);
    expect(h.metrics.records[0].regenerated).toBe(true);
  });

  it('places the lint nudge only in the last user message of the second request', async () => {
    const h = harness([{ chunks: [LEAK] }, { chunks: GREETING }]);
    await h.runner.send('帮我看看这个。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    const first = h.client.requests[0].messages;
    const second = h.client.requests[1].messages;
    expect(first.some((m) => m.content.includes(LINT_NUDGE))).toBe(false);
    expect(second[second.length - 1].content.endsWith(LINT_NUDGE)).toBe(true);
    expect(second.slice(0, -1).some((m) => m.content.includes(LINT_NUDGE))).toBe(false);
    expect(second[0].content).toBe(first[0].content);
    expect(h.history.rows.some((r) => r.content.includes(LINT_NUDGE))).toBe(false);
  });

  it('calls deps.state exactly once per turn even when it regenerates', async () => {
    const h = harness([{ chunks: [LEAK] }, { chunks: GREETING }]);
    await h.runner.send('帮我看看这个。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(2);
    expect(h.stateSpy).toHaveBeenCalledTimes(1);
  });

  it('strips a later assistant-leak sentence without a second request', async () => {
    const h = harness([
      {
        chunks: [
          '<|ACT emotion=happy|>回来啦。',
          '作为一个AI助手，我来帮你分析。',
          '<|ACT emotion=curious|>今天怎么样。',
        ],
      },
    ]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(1);
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。', '今天怎么样。']);
    expect(h.history.rows[1].content).toBe('回来啦。今天怎么样。');
  });

  it('never emits a final sentence that trips the tail lint', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>回来啦。', '饭吃了没。', '总之早点睡。'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(1);
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。', '饭吃了没。']);
    expect(h.history.rows[1].content).toBe('回来啦。饭吃了没。');
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('closing-moral');
    expect(h.turnDone[0].regenerated).toBe(false);
  });

  it('regenerates a one-sentence reply that trips the tail lint instead of going silent', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=neutral|>总之早点睡。'] }, { chunks: GREETING }]);
    await h.runner.send('我要睡了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(2);
    expect(h.turnDone[0].regenerated).toBe(true);
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。', '今天怎么样。']);
  });

  it('strips a strip-severity tail failure once sentences are already painted', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>回来啦……', '嗯……'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(1);
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦……']);
    expect(h.history.rows[1].content).toBe('回来啦……');
    expect(h.turnDone[0].lint.severity).toBe('strip');
  });

  it('still emits turnDone when every sentence is stripped', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>**回来啦**。'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.sentences).toHaveLength(0);
    expect(h.history.rows).toEqual([
      { role: 'user', content: '我回来了。', meta: { turnId: 't1', kind: 'chat' } },
    ]);
    expect(h.states).toEqual(['thinking', 'idle']);
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('markdown');
  });

  it('emits a would-be-regenerated sentence verbatim when lint is disabled', async () => {
    const h = harness([{ chunks: [LEAK] }], { lint: false });
    await h.runner.send('帮我看看这个。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(1);
    expect(h.sentences.map((s) => s.text)).toEqual(['作为一个AI助手，', '我来帮你分析。']);
    expect(h.turnDone[0].lint.severity).toBe('none');
    expect(h.turnDone[0].regenerated).toBe(false);
  });
});

describe('TurnRunner — failure paths and bookkeeping', () => {
  it('emits error and no turnDone when the client fails', async () => {
    const h = harness([{ chunks: [], error: new DeepSeekError('rate', 429, 'Rate limit reached') }]);
    await h.runner.send('在吗？');
    await until(() => h.errors.length === 1, 'the error event');
    expect(h.errors[0]).toEqual({ turnId: 't1', code: 'rate', message: 'Rate limit reached' });
    expect(h.turnDone).toHaveLength(0);
    expect(h.runner.state).toBe('idle');
    expect(h.history.rows).toEqual([
      { role: 'user', content: '在吗？', meta: { turnId: 't1', kind: 'chat' } },
    ]);
    await until(() => h.metrics.records.length === 1, 'the metrics record');
    expect(h.metrics.records[0].errorCode).toBe('rate');
  });

  it('re-requests once on an empty completion and then speaks the canned line', async () => {
    const h = harness([{ chunks: [] }, { chunks: [] }]);
    await h.runner.send('在吗？');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(2);
    expect(h.sentences).toEqual([
      { turnId: 't1', seq: 0, text: '……脑子空白了一下，主人再说一遍。', emotion: 'awkward' },
    ]);
    expect(h.turnDone[0].regenerated).toBe(false);
    expect(h.turnDone[0].lint.severity).toBe('none');
    expect(h.metrics.records[0].errorCode).toBe('empty');
    expect(h.history.rows).toEqual([
      { role: 'user', content: '在吗？', meta: { turnId: 't1', kind: 'chat' } },
      { role: 'assistant', content: '……脑子空白了一下，主人再说一遍。', meta: { turnId: 't1', kind: 'system' } },
    ]);
  });

  it('trims the window before assembling and re-reads it', async () => {
    const long: ChatMessage[] = Array.from({ length: 60 }, (_unused, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: '好'.repeat(800),
    }));
    const plan = planTrim(long);
    expect(plan.drop.length).toBeGreaterThan(0);
    const h = harness([{ chunks: GREETING }], { window: long });
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.history.trims).toHaveLength(1);
    expect(h.client.requests[0].messages).toHaveLength(plan.keep.length + 2);
    expect(h.client.requests[0].messages[0].role).toBe('system');
    expect(h.client.requests[0].messages[1].role).toBe('user');
  });

  it('records the sensitive flag, the usage and a null error code on a clean turn', async () => {
    const h = harness([{ chunks: GREETING }]);
    await h.runner.send('我最近有点抑郁，睡不着。');
    await until(() => h.metrics.records.length === 1, 'the metrics record');
    const record = h.metrics.records[0];
    expect(record.turnId).toBe('t1');
    expect(record.sensitive).toBe(true);
    expect(record.errorCode).toBeNull();
    expect(record.promptTokens).toBe(120);
    expect(record.cacheHit).toBe(64);
    expect(record.cacheMiss).toBe(56);
    expect(record.completion).toBe(18);
    expect(record.regenerated).toBe(false);
    expect(record.complianceMiss).toBe(false);
    expect(typeof record.totalMs).toBe('number');
  });
});

describe('TurnRunner — review fixes (M-1 / I-3)', () => {
  it('M-1: strips the injected leading number only from the first sentence of an attempt', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>12 今天不错。', '2 加 2 等于 4。', '3 个小时吧。'] }]);
    await h.runner.send('算一下。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.sentences.map((s) => s.text)).toEqual(['今天不错。', '2 加 2 等于 4。', '3 个小时吧。']);
  });

  it('I-3: a reply-scope tail violation (emoji-rate) does not delete the innocent pending sentence', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>主人回来啦😀。', '今天吃了吗。'] }], { recent: ['刚吃完饭😀'] });
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.client.requests).toHaveLength(1);
    expect(h.sentences.map((s) => s.text)).toEqual(['主人回来啦😀。', '今天吃了吗。']);
    expect(h.history.rows[1].content).toBe('主人回来啦😀。今天吃了吗。');
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('emoji-rate');
    expect(h.metrics.records[0].lint.violations.map((v) => v.rule)).toContain('emoji-rate');
  });

  it('I-3: ellipsis-rate carried by a painted sentence keeps the correction that follows', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=neutral|>好麻烦哦……这句不对。', '你改出来的是新对象。'] }], { recent: ['好麻烦哦……', '嗯。'] });
    await h.runner.send('这样对吗？');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.sentences.map((s) => s.text)).toEqual(['好麻烦哦……', '这句不对。', '你改出来的是新对象。']);
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('ellipsis-rate');
  });

  it('I-3: the stripped sentence is the one carrying a last-sentence violation', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>回来啦。', '饭吃了没。', '总之早点睡。'] }]);
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    const painted = h.sentences.map((s) => s.text);
    expect(painted).toEqual(['回来啦。', '饭吃了没。']);
    const stripped = ['回来啦。', '饭吃了没。', '总之早点睡。'].filter((s) => !painted.includes(s));
    expect(stripped).toEqual(['总之早点睡。']);
    expect(stripped[0]).toMatch(/总之/);
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('closing-moral');
  });

  it('I-3: question-streak still strips the pending final question', async () => {
    const h = harness([{ chunks: ['<|ACT emotion=happy|>回来啦。', '饭吃了没？'] }], { recent: ['今天累不累？'] });
    await h.runner.send('我回来了。');
    await until(() => h.turnDone.length === 1, 'turnDone');
    expect(h.sentences.map((s) => s.text)).toEqual(['回来啦。']);
    expect(h.turnDone[0].lint.violations.map((v) => v.rule)).toContain('question-streak');
  });
});
