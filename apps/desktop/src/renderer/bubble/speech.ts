import { Channels, type ErrorCode, type SentenceEvent, type TurnState } from '@ds/protocol';
import type { DsBridge } from './bridge';
import type { Bubble } from './bubble';
import type { HintSurface } from './hint';
import { RevealPlan, type RevealStep } from './reveal';

/** How long the band stays up after the whole TURN is shown (contracts.md §5.2). */
export const LINGER_MS = 3000;
/** Mirrors --sp-2: the gap between the band and the hint strip below it. */
export const HINT_GAP = 8;
export const MAX_LINES = 6;
/** 460px band - 24 shadow room - 12 - 32 padding - 2 border = 390px = 24 hanzi at --fs-bubble. */
export const MAX_HANZI_PER_LINE = 24;

export interface SpeechDeps {
  bubble: Bubble;
  hint: HintSurface;
  /** undefined in browser/Playwright mode — the page must still render and reveal. */
  bridge: DsBridge | undefined;
  now?: () => number;
  /** Injectable timer, default window.setTimeout. Named per contracts.md §5.2. */
  raf?: (cb: () => void, ms: number) => number;
}

interface Current {
  ev: SentenceEvent;
  steps: readonly RevealStep[];
  i: number;
}

/**
 * Owns the sentence queue, the reveal cadence, the mouth transitions and the linger.
 *
 * Timing shape (contracts.md §5.2): a sentence's graphemes are painted on their own RevealPlan
 * delays; `playback:sentenceDone` is sent the instant the last grapheme lands and the next queued
 * sentence starts immediately — its `pause` (the `<|PAUSE n|>` beat) is the only inter-sentence
 * gap. `LINGER_MS` applies ONCE per turn. `pinned` defers only that hide, never the reveal.
 */
export class SpeechController {
  private readonly bubble: Bubble;
  private readonly hint: HintSurface;
  private readonly bridge: DsBridge | undefined;
  private readonly now: () => number;
  private readonly timer: (cb: () => void, ms: number) => number;
  private readonly ownsTimer: boolean;

  private turnId: string | null = null;
  private queue: SentenceEvent[] = [];
  /** Sentences already fully painted in this turn, oldest first. */
  private shownText: string[] = [];
  /** Graphemes painted of the sentence in flight. */
  private partial = '';
  private current: Current | null = null;
  private turnEnded = false;
  private finished = true;
  private mouthOn = false;
  /** Bumped on every cancel; a stale timer callback compares it and returns. */
  private gen = 0;
  private handle: number | null = null;
  private hideAt: number | null = null;
  /** Bumped every time the linger is (re)armed; a stale hide callback compares it and returns. */
  private hideArm = 0;
  private waiters: Array<() => void> = [];
  /**
   * CX-2: false between `pause()` and `resume()` (the pet is hidden). The bubble window runs with
   * `backgroundThrottling: false`, so nothing else stops its timers: while false no grapheme is
   * painted, no `playback:*` acknowledgement leaves, the mouth is closed and the band is hidden.
   */
  private isVisible = true;
  /** The `<|PAUSE n|>` beat in flight: its deadline while armed, its remainder while paused. */
  private beatDeadline: number | null = null;
  private beatLeft = 0;

  constructor(deps: SpeechDeps) {
    this.bubble = deps.bubble;
    this.hint = deps.hint;
    this.bridge = deps.bridge;
    this.now = deps.now ?? (() => performance.now());
    this.ownsTimer = deps.raf === undefined;
    this.timer = deps.raf ?? ((cb, ms) => window.setTimeout(cb, ms));
  }

  onState(p: { state: TurnState; turnId: string }): void {
    if (p.state === 'thinking') {
      if (p.turnId === this.turnId) return;
      this.beginTurn(p.turnId);
      return;
    }
    if (p.state === 'idle') {
      // contracts.md §5.2 / §8.6 row 4: this is what stops the bubble after `user:cancel`. An
      // `idle` for a turnId we never saw is ignored; otherwise the queue is dropped, the reveal
      // stops where it stands, and the normal hide path runs (finishTurn is idempotent, so a
      // normal end followed by `idle` never sends a second playback:turnDone).
      if (p.turnId !== this.turnId) return;
      if (this.finished) {
        // The normal path already ran: playback:turnDone went out, main answered with
        // runner.turnShown(), and this `idle` is that echo. finishTurn() would early-return on
        // `finished`, so cancelling unconditionally here would destroy the linger it armed and
        // Bubble.hide() would never run — the --dur-exit exit would never play and only main's
        // window-level 3400 ms hide would clear the screen. Re-arm the SAME deadline instead:
        // `hideAt` is untouched, so this neither extends nor shortens the linger.
        this.cancelPending();
        this.scheduleHide();
        return;
      }
      // GC2-3: hidden (paused) and unfinished. finishTurn() would return on `!isVisible` and leave
      // the controller wedged — `finished` false, `current` null, no continuation for resume() to
      // take, the band re-shown empty on the next `shell:visibility`. The turn is over and nobody
      // saw its end, so it is cancelled outright: no playback:turnDone (that ack is only ever sent
      // for a reply somebody could have seen), no linger, nothing left for resume() to show.
      if (!this.isVisible) {
        this.cancelTurn();
        return;
      }
      this.cancelPending();
      this.queue = [];
      this.current = null;
      this.finishTurn();
    }
  }

