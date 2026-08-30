// eval/lib/bounded-fetch.mjs — a fetch that cannot hang the run (final-review CX-11).
// Every judge / ablation call goes through here: the request has a hard deadline
// (AbortSignal.timeout), the body read is capped in bytes and in idle time, and any
// of those failures surfaces as a plain Error so the caller can mark the turn instead
// of waiting forever on a stalled upstream.

export const DEFAULT_TIMEOUT_MS = 120_000;   // whole request; the judge thinks, so generous
export const DEFAULT_IDLE_MS = 30_000;       // max gap between two body chunks
export const DEFAULT_MAX_BYTES = 256 * 1024; // a judgement is < 1 KiB; 256 KiB is already wrong

function abortError(signal, fallback) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(fallback);
}

/** Resolves/rejects like `promise`, but rejects as soon as `signal` aborts (even if the promise ignores it). */
export function raceSignal(promise, signal, label) {
  if (signal.aborted) return Promise.reject(abortError(signal, `${label} aborted`));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal, `${label} aborted`));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * Read a Response body as text with a byte cap and an idle cap.
 * Falls back to res.text() / res.json() for mocked responses without a stream.
 */
export async function readBoundedBody(res, { maxBytes = DEFAULT_MAX_BYTES, idleMs = DEFAULT_IDLE_MS, signal } = {}) {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    if (typeof res.text === 'function') return raceSignal(res.text(), signal, 'body read');
    if (typeof res.json === 'function') return JSON.stringify(await raceSignal(res.json(), signal, 'body read'));
    return '';
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  try {
    for (;;) {
      const idle = AbortSignal.timeout(idleMs);
      const both = AbortSignal.any([signal, idle]);
      const { done, value } = await raceSignal(reader.read(), both, 'body read');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error(`response body exceeded ${maxBytes} bytes`);
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

/**
 * fetch + bounded body read. Returns { status, ok, text }. Throws Error on timeout,
 * idle stall, oversize body, or a fetchImpl that never resolves (raceSignal covers that).
 */
export async function boundedFetch(fetchImpl, url, init, { timeoutMs = DEFAULT_TIMEOUT_MS, idleMs = DEFAULT_IDLE_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await raceSignal(Promise.resolve().then(() => fetchImpl(url, { ...init, signal })), signal, 'request');
  const text = await readBoundedBody(res, { maxBytes, idleMs, signal });
  return { status: res.status, ok: res.ok, text };
}
