import { PAUSE_MAX_S, type WalkAnchor } from '@ds/protocol';
import { parseLook, parseWalkTo, type LookTarget } from './act.ts';
import { isEmotion, type ScanItem, type Tag } from './types.ts';

const OPEN = '<|', CLOSE = '|>';
/**
 * §2.6: worst case `<|ACT emotion=surprised motion=<24 chars> look=-0.75,-0.50 walkTo=corner-br|>`
 * is 91; 96 leaves headroom and still keeps a runaway `<|` from buffering.
 */
export const MAX_TAG = 96;

/** §2.6: four attributes; `[\w.,-]` because `look=-0.75,-0.50` needs `.` and `,`. */
export const ACT_ATTR = /^(emotion|motion|look|walkTo)=([\w.,-]+)$/;

export type DroppedAttr = 'look' | 'walkTo' | 'unknown';
/** Called once per dropped attribute (§2.6 "counted as a compliance miss"); the StreamParser owner wires it. */
export type TagDropListener = (attr: DroppedAttr, word: string) => void;
const NO_DROP: TagDropListener = () => {};

export function parseTag(raw: string, onDrop: TagDropListener = NO_DROP): Tag | null {
  const body = raw.slice(OPEN.length, -CLOSE.length).trim();
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  // I-5: a model- or prompt-injected `<|PAUSE 100000|>` must never park the band for hours.
  if (pause) return { kind: 'pause', seconds: Math.min(Number(pause[1]), PAUSE_MAX_S) };
  const words = body.split(/\s+/);
  if (words[0] !== 'ACT' || words.length < 2) return null;
  const seen = new Set<string>();
  let emotion: string | undefined, motion: string | undefined;
  let look: LookTarget | undefined;
  let walkTo: WalkAnchor | undefined;
  for (const word of words.slice(1)) {
    const m = ACT_ATTR.exec(word);
    if (!m) { onDrop('unknown', word); continue; }          // per-attribute drop (§2.6)
    const key = m[1], value = m[2];
    if (seen.has(key)) return null;                          // duplicate: still a hard reject (§2.6)
    seen.add(key);
    if (key === 'emotion') emotion = value;
    else if (key === 'motion') motion = value;
    else if (key === 'look') { const t = parseLook(value); if (t) look = t; else onDrop('look', word); }
    else { const a = parseWalkTo(value); if (a) walkTo = a; else onDrop('walkTo', word); }
  }
  if (!emotion || !isEmotion(emotion)) return null;          // only a missing/invalid emotion rejects
  const tag: Tag = { kind: 'act', emotion };
  if (motion) tag.motion = motion;
  if (look) tag.look = look;
  if (walkTo) tag.walkTo = walkTo;
  return tag;
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
  private readonly onDrop: TagDropListener;
  constructor(onDrop: TagDropListener = NO_DROP) { this.onDrop = onDrop; }
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
      const tag = parseTag(raw, this.onDrop);
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
