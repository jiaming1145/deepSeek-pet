const HARD = /[。！？!?]|…+|\n+/g;
/** G-12: characters that extend a hard boundary — more terminals, ellipsis dots, closing quotes/brackets, newlines. */
const TRAIL = /[。！？!?…\n」』”’)）\]】]/;
const COMMA = /[，,]/g;

export class SentenceSplitter {
  private buf = '';
  private emitted = 0;
  private readonly minFirstChars: number;
  constructor(minFirstChars = 6) { this.minFirstChars = minFirstChars; }

  push(text: string): string[] {
    this.buf += text;
    return this.scan(false);
  }

  /**
   * A control tag is a definite boundary: a hard run held at the end of the buffer (waiting to see
   * whether it grows) is closed now, so the sentence keeps the ACT/PAUSE that preceded the tag.
   */
  settle(): string[] { return this.scan(true); }

  private scan(boundary: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      HARD.lastIndex = 0;
      const m = HARD.exec(this.buf);
      let cut = -1;
      if (m) {
        // Group the whole punctuation run (`？！`, `！！`, `。」`, `……`).
        cut = m.index + m[0].length;
        while (cut < this.buf.length && TRAIL.test(this.buf[cut])) cut++;
        // A run that reaches the end of the buffer may still grow: wait for lookahead or flush.
        if (cut === this.buf.length && !boundary) cut = -1;
      }
      if (this.emitted === 0) {
        // The first eligible comma at or after minFirstChars, not merely the first comma.
        COMMA.lastIndex = this.minFirstChars;
        const c = COMMA.exec(this.buf);
        if (c && (cut < 0 || c.index < cut) && (m === null || c.index < m.index)) cut = c.index + 1;
      }
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).replace(/\n+$/, '');
      this.buf = this.buf.slice(cut);
      if (piece.trim()) { out.push(piece); this.emitted++; }
    }
    return out;
  }
  flush(): string[] { const rest = this.buf.trim(); this.buf = ''; if (rest) { this.emitted++; return [rest]; } return []; }
}
