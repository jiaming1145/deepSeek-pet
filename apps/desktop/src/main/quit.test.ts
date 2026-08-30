import { describe, expect, it, vi } from 'vitest';
import { createBeforeQuit } from './quit';

function harness(opts: { timeoutMs?: number } = {}) {
  const calls: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const q = createBeforeQuit({
    teardownSync: () => calls.push('teardownSync'),
    drain: () => {
      calls.push('drain');
      return gate;
    },
    teardownAfterDrain: () => calls.push('teardownAfterDrain'),
    closeDb: () => calls.push('closeDb'),
    quit: () => {
      calls.push('quit');
      // app.quit() raises before-quit again; the handler must let this one through.
      q.handler(event());
    },
    timeoutMs: opts.timeoutMs,
    log: (line) => calls.push(`log:${line}`),
  });
  const prevented: number[] = [];
  const event = () => ({ preventDefault: () => prevented.push(calls.length) });
  return { q, calls, release, prevented, event };
}

describe('I-9: before-quit sequence', () => {
  it('prevents the first before-quit, drains, then closes the db and quits — in that order', async () => {
    const { q, calls, release, prevented, event } = harness();
    q.handler(event());
    expect(prevented).toHaveLength(1);
    expect(q.phase).toBe('draining');
    expect(calls).toEqual(['teardownSync', 'drain']);

    await Promise.resolve();
    expect(calls).not.toContain('closeDb'); // the barrier holds while cancel() has not settled

    release();
    await vi.waitFor(() => expect(q.phase).toBe('done'));
    expect(calls).toEqual(['teardownSync', 'drain', 'teardownAfterDrain', 'closeDb', 'quit']);
    expect(prevented).toHaveLength(1); // the before-quit raised by quit() went through
  });

  it('prevents a second before-quit during the drain without running the teardown twice', async () => {
    const { q, calls, release, prevented, event } = harness();
    q.handler(event());
    q.handler(event());
    expect(prevented).toHaveLength(2);
    expect(calls.filter((c) => c === 'teardownSync')).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(q.phase).toBe('done'));
    expect(calls.filter((c) => c === 'closeDb')).toHaveLength(1);
  });

  it('bounds a drain that never settles, and still closes the db before quitting', async () => {
    vi.useFakeTimers();
    try {
      const { q, calls, event } = harness({ timeoutMs: 50 });
      q.handler(event());
      await vi.advanceTimersByTimeAsync(49);
      expect(calls).not.toContain('closeDb');
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(q.phase).toBe('done'));
      expect(calls.slice(-3)).toEqual(['teardownAfterDrain', 'closeDb', 'quit']);
      expect(calls.some((c) => c.startsWith('log:[quit] drain did not settle'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejecting drain is logged and never blocks the quit', async () => {
    const calls: string[] = [];
    const q = createBeforeQuit({
      teardownSync: () => {},
      drain: () => Promise.reject(new Error('boom')),
      teardownAfterDrain: () => calls.push('after'),
      closeDb: () => calls.push('closeDb'),
      quit: () => calls.push('quit'),
      log: (line) => calls.push(`log:${line}`),
    });
    q.handler({ preventDefault: () => {} });
    await vi.waitFor(() => expect(q.phase).toBe('done'));
    expect(calls).toEqual(['log:[quit] drain failed: boom', 'after', 'closeDb', 'quit']);
  });
});
