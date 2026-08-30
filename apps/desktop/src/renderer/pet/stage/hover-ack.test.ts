import { describe, expect, it } from 'vitest';
import {
  HOVER_ACK_GLANCE_MS, HOVER_ACK_MAX_MS, HoverAckMachine, WORK_MODE_DEFAULT, WORK_MODE_FADE_AFTER_MS,
  WORK_MODE_FADE_MS, WORK_MODE_FADE_OPACITY, type HoverAckDeps,
} from './hover-ack';

/**
 * `flags` stands in for the relayed snapshot: R3-35/A3-1 makes `SimSnapshot.uiWorkMode` the source
 * of `workMode()`, and `pet/main.ts` (Task 13) assigns it on every `sim:state`. It is a mutable box,
 * not a captured constant, because the machine reads the getter at TICK time — a tray toggle that
 * lands mid-hover must take effect on the very next tick, in both directions.
 */
function harness(workMode = WORK_MODE_DEFAULT) {
  const log: string[] = [];
  const flags = { workMode };
  const deps: HoverAckDeps = {
    glance: (ttl) => log.push(`glance:${ttl}`),
    setFrozen: (f) => log.push(`frozen:${f}`),
    setModelOapcity: (o, ms) => log.push(`opacity:${o}:${ms}`),
    sendPassthrough: (faded) => log.push(`passthrough:${faded}`),
    openChat: () => log.push('chat:open'),
    workMode: () => flags.workMode,
    trace: (rec) => log.push(`trace:${rec.kind}:${rec.label}`),
  };
  return { m: new HoverAckMachine(deps), log, flags };
}

describe('constants (§5.9, bar §0)', () => {
  it('pins the six numbers', () => {
    expect(HOVER_ACK_MAX_MS).toBe(250);
    expect(HOVER_ACK_GLANCE_MS).toBe(400);
    expect(WORK_MODE_FADE_AFTER_MS).toBe(3_000);
    expect(WORK_MODE_FADE_OPACITY).toBe(0.35);
    expect(WORK_MODE_FADE_MS).toBe(250);
    expect(WORK_MODE_DEFAULT).toBe(false);
  });
});

