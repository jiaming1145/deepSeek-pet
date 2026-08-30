import { describe, expect, it } from 'vitest';
import { createBubbleVisibility } from './bubble-visibility';

class FakeSurface {
  visible = false;
  destroyed = false;
  readonly calls: string[] = [];
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isVisible(): boolean {
    return this.visible;
  }
  showInactive(): void {
    this.visible = true;
    this.calls.push('showInactive');
  }
  hide(): void {
    this.visible = false;
    this.calls.push('hide');
  }
}

function harness() {
  const win = new FakeSurface();
  const events: string[] = [];
  let shellHidden = false;
  const vis = createBubbleVisibility({
    window: () => win,
    shellHidden: () => shellHidden,
    onHidden: () => events.push('hidden'),
    onShown: () => events.push('shown'),
  });
  return { win, events, vis, setShellHidden: (v: boolean) => (shellHidden = v) };
}

describe('G2-5: bubble visibility reconciler', () => {
  it('shows with showInactive on the hidden→visible edge and fires onShown exactly once', () => {
    const { win, events, vis } = harness();
    vis.set(true);
    expect(win.calls).toEqual(['showInactive']);
    expect(events).toEqual(['shown']);
    vis.apply();
    vis.set(true);
    expect(win.calls).toEqual(['showInactive']);
    expect(events).toEqual(['shown']); // no resync spam while it stays up
  });

  it('EVERY hide fires onHidden — even when the window was already hidden (a stale pin must never survive)', () => {
    const { win, events, vis } = harness();
    vis.set(true);
    vis.set(false);
    expect(win.calls).toEqual(['showInactive', 'hide']);
    expect(events).toEqual(['shown', 'hidden']);
    // Already down: no second `hide()` on the window, but the service is told again.
    vis.set(false);
    vis.apply();
    expect(win.calls).toEqual(['showInactive', 'hide']);
    expect(events).toEqual(['shown', 'hidden', 'hidden', 'hidden']);
  });

  it('hover-inside → verdict hide → verdict clear: the hidden edge tells the service, the show edge resyncs the renderer', () => {
    const { win, events, vis, setShellHidden } = harness();
    vis.set(true); // she is speaking; the pointer rests on the band (renderer state, not ours)
    setShellHidden(true);
    vis.apply(); // lock screen
    expect(win.visible).toBe(false);
    expect(events).toEqual(['shown', 'hidden']);
    setShellHidden(false);
    vis.apply(); // unlock, brain still wants it: replayed, and the renderer gets its resync
    expect(win.visible).toBe(true);
    expect(events).toEqual(['shown', 'hidden', 'shown']);
  });

  it('a wish while the shell hides her is remembered, not shown, and still forces the hidden hook', () => {
    const { win, events, vis, setShellHidden } = harness();
    setShellHidden(true);
    vis.set(true);
    expect(vis.wanted).toBe(true);
    expect(win.calls).toEqual([]);
    expect(events).toEqual(['hidden']);
    setShellHidden(false);
    vis.apply();
    expect(win.calls).toEqual(['showInactive']);
  });

  it('does nothing without a window or with a destroyed one', () => {
    let win: FakeSurface | null = null;
    const events: string[] = [];
    const vis = createBubbleVisibility({
      window: () => win,
      shellHidden: () => false,
      onHidden: () => events.push('hidden'),
      onShown: () => events.push('shown'),
    });
    vis.set(true);
    expect(events).toEqual([]);
    win = new FakeSurface();
    win.destroyed = true;
    vis.apply();
    expect(events).toEqual([]);
    win.destroyed = false;
    vis.apply(); // the remembered wish replays once a live window exists
    expect(win.calls).toEqual(['showInactive']);
  });
});
