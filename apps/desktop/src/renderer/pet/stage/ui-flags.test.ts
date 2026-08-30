import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '@ds/protocol';
import { HoverAckMachine, WORK_MODE_DEFAULT, WORK_MODE_FADE_MS, WORK_MODE_FADE_OPACITY, type HoverAckDeps } from './hover-ack';
import { SfxPlayer, type SfxAudio } from './sfx';
import { applyUiFlags, createUiFlags } from './ui-flags';

/** Only the two fields the relay reads; the rest of the snapshot is irrelevant here. */
const snap = (uiWorkMode: boolean, uiSfxMuted: boolean): Pick<SimSnapshot, 'uiWorkMode' | 'uiSfxMuted'> =>
  ({ uiWorkMode, uiSfxMuted });

function harness() {
  const log: string[] = [];
  const flags = createUiFlags();
  const deps: HoverAckDeps = {
    glance: () => {},
    setFrozen: () => {},
    setModelOapcity: (o, ms) => log.push(`opacity:${o}:${ms}`),
    sendPassthrough: (faded) => log.push(`passthrough:${faded}`),
    openChat: () => {},
    workMode: () => flags.workMode,          // exactly what pet/main.ts binds
    trace: () => {},
  };
  // Task 5's `SfxAudio` is exactly {volume, currentTime, play} — no excess properties.
  const played: string[] = [];
  let now = 0;
  const createAudio = (url: string): SfxAudio => ({
    volume: 1, currentTime: 0,
    play: () => { played.push(url); return Promise.resolve(); },
  });
  const sfx = new SfxPlayer('/sfx/', { createAudio, now: () => now });
  return { m: new HoverAckMachine(deps), log, flags, sfx, played, tick: (ms: number) => { now = ms; } };
}

describe('applyUiFlags — the sim:state relay (R3-35 / A3-1)', () => {
  it('starts at the shipped defaults: work mode off, sound on', () => {
    const flags = createUiFlags();
    expect(flags).toEqual({ workMode: WORK_MODE_DEFAULT, sfxMuted: false });
  });

  it('work mode ON + cursor rest > 3 s → fade to 35 % and arb:passthrough {faded:true}', () => {
    const h = harness();
    applyUiFlags(snap(true, false), h.flags, { sfx: h.sfx });
    h.m.enter(0);
    h.m.tick(400);
    h.m.tick(3_000);                            // the threshold is strict
    expect(h.m.state).toBe('held');
    h.m.tick(3_001);
    expect(h.m.state).toBe('faded');
    expect(h.log).toEqual([`opacity:${WORK_MODE_FADE_OPACITY}:${WORK_MODE_FADE_MS}`, 'passthrough:true']);
  });

  it('work mode OFF (the default, and after a snapshot turns it off) never fades', () => {
    const h = harness();
    applyUiFlags(snap(false, false), h.flags, { sfx: h.sfx });
    h.m.enter(0);
    h.m.tick(400);
    h.m.tick(60_000);
    expect(h.m.state).toBe('held');
    expect(h.log).toEqual([]);
  });

  it('uiSfxMuted true reaches SfxPlayer.setMuted, so a tap makes no sound; false restores it', () => {
    const h = harness();
    applyUiFlags(snap(false, true), h.flags, { sfx: h.sfx });
    h.sfx.play('tap');
    expect(h.played).toEqual([]);               // §5.12: muted plays nothing
    h.tick(10_000);
    applyUiFlags(snap(false, false), h.flags, { sfx: h.sfx });
    h.sfx.play('tap');
    expect(h.played).toHaveLength(1);
  });

  it('is safe with no SfxPlayer (browser lane has no bridge, so `sfx` is null)', () => {
    const h = harness();
    expect(() => applyUiFlags(snap(true, true), h.flags, { sfx: null })).not.toThrow();
    expect(h.flags).toEqual({ workMode: true, sfxMuted: true });
  });
});
