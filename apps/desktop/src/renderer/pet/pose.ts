import type { Emotion } from '@ds/protocol';

/**
 * The pet's pose, as one place that knows both inputs (final review CX-10).
 *
 * `base` is what the turn says she is: `think` while the brain is thinking, the sentence's emotion
 * while she speaks, `neutral` at idle. `avatar:listening {on:true}` lays `curious` over it while
 * the user types; `{on:false}` must put the BASE back, not leave her curious until the next turn.
 * A base change while listening shows through (a sentence arriving is the stronger signal), and
 * the next `{on:false}` still resolves to that base.
 */
export class PoseTracker {
  private base: Emotion = 'neutral';
  private listening = false;

  constructor(private readonly apply: (e: Emotion) => void) {}

  /** What a fresh listening edge would resolve to. */
  get pose(): Emotion {
    return this.listening ? 'curious' : this.base;
  }

  /** brain:state thinking/idle and brain:sentence. Always applied, as every event did before. */
  setBase(e: Emotion): void {
    this.base = e;
    this.apply(e);
  }

  /** avatar:listening. Only an edge re-applies; a repeated `{on:true}` restarts nothing. */
  setListening(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    this.apply(on ? 'curious' : this.base);
  }
}
