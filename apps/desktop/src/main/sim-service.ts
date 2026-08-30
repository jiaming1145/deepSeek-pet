import type { BrowserWindow } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { Channels, SimSnapshotSchema, type SimSnapshot } from '@ds/protocol';
import type { StatePreamble } from '@ds/brain';
import { getKv, setKv } from '@ds/memory';
import {
  SIM_DEFAULTS, SimPersistedSchema, affectionShown, energyOf, fromPersisted, initialSimState,
  reduceWithEffects, toPersisted, toSnapshot, type SimEffect, type SimEvent, type SimState,
} from '@ds/sim';
import type { Rect } from './foreground';
import type { ActivitySensor } from './activity-sensor';
import { sendTo } from './ipc';

// §8.1's reserved kv keys owned by SimService (+ the two it only READS at start).
export const KV_SIM_SNAPSHOT = 'sim_snapshot';
export const KV_SIM_AFFECTION = 'sim_affection';
export const KV_SIM_DAYS_SEEN = 'sim_days_seen';
export const KV_SIM_LIVELINESS = 'sim_liveliness';
export const KV_SIM_PHASES = 'sim_phases';
export const KV_SIM_PROACTIVE_MUTED = 'sim_proactive_muted';

/** CONTRACT GAP: §3.3 gives `onFloor` no tolerance; 2 DIP mirrors foreground.ts's rounding slack. */
export const ON_FLOOR_TOLERANCE_DIP = 2;
/** §12.2: the `resource` record is 1 Hz; the tick is 2 Hz. */
export const RESOURCE_EVERY_N_TICKS = 2;

// Verbatim from brain-service.ts:46-47 so `preamble()` formats exactly as BrainService.state() did.
const TIME_FMT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const WEEKDAY_FMT = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });

/** §12.2 `presence` / `resource` payloads; `m`/`w` are stamped by the TraceWriter, not here. */
export type SimTraceRecord =
  | { t: 'presence'; presence: string; presentationMode: string; phase: string; inputAgeMs: number;
      probableTyping: boolean; valence: number; arousal: number; energy: number; affection: number;
      liveliness: number }
  | { t: 'resource'; privateWorkingSetMb: number; privateCommitMb: number; cpuPct: number; processes: number };

export interface SimServiceDeps {
  pet: BrowserWindow;
  bubble: BrowserWindow;
  db: DatabaseSync;
  sensor: ActivitySensor;                       // §10
  petBounds(): Rect;                            // for cursorNear / onFloor / nearEdge
  workArea(): Rect;
  /** Injected clocks. Tests pass fakes; production passes the two below. */
  nowMono?: () => number;                       // default () => Number(process.hrtime.bigint() / 1_000_000n)
  nowWall?: () => number;                       // default Date.now
  seed?: number;
  /**
   * CONTRACT GAP: §3.11's deps carry no trace port although §12.2 makes SimService the producer of
   * `presence` and `resource`. index.ts (Task 17) passes `(r) => traceWriter.write(r)`.
   */
  trace?: (record: SimTraceRecord) => void;
  /** §12.2 resource sampler, read only under DS_TRACE_RESOURCE=1. index.ts composes it from
   *  app.getAppMetrics() (pids + summed cpu.percentCPUUsage) and Task 7's sampleTreeMemory. */
  resources?: () => { privateWorkingSetMb: number; privateCommitMb: number; processes: number; cpuPct: number };
}

const SNAPSHOT_KEYS = (Object.keys(SimSnapshotSchema.shape) as (keyof SimSnapshot)[])
  .filter((k) => k !== 'tsMain');

