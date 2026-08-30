/**
 * The system-hint surface (contracts.md §5.5, addendum C10/X6): a second, independent layer in the
 * bubble window with its own tokens, so an app error never looks like the character speaking. The
 * COPY comes from `ERROR_HINTS` in @ds/protocol via main's `hint:show` (§2.8) — this module holds
 * no strings of its own.
 */
export interface Hint {
  text: string;
  level: 'info' | 'warn' | 'error';
  ttlMs: number;
}

export const HINT_QUEUE_MAX = 3;
export const HINT_DEFAULT_TTL_MS = 6000;

export class HintSurface {
  private readonly root: HTMLElement;
  private readonly queue: Hint[] = [];
  private current: Hint | null = null;
  private handle: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.hidden = true;
    this.root.textContent = '';
  }

  /** At most ONE visible; the rest queue, oldest queued dropped past HINT_QUEUE_MAX. */
  show(h: Hint): void {
    if (this.current) {
      this.queue.push(h);
      while (this.queue.length > HINT_QUEUE_MAX) this.queue.shift();
      return;
    }
    this.paint(h);
  }

  dismiss(): void {
    if (this.handle !== null) {
      window.clearTimeout(this.handle);
      this.handle = null;
    }
    this.current = null;
    this.root.hidden = true;
    this.root.textContent = '';
    const next = this.queue.shift();
    if (next) this.paint(next);
  }

  get queueLength(): number {
    return this.queue.length;
  }

  private paint(h: Hint): void {
    this.current = h;
    this.root.textContent = h.text;
    this.root.dataset.level = h.level;
    this.root.hidden = false;
    const ttl = h.ttlMs > 0 ? h.ttlMs : HINT_DEFAULT_TTL_MS;
    this.handle = window.setTimeout(() => this.dismiss(), ttl);
  }
}
