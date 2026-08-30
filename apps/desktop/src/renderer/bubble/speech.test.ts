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
      <div class="bubble__plate" data-bubble-plate hidden></div>
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
});
