/**
 * `StatePreamble.sinceLastChat` (contracts.md §3.8.2 / §6.6). A phrase, never a number of
 * milliseconds: the whole state preamble is phrase-only (C-5), and this is the one place the gap
 * becomes text.
 */
export function humanizeGap(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 5) return '刚刚';
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  return `${Math.floor(hours / 24)}天`;
}
