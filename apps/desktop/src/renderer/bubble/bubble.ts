import type { Emotion, Side } from '@ds/protocol';

export interface BubbleOptions {
  maxWidth: number;
  maxHeight: number;
  side: Side;
  arrowOffset: number;
}

/** Mirrors --dur-exit. jsdom fires no `transitionend`, so the exit is timed, not event-driven. */
export const BUBBLE_EXIT_MS = 160;

/**
 * The ADV band (contracts.md §5.2 / §5.8, Task 0's direction contract) inside the bubble window:
 * left-edge rail, name plate, typed line, blinking advance mark, and an anchor notch on the
 * pet-facing edge. It owns DOM, never timing — SpeechController drives every state change.
 */
export class Bubble {
  private readonly root: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly plateEl: HTMLElement;
  private readonly advanceEl: HTMLElement;
  private shown = false;
  private exitHandle: number | null = null;

  /** True while the pointer is over the bubble; defers the TURN-level hide, never the reveal. */
  pinned = false;

  constructor(root: HTMLElement) {
    const text = root.querySelector<HTMLElement>('[data-bubble-text]');
    const plate = root.querySelector<HTMLElement>('[data-bubble-plate]');
    const advance = root.querySelector<HTMLElement>('[data-bubble-advance]');
    if (!text || !plate || !advance) {
      throw new Error('bubble root needs [data-bubble-text], [data-bubble-plate], [data-bubble-advance]');
    }
    this.root = root;
    this.textEl = text;
    this.plateEl = plate;
    this.advanceEl = advance;
    this.advanceEl.dataset.on = '0';
  }

  /**
   * Applies the geometry main just computed. Called on every `bubble:place`.
   *
   * contracts.md §5.2's owner table: the three custom properties are written on
   * `document.documentElement`, NOT on this band root. `#content` — the band's PARENT — consumes
   * `--bubble-max-w` / `--bubble-max-h`, and custom properties inherit downwards only, so writing
   * them here would make the 460x320 DIP cap resolve to nothing and the band could grow past the
   * window. `data-side` stays on the band: it is an attribute selector, not an inherited value,
   * and its consumer IS the band. The window hosts exactly one Bubble, so writing outside this
   * root is unambiguous.
   */
  place(o: BubbleOptions): void {
    this.root.dataset.side = o.side;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--bubble-max-w', `${o.maxWidth}px`);
    rootStyle.setProperty('--bubble-max-h', `${o.maxHeight}px`);
    rootStyle.setProperty('--arrow-offset', `${o.arrowOffset}px`);
  }

  show(): void {
    if (this.exitHandle !== null) {
      window.clearTimeout(this.exitHandle);
      this.exitHandle = null;
    }
    this.root.hidden = false;
    this.root.classList.remove('is-exiting');
    // Read a layout property so the enter transition starts from the pre-show state instead of
    // being collapsed into the same style flush.
    void this.root.offsetWidth;
    this.root.classList.add('is-visible');
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('is-visible');
    this.root.classList.add('is-exiting');
    this.exitHandle = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('is-exiting');
      this.exitHandle = null;
    }, BUBBLE_EXIT_MS);
  }

  /** textContent only — model output must never reach an HTML sink. */
  setText(text: string): void {
    this.textEl.textContent = text;
  }

  clear(): void {
    this.setText('');
  }

  setName(name: string): void {
    this.plateEl.textContent = name;
    this.plateEl.hidden = name.length === 0;
  }

  /** The ADV advance mark: on whenever she is not painting and the band is still up. */
  setAwaiting(on: boolean): void {
    this.advanceEl.dataset.on = on ? '1' : '0';
  }

  /**
   * Writes `data-emotion` on the band root (contracts.md §5.8). tokens.css carries nine
   * `[data-emotion='<e>']` rules — one per EMOTIONS member — that retint `--c-plate` and raise
   * `--fw-line`. This is "state-as-material": no badge, no icon.
   */
  setEmotion(e: Emotion): void {
    this.root.dataset.emotion = e;
  }

  /** Measured content box, reported to main as `bubble:size`. */
  measure(): { width: number; height: number } {
    const r = this.root.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  }

  /** The text node is max-height clamped at MAX_LINES, so scrolling is the overflow signal. */
  overflowing(): boolean {
    return this.textEl.scrollHeight > this.textEl.clientHeight + 1;
  }

  get visible(): boolean {
    return this.shown;
  }
}
