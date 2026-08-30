/**
 * §12.7 B-06 — "fling generation 7 in flight → grab() starts generation 8 → generation 7's landing
 * callback fires": generation 7's landing is IGNORED; no sim:landing for gen 7 after gen 8 exists;
 * position comes from generation 8 only.
 *
 * This file also hosts the fake-deps harness every motion fixture and window-motion.test.ts share.
 * It imports nothing from vitest: the timer driver is injected, so the same harness runs under
 * fake timers (unit lane) or a real clock.
 */
import type { BrowserWindow } from 'electron';
import type { Landing, WindowMotion } from '@ds/protocol';
import type { TracePayloads } from '../../../src/main/trace';
import { WindowMotionController } from '../../../src/main/window-motion';
import type { Rect } from '../../../src/main/window-state';

/** The two §12.2 records `WindowMotionController` is the Source of. */
export type MotionTrace =
  | { t: 'motion'; payload: TracePayloads['motion'] }
  | { t: 'landing'; payload: TracePayloads['landing'] };

export interface MotionHarnessOptions {
  pos: [number, number];
  areas: Rect[];
  /** Milliseconds one `frame()` advances the injected clock and the timer driver. */
  frameMs: number;
  /** Advances whatever timer implementation owns the motor's setInterval. */
  advance: (ms: number) => void;
}

export interface MotionHarness {
  ctl: WindowMotionController;
  clock: { t: number };
  areas: Rect[];
  sends: { channel: 'sim:windowMotion' | 'sim:landing'; payload: WindowMotion | Landing }[];
  clickThrough: boolean[];
  suspend: boolean[];
  persisted: [number, number][];
  positions: [number, number][];
  /** Every §12.2 record the controller wrote, in order (the `trace` dep Task 15 wires to TraceWriter). */
  traces: MotionTrace[];
  frame(n?: number): void;
  setCursor(x: number, y: number): void;
  cursor(): { x: number; y: number };
  position(): [number, number];
  setAreas(areas: Rect[]): void;
  motions(): WindowMotion[];
  landings(): Landing[];
  /** The `motion` trace records alone — the only place `clamped` is observable (B-07). */
  motionTraces(): TracePayloads['motion'][];
}

export function createMotionHarness(opts: MotionHarnessOptions): MotionHarness {
  const clock = { t: 0 };
  const state = { cursor: { x: 0, y: 0 }, areas: opts.areas, position: opts.pos, destroyed: false };
  const h: MotionHarness = {
    ctl: null as unknown as WindowMotionController,
    clock,
    get areas() { return state.areas; },
    sends: [],
    clickThrough: [],
    suspend: [],
    persisted: [],
    positions: [],
    traces: [],
    frame(n = 1) {
      for (let i = 0; i < n; i++) {
        clock.t += opts.frameMs;
        opts.advance(opts.frameMs);
      }
    },
    setCursor(x, y) { state.cursor = { x, y }; },
    cursor: () => ({ ...state.cursor }),
    position: () => [...state.position] as [number, number],
    setAreas(areas) { state.areas = areas; },
    motions: () => h.sends.filter((s) => s.channel === 'sim:windowMotion').map((s) => s.payload as WindowMotion),
    landings: () => h.sends.filter((s) => s.channel === 'sim:landing').map((s) => s.payload as Landing),
    motionTraces: () => h.traces.flatMap((r) => (r.t === 'motion' ? [r.payload] : [])),
  };
  const pet = { isDestroyed: () => state.destroyed, getPosition: () => [...state.position] as [number, number] };
  h.ctl = new WindowMotionController({
    pet: pet as unknown as BrowserWindow,
    cursor: () => ({ ...state.cursor }),
    workAreas: () => state.areas,
    workArea: () => state.areas[0],
    setPosition: (x, y) => { state.position = [x, y]; h.positions.push([x, y]); },
    setClickThrough: (ignore) => { h.clickThrough.push(ignore); },
    suspendHoverSwitching: (s) => { h.suspend.push(s); },
    send: (channel, payload) => { h.sends.push({ channel, payload }); },
    persist: (x, y) => { h.persisted.push([x, y]); },
    trace: (t, payload) => { h.traces.push({ t, payload } as MotionTrace); },
    now: () => clock.t,
  });
  return h;
}

export const B06 = {
  id: 'B-06',
  input: 'fling generation 7 in flight -> grab() starts generation 8 -> generation 7 landing would fire',
  expectedState: 'generation 7 landing ignored',
  emitted: 'no sim:landing for gen 7 after gen 8 exists; renderer drops it on generation mismatch',
  persisted: 'position from generation 8 only',
} as const;

/** Drives six grab/release rounds to reach generation 7, flings it, grabs mid-air (gen 8). */
export function runStaleGeneration(h: MotionHarness): {
  generationAfterGrab: number;
  landingsForGen7AfterGrab: number;
  positionsFromGen8Only: boolean;
} {
  for (let gen = 1; gen <= 6; gen++) {
    h.setCursor(700, 200);
    h.ctl.grab({ pressId: gen, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
    h.ctl.release({ pressId: gen, wasTap: true });
    h.frame(3);
  }
  // Generation 7: a real fling, thrown sideways from 220 DIP above the floor.
  h.setCursor(700, 200);
  h.ctl.grab({ pressId: 7, modelX: 0, modelY: 0, screenX: 700, screenY: 200 });
  for (let i = 0; i < 6; i++) { h.setCursor(h.cursor().x + 30, 200); h.frame(); }
  h.ctl.release({ pressId: 7, wasTap: false });
  h.frame(6); // ~100 ms: still airborne (fall time from 220 DIP is ~0.49 s)
  const landingsBefore = h.landings().length;
  // Generation 8 starts before generation 7 could land.
  h.setCursor(h.position()[0] + 100, h.position()[1] + 100);
  h.ctl.grab({ pressId: 8, modelX: 0, modelY: 0, screenX: h.cursor().x, screenY: h.cursor().y });
  const generationAfterGrab = h.ctl.generation;
  const writesAtGrab = h.positions.length;
  h.frame(120); // 2 s of generation 8's drag: long enough for 7's fall to have "completed"
  const landingsAfter = h.landings().filter((l) => l.generation === 7).length - landingsBefore;
  const positionsFromGen8Only = h.motions().slice(-1)[0]?.generation === 8
    && h.positions.length > writesAtGrab
    && h.motions().filter((m, i) => i >= h.motions().findIndex((x) => x.generation === 8)).every((m) => m.generation === 8);
  return { generationAfterGrab, landingsForGen7AfterGrab: Math.max(0, landingsAfter), positionsFromGen8Only };
}
