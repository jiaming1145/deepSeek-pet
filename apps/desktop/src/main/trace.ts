import { appendFileSync, renameSync, statSync } from 'node:fs';
import type {
  Channels, ClockPhase, HitPart, Landing, Payload, PersonaModeIpc, Presence, PresentationMode,
  ProactiveBucket, ProactiveVerdict, WindowMotion,
} from '@ds/protocol';
import type { VisibilityReason } from './visibility-state';

/** §12.2: the 16 record types — the 8 renderer kinds of `ArbTraceSchema` plus the 8 main-written ones. */
export const TRACE_KINDS = [
  'presence', 'visibility', 'behaviourStart', 'behaviourEnd', 'laneGrant', 'laneResult',
  'gazeBreak', 'blink', 'hoverAck', 'touch', 'motion', 'landing', 'proactive',
  'mode', 'fps', 'resource',
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export interface TraceLine {
  /** Main monotonic ms since the trace opened. */
  m: number;
  /** Wall clock, epoch ms. */
  w: number;
  /** Renderer monotonic ms, present only on records that came over `arb:trace`. */
  r?: number;
  /** Record type. */
  t: TraceKind;
  [k: string]: unknown; // the per-type payload (§12.2 table)
}

type ArbTrace = Payload<typeof Channels.arbTrace>;
type ModeChanged = Payload<typeof Channels.modeChanged>;

/**
 * §12.2's payload table, one row per kind. The writer does NOT filter or sanitise: a field that is
 * not in the table fails `trace.test.ts`'s allow-list by existing, which is the point (R3-15).
 * NEVER add user text, assistant text, fact values, summary text, titles, exe paths or keys.
 */
export interface TracePayloads {
  presence: {
    presence: Presence; presentationMode: PresentationMode; phase: ClockPhase; inputAgeMs: number;
    probableTyping: boolean; valence: number; arousal: number; energy: number; affection: number; liveliness: number;
  };
  visibility: { hidden: boolean; reason: VisibilityReason };
  behaviourStart: { id: string; durationMs?: number; eligible?: string[]; weights?: number[]; seed?: number; bagSize?: number };
  behaviourEnd: { id: string; result: ArbTrace['result'] };
  laneGrant: { lane: ArbTrace['lane']; source: ArbTrace['source']; generation: number | null; id: string; ttlMs?: number };
  laneResult: { lane: ArbTrace['lane']; source: ArbTrace['source']; generation: number | null; result: ArbTrace['result'] };
  gazeBreak: { type?: string; deg: number | null };
  blink: { doublet?: boolean };
  hoverAck: { state?: string };
  touch: { part: HitPart; alpha: number; burst: number; annoyed: boolean };
  motion: { phase: WindowMotion['phase']; generation: number; vx: number; vy: number; lagX: number; lagY: number; clamped: boolean };
  landing: { generation: number; impulse: number; edge: Landing['edge'] };
  proactive: {
    verdict: ProactiveVerdict; reason: string; templateId: string; bucket: ProactiveBucket;
    reservationId: string; displayedToday: number; unansweredToday: number;
  };
  mode: { mode: PersonaModeIpc; reason: ModeChanged['reason'] };
  fps: { fps: number | null; frameMs?: number };
  /** Written by SimService at 1 Hz, ONLY when DS_TRACE_RESOURCE=1 (the writer enforces the gate). */
  resource: { privateWorkingSetMb: number; privateCommitMb: number; cpuPct: number; processes: number };
}

export const TRACE_FLUSH_MS = 200;
export const TRACE_FLUSH_LINES = 256;
export const TRACE_ROTATE_BYTES = 32 * 1024 * 1024;

/** The three file operations, injectable so the tests drive the real writer without a disk. */
export interface TraceIo {
  append(path: string, data: string): void;
  /** Current size of `path` in bytes, 0 when absent. */
  size(path: string): number;
  /** Moves `path` aside (to `<path>.1`, replacing any previous one). */
  rotate(path: string): void;
}

const nodeIo: TraceIo = {
  append: (path, data) => appendFileSync(path, data, 'utf8'),
  size: (path) => { try { return statSync(path).size; } catch { return 0; } },
  rotate: (path) => {
    try { renameSync(path, `${path}.1`); } catch (err) { console.warn('[trace] rotate failed:', err); }
  },
};

export interface TraceWriterOptions {
  /** `DS_TRACE`; `null` makes every method a no-op so production pays nothing. */
  path: string | null;
  /** `DS_TRACE_RESOURCE=1`. */
  resource?: boolean;
  nowMono?: () => number;
  nowWall?: () => number;
  io?: TraceIo;
}

const hrtimeMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

/**
 * Renderer record → §12.2 payload. Only the fields that mean something for the kind are copied;
 * a `null` slot the schema had to carry (`lane: null` on a blink) is never written (§2.4).
 */
export function projectRendererTrace(rec: ArbTrace): TracePayloads[ArbTrace['kind']] {
  switch (rec.kind) {
    case 'behaviourStart':
      return omitUndefined({ id: rec.id, durationMs: rec.durationMs, eligible: rec.eligible, weights: rec.weights, seed: rec.seed, bagSize: rec.bagSize });
    case 'behaviourEnd':
      return { id: rec.id, result: rec.result };
    case 'laneGrant':
      return omitUndefined({ lane: rec.lane, source: rec.source, generation: rec.generation, id: rec.id, ttlMs: rec.ttlMs });
    case 'laneResult':
      return { lane: rec.lane, source: rec.source, generation: rec.generation, result: rec.result };
    case 'gazeBreak':
      return omitUndefined({ type: rec.label, deg: rec.value });
    case 'blink':
      return omitUndefined({ doublet: rec.flag });
    case 'hoverAck':
      return omitUndefined({ state: rec.label });
    case 'fps':
      return omitUndefined({ fps: rec.value, frameMs: rec.value2 });
  }
}

function omitUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * §12.2: one JSON object per line under `DS_TRACE=<path>`. Main stamps `m` (its own monotonic
 * clock, ms since the trace opened) and `w` (wall); renderer records keep their `tsRenderer` as
 * `r` and are never rebased — the two clocks sit side by side, never compared (R3-3).
 * Bounded buffer: flushed every TRACE_FLUSH_MS or at TRACE_FLUSH_LINES; rotated at TRACE_ROTATE_BYTES.
 */
export class TraceWriter {
  static fromEnv(env: NodeJS.ProcessEnv = process.env): TraceWriter {
    const path = env.DS_TRACE?.trim() || null;
    return new TraceWriter({ path, resource: env.DS_TRACE_RESOURCE === '1' });
  }

  readonly path: string | null;
  readonly enabled: boolean;
  readonly resourceEnabled: boolean;
  private readonly io: TraceIo;
  private readonly nowMono: () => number;
  private readonly nowWall: () => number;
  private readonly openedAt: number;
  private buf: string[] = [];
  private bytes: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(opts: TraceWriterOptions) {
    this.path = opts.path;
    this.enabled = opts.path !== null;
    this.resourceEnabled = this.enabled && opts.resource === true;
    this.io = opts.io ?? nodeIo;
    this.nowMono = opts.nowMono ?? hrtimeMs;
    this.nowWall = opts.nowWall ?? Date.now;
    this.openedAt = this.enabled ? this.nowMono() : 0;
    this.bytes = this.enabled && this.path ? this.io.size(this.path) : 0;
  }

  write<K extends TraceKind>(t: K, payload: TracePayloads[K]): void {
    if (!this.enabled || this.closed) return;
    if (t === 'resource' && !this.resourceEnabled) return;
    this.push({ m: this.nowMono() - this.openedAt, w: this.nowWall(), t, ...payload });
  }

  writeRenderer(rec: ArbTrace): void {
    if (!this.enabled || this.closed) return;
    this.push({ m: this.nowMono() - this.openedAt, w: this.nowWall(), r: rec.tsRenderer, t: rec.kind, ...projectRendererTrace(rec) });
  }

  flush(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.enabled || this.path === null || this.buf.length === 0) return;
    const data = `${this.buf.join('\n')}\n`;
    this.buf = [];
    if (this.bytes + data.length > TRACE_ROTATE_BYTES) {
      this.io.rotate(this.path);
      this.bytes = 0;
    }
    try {
      this.io.append(this.path, data);
      this.bytes += data.length;
    } catch (err) {
      console.warn('[trace] append failed:', err);
    }
  }

  close(): void {
    this.flush();
    this.closed = true;
  }

  private push(line: TraceLine): void {
    this.buf.push(JSON.stringify(line));
    if (this.buf.length >= TRACE_FLUSH_LINES) { this.flush(); return; }
    if (this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, TRACE_FLUSH_MS);
      this.timer.unref?.();
    }
  }
}
