import { describe, expect, it, vi } from 'vitest';
import { QUNS, createNotificationState, isDnd } from './notification-state';

describe('QUNS / isDnd', () => {
  it('pins the seven QUERY_USER_NOTIFICATION_STATE values', () => {
    expect(QUNS).toEqual({
      NOT_PRESENT: 1, BUSY: 2, RUNNING_D3D_FULL_SCREEN: 3, PRESENTATION_MODE: 4,
      ACCEPTS_NOTIFICATIONS: 5, QUIET_TIME: 6, APP: 7,
    });
  });
  it('DND := state !== ACCEPTS_NOTIFICATIONS (QUIET_TIME counts as DND)', () => {
    expect(isDnd(QUNS.ACCEPTS_NOTIFICATIONS)).toBe(false);
    for (const v of [1, 2, 3, 4, 6, 7, 0, 99]) expect(isDnd(v)).toBe(true);
  });
});

describe('createNotificationState', () => {
  it('starts unknown (null), resolves on the first poll and reports edges only', () => {
    let value: number | null = QUNS.ACCEPTS_NOTIFICATIONS;
    const ns = createNotificationState(() => value);
    const cb = vi.fn();
    ns.onChange(cb);
    expect(ns.dnd).toBeNull();
    ns.poll();
    expect(ns.dnd).toBe(false);
    expect(cb.mock.calls).toEqual([[false]]);
    ns.poll();                                  // same value: no callback
    expect(cb).toHaveBeenCalledTimes(1);
    value = QUNS.BUSY;
    ns.poll();
    expect(ns.dnd).toBe(true);
    expect(cb.mock.calls).toEqual([[false], [true]]);
  });

  it('treats a failed query as DND on (conservative, §10.5 rung 3) and keeps dnd === null', () => {
    const ns = createNotificationState(() => null);
    const cb = vi.fn();
    ns.onChange(cb);
    ns.poll();
    expect(ns.dnd).toBeNull();
    expect(cb.mock.calls).toEqual([[true]]);
    ns.poll();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is inert with no query (koffi missing): dnd stays null and onChange reports on once', () => {
    const ns = createNotificationState(null);
    const cb = vi.fn();
    const off = ns.onChange(cb);
    ns.poll();
    expect(cb.mock.calls).toEqual([[true]]);
    off();
    ns.poll();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
