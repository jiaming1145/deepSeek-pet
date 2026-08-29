import { describe, expect, it, vi } from 'vitest';
import { createVisibilityController, VisibilityState, type VisibilityVerdict } from './visibility-state';

describe('VisibilityState', () => {
  it('lock -> suspend -> resume -> unlock keeps hidden true until unlock', () => {
    const v = new VisibilityState();
    v.set('locked', true); // Win+L
    expect(v.hidden).toBe(true);
    v.set('suspended', true); // machine goes to sleep while locked
    expect(v.hidden).toBe(true);
    v.set('suspended', false); // resume: lock screen is still showing
    expect(v.hidden).toBe(true);
    expect(v.reason).toBe('locked');
    v.set('locked', false); // unlock
    expect(v.hidden).toBe(false);
    expect(v.reason).toBe('none');
  });

  it('user-hidden survives unlock and resume', () => {
    const v = new VisibilityState();
    v.set('user', true);
    v.set('locked', true);
    v.set('suspended', true);
    v.set('suspended', false); // resume
    v.set('locked', false); // unlock
    expect(v.hidden).toBe(true);
    expect(v.reason).toBe('user');
  });

  it('fullscreen clearing while locked yields hidden:true reason:locked', () => {
    const v = new VisibilityState();
    v.set('locked', true);
    v.set('fullscreen', true);
    v.set('fullscreen', false);
    expect(v.hidden).toBe(true);
    expect(v.reason).toBe('locked');
  });

  it('all flags clear yields hidden:false reason:none', () => {
    const v = new VisibilityState();
    v.set('fullscreen', true);
    v.set('locked', true);
    v.set('suspended', true);
    v.set('user', true);
    v.set('fullscreen', false);
    v.set('locked', false);
    v.set('suspended', false);
    v.set('user', false);
    expect(v.hidden).toBe(false);
    expect(v.reason).toBe('none');
  });

  it('precedence is user > locked > suspended > fullscreen when several are set', () => {
    const v = new VisibilityState();
    v.set('fullscreen', true);
    v.set('suspended', true);
    v.set('locked', true);
    v.set('user', true);
    expect(v.reason).toBe('user');
    v.set('user', false);
    expect(v.reason).toBe('locked');
    v.set('locked', false);
    expect(v.reason).toBe('suspended');
    v.set('suspended', false);
    expect(v.reason).toBe('fullscreen');
  });
});

/**
 * The startup reconciliation (final-review F1): every show goes through one owner, so a hide that
 * lands during the ~1 s of renderer startup is not undone by the window's first paint, and the
 * renderer — whose `shell:visibility` listener only exists after the model loads — can ask for the
 * verdict again.
 */
describe('createVisibilityController', () => {
  function harness(destroyed = false) {
    const calls: string[] = [];
    const sent: VisibilityVerdict[] = [];
    const paused: boolean[] = [];
    const clickThrough: boolean[] = [];
    let rechecks = 0;
    const window = {
      isDestroyed: () => destroyed,
      hide: () => calls.push('hide'),
      showInactive: () => calls.push('showInactive'),
    };
    const controller = createVisibilityController({
      window: () => window,
      send: (verdict) => sent.push(verdict),
      setCursorPaused: (p) => paused.push(p),
      setClickThrough: (ignore) => clickThrough.push(ignore),
      recheckCursor: () => { rechecks++; },
      log: () => { /* quiet */ },
    });
    // Exactly how index.ts wires `createPetWindow({ onReadyToShow })`.
    const readyToShow = (): void => controller.apply();
    return { calls, sent, paused, clickThrough, rechecks: () => rechecks, controller, readyToShow };
  }

  it('hide-before-paint: ready-to-show never shows her when a flag is already set', () => {
    const h = harness();
    h.controller.set('user', true);
    h.controller.apply();
    h.readyToShow();
    expect(h.calls).toEqual(['hide', 'hide']);
    expect(h.calls).not.toContain('showInactive');
    expect(h.sent.at(-1)).toEqual({ hidden: true, reason: 'user' });
    expect(h.paused).toEqual([true, true]);
  });

  it('normal path: ready-to-show with no flags set shows her exactly once', () => {
    const h = harness();
    h.readyToShow();
    expect(h.calls).toEqual(['showInactive']);
    expect(h.sent).toEqual([{ hidden: false, reason: 'none' }]);
    expect(h.paused).toEqual([false]);
  });

  it('stage-ready resync: resend() re-sends the verdict without touching the window', () => {
    const h = harness();
    h.controller.set('fullscreen', true);
    h.controller.resend();
    expect(h.sent).toEqual([{ hidden: true, reason: 'fullscreen' }]);
    expect(h.calls).toEqual([]);
  });

  it('sends on every apply(), not only when the verdict changes', () => {
    const h = harness();
    h.controller.apply();
    h.controller.apply();
    expect(h.sent).toEqual([{ hidden: false, reason: 'none' }, { hidden: false, reason: 'none' }]);
  });

  it('is inert while the window does not exist yet or is destroyed', () => {
    const send = vi.fn();
    const before = createVisibilityController({ window: () => null, send, log: () => {} });
    before.apply();
    expect(send).not.toHaveBeenCalled();

    const after = harness(true);
    after.controller.apply();
    expect(after.calls).toEqual([]);
    expect(after.sent).toEqual([]);
  });

  it('exposes the verdict the flags currently imply', () => {
    const h = harness();
    expect(h.controller.verdict).toEqual({ hidden: false, reason: 'none' });
    h.controller.set('locked', true);
    expect(h.controller.verdict).toEqual({ hidden: true, reason: 'locked' });
    expect(h.controller.get('locked')).toBe(true);
  });
});

describe('createVisibilityController — hover resync across hide/show', () => {
  function harness() {
    const calls: string[] = [];
    const clickThrough: boolean[] = [];
    let rechecks = 0;
    const controller = createVisibilityController({
      window: () => ({ isDestroyed: () => false, hide: () => calls.push('hide'), showInactive: () => calls.push('showInactive') }),
      send: () => { /* not under test */ },
      setClickThrough: (ignore) => clickThrough.push(ignore),
      recheckCursor: () => { rechecks++; },
      log: () => { /* quiet */ },
    });
    return { calls, clickThrough, rechecks: () => rechecks, controller };
  }

  it('forces native click-through before hiding (the leave event may never arrive)', () => {
    const h = harness();
    h.controller.set('fullscreen', true);
    h.controller.apply();
    expect(h.clickThrough).toEqual([true]);
    expect(h.calls).toEqual(['hide']);
    expect(h.rechecks()).toBe(0);
  });

  it('re-samples the cursor after showing so a stationary cursor on her re-enables interaction', () => {
    const h = harness();
    h.controller.set('fullscreen', true);
    h.controller.apply();
    h.controller.set('fullscreen', false);
    h.controller.apply();
    expect(h.calls).toEqual(['hide', 'showInactive']);
    expect(h.rechecks()).toBe(1);
    // Show never forces the click-through state itself: the renderer's fresh hit decides.
    expect(h.clickThrough).toEqual([true]);
  });
});
