import { describe, expect, it } from 'vitest';
import { createLateBoundChatRequest, decideChatRequest, type ChatRequestSource } from './chat-request';
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

describe('GC2-2: createLateBoundChatRequest (second-instance before and after wiring)', () => {
  function harness() {
    const calls: Array<[ChatRequestSource, boolean]> = [];
    const logs: string[] = [];
    const late = createLateBoundChatRequest((line) => logs.push(line));
    return { late, calls, logs, target: (s: ChatRequestSource, f: boolean) => calls.push([s, f]) };
  }

  it('after wiring, a request goes straight through', () => {
    const h = harness();
    h.late.bind(h.target);
    h.late.request('second-instance', true);
    expect(h.calls).toEqual([['second-instance', true]]);
    expect(h.late.pending).toBeNull();
  });

  it('before wiring, ONE pending request is held (latest wins) and replayed exactly once on bind', () => {
    const h = harness();
    h.late.request('second-instance', false);
    h.late.request('second-instance', true);
    expect(h.calls).toEqual([]);
    expect(h.late.pending).toEqual({ source: 'second-instance', focusComposer: true });
    expect(h.logs).toHaveLength(2);
    h.late.bind(h.target);
    expect(h.calls).toEqual([['second-instance', true]]);
    expect(h.late.pending).toBeNull();
    h.late.bind(h.target);
    expect(h.calls).toHaveLength(1);
  });

  it('a request that arrives during the replay is not lost and does not recurse', () => {
    const h = harness();
    h.late.request('second-instance', true);
    h.late.bind((s, f) => {
      h.calls.push([s, f]);
      if (h.calls.length === 1) h.late.request('tray', true);
    });
    expect(h.calls).toEqual([['second-instance', true], ['tray', true]]);
  });

  it('integration: replayed and live second-instance requests go through the visibility gate', () => {
    // The shape of index.ts's requestChat, applied to a real VisibilityState.
    const flags = { user: false, locked: false, fullscreen: false };
    const opened: ChatRequestSource[] = [];
    const requestChat = (source: ChatRequestSource, focusComposer: boolean): void => {
      const vis = verdictWith(flags);
      const decision = decideChatRequest(vis);
      if (decision === 'refuse') return;
      if (decision === 'reveal') flags.user = false;
      opened.push(source);
      expect(focusComposer).toBe(true);
    };
    const late = createLateBoundChatRequest(() => {});
    late.request('second-instance', true); // the event precedes `ready`
    flags.user = true; // she was hidden by the tray toggle when wiring completes
    late.bind(requestChat);
    expect(opened).toEqual(['second-instance']);
    expect(flags.user).toBe(false); // revealed, as the tray/hotkey path does

    flags.locked = true;
    late.request('second-instance', true);
    expect(opened).toEqual(['second-instance']); // refused behind the lock screen
    flags.locked = false;
    flags.fullscreen = true;
    late.request('second-instance', true);
    expect(opened).toEqual(['second-instance']); // refused over a fullscreen app
    flags.fullscreen = false;
    late.request('second-instance', true);
    expect(opened).toEqual(['second-instance', 'second-instance']);
  });
});