/** Field-by-field (§3.11); `battery` is the one nested object. `tsMain` is excluded on purpose. */
export function snapshotEquals(a: SimSnapshot, b: SimSnapshot): boolean {
  for (const k of SNAPSHOT_KEYS) {
    if (k === 'battery') {
      if (a.battery.charging !== b.battery.charging || a.battery.level !== b.battery.level) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}

function distanceToRect(p: { x: number; y: number }, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

function readMirror(raw: string | null, max: number, integer: boolean): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) return null;
  return n;
}

export class SimService {
  private state: SimState;
  private readonly nowMono: () => number;
  private readonly nowWall: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSent: SimSnapshot | null = null;
  private lastSentMono = -Infinity;
  private dirty = false;
  private tickN = 0;
  private readonly evalSubs = new Set<() => void>();
  /** R3-35 / A3-1: the tray's two UI booleans, relayed by index.ts. NOT reducer state — see below. */
  private uiWorkMode = false;
  private uiSfxMuted = false;
  private offWiggle: (() => void) | null = null;

  constructor(private readonly deps: SimServiceDeps) {
    this.nowMono = deps.nowMono ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
    this.nowWall = deps.nowWall ?? Date.now;
    this.state = initialSimState(this.nowMono(), this.nowWall(), { seed: deps.seed });
  }

  /** Reads kv, rebuilds state, starts the 2 Hz timer. (Stale-reservation recovery: see Concerns.) */
  start(): void {
    if (this.timer !== null) return;
    this.restore();
    this.broadcast(true);
    // R3-36 / A3-2: the wiggle predicate is the SENSOR's and changes no reducer state, so it is a
    // fan-out, not a dispatch — routing it through `reduceWithEffects` would need a `SimState` field
    // and an event for a notification the reducer has no opinion about. Radius, rate, ring, reversal
    // floor and the 20 s cooldown are all enforced in `activity-sensor.ts`.
    this.offWiggle = this.deps.sensor.onWiggle(() => {
      sendTo(this.deps.pet, Channels.simEvent, { kind: 'cursorWiggle', tsMain: this.nowMono() });
    });
    this.timer = setInterval(() => this.tick(), SIM_DEFAULTS.TICK_MS);
  }

  /** Dispatches immediately. Never queues to the next tick (R3-1). */
  dispatch(event: SimEvent): void {
    const { state, effects } = reduceWithEffects(this.state, event, this.nowMono(), this.nowWall());
    this.state = state;
    this.apply(effects);
    this.broadcast(false);
  }

  /**
   * The current broadcast subset — what `sim:state` carries.
   *
   * R3-35 / A3-1: `uiWorkMode` / `uiSfxMuted` are overlaid here rather than integrated by the
   * reducer. They are UI toggles read from kv (`ui_work_mode` / `ui_sfx_muted`), not sim state: the
   * reducer must never decay, settle or persist them, and `toSnapshot` (Task 9) emits their schema
   * defaults so this spread is the ONE place their live value enters the wire.
   */
  snapshot(): SimSnapshot {
    return {
      ...toSnapshot(this.state, this.nowMono(), this.nowWall()),
      uiWorkMode: this.uiWorkMode,
      uiSfxMuted: this.uiSfxMuted,
    };
  }

  /**
   * R3-35 / A3-1. Called by `index.ts` (Task 15) at startup with the kv values and again on every
   * 工作模式 / 静音 tray toggle. index.ts stays the writer of the two kv keys and the source of the
   * tray's getters; this is a broadcast mirror, not a second source of truth. An unchanged pair is
   * a no-op, so a right-click that rebuilds the menu never costs a `sim:state`.
   */
  setUiFlags(flags: { workMode: boolean; sfxMuted: boolean }): void {
    if (flags.workMode === this.uiWorkMode && flags.sfxMuted === this.uiSfxMuted) return;
    this.uiWorkMode = flags.workMode;
    this.uiSfxMuted = flags.sfxMuted;
    this.dirty = true;
    this.broadcast(false);   // sent now, or by the next tick if one landed inside TICK_MS
  }

  /** §3.11: the live preamble; `sinceLastChat` stays BrainService's (it owns the history store). */
  preamble(sinceLastChat: string): StatePreamble {
    const now = new Date(this.nowWall());
    return {
      localTime: TIME_FMT.format(now),
      weekday: WEEKDAY_FMT.format(now),
      mood: this.state.valence,
      energy: energyOf(this.state, this.nowWall()),
      affection: affectionShown(this.state),
      sinceLastChat,
    };
  }

  get liveliness(): number {
    return this.state.liveliness;
  }

  /** §3.11: on `stage:ready` the snapshot is re-sent unconditionally. */
  resend(): void {
    this.broadcast(true);
  }

  /** Relays the reducer's `proactiveEvaluate` effect to ProactiveController (Task 14). */
  onProactiveEvaluate(cb: () => void): () => void {
    this.evalSubs.add(cb);
    return () => { this.evalSubs.delete(cb); };
  }

  /** Flushes the kv snapshot and stops the timer. Awaited by the quit drain before db.close(). */
  async dispose(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.offWiggle?.();
    this.offWiggle = null;
    this.persist();
  }

  // ---- restore (§3.12) --------------------------------------------------------------------------
  private restore(): void {
    const { db } = this.deps;
    const nowMono = this.nowMono();
    const nowWall = this.nowWall();
    let restored: SimState | null = null;
    let reason: string | null = null;
    const raw = getKv(db, KV_SIM_SNAPSHOT);
    if (raw !== null) {
      try {
        const parsed = SimPersistedSchema.safeParse(JSON.parse(raw));
        if (parsed.success) restored = fromPersisted(parsed.data, nowMono, nowWall);
        else reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      } catch (err) {
        reason = String(err);
      }
    }
    if (restored) {
      this.state = restored;
    } else {
      if (reason !== null) console.warn('[sim] snapshot discarded:', reason);
      const base = initialSimState(nowMono, nowWall, { seed: this.deps.seed });
      // The one piece of state a corrupt snapshot must not silently reset (§3.12).
      const affection = readMirror(getKv(db, KV_SIM_AFFECTION), 100, false);
      const days = readMirror(getKv(db, KV_SIM_DAYS_SEEN), Number.MAX_SAFE_INTEGER, true);
      this.state = {
        ...base,
        affection: affection ?? base.affection,
        distinctDaysSeen: days ?? base.distinctDaysSeen,
      };
    }
    const liveliness = readMirror(getKv(db, KV_SIM_LIVELINESS), Number.POSITIVE_INFINITY, false);
    if (liveliness !== null) this.reduceOnly({ type: 'LIVELINESS', value: liveliness });   // reducer clamps (§3.5)
    const muted = getKv(db, KV_SIM_PROACTIVE_MUTED);
    if (muted !== null) {
      const until = muted === '' ? null : Number(muted);
      if (until === null || (Number.isFinite(until) && until >= 0)) this.reduceOnly({ type: 'PROACTIVE_MUTE', untilWall: until });
    }
    // CONTRACT GAP: §3.9 makes phase hours configurable through kv `sim_phases`, but
    // reduceWithEffects(state, event, nowMono, nowWall) has no parameter that could carry them.
    // The key is read and validated so a bad value is reported; it cannot reach phaseOf() yet.
    const phases = getKv(db, KV_SIM_PHASES);
    if (phases !== null) {
      try { JSON.parse(phases); } catch (err) { console.warn('[sim] sim_phases ignored:', String(err)); }
    }
  }

  /** Dispatch without broadcast, for the restore sequence (effects still apply, nothing is sent). */
  private reduceOnly(event: SimEvent): void {
    const { state, effects } = reduceWithEffects(this.state, event, this.nowMono(), this.nowWall());
    this.state = state;
    this.apply(effects.filter((e) => e.kind !== 'simEvent' && e.kind !== 'persist'));
  }

  // ---- tick (§3.3) ------------------------------------------------------------------------------
  private tick(): void {
    this.tickN++;
    const { sensor } = this.deps;
    const s = sensor.sample;
    const pet = this.deps.petBounds();
    const work = this.deps.workArea();
    const cursorNear = s.cursor !== null && distanceToRect(s.cursor, pet) <= SIM_DEFAULTS.CURSOR_NEAR_DIP;
    const onFloor = Math.abs((pet.y + pet.height) - (work.y + work.height)) <= ON_FLOOR_TOLERANCE_DIP;
    const nearEdge = pet.x - work.x <= SIM_DEFAULTS.NEAR_EDGE_DIP
      || (work.x + work.width) - (pet.x + pet.width) <= SIM_DEFAULTS.NEAR_EDGE_DIP;
    this.dispatch({
      type: 'TICK',
      // An unreadable age is reported as 0: the user is assumed PRESENT (no nap, no proactive —
      // layer 4's `recent-input` and `sensor-unknown` both refuse), the conservative side.
      inputAgeMs: s.inputAgeMs ?? 0,
      cursorDeltaDip: s.cursorDeltaDip ?? 0,
      cursorNear, onFloor, nearEdge,
    });
    if (process.env.DS_TRACE_RESOURCE === '1' && this.deps.resources && this.deps.trace
        && this.tickN % RESOURCE_EVERY_N_TICKS === 0) {
      try {
        const r = this.deps.resources();
        this.deps.trace({ t: 'resource', privateWorkingSetMb: r.privateWorkingSetMb,
          privateCommitMb: r.privateCommitMb, cpuPct: r.cpuPct, processes: r.processes });
      } catch (err) {
        console.warn('[sim] resource sample failed:', err);
      }
    }
  }

  // ---- effects and broadcast (§2.3, §3.11) ------------------------------------------------------
  private apply(effects: SimEffect[]): void {
    for (const e of effects) {
      switch (e.kind) {
        case 'simEvent':
          sendTo(this.deps.pet, Channels.simEvent, e.payload);      // immediate, un-coalesced
          break;
        case 'snapshotDirty':
          this.dirty = true;
          break;
        case 'persist':
          this.persist();
          break;
        case 'proactiveEvaluate':
          for (const cb of this.evalSubs) cb();
          break;
      }
    }
  }

  private broadcast(force: boolean): void {
    if (!force && !this.dirty) return;
    const now = this.nowMono();
    if (!force && now - this.lastSentMono < SIM_DEFAULTS.TICK_MS) return;   // the next tick will send it
    const snap = this.snapshot();
    if (!force && this.lastSent !== null && snapshotEquals(snap, this.lastSent)) {
      this.dirty = false;
      return;
    }
    sendTo(this.deps.pet, Channels.simState, snap);
    sendTo(this.deps.bubble, Channels.simState, snap);
    this.lastSent = snap;
    this.lastSentMono = now;
    this.dirty = false;
    this.deps.trace?.({
      t: 'presence', presence: snap.presence, presentationMode: snap.presentationMode, phase: snap.phase,
      inputAgeMs: this.state.inputAgeMs, probableTyping: snap.probableTyping, valence: snap.valence,
      arousal: snap.arousal, energy: snap.energy, affection: snap.affection, liveliness: snap.liveliness,
    });
  }

  // ---- persist (§3.12): snapshot + the two scalar mirrors, one transaction -----------------------
  private persist(): void {
    const { db } = this.deps;
    const p = toPersisted(this.state, this.nowMono(), this.nowWall());
    try {
      db.exec('BEGIN');
      try {
        setKv(db, KV_SIM_SNAPSHOT, JSON.stringify(p));
        setKv(db, KV_SIM_AFFECTION, String(this.state.affection));
        setKv(db, KV_SIM_DAYS_SEEN, String(this.state.distinctDaysSeen));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      console.warn('[sim] persist failed:', err);
    }
  }
}
