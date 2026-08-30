import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CancelledError,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_JUDGE_MODEL,
  DEEPSEEK_MODEL,
  DEFAULT_MAX_TOKENS,
  DeepSeekClient,
  DeepSeekError,
  IDLE_TIMEOUT_MS,
  MAX_DETAIL_CHARS,
  MAX_ERROR_BODY_BYTES,
  RETRY_DELAYS_MS,
  RETRY_JITTER,
  RETRYABLE,
  STOP_SEQUENCES,
  parseSseLine,
} from './deepseek.ts';
import type { ChatRequest, StreamChunk } from './deepseek.ts';
import type { ChatMessage, Usage } from './types.ts';

const ENC = new TextEncoder();
const EVIDENCE_DIR = fileURLToPath(new URL('../../../docs/evidence/phase2/', import.meta.url));

const DELTA_1 = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n';
const DELTA_2 = 'data: {"choices":[{"delta":{"content":"，主人"}}]}\n\n';
const DELTA_3 = 'data: {"choices":[{"delta":{"content":"。"}}]}\n\n';
const USAGE_FRAME =
  'data: {"choices":[],"usage":{"prompt_tokens":128,"prompt_cache_hit_tokens":64,' +
  '"prompt_cache_miss_tokens":64,"completion_tokens":12}}\n\n';
const DONE_FRAME = 'data: [DONE]\n\n';
const EXPECTED_USAGE: Usage = { promptTokens: 128, cacheHit: 64, cacheMiss: 64, completionTokens: 12 };

const HI: ChatMessage[] = [{ role: 'user', content: '在吗？' }];
const REQ: ChatRequest = { messages: HI };

// ---------------------------------------------------------------- test doubles

/** Every body stream handed to the client, so a test can assert it was cancelled (G-1). */
const openBodies: { cancelled: boolean; pulls: number }[] = [];

/** Feeds an async generator into the ReadableStream the client reads. */
function streamOf(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  const track = { cancelled: false, pulls: 0 };
  openBodies.push(track);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      track.pulls += 1;
      const next = await gen.next();
      if (next.done === true) controller.close();
      else controller.enqueue(next.value);
    },
    cancel() {
      // A real fetch body's cancel() resolves promptly; a generator parked on an await would only
      // honour return() once that await settles, so it is not awaited here.
      track.cancelled = true;
      void gen.return(undefined).catch(() => undefined);
    },
  });
}

async function* forever(frame: string): AsyncGenerator<Uint8Array> {
  for (;;) yield ENC.encode(frame);
}

async function* sse(...frames: string[]): AsyncGenerator<Uint8Array> {
  for (const frame of frames) yield ENC.encode(frame);
}

async function* sseThenThrow(frames: string[], err: Error): AsyncGenerator<Uint8Array> {
  for (const frame of frames) yield ENC.encode(frame);
  throw err;
}

async function* sseThenHang(frames: string[], signal: AbortSignal | null | undefined): AsyncGenerator<Uint8Array> {
  for (const frame of frames) yield ENC.encode(frame);
  await new Promise<void>((resolve) => {
    if (signal === null || signal === undefined || signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => { resolve(); }, { once: true });
  });
  throw new Error('the socket was closed by the caller');
}

/**
 * The five members DeepSeekClient touches on a Response — and only those.
 * `new Response(stream)` is not written here on purpose: in the installed @types/node 24.13.3
 * the BodyInit union (undici-types 7.18.2) has no ReadableStream arm, so it does not typecheck.
 */
function fakeResponse(init: { status?: number; text?: string; body?: AsyncGenerator<Uint8Array> }): Response {
  const status = init.status ?? 200;
  const body = init.body ?? (init.text !== undefined ? sse(init.text) : undefined);
  const shape = {
    ok: status >= 200 && status < 300,
    status,
    body: body === undefined ? null : streamOf(body),
  };
  return shape as unknown as Response;
}

interface Call { url: string; init: RequestInit }

function stubFetch(make: (call: Call, index: number) => Response): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fn: typeof fetch = async (input, init) => {
    const call: Call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return make(call, calls.length - 1);
  };
  return { calls, fetch: fn };
}

const bodyOf = (call: Call): Record<string, unknown> =>
  JSON.parse(String(call.init.body)) as Record<string, unknown>;

