import type { ErrorCode } from '@ds/protocol';
import type { ChatMessage, Usage } from './types.ts';

// ---------------------------------------------------------------- public types

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
}

export type StreamChunk =
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done' };

export interface ChatClient {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
  /** Non-streaming single call. On the INTERFACE, not just the class — §4.4's makeSummarizer needs it. */
  complete(req: ChatRequest, signal: AbortSignal): Promise<{ text: string; usage: Usage }>;
  testKey(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string }>;
}

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  /**
   * Accepted for symmetry with TurnRunnerDeps and unread here: the client needs no clock.
   * The connect and idle timeouts are setTimeout timers; `sleep` governs the retry backoff.
   */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

// ---------------------------------------------------------------- constants (§3.9.1)

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_JUDGE_MODEL = 'deepseek-v4-pro';
export const DEFAULT_MAX_TOKENS = 300;
/** Headers not received within this window -> code 'timeout'. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** No SSE bytes for this long mid-stream -> code 'timeout'. */
export const IDLE_TIMEOUT_MS = 30_000;
/** 3 retries, 4 attempts max, for stream() only. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const RETRY_JITTER = 0.3;
export const RETRYABLE: readonly ErrorCode[] = ['rate', 'server', 'network', 'timeout'];
/** The first colon is full-width, the second is not. One binding so nobody retypes them. */
export const STOP_SEQUENCES = ['\n用户：', '\n用户:', '\nUser:'] as const;

// ---------------------------------------------------------------- errors

export class DeepSeekError extends Error {
  readonly code: ErrorCode;
  readonly status: number | null;

  constructor(code: ErrorCode, status: number | null, message: string) {
    super(message);
    this.name = 'DeepSeekError';
    this.code = code;
    this.status = status;
  }
}

/** User abort. Never a DeepSeekError, never retried, never an `error` event (§3.11.5). */
export class CancelledError extends Error {
  constructor(message = 'the request was cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

// ---------------------------------------------------------------- SSE line parsing (§3.9.2)

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One SSE line in, zero or more chunks out. A single frame can legally carry both a delta and a
 * `usage` object, hence the array return; the delta always comes first.
 */
export function parseSseLine(line: string): StreamChunk[] {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (text === '' || text.startsWith(':')) return [];
  if (!text.startsWith('data:')) return [];

  let payload = text.slice('data:'.length);
  if (payload.startsWith(' ')) payload = payload.slice(1);
  if (payload === '[DONE]') return [{ kind: 'done' }];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    console.warn(`[deepseek] skipped a malformed SSE frame: ${payload.slice(0, 120)}`);
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];

  const frame = parsed as {
    choices?: { delta?: { content?: unknown } }[];
    usage?: Record<string, unknown> | null;
  };
  const out: StreamChunk[] = [];

  const content = frame.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content !== '') out.push({ kind: 'delta', text: content });

  const usage = frame.usage;
  if (usage !== null && usage !== undefined && typeof usage === 'object') {
    out.push({ kind: 'usage', usage: mapUsage(usage) });
  }
  return out;
}

const mapUsage = (raw: Record<string, unknown>): Usage => ({
  promptTokens: asNumber(raw.prompt_tokens),
  cacheHit: asNumber(raw.prompt_cache_hit_tokens),
  cacheMiss: asNumber(raw.prompt_cache_miss_tokens),
  completionTokens: asNumber(raw.completion_tokens),
});

// ---------------------------------------------------------------- internals

/** Races a promise against a real timer. Used for the idle timeout only. */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(onTimeout()); }, ms);
  });
  return Promise.race([promise, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

interface Linked {
  signal: AbortSignal;
  timedOut: () => boolean;
  clearConnectTimer: () => void;
  dispose: () => void;
}

/**
 * One inner AbortController that the caller's signal and the connect timer both abort, so the
 * catch site can tell a user cancel from a connect timeout from a socket failure.
 */
function link(outer: AbortSignal, connectMs: number): Linked {
  const inner = new AbortController();
  let expired = false;
  const forward = (): void => { inner.abort(); };
  if (outer.aborted) inner.abort();
  else outer.addEventListener('abort', forward, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    expired = true;
    inner.abort();
  }, connectMs);

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    signal: inner.signal,
    timedOut: () => expired,
    clearConnectTimer: stopTimer,
    dispose: () => {
      stopTimer();
      outer.removeEventListener('abort', forward);
    },
  };
}

/** Error body is read (max 2 KB) and used as the message; `HTTP <status>` when unreadable. */
async function httpError(res: Response): Promise<DeepSeekError> {
  const status = res.status;
  const code: ErrorCode =
    status === 401 ? 'auth' : status === 402 ? 'balance' : status === 429 ? 'rate' : 'server';
  let message = `HTTP ${status}`;
  try {
    const body = await res.text();
    if (body !== '') message = body.slice(0, 2048);
  } catch {
    message = `HTTP ${status}`;
  }
  return new DeepSeekError(code, status, message);
}

// ---------------------------------------------------------------- the client

