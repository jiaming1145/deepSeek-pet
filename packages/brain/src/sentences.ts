const HARD = /[。！？!?]|…+|\n+/g;
const COMMA = /[，,]/;

export class SentenceSplitter {
  private buf = '';
  private emitted = 0;
  private readonly minFirstChars: number;
  constructor(minFirstChars = 6) { this.minFirstChars = minFirstChars; }

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    for (;;) {
      HARD.lastIndex = 0;
      const m = HARD.exec(this.buf);
      let cut = -1;
      if (m) cut = m.index + m[0].length;
      if (this.emitted === 0) {
        const c = this.buf.search(COMMA);
        if (c >= this.minFirstChars && (cut < 0 || c < cut)) cut = c + 1;
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
