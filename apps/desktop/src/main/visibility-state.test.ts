import { describe, expect, it } from 'vitest';
import { VisibilityState } from './visibility-state';

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
