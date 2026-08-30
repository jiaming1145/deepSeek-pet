import { beforeEach, describe, expect, it } from 'vitest';
import type { SentenceEvent } from '@ds/protocol';
import type { DsBridge } from './bridge';
import { Bubble } from './bubble';
import { HintSurface } from './hint';
import { LINGER_MS, SpeechController } from './speech';

/** Deterministic clock: the controller's only timing source once `raf` is injected. */
class Clock {
  now = 0;
  private seq = 0;
  private timers: Array<{ id: number; at: number; cb: () => void }> = [];

  timer = (cb: () => void, ms: number): number => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.now + ms, cb });
    return id;
  };

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.cb();
    }
    this.now = end;
  }
}

type Sent = { channel: string; payload: unknown };

function mount(): {
  speech: SpeechController;
  clock: Clock;
  sent: Sent[];
  root: HTMLElement;
  text: HTMLElement;
  bubble: Bubble;
} {
  document.body.innerHTML = `
    <div id="bubble" class="bubble" data-side="left" data-emotion="neutral" hidden>
      <div class="bubble__plate" data-bubble-plate hidden><span class="bubble__plate-text" data-bubble-plate-text></span></div>
      <div class="bubble__surface">
        <p class="bubble__text" data-bubble-text></p>
        <span class="bubble__advance" data-bubble-advance>▼</span>
      </div>
    </div>
    <div id="hint" hidden></div>`;
  const clock = new Clock();
  const sent: Sent[] = [];
  const bridge = {
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
    on: () => () => undefined,
  } as unknown as DsBridge;
  const root = document.getElementById('bubble') as HTMLElement;
  const bubble = new Bubble(root);
  const hint = new HintSurface(document.getElementById('hint') as HTMLElement);
  const speech = new SpeechController({ bubble, hint, bridge, now: () => clock.now, raf: clock.timer });
  return { speech, clock, sent, root, text: document.querySelector('[data-bubble-text]') as HTMLElement, bubble };
}

const ev = (over: Partial<SentenceEvent> = {}): SentenceEvent => ({
  turnId: 't1',
  seq: 0,
  text: '你好',
  emotion: 'happy',
  ...over,
});

const mouths = (sent: Sent[]) => sent.filter((s) => s.channel === 'speech:mouth').map((s) => s.payload);

