import { describe, expect, it } from 'vitest';
import { createKeyRequest, decideKeyRequest } from './key-request';
import type { VisibilityFlag } from './visibility-state';

type Flags = Partial<Record<VisibilityFlag, boolean>>;
const vis = (flags: Flags) => ({
  hidden: Object.values(flags).some(Boolean),
  get: (flag: VisibilityFlag) => flags[flag] === true,
});

describe('CX-3: decideKeyRequest', () => {
  it('opens when she is on screen', () => {
    expect(decideKeyRequest(vis({}))).toBe('open');
  });

  it('opens when hidden only by the user (a settings dialog, not the pet)', () => {
    expect(decideKeyRequest(vis({ user: true }))).toBe('open');
  });

  it.each([
    ['locked', { locked: true }],
    ['suspended', { suspended: true }],
    ['fullscreen', { fullscreen: true }],
    ['locked + user', { locked: true, user: true }],
    ['fullscreen + user', { fullscreen: true, user: true }],
  ])('queues while %s', (_label, flags) => {
    expect(decideKeyRequest(vis(flags))).toBe('queue');
  });
});

describe('CX-3: createKeyRequest', () => {
  function harness(flags: Flags) {
    const shown: string[] = [];
    const logs: string[] = [];
    const gate = createKeyRequest({
      visibility: { hidden: () => Object.values(flags).some(Boolean), get: (f) => flags[f] === true },
      show: (reason) => shown.push(reason),
      log: (line) => logs.push(line),
    });
    return { gate, shown, logs, flags };
  }

  it('shows at once when the shell is visible', () => {
    const { gate, shown } = harness({});
    gate.request('auth');
    expect(shown).toEqual(['auth']);
    expect(gate.pending).toBeNull();
  });

  it('an auth failure over a lock screen does NOT pop the window; it is shown when the verdict clears', () => {
    const h = harness({ locked: true });
    h.gate.request('auth');
    expect(h.shown).toEqual([]);
    expect(h.gate.pending).toBe('auth');
    expect(h.logs).toHaveLength(1);
    // Still hidden (suspend follows the lock): nothing.
    h.gate.onVerdict();
    expect(h.shown).toEqual([]);
    // Unlocked: the queued prompt shows exactly once.
    h.flags.locked = false;
    h.gate.onVerdict();
    expect(h.shown).toEqual(['auth']);
    expect(h.gate.pending).toBeNull();
    h.gate.onVerdict();
    expect(h.shown).toEqual(['auth']);
  });

  it('a fullscreen game queues the prompt; the latest queued reason wins', () => {
    const h = harness({ fullscreen: true });
    h.gate.request('first-run');
    h.gate.request('auth');
    expect(h.gate.pending).toBe('auth');
    h.flags.fullscreen = false;
    h.gate.onVerdict();
    expect(h.shown).toEqual(['auth']);
  });

  it('a request that can be shown clears an older queued one', () => {
    const h = harness({ suspended: true });
    h.gate.request('auth');
    h.flags.suspended = false;
    h.gate.request('user');
    expect(h.shown).toEqual(['user']);
    expect(h.gate.pending).toBeNull();
  });

  it('a clear verdict with nothing queued shows nothing', () => {
    const h = harness({});
    h.gate.onVerdict();
    expect(h.shown).toEqual([]);
  });

  it('GC3-1: a queued prompt flushes when the system flag clears even though the user flag stays set', () => {
    const h = harness({ locked: true, user: true });
    h.gate.request('auth');
    expect(h.shown).toEqual([]);
    expect(h.gate.pending).toBe('auth');
    // Unlock: the aggregate verdict is still hidden (user), but decideKeyRequest says open.
    h.flags.locked = false;
    h.gate.onVerdict();
    expect(h.shown).toEqual(['auth']);
    expect(h.gate.pending).toBeNull();
    h.gate.onVerdict();
    expect(h.shown).toEqual(['auth']);
  });

  it('GC3-1: pending is cleared before show — a re-entrant verdict inside show() cannot show twice', () => {
    const flags: Flags = { fullscreen: true };
    const shown: string[] = [];
    const gate = createKeyRequest({
      visibility: { hidden: () => Object.values(flags).some(Boolean), get: (f) => flags[f] === true },
      show: (reason) => {
        shown.push(reason);
        gate.onVerdict();
      },
      log: () => {},
    });
    gate.request('first-run');
    flags.fullscreen = false;
    gate.onVerdict();
    expect(shown).toEqual(['first-run']);
  });
});
