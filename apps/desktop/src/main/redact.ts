/**
 * G-3: nothing that came back from upstream is logged or forwarded raw. A proxy or endpoint that
 * echoes the request would otherwise put the Authorization value in the log file and in a
 * renderer. The BRAIN lane makes `DeepSeekError.message` user-safe at the source; this is main's
 * own line of defence, applied regardless.
 */
const KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/g;
export const REDACTED = 'sk-[redacted]';
/** Enough of an upstream body to diagnose a failure; never the whole thing. */
export const DETAIL_MAX_CHARS = 200;

/** Replaces every DeepSeek-shaped key with a fixed marker. Safe for IPC payloads. */
export function redactSecrets(text: string): string {
  return text.replace(KEY_PATTERN, REDACTED);
}

/** Redacted, whitespace-collapsed and cut to `max` characters — the form a log line may carry. */
export function boundedDetail(text: string, max: number = DETAIL_MAX_CHARS): string {
  const flat = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
