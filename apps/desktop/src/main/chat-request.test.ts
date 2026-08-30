import { describe, expect, it } from 'vitest';
import { decideChatRequest } from './chat-request';
import { VisibilityState } from './visibility-state';

const verdictWith = (flags: Partial<Record<'fullscreen' | 'locked' | 'suspended' | 'user', boolean>>) => {
  const s = new VisibilityState();
  for (const [flag, on] of Object.entries(flags)) s.set(flag as 'user', on);
  return { hidden: s.hidden, get: (flag: 'user') => s.get(flag) };
};

describe('I-7: decideChatRequest', () => {
  it('opens when she is on screen', () => {
    expect(decideChatRequest(verdictWith({}))).toBe('open');
  });

  it('reveals first when the user is the only reason she is hidden', () => {
    expect(decideChatRequest(verdictWith({ user: true }))).toBe('reveal');
  });

  it.each([
    ['locked', { locked: true }],
    ['suspended', { suspended: true }],
    ['fullscreen', { fullscreen: true }],
    ['locked + user', { locked: true, user: true }],
    ['fullscreen + user', { fullscreen: true, user: true }],
  ])('refuses while %s', (_label, flags) => {
    expect(decideChatRequest(verdictWith(flags))).toBe('refuse');
  });
});
