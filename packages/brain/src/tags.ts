import { isEmotion, type ScanItem, type Tag } from './types.ts';

const OPEN = '<|', CLOSE = '|>', MAX_TAG = 64;

export function parseTag(raw: string): Tag | null {
  const body = raw.slice(OPEN.length, -CLOSE.length).trim();
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  if (pause) return { kind: 'pause', seconds: Number(pause[1]) };
  if (!body.startsWith('ACT')) return null;
  const attrs = Object.fromEntries([...body.slice(3).matchAll(/(\w+)=([\w-]+)/g)].map((m) => [m[1], m[2]]));
  if (!attrs.emotion || !isEmotion(attrs.emotion)) return null;
  return attrs.motion ? { kind: 'act', emotion: attrs.emotion, motion: attrs.motion } : { kind: 'act', emotion: attrs.emotion };
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
      if (end < 0) {
        if (this.buf.length > MAX_TAG) { out.push({ kind: 'text', text: this.buf }); this.buf = ''; }
        break; // wait for more
      }
      const raw = this.buf.slice(0, end + CLOSE.length);
      this.buf = this.buf.slice(end + CLOSE.length);
      const tag = parseTag(raw);
      out.push(tag ? { kind: 'tag', tag } : { kind: 'badtag', raw });
    }
    return out;
  }
  flush(): ScanItem[] { const rest = this.buf; this.buf = ''; return rest ? [{ kind: 'text', text: rest }] : []; }
}
