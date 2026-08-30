import { CancelledError, type ChatClient, type ChatRequest, type StreamChunk, type Usage } from '@ds/brain';

export const FAKE_BRAIN_ENV = 'DS_FAKE_BRAIN';

/**
 * Dev-only, the same guard shape as D5's dev key: unreachable in a packaged build. DS_FAKE_BRAIN is
 * a third distinct variable, alongside DS_DEV_DEEPSEEK_KEY (the dev app key) and DEEPSEEK_API_KEY
 * (the test/eval gate). None of the three ever stands in for another.
 */
export function useFakeBrain(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged && env[FAKE_BRAIN_ENV] === '1';
}

// Four openers/tails so consecutive replies do not trip `opener-repeat` or `repetition`, and the
// dev run exercises the real lint path instead of looping on a regeneration.
const OPENERS = ['听见了，你说', '收到，你刚说', '嗯，我这边记下了', '好，你提到'] as const;
const TAILS = ['我在这儿。', '接着说吧。', '等你下一句。', '先放着。'] as const;
const FAKE_USAGE: Usage = { promptTokens: 128, cacheHit: 64, cacheMiss: 64, completionTokens: 24 };

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new CancelledError());
      },
      { once: true },
    );
  });

function* pieces(s: string, n: number): Generator<string> {
  for (let i = 0; i < s.length; i += n) yield s.slice(i, i + n);
}

/**
 * An offline echo brain: streams a lint-clean, ACT-compliant reply in 6-character chunks (which
 * also exercises TagScanner's chunk-safety, since a `<|ACT …|>` tag is longer than one chunk). It
 * exists so T6 is verifiable end to end with no key and no network — nothing in the pipeline is
 * faked except the HTTP call itself.
 */
export function createFakeClient(): ChatClient {
  let turn = 0;
  return {
    async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
      // The latest user message is the state preamble plus the user's text; the text is its last
      // non-empty line (contracts.md §3.8.3 puts `userText` last, with the optional nudge after it).
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      const text = (last?.content ?? '').split('\n').filter((l) => l.trim()).pop() ?? '';
      const i = turn++ % OPENERS.length;
      const reply = `<|ACT emotion=happy motion=nod|>${OPENERS[i]}「${text}」。<|ACT emotion=curious|>${TAILS[i]}`;
      for (const piece of pieces(reply, 6)) {
        if (signal.aborted) throw new CancelledError();
        await sleep(40, signal);
        yield { kind: 'delta', text: piece };
      }
      yield { kind: 'usage', usage: FAKE_USAGE };
      yield { kind: 'done' };
    },
    async testKey() {
      return { ok: true as const };
    },
    async complete() {
      return { text: '（假摘要：这是 DS_FAKE_BRAIN 的占位结果。）', usage: FAKE_USAGE };
    },
  };
}
