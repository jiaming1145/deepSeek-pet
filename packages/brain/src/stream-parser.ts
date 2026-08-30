import { SentenceSplitter } from './sentences.ts';
import { TagScanner } from './tags.ts';
import type { Emotion, SentenceEvent } from './types.ts';

/** §9.4: the ONE option. `dropAct` is set by BrainService for plain mode (R3-12). */
export interface StreamParserOptions { dropAct?: boolean }

export class StreamParser {
  private readonly tags = new TagScanner();
  private readonly sentences = new SentenceSplitter();
  private emotion: Emotion = 'neutral';
  private motion: string | undefined;
  private motionUsed = false;
  private pendingPause: number | undefined;
  private seq = 0;
  private sawAct = false;
  private sawText = false;
  private readonly turnId: string;
  /** Plain mode: every tag is consumed and discarded; emotion stays 'neutral'; no complianceMiss. */
  private readonly dropAct: boolean;
  public complianceMiss = false;
  constructor(turnId: string, opts: StreamParserOptions = {}) {
    this.turnId = turnId;
    this.dropAct = opts.dropAct === true;
  }

  /** True once any non-whitespace text was seen — the parser fact behind the §3.9.4 empty test (I-2). */
  get hasText(): boolean { return this.sawText; }

  push(chunk: string): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.push(chunk)) {
      if (item.kind === 'tag') {
        if (this.dropAct) continue;                       // §9.4: consumed, never applied
        for (const s of this.sentences.settle()) out.push(this.emit(s));
        if (item.tag.kind === 'act') { this.emotion = item.tag.emotion; this.motion = item.tag.motion; this.motionUsed = false; this.sawAct = true; }
        else this.pendingPause = item.tag.seconds;
      } else if (item.kind === 'text') {
        this.onText(item.text, out);
      }
    }
    return out;
  }

  flush(): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.flush()) if (item.kind === 'text') this.onText(item.text, out);
    for (const s of this.sentences.flush()) out.push(this.emit(s));
    return out;
  }

  /** G-13: the one text handler for push and flush; whitespace-only text is not "text seen". */
  private onText(text: string, out: SentenceEvent[]): void {
    if (text.trim() !== '') {
      if (!this.dropAct && !this.sawAct && !this.sawText) this.complianceMiss = true;
      this.sawText = true;
    }
    for (const s of this.sentences.push(text)) out.push(this.emit(s));
  }

  private emit(text: string): SentenceEvent {
    const ev: SentenceEvent = { turnId: this.turnId, seq: this.seq++, text, emotion: this.emotion };
    if (this.motion && !this.motionUsed) { ev.motion = this.motion; this.motionUsed = true; }
    if (this.pendingPause !== undefined) { ev.pause = this.pendingPause; this.pendingPause = undefined; }
    return ev;
  }
}
