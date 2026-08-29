import { SentenceSplitter } from './sentences.ts';
import { TagScanner } from './tags.ts';
import type { Emotion, SentenceEvent } from './types.ts';

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
  public complianceMiss = false;
  constructor(turnId: string) { this.turnId = turnId; }

  push(chunk: string): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.push(chunk)) {
      if (item.kind === 'tag') {
        if (item.tag.kind === 'act') { this.emotion = item.tag.emotion; this.motion = item.tag.motion; this.motionUsed = false; this.sawAct = true; }
        else this.pendingPause = item.tag.seconds;
      } else if (item.kind === 'text') {
        if (!this.sawAct && !this.sawText && item.text.trim()) this.complianceMiss = true;
        this.sawText = true;
        for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
      }
    }
    return out;
  }

  flush(): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.flush()) if (item.kind === 'text') for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
    for (const s of this.sentences.flush()) out.push(this.emit(s));
    return out;
  }

  private emit(text: string): SentenceEvent {
    const ev: SentenceEvent = { turnId: this.turnId, seq: this.seq++, text, emotion: this.emotion };
    if (this.motion && !this.motionUsed) { ev.motion = this.motion; this.motionUsed = true; }
    if (this.pendingPause !== undefined) { ev.pause = this.pendingPause; this.pendingPause = undefined; }
    return ev;
  }
}