  onSentence(ev: SentenceEvent): void {
    // A first-run `first_mes` sentence arrives with no preceding brain:state (contracts.md §6.6).
    if (ev.turnId !== this.turnId) this.beginTurn(ev.turnId);
    this.bubble.setEmotion(ev.emotion);
    this.queue.push(ev);
    if (!this.current) this.next();
  }

  onTurnDone(p: { turnId: string }): void {
    if (p.turnId !== this.turnId) return;
    this.turnEnded = true;
    if (!this.current && this.queue.length === 0) this.finishTurn();
  }

  onError(p: { code: ErrorCode; message: string }): void {
    void p; // the copy is rendered by main on the hint surface (C10/C-10), never in her voice
    this.cancelPending();
    this.queue = [];
    this.current = null;
    this.turnId = null;
    this.turnEnded = false;
    this.finished = true;
    this.hideAt = null;
    this.setMouth(false);
    this.bubble.setAwaiting(false);
    this.bubble.hide();
    this.resolveWaiters();
  }

  /** Instantly finish the sentence being revealed and drain the queue's reveal timers. */
  complete(): void {
    // GC2-4: while paused nothing may be committed — `commitSentence` sends playback:sentenceDone
    // and CX-1 would persist text nobody saw as shown. The request is dropped, not deferred: the
    // click that produces it cannot happen on a hidden band, and resume() carries the reveal on.
    if (!this.isVisible) return;
    if (!this.current && this.queue.length === 0) return;
    this.cancelPending();
    if (this.current) {
      const { ev, steps, i } = this.current;
      for (let k = i; k < steps.length; k++) this.partial += steps[k].grapheme;
      this.current = null;
      this.commitSentence(ev);
    }
    for (;;) {
      const ev = this.queue.shift();
      if (!ev) break;
      this.bubble.setEmotion(ev.emotion);
      this.partial = ev.text;
      this.commitSentence(ev);
    }
    this.setMouth(false);
    if (this.turnEnded) this.finishTurn();
  }

  /**
   * True while there is something on the band: a turn that is still revealing, or one that has
   * finished and is lingering. bubble/main.ts reads it on a hidden->shown `shell:visibility` edge
   * to decide whether the band element must be re-shown (I-6).
   */
  get active(): boolean {
    return this.turnId !== null && (!this.finished || this.hideAt !== null);
  }

  /** False while paused (pet hidden). */
  get visible(): boolean {
    return this.isVisible;
  }

  /**
   * `shell:visibility {hidden:true}`: stop the reveal where it stands, close the mouth, hide the
   * band and hold every acknowledgement. Nothing is dropped — the queue, the sentence in flight and
   * the turn's end all wait for `resume()`.
   */
  pause(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.cancelPending();
    if (this.beatDeadline !== null) {
      this.beatLeft = Math.max(0, this.beatDeadline - this.now());
      this.beatDeadline = null;
    }
    this.setMouth(false);
    this.bubble.hide();
  }

  /**
   * `shell:visibility {hidden:false}`: re-show the band if a turn is still on it and carry on. A
   * paused beat keeps its remainder; the grapheme in flight restarts its own delay; a turn that
   * ended while hidden is acknowledged now; a linger restarts in full from the show (I-6).
   */
  resume(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    if (!this.active) return;
    this.bubble.show();
    if (this.current) {
      if (this.beatLeft > 0) this.armBeat();
      else this.step();
    } else if (this.turnEnded && !this.finished) {
      this.finishTurn();
    } else if (this.hideAt !== null) {
      this.hideAt = this.now() + LINGER_MS;
      this.scheduleHide();
    }
  }

  /** Pointer state from bubble/main.ts: hover only defers the hide. */
  setPinned(inside: boolean): void {
    this.bubble.pinned = inside;
    if (!inside && this.hideAt !== null) {
      this.hideAt = this.now() + LINGER_MS;
      this.scheduleHide();
    }
  }