const headerOf = (call: Call, name: string): string =>
  (call.init.headers as Record<string, string>)[name];

async function drain(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of it) out.push(chunk);
  return out;
}

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const freshSignal = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  openBodies.length = 0;
});

// ---------------------------------------------------------------- parseSseLine

describe('parseSseLine', () => {
  it('ends the stream on the [DONE] sentinel', () => {
    expect(parseSseLine('data: [DONE]')).toEqual([{ kind: 'done' }]);
  });

  it('ignores an SSE comment line', () => {
    expect(parseSseLine(': keep-alive')).toEqual([]);
  });

  it('ignores an empty line', () => {
    expect(parseSseLine('')).toEqual([]);
  });

  it('returns the delta before the usage when one frame carries both', () => {
    const line =
      'data: {"choices":[{"delta":{"content":"好"}}],"usage":{"prompt_tokens":10,' +
      '"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":10,"completion_tokens":1}}';
    expect(parseSseLine(line)).toEqual([
      { kind: 'delta', text: '好' },
      { kind: 'usage', usage: { promptTokens: 10, cacheHit: 0, cacheMiss: 10, completionTokens: 1 } },
    ]);
  });

  it('GC-4: a malformed non-empty data frame is a server error with exactly one console.warn, never skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => parseSseLine('data: {"choices":[{"delta"')).toThrowError(DeepSeekError);
    expect(warn).toHaveBeenCalledTimes(1);
    let err: unknown;
    try { parseSseLine('data: 42'); } catch (e) { err = e; }
    expect((err as DeepSeekError).code).toBe('server'); // valid JSON that is not an object is malformed too
  });

  it('GC-4: an empty data frame is still ignored', () => {
    expect(parseSseLine('data:')).toEqual([]);
    expect(parseSseLine('data: ')).toEqual([]);
  });

  it('CX-8 / GC-4: the malformed-frame warning and error carry the frame length, never the payload bytes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const secret = '{"choices":[{"delta":{"content":"我昨天跟老板吵架了"';
    let err: unknown;
    try { parseSseLine(`data: ${secret}`); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('server');
    expect((err as DeepSeekError).message).not.toContain('我昨天跟老板吵架了');
    expect((err as DeepSeekError).message).not.toContain('choices');
    expect((err as DeepSeekError).detail).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.flat().map((a) => String(a)).join(' ');
    expect(logged).not.toContain('我昨天跟老板吵架了');
    expect(logged).not.toContain('choices');
    expect(logged).toContain(`${secret.length} chars`);
    expect(logged).toContain('malformed SSE frame');
  });

  it('GC-4: a provider error object inside a data frame is a server error that never carries the payload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const secret = 'sk-' + 'q'.repeat(32);
    let err: unknown;
    try { parseSseLine(`data: {"error":{"message":"bad key ${secret}","type":"invalid_request_error"}}`); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('server');
    expect((err as DeepSeekError).message).not.toContain(secret);
    expect((err as DeepSeekError).message).not.toContain('bad key');
    expect((err as DeepSeekError).detail).toBeUndefined();
    const logged = warn.mock.calls.flat().map((a) => String(a)).join(' ');
    expect(logged).not.toContain(secret);
  });

  it('accepts a frame with no space after the colon', () => {
    expect(parseSseLine('data:{"choices":[{"delta":{"content":"嗯"}}]}')).toEqual([
      { kind: 'delta', text: '嗯' },
    ]);
  });

  it('strips a trailing carriage return before parsing', () => {
    expect(parseSseLine('data: {"choices":[{"delta":{"content":"嗯"}}]}\r')).toEqual([
      { kind: 'delta', text: '嗯' },
    ]);
  });

  it('yields nothing for an empty delta content', () => {
    expect(parseSseLine('data: {"choices":[{"delta":{"content":""}}]}')).toEqual([]);
  });

  it('maps missing usage fields to zero', () => {
    expect(parseSseLine('data: {"choices":[],"usage":{"completion_tokens":7}}')).toEqual([
      { kind: 'usage', usage: { promptTokens: 0, cacheHit: 0, cacheMiss: 0, completionTokens: 7 } },
    ]);
  });
});

// ---------------------------------------------------------------- stream()

describe('DeepSeekClient.stream', () => {
  it('yields three deltas, the usage and done', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sse(DELTA_1, DELTA_2, DELTA_3, USAGE_FRAME, DONE_FRAME) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks.map((c) => c.kind)).toEqual(['delta', 'delta', 'delta', 'usage', 'done']);
    expect(chunks[0]).toEqual({ kind: 'delta', text: '你好' });
    expect(chunks[3]).toEqual({ kind: 'usage', usage: EXPECTED_USAGE });
  });

  it('sends the pinned §3.9.1 request body', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sse(DONE_FRAME) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    await drain(client.stream(REQ, freshSignal()));
    const body = bodyOf(stub.calls[0]);
    expect(body.model).toBe(DEEPSEEK_MODEL);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages).toEqual(HI);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.95);
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(body.max_tokens).toBe(300);
    expect(body.stop).toEqual(['\n用户：', '\n用户:', '\nUser:']);
    expect(body.stop).toEqual([...STOP_SEQUENCES]);
    expect(stub.calls[0].url).toBe(`${DEEPSEEK_BASE_URL}/chat/completions`);
    expect(stub.calls[0].init.method).toBe('POST');
  });

  it('sends the authorization, content-type and event-stream accept headers', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sse(DONE_FRAME) }));
    const client = new DeepSeekClient({ apiKey: 'sk-abc', fetch: stub.fetch });
    await drain(client.stream(REQ, freshSignal()));
    expect(headerOf(stub.calls[0], 'Authorization')).toBe('Bearer sk-abc');
    expect(headerOf(stub.calls[0], 'Content-Type')).toBe('application/json');
    expect(headerOf(stub.calls[0], 'Accept')).toBe('text/event-stream');
  });

  it('maps 401 to auth and never retries it', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 401, text: 'Authentication Fails, Your api key is invalid' }));
    const client = new DeepSeekClient({ apiKey: 'bad', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => drain(client.stream(REQ, freshSignal())));
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('auth');
    expect((err as DeepSeekError).status).toBe(401);
    expect((err as DeepSeekError).message).not.toContain('api key is invalid'); // G-3: body -> detail only
    expect((err as DeepSeekError).detail).toContain('api key is invalid');
    expect(stub.calls).toHaveLength(1);
  });

  it('maps 402 to balance and never retries it', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 402, text: 'Insufficient Balance' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => drain(client.stream(REQ, freshSignal())));
    expect((err as DeepSeekError).code).toBe('balance');
    expect((err as DeepSeekError).status).toBe(402);
    expect(stub.calls).toHaveLength(1);
  });

  it('retries 429 once and succeeds, sleeping the first backoff', async () => {
    const slept: number[] = [];
    const stub = stubFetch((_call, index) =>
      index === 0
        ? fakeResponse({ status: 429, text: 'Rate limit reached' })
        : fakeResponse({ body: sse(DELTA_1, DONE_FRAME) }),
    );
    const client = new DeepSeekClient({
      apiKey: 'k',
      fetch: stub.fetch,
      sleep: async (ms) => { slept.push(ms); },
      random: () => 0.5,
    });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks.map((c) => c.kind)).toEqual(['delta', 'done']);
    expect(stub.calls).toHaveLength(2);
    expect(slept).toEqual([1000]);
  });

  it('retries 503 once and succeeds', async () => {
    const stub = stubFetch((_call, index) =>
      index === 0 ? fakeResponse({ status: 503, text: 'Service Unavailable' }) : fakeResponse({ body: sse(DELTA_1, DONE_FRAME) }),
    );
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined, random: () => 0.5 });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks.map((c) => c.kind)).toEqual(['delta', 'done']);
    expect(stub.calls).toHaveLength(2);
  });

  it('gives up after one attempt plus three retries', async () => {
    const slept: number[] = [];
    const stub = stubFetch(() => fakeResponse({ status: 503, text: 'Service Unavailable' }));
    const client = new DeepSeekClient({
      apiKey: 'k',
      fetch: stub.fetch,
      sleep: async (ms) => { slept.push(ms); },
      random: () => 0.5,
    });
    const err = await caught(() => drain(client.stream(REQ, freshSignal())));
    expect((err as DeepSeekError).code).toBe('server');
    expect((err as DeepSeekError).status).toBe(503);
    expect(stub.calls).toHaveLength(1 + RETRY_DELAYS_MS.length);
    expect(stub.calls).toHaveLength(4);
    expect(slept).toEqual([1000, 2000, 4000]);
    expect(RETRYABLE).toContain('server');
  });

  it('jitters each backoff by ±30% from opts.random', async () => {
    const low: number[] = [];
    const high: number[] = [];
    const build = (bucket: number[], random: () => number): DeepSeekClient =>
      new DeepSeekClient({
        apiKey: 'k',
        fetch: stubFetch((_c, index) => (index === 0 ? fakeResponse({ status: 503 }) : fakeResponse({ body: sse(DONE_FRAME) }))).fetch,
        sleep: async (ms) => { bucket.push(ms); },
        random,
      });
    await drain(build(low, () => 0).stream(REQ, freshSignal()));
    await drain(build(high, () => 1).stream(REQ, freshSignal()));
    expect(low).toEqual([700]);
    expect(high).toEqual([1300]);
    expect(RETRY_JITTER).toBe(0.3);
  });

  it('does not retry a failure that arrives after the first delta', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sseThenThrow([DELTA_1], new Error('socket hang up')) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const seen: StreamChunk[] = [];
    const err = await caught(async () => {
      for await (const chunk of client.stream(REQ, freshSignal())) seen.push(chunk);
    });
    expect(seen).toEqual([{ kind: 'delta', text: '你好' }]);
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('network');
    expect((err as DeepSeekError).status).toBeNull();
    expect(stub.calls).toHaveLength(1);
  });

  it('reassembles a frame split mid-line, ignores comments and accepts CRLF', async () => {
    const stub = stubFetch(() =>
      fakeResponse({
        body: sse(
          ': keep-alive\r\n\r\n',
          'data: {"choices":[{"del',
          'ta":{"content":"你好"}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{"content":"世界。"}}]}\r\n',
          '\r\ndata: [DONE]\r\n\r\n',
        ),
      }),
    );
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks).toEqual([
      { kind: 'delta', text: '你好' },
      { kind: 'delta', text: '世界。' },
      { kind: 'done' },
    ]);
  });

  it('GC-4: delta + malformed frame + [DONE] rejects with server instead of completing with content missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = 'data: {"choices":[{"delta":{"content":"，主人"\n\n';
    const stub = stubFetch(() => fakeResponse({ text: DELTA_1 + broken + DONE_FRAME }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const got: StreamChunk[] = [];
    const err = await caught(async () => {
      for await (const chunk of client.stream(REQ, freshSignal())) got.push(chunk);
    });
    expect(got).toEqual([{ kind: 'delta', text: '你好' }]);
    expect((err as DeepSeekError).code).toBe('server');
    expect(stub.calls).toHaveLength(1); // a delta was seen: the existing gate forbids a retry
    const logged = warn.mock.calls.flat().map((a) => String(a)).join(' ');
    expect(logged).not.toContain('主人');
    expect(logged).toContain('chars');
  });

  it('GC-4: a malformed frame before any delta is retried through the existing gate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stub = stubFetch((_call, index) =>
      index === 0
        ? fakeResponse({ text: 'data: {"choices":[\n\n' + DONE_FRAME })
        : fakeResponse({ text: DELTA_1 + USAGE_FRAME + DONE_FRAME }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks[0]).toEqual({ kind: 'delta', text: '你好' });
    expect(stub.calls).toHaveLength(2);
  });

  it('GC-4: an explicit provider error frame in a 200 stream after a delta is a server error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stub = stubFetch(() =>
      fakeResponse({ text: DELTA_1 + 'data: {"error":{"message":"overloaded","code":"server_busy"}}\n\n' + DONE_FRAME }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => drain(client.stream(REQ, freshSignal())));
    expect((err as DeepSeekError).code).toBe('server');
    expect((err as DeepSeekError).message).not.toContain('overloaded');
    expect(stub.calls).toHaveLength(1);
  });

  it('rejects with CancelledError when the caller aborts mid-stream', async () => {
    const ctl = new AbortController();
    const stub = stubFetch((call) => fakeResponse({ body: sseThenHang([DELTA_1], call.init.signal) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const it = client.stream(REQ, ctl.signal)[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value).toEqual({ kind: 'delta', text: '你好' });
    ctl.abort();
    const err = await caught(() => it.next());
    expect(err).toBeInstanceOf(CancelledError);
    expect(err).not.toBeInstanceOf(DeepSeekError);
    expect(stub.calls).toHaveLength(1);
  });

  it('G-2: EOF after a complete delta but before [DONE] is a network failure, not a synthetic done', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sse(DELTA_1) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const seen: StreamChunk[] = [];
    const err = await caught(async () => {
      for await (const chunk of client.stream(REQ, freshSignal())) seen.push(chunk);
    });
    expect(seen).toEqual([{ kind: 'delta', text: '你好' }]);
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('network');
    expect(stub.calls).toHaveLength(1); // a delta was delivered: not retried
  });

  it('G-2: EOF after half a JSON frame is a network failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stub = stubFetch(() => fakeResponse({ body: sse(DELTA_1, 'data: {"choices":[{"del') }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => drain(client.stream(REQ, freshSignal())));
    expect((err as DeepSeekError).code).toBe('network');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().map((a) => String(a)).join(' ')).not.toContain('choices'); // CX-8
  });

  it('G-2: EOF before any delta and before [DONE] is retried through the existing gate', async () => {
    const stub = stubFetch((_call, index) =>
      index === 0 ? fakeResponse({ body: sse(': keep-alive\n\n') }) : fakeResponse({ body: sse(DELTA_1, DONE_FRAME) }),
    );
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined, random: () => 0.5 });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks).toEqual([{ kind: 'delta', text: '你好' }, { kind: 'done' }]);
    expect(stub.calls).toHaveLength(2);
  });

  it('G-2: a final [DONE] line without a trailing newline still ends the stream cleanly', async () => {
    const stub = stubFetch(() => fakeResponse({ body: sse(DELTA_1, 'data: [DONE]') }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const chunks = await drain(client.stream(REQ, freshSignal()));
    expect(chunks).toEqual([{ kind: 'delta', text: '你好' }, { kind: 'done' }]);
  });
});

// ---------------------------------------------------------------- testKey()

describe('DeepSeekClient.testKey', () => {
  it('returns ok on 200', async () => {
    const stub = stubFetch(() => fakeResponse({ text: '{"choices":[{"message":{"content":"hi"}}]}' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    expect(await client.testKey()).toEqual({ ok: true });
    expect(stub.calls).toHaveLength(1);
  });

  it('returns the auth code on 401 instead of throwing', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 401, text: 'Authentication Fails' }));
    const client = new DeepSeekClient({ apiKey: 'bad', fetch: stub.fetch, sleep: async () => undefined });
    const result = await client.testKey();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'auth' });
    expect(stub.calls).toHaveLength(1);
  });

  it('maps an aborted signal to the network code and never throws', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const stub = stubFetch(() => fakeResponse({ text: '{}' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const result = await client.testKey(ctl.signal);
    expect(result).toMatchObject({ ok: false, code: 'network' });
    expect(stub.calls).toHaveLength(0);
  });

  it('GC-7: an oversized 200 body is a server failure, never ok', async () => {
    const stub = stubFetch(() => fakeResponse({ body: forever('{"choices":[' + 'x'.repeat(4096)) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const result = await client.testKey();
    expect(result).toMatchObject({ ok: false, code: 'server' });
    expect(openBodies[0].cancelled).toBe(true);
    expect(openBodies[0].pulls).toBeLessThan(1000);
  });

  it('GC-7: a 200 whose body is not a completion is a server failure', async () => {
    for (const text of ['{}', 'not json', '{"choices":[]}', '{"choices":[{"delta":{}}]}', '[]']) {
      const stub = stubFetch(() => fakeResponse({ text }));
      const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
      expect(await client.testKey()).toMatchObject({ ok: false, code: 'server' });
    }
  });

  it('sends the pinned one-token non-streaming body', async () => {
    const stub = stubFetch(() => fakeResponse({ text: '{}' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    await client.testKey();
    const body = bodyOf(stub.calls[0]);
    expect(body).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
      thinking: { type: 'disabled' },
      temperature: 0.7,
    });
    expect(headerOf(stub.calls[0], 'Accept')).toBe('application/json');
  });
});

// ---------------------------------------------------------------- complete()

describe('DeepSeekClient.complete', () => {
  it('returns the message text and the mapped usage', async () => {
    const stub = stubFetch(() =>
      fakeResponse({
        text:
          '{"choices":[{"message":{"content":"主人今天加班到很晚，答应过周末补觉。"}}],' +
          '"usage":{"prompt_tokens":900,"prompt_cache_hit_tokens":832,"prompt_cache_miss_tokens":68,"completion_tokens":41}}',
      }),
    );
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const result = await client.complete({ messages: HI, maxTokens: 900 }, freshSignal());
    expect(result.text).toBe('主人今天加班到很晚，答应过周末补觉。');
    expect(result.usage).toEqual({ promptTokens: 900, cacheHit: 832, cacheMiss: 68, completionTokens: 41 });
  });

  it('sends stream:false with no stream_options and a json accept header', async () => {
    const stub = stubFetch(() => fakeResponse({ text: '{"choices":[{"message":{"content":"ok"}}]}' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    await client.complete({ messages: HI, maxTokens: 900 }, freshSignal());
    const body = bodyOf(stub.calls[0]);
    expect(body.stream).toBe(false);
    expect('stream_options' in body).toBe(false);
    expect(body.max_tokens).toBe(900);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.temperature).toBe(0.7);
    expect(headerOf(stub.calls[0], 'Accept')).toBe('application/json');
  });

  it('makes exactly one request on 503 — complete() never retries', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 503, text: 'Service Unavailable' }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => client.complete({ messages: HI }, freshSignal()));
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('server');
    expect(stub.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- real socket

describe('DeepSeekClient over a real node:http server', () => {
  it('streams through the global fetch across real socket writes', async () => {
    const bodies: string[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
      req.on('end', () => {
        bodies.push(raw);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(': keep-alive\n\n');
        res.write(DELTA_1);
        res.write(DELTA_3);
        res.write(USAGE_FRAME);
        res.write(DONE_FRAME);
        res.end();
      });
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
    const address = server.address() as AddressInfo;
    try {
      const client = new DeepSeekClient({ apiKey: 'local', baseUrl: `http://127.0.0.1:${address.port}` });
      const chunks = await drain(client.stream(REQ, freshSignal()));
      expect(chunks.map((c) => c.kind)).toEqual(['delta', 'delta', 'usage', 'done']);
      expect(chunks[3]).toEqual({ kind: 'done' });
      expect(chunks[2]).toEqual({ kind: 'usage', usage: EXPECTED_USAGE });
      expect(bodies).toHaveLength(1);
      expect((JSON.parse(bodies[0]) as Record<string, unknown>).thinking).toEqual({ type: 'disabled' });
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    }
  });
});

// ---------------------------------------------------------------- C-14, gated

const LIVE_KEY = process.env.DEEPSEEK_API_KEY ?? '';

/**
 * A task-local system block. Deliberately NOT renderStaticSystem: ruling P3 is still moving that
 * signature and Task 4 must not depend on a Task 3 surface in flight (contract addition 16).
 * It is comfortably longer than the 64-token cache granule, which is what the second case needs.
 */
const LIVE_SYSTEM = [
  '【硬性规则】',
  '1. 你是一个中文桌面伙伴，说话简短、口语化，一次一到三句话，通常不超过六十个汉字。',
  '2. 不要用 markdown，不要列点，不要写标题，不要加粗。',
  '3. 只写你自己的话，绝不描写对方的动作、表情或想法。',
  '4. 最后一句不要总结、不要升华、不要讲道理。',
  '5. 少用反问句，一条回复里最多一个「……」。',
  '',
  '【标记语法】',
  '每句话前面可以加一个标记表示情绪：<|ACT emotion=happy|>。',
  'emotion 只能是 happy / sad / angry / think / surprised / awkward / question / curious / neutral 之一。',
  '回复的第一句必须以 <|ACT ...|> 开头，后面的句子想换情绪时再写一个。',
  '需要停顿时写 <|PAUSE 1|>，数字是秒。',
  '除了这些标记，不要写任何尖括号或方括号。',
  '',
  '【示例】',
  '<|ACT emotion=happy|>回来啦。',
  '<|ACT emotion=curious|>今天怎么样。',
].join('\n');

const LIVE_USER =
  '【状态】本地时间 周五 21:14｜心情 平静偏好｜精力 有点困｜好感 熟络｜距离上次聊天 刚刚\n\n我回来了。';

const LIVE_MESSAGES: ChatMessage[] = [
  { role: 'system', content: LIVE_SYSTEM },
  { role: 'user', content: LIVE_USER },
];

const ACT_OPENER =
  /^<\|ACT\s+emotion=(happy|sad|angry|think|surprised|awkward|question|curious|neutral)(\s+motion=[\w-]+)?\s*\|>/;

async function liveTurn(client: DeepSeekClient): Promise<{ text: string; usage: Usage | null }> {
  let text = '';
  let usage: Usage | null = null;
  for await (const chunk of client.stream({ messages: LIVE_MESSAGES }, freshSignal())) {
    if (chunk.kind === 'delta') text += chunk.text;
    if (chunk.kind === 'usage') usage = chunk.usage;
  }
  return { text, usage };
}

describe.runIf(LIVE_KEY !== '')('C-14 — real DeepSeek API (gated on DEEPSEEK_API_KEY)', () => {
  it('streams a real reply that opens with a valid ACT tag', async () => {
    const client = new DeepSeekClient({ apiKey: LIVE_KEY });
    const { text, usage } = await liveTurn(client);
    expect(text.trimStart()).toMatch(ACT_OPENER);
    expect(usage).not.toBeNull();
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      `${EVIDENCE_DIR}task-4-live-turn.txt`,
      [
        `model ${DEEPSEEK_MODEL}`,
        `judge_model ${DEEPSEEK_JUDGE_MODEL}`,
        `act_opener_matched ${String(ACT_OPENER.test(text.trimStart()))}`,
        `usage ${JSON.stringify(usage)}`,
        'reply',
        text,
        '',
      ].join('\n'),
      'utf8',
    );
  }, 60_000);

  it('reports a prompt cache hit on a second call with the same prefix', async () => {
    const client = new DeepSeekClient({ apiKey: LIVE_KEY });
    const first = await liveTurn(client);
    const second = await liveTurn(client);
    expect(first.usage).not.toBeNull();
    expect(second.usage).not.toBeNull();
    expect((second.usage as Usage).cacheHit).toBeGreaterThan(0);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      `${EVIDENCE_DIR}task-4-cache-hit.txt`,
      [
        `first  prompt_tokens ${String((first.usage as Usage).promptTokens)} prompt_cache_hit_tokens ${String((first.usage as Usage).cacheHit)} prompt_cache_miss_tokens ${String((first.usage as Usage).cacheMiss)}`,
        `second prompt_tokens ${String((second.usage as Usage).promptTokens)} prompt_cache_hit_tokens ${String((second.usage as Usage).cacheHit)} prompt_cache_miss_tokens ${String((second.usage as Usage).cacheMiss)}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }, 90_000);
});

// ---------------------------------------------------------------- bounded body reader (G-1 / M-3) and safe errors (G-3)

/** Assembled at runtime so the literal never appears in source or output. */
const KEY = ['sk-', 'abcdefghijklmnopqrstuvwxyz', '0123456789'].join('');
const LEAK_PATTERN = /sk-[A-Za-z0-9]{20,}/;

describe('DeepSeekClient — bounded body reader (G-1 / M-3)', () => {
  it('complete(): a 200 whose body stalls times out with code timeout and cancels the body', async () => {
    vi.useFakeTimers();
    const stub = stubFetch((call) => fakeResponse({ body: sseThenHang([], call.init.signal) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const pending = caught(() => client.complete({ messages: HI }, freshSignal()));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    const err = await pending;
    expect(err).toBeInstanceOf(DeepSeekError);
    expect((err as DeepSeekError).code).toBe('timeout');
    expect(openBodies[0].cancelled).toBe(true);
  });

  it('testKey(): a 200 whose body stalls resolves {ok:false, code:timeout} without a caller signal', async () => {
    vi.useFakeTimers();
    const stub = stubFetch((call) => fakeResponse({ body: sseThenHang([], call.init.signal) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const pending = client.testKey();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ ok: false, code: 'timeout' });
    expect(openBodies[0].cancelled).toBe(true);
  });

  it('error bodies: a 500 body that never ends is not buffered past the cap and the body is cancelled', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 500, body: forever('x'.repeat(1024)) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = await caught(() => client.complete({ messages: HI }, freshSignal()));
    expect((err as DeepSeekError).code).toBe('server');
    expect(((err as DeepSeekError).detail ?? '').length).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    expect(openBodies[0].pulls).toBeLessThanOrEqual(MAX_ERROR_BODY_BYTES / 1024 + 2);
    expect(openBodies[0].cancelled).toBe(true);
  });

  it('error bodies: a stalled 401 body times out instead of hanging the caller', async () => {
    vi.useFakeTimers();
    const stub = stubFetch((call) => fakeResponse({ status: 401, body: sseThenHang(['Authentication'], call.init.signal) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const pending = caught(() => drain(client.stream(REQ, freshSignal())));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    const err = await pending;
    expect((err as DeepSeekError).code).toBe('auth');
    expect((err as DeepSeekError).status).toBe(401);
    expect(openBodies[0].cancelled).toBe(true);
  });

  it('complete(): a body larger than the JSON cap is a server error, not an unbounded buffer', async () => {
    const stub = stubFetch(() => fakeResponse({ body: forever('{"choices":[' + 'x'.repeat(4096)) }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch });
    const err = await caught(() => client.complete({ messages: HI }, freshSignal()));
    expect((err as DeepSeekError).code).toBe('server');
    expect(openBodies[0].cancelled).toBe(true);
    expect(openBodies[0].pulls).toBeLessThan(1000);
  });
});

describe('DeepSeekError — the upstream body never reaches message; detail is redacted (G-3)', () => {
  const echo = `{"error":{"message":"bad header Authorization: Bearer ${KEY} for key ${KEY}"}}`;

  it('stream(): message is status/code-derived, detail is bounded and redacted', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 401, text: echo }));
    const client = new DeepSeekClient({ apiKey: KEY, fetch: stub.fetch, sleep: async () => undefined });
    const err = (await caught(() => drain(client.stream(REQ, freshSignal())))) as DeepSeekError;
    expect(err.code).toBe('auth');
    expect(err.message).toBe('HTTP 401: the API key was rejected');
    expect(err.message).not.toMatch(LEAK_PATTERN);
    expect(err.detail).toBeDefined();
    expect(err.detail).not.toContain(KEY);
    expect(err.detail).not.toMatch(LEAK_PATTERN);
    expect(err.detail).toContain('sk-…');
    expect((err.detail ?? '').length).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    expect(String(err)).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it('redacts the exact active key even when it does not look like sk-…', async () => {
    const odd = 'weird-key-value-1234567890';
    const stub = stubFetch(() => fakeResponse({ status: 500, text: `upstream saw ${odd} in the header` }));
    const client = new DeepSeekClient({ apiKey: odd, fetch: stub.fetch, sleep: async () => undefined });
    const err = (await caught(() => client.complete({ messages: HI }, freshSignal()))) as DeepSeekError;
    expect(err.message).toBe('HTTP 500: upstream error');
    expect(err.detail).not.toContain(odd);
    expect(err.detail).toContain('sk-…');
  });

  it('testKey() returns the same shape with no key in message or detail', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 401, text: echo }));
    const client = new DeepSeekClient({ apiKey: KEY, fetch: stub.fetch });
    const result = await client.testKey();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('auth');
    expect(result.message).not.toContain(KEY);
    expect(result.message).not.toMatch(LEAK_PATTERN);
    expect(result.detail ?? '').not.toContain(KEY);
    expect(result.detail ?? '').not.toMatch(LEAK_PATTERN);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('an empty or unreadable error body leaves detail undefined and message = HTTP <status> phrase', async () => {
    const stub = stubFetch(() => fakeResponse({ status: 429 }));
    const client = new DeepSeekClient({ apiKey: 'k', fetch: stub.fetch, sleep: async () => undefined });
    const err = (await caught(() => client.complete({ messages: HI }, freshSignal()))) as DeepSeekError;
    expect(err.code).toBe('rate');
    expect(err.message).toBe('HTTP 429: rate limited');
    expect(err.detail).toBeUndefined();
  });
});
