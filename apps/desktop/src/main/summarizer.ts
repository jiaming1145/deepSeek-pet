import type { ChatClient, ChatMessage, Summarize } from '@ds/brain';

/** contracts.md §4.4's literal system message — do not reword it. */
export const SUMMARY_SYSTEM =
  '把下面的聊天记录压缩成一段中文摘要，第三人称，只保留后面还用得上的事实和约定：人名、称呼、正在发生的事、答应过的事、明确说过的喜好和忌讳。不要写心情描写，不要写评价，不要分点，不超过三百字。';
export const SUMMARY_MAX_TOKENS = 900;

/**
 * The `Summarize` port `HistoryStore.onTrimNeeded` calls at a trim event. One non-streaming
 * v4-flash call; the running summary is refreshed nowhere else, which is what keeps the cached
 * prefix stable for the cache-hit target.
 *
 * `charName` prefixes the assistant lines of the rendered transcript. The default keeps §4.4's
 * original literal behaviour; main passes `bundle.card.name`, because P0 changes the persona and a
 * hard-coded 小春 would mislabel every assistant line the summariser reads.
 */
export function makeSummarizer(client: ChatClient, charName = '小春'): Summarize {
  return async (oldSummary, dropped) => {
    const lines = dropped.map((m) => `${m.role === 'user' ? '用户' : charName}：${m.content}`).join('\n');
    const user = oldSummary ? `【已有摘要】\n${oldSummary}\n\n【新的聊天记录】\n${lines}` : lines;
    const messages: ChatMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: user },
    ];
    const res = await client.complete({ messages, maxTokens: SUMMARY_MAX_TOKENS }, new AbortController().signal);
    return res.text.trim();
  };
}
