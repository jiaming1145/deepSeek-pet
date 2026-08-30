import { beforeEach, describe, expect, it } from 'vitest';
import { Bubble } from './bubble';

function mount(): { root: HTMLElement; text: HTMLElement; plate: HTMLElement; advance: HTMLElement } {
  // place() writes the three geometry custom properties on :root (contracts.md §5.2's owner
  // table), and jsdom keeps one document per file — so clear them between cases.
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = `
    <div id="bubble" class="bubble" data-side="left" data-emotion="neutral" hidden>
      <span class="bubble__rail" aria-hidden="true"></span>
      <div class="bubble__plate" data-bubble-plate hidden></div>
      <div class="bubble__surface">
        <p class="bubble__text" data-bubble-text></p>
        <span class="bubble__advance" data-bubble-advance aria-hidden="true">▼</span>
      </div>
      <span class="bubble__anchor" aria-hidden="true"></span>
    </div>`;
  return {
    root: document.getElementById('bubble') as HTMLElement,
    text: document.querySelector('[data-bubble-text]') as HTMLElement,
    plate: document.querySelector('[data-bubble-plate]') as HTMLElement,
    advance: document.querySelector('[data-bubble-advance]') as HTMLElement,
  };
}

describe('Bubble', () => {
  let dom: ReturnType<typeof mount>;
  beforeEach(() => {
    dom = mount();
  });

  it('place() writes the side on the band and the geometry on :root', () => {
    new Bubble(dom.root).place({ maxWidth: 460, maxHeight: 320, side: 'right', arrowOffset: 72 });
    const rootStyle = document.documentElement.style;
    expect(dom.root.dataset.side).toBe('right');
    expect(rootStyle.getPropertyValue('--bubble-max-w')).toBe('460px');
    expect(rootStyle.getPropertyValue('--bubble-max-h')).toBe('320px');
    expect(rootStyle.getPropertyValue('--arrow-offset')).toBe('72px');
    // The band is #content's CHILD and custom properties inherit downwards only: writing them on
    // the band root leaves `.content { max-width: var(--bubble-max-w) }` unresolved (§5.2).
    expect(dom.root.style.getPropertyValue('--bubble-max-w')).toBe('');
    expect(dom.root.style.getPropertyValue('--bubble-max-h')).toBe('');
  });

  it('show() reveals the root and hide() re-hides it after the exit duration', async () => {
    const b = new Bubble(dom.root);
    b.show();
    expect(b.visible).toBe(true);
    expect(dom.root.hidden).toBe(false);
    expect(dom.root.classList.contains('is-visible')).toBe(true);
    b.hide();
    expect(b.visible).toBe(false);
    expect(dom.root.classList.contains('is-exiting')).toBe(true);
    expect(dom.root.hidden).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(dom.root.hidden).toBe(true);
  });

  it('setText writes textContent, never HTML', () => {
    new Bubble(dom.root).setText('<b>你好</b>');
    expect(dom.text.textContent).toBe('<b>你好</b>');
    expect(dom.text.querySelector('b')).toBeNull();
  });

  it('clear() empties the text so the CSS thinking dots show', () => {
    const b = new Bubble(dom.root);
    b.setText('你好');
    b.clear();
    expect(dom.text.textContent).toBe('');
  });

  it('measure() reports the rounded-up border box', () => {
    dom.root.getBoundingClientRect = () => ({ width: 322.4, height: 118.2 }) as DOMRect;
    expect(new Bubble(dom.root).measure()).toEqual({ width: 323, height: 119 });
  });

  it('overflowing() is true only when the text node scrolls', () => {
    const b = new Bubble(dom.root);
    Object.defineProperty(dom.text, 'clientHeight', { value: 156, configurable: true });
    Object.defineProperty(dom.text, 'scrollHeight', { value: 156, configurable: true });
    expect(b.overflowing()).toBe(false);
    Object.defineProperty(dom.text, 'scrollHeight', { value: 182, configurable: true });
    expect(b.overflowing()).toBe(true);
  });

  it('setName fills the plate and hides it when the name is empty', () => {
    const b = new Bubble(dom.root);
    b.setName('小春');
    expect(dom.plate.textContent).toBe('小春');
    expect(dom.plate.hidden).toBe(false);
    b.setName('');
    expect(dom.plate.hidden).toBe(true);
  });

  it('setAwaiting toggles the advance mark', () => {
    const b = new Bubble(dom.root);
    expect(dom.advance.dataset.on).toBe('0');
    b.setAwaiting(true);
    expect(dom.advance.dataset.on).toBe('1');
    b.setAwaiting(false);
    expect(dom.advance.dataset.on).toBe('0');
  });

  it('setEmotion writes data-emotion on the band root (drives the nine plate rules)', () => {
    const b = new Bubble(dom.root);
    b.setEmotion('sad');
    expect(dom.root.dataset.emotion).toBe('sad');
    b.setEmotion('neutral');
    expect(dom.root.dataset.emotion).toBe('neutral');
  });
});
