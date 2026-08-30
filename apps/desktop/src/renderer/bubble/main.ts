import '../shared/tokens.css';
import './bubble.css';
import { Channels, type SentenceEvent } from '@ds/protocol';
import { ARROW_MARGIN, BUBBLE_MAX, BUBBLE_MIN } from '../../main/bubble-place';
import { bridge } from './bridge';
import { Bubble } from './bubble';
import { HintSurface, type Hint } from './hint';
import { HINT_GAP, SpeechController } from './speech';

const params = new URLSearchParams(location.search);
// Dev builds only, exactly as pet/main.ts has been since Phase 1's 670f600: `import.meta.env.DEV`
// is a compile-time constant, so the whole hook surface below is tree-shaken out of the production
// bundle. Without the guard a packaged build ships a scriptable speech/hint hook on the
// always-on-top, focusable:false bubble window, reachable at app://local/bubble.html?test=1.
// Playwright drives the Vite dev server, which is DEV, so every spec in this task still gets it.
const TEST = import.meta.env.DEV && params.get('test') === '1';
const character = params.get('character') ?? 'haru';

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`bubble.html is missing #${id}`);
  return el;
}

const contentEl = need('content');
const bubbleEl = need('bubble');
const hintEl = need('hint');
const bubble = new Bubble(bubbleEl);
const hint = new HintSurface(hintEl);
const speech = new SpeechController({ bubble, hint, bridge });

// Always seed the geometry so --bubble-max-w/-h and --arrow-offset resolve before the first paint;
// main overwrites all four on its first `bubble:place`.
bubble.place({
  maxWidth: BUBBLE_MAX.width,
  maxHeight: BUBBLE_MAX.height,
  side: 'left',
  arrowOffset: ARROW_MARGIN,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Report the union of the band and the hint strip. Clamped renderer-side because a hidden band
 * measures 0x0 and `bubble:size` is `z.number().positive()` — main would reject a zero (§5.2).
 */
let lastSize = '';
function report(): void {
  const b = bubble.measure();
  const h = hintEl.hidden ? { width: 0, height: 0 } : hintEl.getBoundingClientRect();
  const width = clamp(Math.ceil(Math.max(b.width, h.width)), BUBBLE_MIN.width, BUBBLE_MAX.width);
  const raw = b.height + (hintEl.hidden ? 0 : HINT_GAP + h.height);
  const height = clamp(Math.ceil(raw), BUBBLE_MIN.height, BUBBLE_MAX.height);
  const key = `${width}x${height}`;
  if (key === lastSize) return;
  lastSize = key;
  bridge?.send(Channels.bubbleSize, { width, height });
}

bridge?.on(Channels.bubblePlace, (p) => {
  bubble.place(p);
  report();
});
bridge?.on(Channels.brainState, (p) => speech.onState(p));
bridge?.on(Channels.brainSentence, (ev) => speech.onSentence(ev));
bridge?.on(Channels.brainTurnDone, (p) => speech.onTurnDone({ turnId: p.turnId }));
bridge?.on(Channels.brainError, (p) => speech.onError({ code: p.code, message: p.message }));
bridge?.on(Channels.speechComplete, () => speech.complete());
bridge?.on(Channels.hintShow, (h) => {
  hint.show({ text: h.text, level: h.level, ttlMs: h.ttlMs });
  report();
});
// The bubble follows the pet's visibility state (§5.4 rule 5): hidden means nobody can see her.
bridge?.on(Channels.shellVisibility, ({ hidden }) => {
  if (!hidden) return;
  hint.dismiss();
  bubble.hide();
});

const setInside = (inside: boolean): void => {
  speech.setPinned(inside);
  bridge?.send(Channels.bubbleHover, { inside });
};
for (const el of [bubbleEl, hintEl]) {
  el.addEventListener('pointerenter', () => setInside(true));
  el.addEventListener('pointerleave', () => setInside(false));
}

// C-12: clicking the band opens the chat with the composer focused, and the same gesture completes
// the reveal (the addendum's "click completes instantly").
bubbleEl.addEventListener('click', () => {
  speech.complete();
  bridge?.send(Channels.chatOpen, { source: 'bubble', focusComposer: true });
});
hintEl.addEventListener('click', () => {
  hint.dismiss();
  report();
});

new ResizeObserver(() => report()).observe(contentEl);

// The plate carries her name, read from the same public character.json the pet renderer loads.
void (async () => {
  try {
    const res = await fetch(`/characters/${character}/character.json`);
    if (!res.ok) return;
    const cfg: unknown = await res.json();
    const name = (cfg as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) bubble.setName(name);
  } catch {
    // No plate is better than a wrong plate; the band reads fine without it.
  }
})();

if (!bridge || TEST) {
  // Browser/Playwright mode: no main to place us, so inset the band and let the pointer leave it.
  // `|| TEST` is load-bearing (contract addition 10): every spec installs a fake `window.dsBubble`
  // from an init script that runs BEFORE this module, so `!bridge` alone is never true under
  // Playwright, `.bubble`'s own padding would still cover the origin, and `pointerleave` could
  // never be provoked. TEST is false in a packaged build, so the real window stays flush.
  document.body.classList.add('browser');
}

if (TEST) {
  (window as unknown as { __bubble: unknown }).__bubble = {
    ready: true,
    speak: (events: SentenceEvent[]) => speech.speak(events),
    complete: () => speech.complete(),
    hint: (h: Hint) => hint.show(h),
    text: () => need('bubble-text').textContent ?? '',
    visible: () => bubble.visible,
  };
}