export class DeepSeekClient implements ChatClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: DeepSeekOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, '');
    this.model = opts.model ?? DEEPSEEK_MODEL;
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
    this.random = opts.random ?? Math.random;
  }

  // -------------------------------------------------------------- request shapes

  private url(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  private headers(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: accept,
    };
  }

  private streamBody(req: ChatRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'disabled' },
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      stop: [...STOP_SEQUENCES],
    };
  }

  /** stream()'s body minus stream_options — OpenAI-compatible servers reject it when stream is false. */
  private completeBody(req: ChatRequest): Record<string, unknown> {
    const body = this.streamBody(req);
    delete body.stream_options;
    body.stream = false;
    return body;
  }

  /** The literal §3.9.1 key-test body: one token, no top_p, no stop. */
  private testKeyBody(): Record<string, unknown> {
    return {
      model: this.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
      thinking: { type: 'disabled' },
      temperature: 0.7,
    };
  }

  private async request(
    body: Record<string, unknown>,
    accept: string,
    outer: AbortSignal,
    linked: Linked,
  ): Promise<Response> {
    if (outer.aborted) throw new CancelledError('cancelled before the request was sent');
    try {
      return await this.doFetch(this.url(), {
        method: 'POST',
        headers: this.headers(accept),
        body: JSON.stringify(body),
        signal: linked.signal,
      });
    } catch (err) {
      if (outer.aborted) throw new CancelledError('the request was cancelled');
      if (linked.timedOut()) {
        throw new DeepSeekError('timeout', null, `no response headers within ${CONNECT_TIMEOUT_MS} ms`);
      }
      throw new DeepSeekError('network', null, describeError(err));
    } finally {
      linked.clearConnectTimer();
    }
  }

  // -------------------------------------------------------------- stream()

  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    return this.streamWithRetries(req, signal);
  }

  /**
   * One gate, written once: the failure code is retryable AND no delta has reached the consumer.
   * That single conjunction is what makes §3.9.3's "idle timeout mid-stream -> not retried" true
   * while 'timeout' stays in RETRYABLE. Retrying after a visible delta would duplicate text.
   */
  private async *streamWithRetries(req: ChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    let sawDelta = false;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const chunk of this.streamOnce(req, signal)) {
          if (chunk.kind === 'delta') sawDelta = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const failure =
          err instanceof DeepSeekError ? err : new DeepSeekError('network', null, describeError(err));
        const mayRetry =
          RETRYABLE.includes(failure.code) && !sawDelta && attempt < RETRY_DELAYS_MS.length;
        if (!mayRetry) throw failure;
        await this.backoff(attempt, signal);
      }
    }
  }

  private async backoff(attempt: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new CancelledError('cancelled before the retry');
    const factor = 1 + (this.random() * 2 - 1) * RETRY_JITTER;
    const delay = Math.round(RETRY_DELAYS_MS[attempt] * factor);
    let onAbort = (): void => undefined;
    const aborted = new Promise<void>((resolve) => {
      onAbort = (): void => { resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(delay), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new CancelledError('cancelled during the retry backoff');
  }

  private async *streamOnce(req: ChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    const linked = link(signal, CONNECT_TIMEOUT_MS);
    try {
      const res = await this.request(this.streamBody(req), 'text/event-stream', signal, linked);
      if (!res.ok) throw await httpError(res);
      const body = res.body;
      if (body === null) throw new DeepSeekError('server', res.status, 'the streaming response carried no body');

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffered = '';

      const readNext = async () => {
        try {
          return await withTimeout(
            reader.read(),
            IDLE_TIMEOUT_MS,
            () => new DeepSeekError('timeout', null, `no stream data for ${IDLE_TIMEOUT_MS} ms`),
          );
        } catch (err) {
          if (signal.aborted) throw new CancelledError('the stream was cancelled');
          if (err instanceof DeepSeekError) throw err;
          throw new DeepSeekError('network', null, describeError(err));
        }
      };

      try {
        for (;;) {
          const step = await readNext();
          if (step.done) break;
          buffered += decoder.decode(step.value, { stream: true });
          let newline = buffered.indexOf('\n');
          while (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            for (const chunk of parseSseLine(line)) {
              yield chunk;
              if (chunk.kind === 'done') return;
            }
            newline = buffered.indexOf('\n');
          }
        }
        buffered += decoder.decode();
        for (const chunk of parseSseLine(buffered)) {
          yield chunk;
          if (chunk.kind === 'done') return;
        }
        yield { kind: 'done' };
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } finally {
      linked.dispose();
    }
  }

  // -------------------------------------------------------------- complete() / testKey()

  async complete(req: ChatRequest, signal: AbortSignal): Promise<{ text: string; usage: Usage }> {
    const linked = link(signal, CONNECT_TIMEOUT_MS);
    try {
      const res = await this.request(this.completeBody(req), 'application/json', signal, linked);
      if (!res.ok) throw await httpError(res);
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (err) {
        if (signal.aborted) throw new CancelledError('the request was cancelled');
        throw new DeepSeekError('server', res.status, `unreadable response body: ${describeError(err)}`);
      }
      const payload = (parsed ?? {}) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: Record<string, unknown> | null;
      };
      const content = payload.choices?.[0]?.message?.content;
      return {
        text: typeof content === 'string' ? content : '',
        usage: mapUsage(payload.usage ?? {}),
      };
    } finally {
      linked.dispose();
    }
  }

  async testKey(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string }> {
    const outer = signal ?? new AbortController().signal;
    const linked = link(outer, CONNECT_TIMEOUT_MS);
    try {
      const res = await this.request(this.testKeyBody(), 'application/json', outer, linked);
      if (!res.ok) {
        const failure = await httpError(res);
        return { ok: false, code: failure.code, message: failure.message };
      }
      await res.text().catch(() => '');
      return { ok: true };
    } catch (err) {
      if (err instanceof CancelledError) return { ok: false, code: 'network', message: err.message };
      if (err instanceof DeepSeekError) return { ok: false, code: err.code, message: err.message };
      return { ok: false, code: 'network', message: describeError(err) };
    } finally {
      linked.dispose();
    }
  }
}