  /** Test hook used by Playwright via `window.__bubble.speak(...)`. Resolves on playback:turnDone. */
  speak(events: SentenceEvent[]): Promise<void> {
    const turnId = events.length > 0 ? events[0].turnId : 'test-turn';
    this.onState({ state: 'thinking', turnId });
    for (const ev of events) this.onSentence(ev);
    this.onTurnDone({ turnId });
    if (this.finished) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private beginTurn(turnId: string): void {
    this.cancelPending();
    this.turnId = turnId;
    this.queue = [];
    this.shownText = [];
    this.partial = '';
    this.current = null;
    this.turnEnded = false;
    this.finished = false;
    this.hideAt = null;
    this.setMouth(false);
    // A stale system hint must not sit under a fresh reply.
    this.hint.dismiss();
    this.bubble.setEmotion('neutral');
    this.bubble.setAwaiting(false);
    this.bubble.setText('');
    if (this.isVisible) this.bubble.show();
  }

  private next(): void {
    const ev = this.queue.shift();
    if (!ev) {
      if (this.turnEnded) this.finishTurn();
      return;
    }
    this.current = { ev, steps: new RevealPlan(ev.text).steps(), i: 0 };
    this.partial = '';
    this.beatLeft = Math.round((ev.pause ?? 0) * 1000);
    if (!this.isVisible) return; // resume() starts it
    if (this.beatLeft > 0) this.armBeat();
    else this.step();
  }

  private armBeat(): void {
    this.beatDeadline = this.now() + this.beatLeft;
    this.schedule(this.beatLeft, () => {
      this.beatDeadline = null;
      this.beatLeft = 0;
      this.step();
    });
  }

  private step(): void {
    if (!this.isVisible) return; // resume() calls step() again
    const cur = this.current;
    if (!cur) return;
    const s = cur.steps[cur.i];
    if (!s) {
      this.current = null;
      this.commitSentence(cur.ev);
      this.next();
      return;
    }
    this.schedule(s.delayMs, () => {
      const c = this.current;
      if (!c) return;
      if (c.i === 0) this.bubble.setAwaiting(false);
      this.partial += s.grapheme;
      this.setMouth(s.mouth);
      this.render();
      c.i += 1;
      this.step();
    });
  }

  private commitSentence(ev: SentenceEvent): void {
    this.shownText.push(this.partial);
    this.partial = '';
    this.render();
    this.bubble.setAwaiting(true);
    this.bridge?.send(Channels.playbackSentenceDone, { turnId: ev.turnId, seq: ev.seq });
  }

  /** Text accumulates within a turn; the oldest sentence leaves the DOM when MAX_LINES overflows. */
  private render(): void {
    this.bubble.setText(this.shownText.join('') + this.partial);
    while (this.shownText.length > 1 && this.bubble.overflowing()) {
      this.shownText.shift();
      this.bubble.setText(this.shownText.join('') + this.partial);
    }
  }

  /**
   * GC2-3: the cancellation finaliser, distinct from `finishTurn()`. Every timer and token is
   * invalidated, the queue, the sentence in flight and the beat are dropped, the turn is marked
   * finished and inactive, the band hidden, and the waiters resolved — WITHOUT `playback:turnDone`.
   */
  private cancelTurn(): void {
    this.cancelPending();
    this.hideArm += 1;
    this.queue = [];
    this.current = null;
    this.beatDeadline = null;
    this.beatLeft = 0;
    this.partial = '';
    this.shownText = [];
    this.turnId = null;
    this.turnEnded = false;
    this.finished = true;
    this.hideAt = null;
    this.setMouth(false);
    this.bubble.setAwaiting(false);
    this.bubble.hide();
    this.resolveWaiters();
  }

  private finishTurn(): void {
    const turnId = this.turnId;
    if (this.finished || turnId === null) return;
    // Hidden: the turn stays open (queue drained, `turnEnded` set) and resume() finishes it, so
    // playback:turnDone is only ever sent for a reply somebody could have seen.
    if (!this.isVisible) return;
    this.finished = true;
    this.bridge?.send(Channels.playbackTurnDone, { turnId });
    this.setMouth(false);
    this.bubble.setAwaiting(true);
    this.hideAt = this.now() + LINGER_MS;
    this.scheduleHide();
    this.resolveWaiters();
  }

  private scheduleHide(): void {
    if (this.hideAt === null || !this.isVisible) return;
    // Each arm invalidates the previous one. `setPinned(false)` re-arms without going through
    // `cancelPending()` (that would also kill an in-flight reveal), so without this token the
    // ORIGINAL hide timer still fires at the original deadline and the re-armed linger is ignored.
    const armed = ++this.hideArm;
    const left = Math.max(0, this.hideAt - this.now());
    this.schedule(left, () => {
      if (armed !== this.hideArm) return;
      if (this.hideAt === null || this.bubble.pinned) return;
      this.hideAt = null;
      this.bubble.setAwaiting(false);
      this.bubble.hide();
    });
  }

  private setMouth(on: boolean): void {
    if (on === this.mouthOn) return;
    this.mouthOn = on;
    this.bridge?.send(Channels.speechMouth, { on });
  }

  private schedule(ms: number, cb: () => void): void {
    const gen = this.gen;
    const id = this.timer(() => {
      if (gen !== this.gen) return;
      cb();
    }, ms);
    if (this.ownsTimer) this.handle = id;
  }

  private cancelPending(): void {
    this.gen += 1;
    if (this.ownsTimer && this.handle !== null) {
      window.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  private resolveWaiters(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }
}