describe('HoverAckMachine', () => {
  it('out → acknowledging on enter: glance lease, freeze, hoverAck trace, all inside HOVER_ACK_MAX_MS', () => {
    const { m, log } = harness();
    m.enter(1_000);
    expect(m.state).toBe('acknowledging');
    expect(log).toEqual([`glance:${HOVER_ACK_GLANCE_MS}`, 'frozen:true', 'trace:hoverAck:acknowledging']);
    expect(m.ackLatencyMs).toBeLessThanOrEqual(HOVER_ACK_MAX_MS);
    m.enter(1_010);                       // a second opaque report is not a second acknowledgement
    expect(log).toHaveLength(3);
  });

  // Fix round 1 (finding 3): `ackLatencyMs` was a hardcoded 0, so the `<= HOVER_ACK_MAX_MS`
  // assertion above could not fail and bar §0's "hover < 250 ms -> acknowledge" was unmeasured.
  // `enter` now takes the picker's opaque-report timestamp; the full picker->enter path is still
  // Task 13/17's to prove end to end.
  it('measures the picker → acknowledge latency instead of reporting a constant 0', () => {
    const a = harness();
    a.m.enter(1_040, 1_000);
    expect(a.m.ackLatencyMs).toBe(40);
    expect(a.m.ackLatencyMs).toBeLessThanOrEqual(HOVER_ACK_MAX_MS);
    const late = harness();
    late.m.enter(1_400, 1_000);                             // a report the frame loop sat on
    expect(late.m.ackLatencyMs).toBe(400);
    expect(late.m.ackLatencyMs).toBeGreaterThan(HOVER_ACK_MAX_MS);   // the bound can now fail
    const now = harness();
    now.m.enter(500);                                       // default: reported this frame
    expect(now.m.ackLatencyMs).toBe(0);
  });

  // Fix round 1 (finding 7): contracts §12 reads one `hoverAck` record per state change; `held` and
  // `out` emitted nothing, so a later assertion on the state sequence would have found gaps.
  it('traces every state change, not only acknowledging and faded', () => {
    const { m, log } = harness(true);
    const traces = () => log.filter((l) => l.startsWith('trace:'));
    m.enter(0);
    m.tick(400);
    m.tick(3_401);
    m.leave(4_000);
    expect(m.state).toBe('out');
    expect(traces()).toEqual([
      'trace:hoverAck:acknowledging', 'trace:hoverAck:held', 'trace:hoverAck:faded', 'trace:hoverAck:out',
    ]);
    m.enter(5_000);
    m.leave(5_100);
    expect(traces().slice(-2)).toEqual(['trace:hoverAck:acknowledging', 'trace:hoverAck:out']);
  });

  it('acknowledging → held when the glance ends; the freeze stays', () => {
    const { m, log } = harness();
    m.enter(0);
    m.tick(399);
    expect(m.state).toBe('acknowledging');
    m.tick(400);
    expect(m.state).toBe('held');
    expect(log.filter((l) => l.startsWith('frozen'))).toEqual(['frozen:true']);
  });

  it('held/acknowledging → out on leave: unfreeze only', () => {
    const { m, log } = harness();
    m.enter(0);
    m.leave(100);
    expect(m.state).toBe('out');
    expect(log.slice(-1)).toEqual(['frozen:false']);
    m.enter(200); m.tick(600); m.leave(700);
    expect(log.slice(-1)).toEqual(['frozen:false']);
    expect(log.filter((l) => l.startsWith('opacity') || l.startsWith('passthrough'))).toEqual([]);
  });

  it('a click before any fade opens the chat exactly once per click; out and faded never do', () => {
    const { m, log } = harness(true);
    m.click(0);
    expect(log.filter((l) => l === 'chat:open')).toHaveLength(0);
    m.enter(0);
    m.click(100);
    expect(log.filter((l) => l === 'chat:open')).toHaveLength(1);
    m.tick(400);
    m.click(2_999);
    expect(log.filter((l) => l === 'chat:open')).toHaveLength(2);
    m.tick(3_401);
    expect(m.state).toBe('faded');
    m.click(3_500);
    expect(log.filter((l) => l === 'chat:open')).toHaveLength(2);
  });

  it('work mode OFF (the default): rest never fades', () => {
    const { m, log } = harness();
    m.enter(0); m.tick(400); m.tick(60_000);
    expect(m.state).toBe('held');
    expect(log.filter((l) => l.startsWith('opacity'))).toEqual([]);
  });

  it('work mode ON: rest > 3 s fades to 0.35 over 250 ms and sends arb:passthrough {faded:true}; movement resets the rest', () => {
    const { m, log } = harness(true);
    m.enter(0); m.tick(400);
    m.move(1_000);
    m.tick(4_000);                       // 3 000 ms since the move: not yet (> is strict)
    expect(m.state).toBe('held');
    m.tick(4_001);
    expect(m.state).toBe('faded');
    expect(log.slice(-3)).toEqual([`opacity:${WORK_MODE_FADE_OPACITY}:${WORK_MODE_FADE_MS}`, 'passthrough:true', 'trace:hoverAck:faded']);
  });

  // R3-35 / A3-1: work mode is `SimSnapshot.uiWorkMode`, relayed on every `sim:state`, and the
  // machine reads it at tick time. Both edges matter: a toggle arriving DURING a hover must arm the
  // fade, and a toggle arriving before the deadline must cancel it. Without this the bar §0 row
  // "rest > 3 s while a 'work-mode' toggle is on → fade to 35 % + pass-through" is unreachable,
  // because nothing else in Phase 3 can change the flag while the cursor is on her.
  it('reads the relayed uiWorkMode at tick time: ON mid-hover arms the fade, OFF before the deadline cancels it', () => {
    const { m, log, flags } = harness(false);
    m.enter(0);
    m.tick(400);
    expect(m.state).toBe('held');
    flags.workMode = true;                       // sim:state arrives with uiWorkMode true
    m.tick(3_001);
    expect(m.state).toBe('faded');
    expect(log.slice(-3)).toEqual([`opacity:${WORK_MODE_FADE_OPACITY}:${WORK_MODE_FADE_MS}`, 'passthrough:true', 'trace:hoverAck:faded']);

    const b = harness(true);
    b.m.enter(0);
    b.m.tick(400);
    b.flags.workMode = false;                    // the tray unchecked 工作模式 while she is hovered
    b.m.tick(9_999);
    expect(b.m.state).toBe('held');
    expect(b.log.filter((l) => l.startsWith('opacity'))).toEqual([]);
    expect(b.log.filter((l) => l.startsWith('passthrough'))).toEqual([]);
  });

  it('faded → out on leave restores opacity, pass-through and wandering; re-entry is an ordinary enter', () => {
    const { m, log } = harness(true);
    m.enter(0); m.tick(400); m.tick(3_401);
    expect(m.state).toBe('faded');
    m.leave(5_000);
    expect(m.state).toBe('out');
    expect(log.slice(-3)).toEqual([`opacity:1:${WORK_MODE_FADE_MS}`, 'passthrough:false', 'frozen:false']);
    m.enter(5_100);
    expect(m.state).toBe('acknowledging');
    expect(log.slice(-3)).toEqual([`glance:${HOVER_ACK_GLANCE_MS}`, 'frozen:true', 'trace:hoverAck:acknowledging']);
  });
});
