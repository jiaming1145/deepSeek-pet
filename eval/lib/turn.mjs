// eval/lib/turn.mjs — one evaluated turn, and the tiny work pool run.mjs uses.
import { StreamParser, sanitizeForDisplay, lintReply, isSensitive, assemblePrompt, estimateTokens } from '@ds/brain';
import { shapeOf } from './shape.mjs';
import { axesFor } from './aggregate.mjs';

/**
 * Frozen synthetic state. Fixed on purpose: the assembled prefix must be
 * byte-identical across turns or X1's cache-hit number means nothing.
 */
export const EVAL_STATE = Object.freeze({
  localTime: '21:14',
  weekday: '周三',
  mood: 0.1,
  energy: 70,
  affection: 50,
  sinceLastChat: '3小时',
});

export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * ctx = { dry, client, staticSystem, postHistoryInstructions, recent: string[], maxTokens }
 * ctx.recent is mutated: it is the running list of this run's sanitized replies.
 */
export async function runTurn({ prompt, runIndex, indexInRun, ctx }) {
  const history = (prompt.priorTurns ?? []).map((t) => ({ role: t.role, content: t.content }));
  const messages = assemblePrompt({
    staticSystem: ctx.staticSystem,
    postHistoryInstructions: ctx.postHistoryInstructions,
    summary: '',
    facts: [],
    history,
    state: EVAL_STATE,
    userText: prompt.text,
  });
  const estimatedPromptTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);

  const parser = new StreamParser(`${prompt.id}#${runIndex}`);
  const controller = new AbortController();
  const started = Date.now();
  let ttftMs = null;
  let usage = null;
  const sentences = [];

  const iter = ctx.dry
    ? ctx.client.streamFor(prompt.id)
    : ctx.client.stream({ messages, maxTokens: ctx.maxTokens ?? 300 }, controller.signal);

  for await (const chunk of iter) {
    if (chunk.kind === 'delta') {
      if (ttftMs === null) ttftMs = Date.now() - started;
      for (const ev of parser.push(chunk.text)) sentences.push(ev);
    } else if (chunk.kind === 'usage') {
      usage = chunk.usage;
    }
  }
  for (const ev of parser.flush()) sentences.push(ev);

  const totalMs = Date.now() - started;
  const raw = sentences.map((s) => s.text).join('');
  const reply = sanitizeForDisplay(raw);
  const sensitive = typeof prompt.sensitive === 'boolean' ? prompt.sensitive : isSensitive(prompt.text);
  const lint = lintReply(raw, { recent: ctx.recent.slice(-5), sensitiveTurn: sensitive });
  ctx.recent.push(reply);

  return {
    promptId: prompt.id,
    category: prompt.category,
    run: runIndex,
    indexInRun,
    sensitive,
    axes: axesFor(prompt),
    raw,
    reply,
    lint,
    usage,
    ttftMs,
    totalMs,
    complianceMiss: parser.complianceMiss,
    regenerated: false,
    estimatedPromptTokens,
    shape: shapeOf(reply),
    judge: null,
    judgeError: false,
  };
}
