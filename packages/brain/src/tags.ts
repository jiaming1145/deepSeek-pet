import { PAUSE_MAX_S } from '@ds/protocol';
import { isEmotion, type ScanItem, type Tag } from './types.ts';

const OPEN = '<|', CLOSE = '|>', MAX_TAG = 64;

/** G-11: one anchored ACT grammar — exactly `ACT`, attributes `emotion` (required) / `motion` (optional). */
const ACT_ATTR = /^(emotion|motion)=([\w-]+)$/;

export function parseTag(raw: string): Tag | null {
  const body = raw.slice(OPEN.length, -CLOSE.length).trim();
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  // I-5: a model- or prompt-injected `<|PAUSE 100000|>` must never park the band for hours.
  if (pause) return { kind: 'pause', seconds: Math.min(Number(pause[1]), PAUSE_MAX_S) };
  const words = body.split(/\s+/);
  if (words[0] !== 'ACT' || words.length < 2) return null;
  const attrs: { emotion?: string; motion?: string } = {};
  for (const word of words.slice(1)) {
    const m = ACT_ATTR.exec(word);
    if (!m) return null;
    const key = m[1] as 'emotion' | 'motion';
    if (attrs[key] !== undefined) return null; // duplicate attribute
    attrs[key] = m[2];
  }
  if (!attrs.emotion || !isEmotion(attrs.emotion)) return null;
  return attrs.motion ? { kind: 'act', emotion: attrs.emotion, motion: attrs.motion } : { kind: 'act', emotion: attrs.emotion };
}

/**
 * I-1 / G-10: a candidate that starts with `<|` but can never be a tag (a second `<|` before any
 * `|>`, longer than MAX_TAG, or unclosed at end of stream) is split into its tag-ish head — `<|`,
 * then anything that is not `<`, `>` or `|`, then at most one `|` or `>` — which is emitted as
 * `badtag`, and the remainder, which is the model's prose and is emitted as text. A candidate is
 * never emitted as visible text.
 */
const BAD_HEAD = /^<\|[^<>|]*[|>]?/;

function reject(raw: string, out: ScanItem[]): string {
  const head = BAD_HEAD.exec(raw)?.[0] ?? OPEN;
  out.push({ kind: 'badtag', raw: head });
  return raw.slice(head.length);
}

export class TagScanner {
  private buf = '';
  push(chunk: string): ScanItem[] {
    this.buf += chunk;
    const out: ScanItem[] = [];
    for (;;) {
      const start = this.buf.indexOf(OPEN);
      // Hold a trailing '<': it may be the first half of an OPEN split across two chunks.
      if (start < 0) { const hold = this.buf.endsWith('<') ? 1 : 0; const text = hold ? this.buf.slice(0, -1) : this.buf; if (text) out.push({ kind: 'text', text }); this.buf = hold ? '<' : ''; break; }
      if (start > 0) { out.push({ kind: 'text', text: this.buf.slice(0, start) }); this.buf = this.buf.slice(start); }
      const end = this.buf.indexOf(CLOSE);
      const again = this.buf.indexOf(OPEN, OPEN.length);
      // A second `<|` before any `|>`: the first candidate is malformed; re-scan from the second.
      if (again >= 0 && (end < 0 || again < end)) {
        const rest = reject(this.buf.slice(0, again), out);
        if (rest) out.push({ kind: 'text', text: rest });
        this.buf = this.buf.slice(again);
        continue;
      }
      if (end < 0) {
        if (this.buf.length > MAX_TAG) { this.buf = reject(this.buf, out); continue; }
        break; // wait for more
      }
      const raw = this.buf.slice(0, end + CLOSE.length);
      this.buf = this.buf.slice(end + CLOSE.length);
      if (raw.length > MAX_TAG) { this.buf = reject(raw, out) + this.buf; continue; }
      const tag = parseTag(raw);
      out.push(tag ? { kind: 'tag', tag } : { kind: 'badtag', raw });
    }
    return out;
  }
  flush(): ScanItem[] {
    const rest = this.buf;
    this.buf = '';
    if (!rest) return [];
    if (!rest.startsWith(OPEN)) return [{ kind: 'text', text: rest }];
    const out: ScanItem[] = [];
    const tail = reject(rest, out);
    if (tail) out.push({ kind: 'text', text: tail });
    return out;
  }
}