describe('SpeechController', () => {
  let h: ReturnType<typeof mount>;
  beforeEach(() => {
    h = mount();
  });

  it('thinking shows an empty bubble for the new turn', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    expect(h.bubble.visible).toBe(true);
    expect(h.text.textContent).toBe('');
  });

  it('paints one grapheme per RevealPlan step, delay first', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.clock.advance(69);
    expect(h.text.textContent).toBe('');
    h.clock.advance(1);
    expect(h.text.textContent).toBe('你');
    h.clock.advance(70);
    expect(h.text.textContent).toBe('你好');
  });

  it('emits speech:mouth only on transitions', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ text: '你好，' }));
    h.clock.advance(1000);
    expect(mouths(h.sent)).toEqual([{ on: true }, { on: false }]);
  });

  it('sends sentenceDone at the last grapheme, raises the advance mark, and sends turnDone after it', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(1000);
    expect(h.sent.map((s) => s.channel)).toEqual([
      'speech:mouth',
      'playback:sentenceDone',
      'playback:turnDone',
      'speech:mouth',
    ]);
    expect(h.sent[1].payload).toEqual({ turnId: 't1', seq: 0 });
    expect(h.sent[2].payload).toEqual({ turnId: 't1' });
    expect((document.querySelector('[data-bubble-advance]') as HTMLElement).dataset.on).toBe('1');
  });

  it('accumulates sentences within a turn', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ seq: 0, text: '你好' }));
    h.speech.onSentence(ev({ seq: 1, text: '早啊' }));
    h.clock.advance(1000);
    expect(h.text.textContent).toBe('你好早啊');
  });

  it('honours the pause beat before a sentence', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ text: '嗯', pause: 0.5 }));
    h.clock.advance(569);
    expect(h.text.textContent).toBe('');
    h.clock.advance(1);
    expect(h.text.textContent).toBe('嗯');
  });

  it('complete() paints the rest of the queue at once', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ seq: 0, text: '你回来啦' }));
    h.speech.onSentence(ev({ seq: 1, text: '饿不饿' }));
    h.clock.advance(70);
    h.speech.complete();
    expect(h.text.textContent).toBe('你回来啦饿不饿');
    expect(h.sent.filter((s) => s.channel === 'playback:sentenceDone')).toHaveLength(2);
  });

  it('a new turnId drops the queue and clears the bubble', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ text: '一二三四五' }));
    h.clock.advance(140);
    h.speech.onState({ state: 'thinking', turnId: 't2' });
    expect(h.text.textContent).toBe('');
    h.clock.advance(1000);
    expect(h.text.textContent).toBe('');
  });

  it('hides LINGER_MS after the turn is shown', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(140);
    expect(h.bubble.visible).toBe(true);
    h.clock.advance(LINGER_MS - 1);
    expect(h.bubble.visible).toBe(true);
    h.clock.advance(1);
    expect(h.bubble.visible).toBe(false);
  });

  it('a pinned bubble stays up and re-arms the linger on leave', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(140);
    h.speech.setPinned(true);
    h.clock.advance(10_000);
    expect(h.bubble.visible).toBe(true);
    h.speech.setPinned(false);
    h.clock.advance(LINGER_MS - 1);
    expect(h.bubble.visible).toBe(true);
    h.clock.advance(1);
    expect(h.bubble.visible).toBe(false);
  });

  it('hover-then-leave during the linger re-arms a full LINGER_MS (I-11)', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(140); // reveal done, linger armed at t=140
    h.clock.advance(1000);
    h.speech.setPinned(true); // hover at +1.0 s
    h.clock.advance(500);
    h.speech.setPinned(false); // leave at +1.5 s, well before the original deadline
    h.clock.advance(LINGER_MS - 1);
    expect(h.bubble.visible).toBe(true);
    h.clock.advance(1);
    expect(h.bubble.visible).toBe(false);
  });

  it('active is true from the first sentence through the linger, false once hidden (I-6)', () => {
    expect(h.speech.active).toBe(false);
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    expect(h.speech.active).toBe(true);
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(140);
    expect(h.speech.active).toBe(true); // finished, lingering
    h.clock.advance(LINGER_MS);
    expect(h.speech.active).toBe(false);
    h.speech.onState({ state: 'thinking', turnId: 't2' });
    h.speech.onError({ code: 'network', message: 'x' });
    expect(h.speech.active).toBe(false);
  });

  it('drops the oldest sentence when the text node overflows', () => {
    Object.defineProperty(h.text, 'clientHeight', { value: 156, configurable: true });
    Object.defineProperty(h.text, 'scrollHeight', { value: 156, configurable: true });
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ seq: 0, text: '第一句' }));
    h.clock.advance(1000);
    Object.defineProperty(h.text, 'scrollHeight', { value: 200, configurable: true });
    h.speech.onSentence(ev({ seq: 1, text: '第二句' }));
    h.clock.advance(1000);
    expect(h.text.textContent).toBe('第二句');
  });

  it('onError drops the queue, closes the mouth and hides the bubble', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ text: '一二三四五' }));
    h.clock.advance(140);
    h.speech.onError({ code: 'network', message: '网络不太好，等一下再聊' });
    expect(h.bubble.visible).toBe(false);
    expect(mouths(h.sent).at(-1)).toEqual({ on: false });
    h.clock.advance(1000);
    expect(h.sent.some((s) => s.channel === 'playback:turnDone')).toBe(false);
  });

  it('writes data-emotion on the band root and resets it to neutral on a new turn', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    expect(h.root.dataset.emotion).toBe('neutral');
    h.speech.onSentence(ev({ emotion: 'sad' }));
    expect(h.root.dataset.emotion).toBe('sad');
    h.speech.onState({ state: 'thinking', turnId: 't2' });
    expect(h.root.dataset.emotion).toBe('neutral');
  });

  it('state:idle drops the queue, keeps what was painted, and runs the hide path (user:cancel)', () => {
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev({ text: '一二三四五' }));
    h.clock.advance(140);
    h.speech.onState({ state: 'idle', turnId: 't1' });
    expect(h.text.textContent).toBe('一二');
    h.clock.advance(1000);
    expect(h.text.textContent).toBe('一二');
    expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
    expect(mouths(h.sent).at(-1)).toEqual({ on: false });
    h.clock.advance(LINGER_MS);
    expect(h.bubble.visible).toBe(false);
  });

  it('state:idle echoing a normal turn keeps the armed linger and still hides', () => {
    // The production sequence: turnDone -> bubble sends playback:turnDone -> main calls
    // runner.turnShown() -> the runner emits state:'idle' -> main relays brain:state idle. The
    // idle arm must NOT cancel the hide finishTurn() already armed (contract addition 7).
    h.speech.onState({ state: 'thinking', turnId: 't1' });
    h.speech.onSentence(ev());
    h.speech.onTurnDone({ turnId: 't1' });
    h.clock.advance(140); // both graphemes painted; finishTurn() arms the hide at now + LINGER_MS
    expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
    h.speech.onState({ state: 'idle', turnId: 't1' });
    expect(h.bubble.visible).toBe(true);
    expect(h.text.textContent).toBe('你好');
    h.clock.advance(LINGER_MS - 1);
    expect(h.bubble.visible).toBe(true);
    h.clock.advance(1);
    expect(h.bubble.visible).toBe(false); // Bubble.hide() ran, so the --dur-exit exit plays
    expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
  });
  // CX-2: the bubble window sets backgroundThrottling:false, so a hidden window's timers keep
  // running. Without an explicit visible state the reveal, its acknowledgements and the mouth all
  // carry on for text nobody can see, and a short hide never brings the band back (I-6).
  describe('pause/resume (CX-2 / I-6)', () => {
    const acks = (sent: Sent[]) => sent.filter((s) => s.channel === 'playback:sentenceDone').length;

    it('hide mid-sentence sends no sentenceDone, closes the mouth and hides the band', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev({ text: '一二三四五' }));
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(140); // '一二' painted, mouth open
      expect(mouths(h.sent).at(-1)).toEqual({ on: true });
      h.speech.pause();
      expect(h.bubble.visible).toBe(false);
      expect(mouths(h.sent).at(-1)).toEqual({ on: false });
      expect(h.speech.visible).toBe(false);
      h.clock.advance(10_000);
      expect(h.text.textContent).toBe('一二');
      expect(acks(h.sent)).toBe(0);
      expect(h.sent.some((s) => s.channel === 'playback:turnDone')).toBe(false);
    });

    it('show re-shows the band and the reveal continues from where it stopped, then acks', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev({ text: '一二三四五' }));
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(140);
      h.speech.pause();
      h.clock.advance(10_000);
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      expect(h.speech.visible).toBe(true);
      expect(h.text.textContent).toBe('一二');
      h.clock.advance(1000);
      expect(h.text.textContent).toBe('一二三四五');
      expect(acks(h.sent)).toBe(1);
      expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
      expect(mouths(h.sent).at(-1)).toEqual({ on: false });
    });

    it('a pause beat pauses with its remaining time and resumes with it', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev({ text: '嗯', pause: 0.5 }));
      h.clock.advance(200); // 300 ms of the beat left
      h.speech.pause();
      h.clock.advance(5000);
      h.speech.resume();
      h.clock.advance(299 + 70 - 1);
      expect(h.text.textContent).toBe('');
      h.clock.advance(2);
      expect(h.text.textContent).toBe('嗯');
    });

    it('hide across the whole reply: turnDone only after show + completion', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.pause();
      h.speech.onSentence(ev({ seq: 0, text: '你好' }));
      h.speech.onSentence(ev({ seq: 1, text: '早啊' }));
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(60_000);
      expect(h.bubble.visible).toBe(false);
      expect(acks(h.sent)).toBe(0);
      expect(h.sent.some((s) => s.channel === 'playback:turnDone')).toBe(false);
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      expect(h.sent.some((s) => s.channel === 'playback:turnDone')).toBe(false);
      h.clock.advance(1000);
      expect(h.text.textContent).toBe('你好早啊');
      expect(acks(h.sent)).toBe(2);
      expect(h.sent.map((s) => s.channel).filter((c) => c.startsWith('playback:'))).toEqual([
        'playback:sentenceDone',
        'playback:sentenceDone',
        'playback:turnDone',
      ]);
    });

    it('a turn that ends while hidden with nothing left to paint sends turnDone on show', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev());
      h.clock.advance(140); // fully painted, sentenceDone sent, turn still open
      h.speech.pause();
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(60_000);
      expect(h.sent.some((s) => s.channel === 'playback:turnDone')).toBe(false);
      h.speech.resume();
      expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
      expect(h.bubble.visible).toBe(true);
      h.clock.advance(LINGER_MS - 1);
      expect(h.bubble.visible).toBe(true);
      h.clock.advance(1);
      expect(h.bubble.visible).toBe(false);
    });

    it('hide during the linger: the linger restarts in full from the show', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev());
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(140);
      h.clock.advance(LINGER_MS - 500);
      h.speech.pause();
      expect(h.bubble.visible).toBe(false);
      h.clock.advance(60_000);
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      expect(h.speech.active).toBe(true);
      h.clock.advance(LINGER_MS - 1);
      expect(h.bubble.visible).toBe(true);
      h.clock.advance(1);
      expect(h.bubble.visible).toBe(false);
      expect(h.sent.filter((s) => s.channel === 'playback:turnDone')).toHaveLength(1);
    });

    it('show with nothing on the band does not re-show it; a new turn begun while hidden shows on resume', () => {
      h.speech.resume();
      expect(h.bubble.visible).toBe(false);
      h.speech.pause();
      h.speech.onState({ state: 'thinking', turnId: 't2' });
      expect(h.bubble.visible).toBe(false);
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      expect(h.text.textContent).toBe('');
    });

    it('idle echo while hidden does not consume the linger; onError while hidden clears the turn', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev());
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(140);
      h.speech.pause();
      h.speech.onState({ state: 'idle', turnId: 't1' });
      h.clock.advance(60_000);
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      h.clock.advance(LINGER_MS);
      expect(h.bubble.visible).toBe(false);
      h.speech.pause();
      h.speech.onState({ state: 'thinking', turnId: 't2' });
      h.speech.onError({ code: 'network', message: 'x' });
      h.speech.resume();
      expect(h.bubble.visible).toBe(false);
      expect(h.speech.active).toBe(false);
    });
  });

  // GC2-3 / GC2-4: the two paths that used to wedge or leak while the pet is hidden.
  describe('hidden cancellation and complete() while paused (GC2-3 / GC2-4)', () => {
    const acks = (sent: Sent[]) => sent.filter((s) => s.channel === 'playback:sentenceDone').length;
    const turnDones = (sent: Sent[]) => sent.filter((s) => s.channel === 'playback:turnDone').length;

    it('GC2-3: idle while paused and unfinished cancels the turn — inactive, hidden, timer-free, no acks', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev({ text: '一二三四五', seq: 0 }));
      h.speech.onSentence(ev({ text: '六七', seq: 1, pause: 0.5 }));
      h.clock.advance(140); // '一二' painted
      h.speech.pause();
      h.sent.length = 0;
      h.speech.onState({ state: 'idle', turnId: 't1' }); // user:cancel landed while hidden
      expect(h.speech.active).toBe(false);
      expect(h.bubble.visible).toBe(false);
      h.clock.advance(60_000);
      expect(acks(h.sent)).toBe(0);
      expect(turnDones(h.sent)).toBe(0);
      h.speech.resume();
      expect(h.bubble.visible).toBe(false); // no stale band on show
      expect(h.speech.active).toBe(false);
      h.clock.advance(60_000);
      expect(acks(h.sent)).toBe(0);
      expect(turnDones(h.sent)).toBe(0);
      expect(mouths(h.sent)).toEqual([]); // the mouth was already closed by pause(); no reopen
      // A late echo for the cancelled turn is ignored, and the next turn starts clean.
      h.speech.onState({ state: 'idle', turnId: 't1' });
      h.speech.onState({ state: 'thinking', turnId: 't2' });
      expect(h.bubble.visible).toBe(true);
      expect(h.text.textContent).toBe('');
      h.speech.onSentence(ev({ turnId: 't2', text: '好', seq: 0 }));
      h.speech.onTurnDone({ turnId: 't2' });
      h.clock.advance(1000);
      expect(acks(h.sent)).toBe(1);
      expect(turnDones(h.sent)).toBe(1);
    });

    it('GC2-3: speak() waiters resolve on a hidden cancellation', async () => {
      const p = h.speech.speak([ev({ text: '一二三四五' })]);
      h.clock.advance(140);
      h.speech.pause();
      h.speech.onState({ state: 'idle', turnId: 't1' });
      await expect(p).resolves.toBeUndefined();
    });

    it('GC2-4: complete() while paused emits nothing, marks no hidden text as shown, and resumes the reveal', () => {
      h.speech.onState({ state: 'thinking', turnId: 't1' });
      h.speech.onSentence(ev({ text: '一二三四五', seq: 0 }));
      h.speech.onSentence(ev({ text: '六七', seq: 1 }));
      h.speech.onTurnDone({ turnId: 't1' });
      h.clock.advance(140); // '一二'
      h.speech.pause();
      h.sent.length = 0;
      h.speech.complete();
      expect(h.sent).toEqual([]);
      expect(h.text.textContent).toBe('一二');
      expect(h.bubble.visible).toBe(false);
      h.clock.advance(60_000);
      expect(h.sent).toEqual([]);
      // The reveal carries on from where it stopped once she is back.
      h.speech.resume();
      expect(h.bubble.visible).toBe(true);
      h.clock.advance(5000);
      expect(h.text.textContent).toBe('一二三四五六七');
      expect(acks(h.sent)).toBe(2);
      expect(turnDones(h.sent)).toBe(1);
    });
  });
});
