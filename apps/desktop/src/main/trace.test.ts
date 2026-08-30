import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels, parseEvent, type Payload } from '@ds/protocol';
import {
  TRACE_FLUSH_LINES, TRACE_FLUSH_MS, TRACE_KINDS, TRACE_ROTATE_BYTES, TraceWriter,
  type TraceIo, type TraceKind, type TraceLine,
} from './trace';

/**
 * §12.2's payload table, copied by hand — NOT imported from trace.ts, so a field added to the
 * writer cannot silently extend its own allow-list. Every emitted key must be `m|w|r|t` or in the
 * row for its `t`; an unknown key FAILS. This is the load-bearing guard (preflight F-3).
 */
const ALLOWED: Record<TraceKind, readonly string[]> = {
  presence: ['presence', 'presentationMode', 'phase', 'inputAgeMs', 'probableTyping', 'valence', 'arousal', 'energy', 'affection', 'liveliness'],
  visibility: ['hidden', 'reason'],
  behaviourStart: ['id', 'durationMs', 'eligible', 'weights', 'seed', 'bagSize'],
  behaviourEnd: ['id', 'result'],
  laneGrant: ['lane', 'source', 'generation', 'id', 'ttlMs'],
  laneResult: ['lane', 'source', 'generation', 'result'],
  gazeBreak: ['type', 'deg'],
  blink: ['doublet'],
  hoverAck: ['state'],
  touch: ['part', 'alpha', 'burst', 'annoyed'],
  motion: ['phase', 'generation', 'vx', 'vy', 'lagX', 'lagY', 'clamped'],
  landing: ['generation', 'impulse', 'edge'],
  proactive: ['verdict', 'reason', 'templateId', 'bucket', 'reservationId', 'displayedToday', 'unansweredToday'],
  mode: ['mode', 'reason'],
  fps: ['fps', 'frameMs'],
  resource: ['privateWorkingSetMb', 'privateCommitMb', 'cpuPct', 'processes'],
};
const ENVELOPE = ['m', 'w', 'r', 't'];

function unknownKeys(line: TraceLine): string[] {
  const allowed = new Set([...ENVELOPE, ...ALLOWED[line.t]]);
  return Object.keys(line).filter((k) => !allowed.has(k));
}

/** §12.2 guard 2 — cheap defence in depth, run over the SAME real-writer session as guard 1. */
const DENY = /^(?!.*(sk-|apiKey|title|\.exe|content|"text")).*$/;

class MemIo implements TraceIo {
  chunks: string[] = [];
  sizeValue = 0;
  rotated: string[] = [];
  append(_path: string, data: string): void { this.chunks.push(data); }
  size(): number { return this.sizeValue; }
  rotate(path: string): void { this.rotated.push(path); this.sizeValue = 0; }
  lines(): TraceLine[] {
    return this.chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TraceLine);
  }
}

function writer(io = new MemIo(), extra: Partial<ConstructorParameters<typeof TraceWriter>[0]> = {}) {
  let mono = 1000;
  const w = new TraceWriter({
    path: 'C:/tmp/trace.jsonl', io, nowMono: () => (mono += 7), nowWall: () => 1_700_000_000_000, ...extra,
  });
  return { w, io };
}

/** Recorded `arb:trace` payloads, one per renderer kind — validated by the real schema below. */
const RENDERER_RECORDS: Payload<typeof Channels.arbTrace>[] = [
  { tsRenderer: 12.5, kind: 'behaviourStart', lane: null, source: null, generation: null, id: 'stretch', result: null, eligible: ['stretch', 'hum', 'yawn'], weights: [1, 0.5, 0.8], seed: 42, value: null, durationMs: 8000, bagSize: 9 },
  { tsRenderer: 8012.5, kind: 'behaviourEnd', lane: null, source: null, generation: null, id: 'stretch', result: 'completed', value: null },
  { tsRenderer: 13, kind: 'laneGrant', lane: 'body', source: 'behaviour', generation: 3, id: 'haru_g_m15', result: null, value: null, ttlMs: 8000 },
  { tsRenderer: 8013, kind: 'laneResult', lane: 'body', source: 'behaviour', generation: 3, id: '', result: 'completed', value: null },
  { tsRenderer: 9000, kind: 'gazeBreak', lane: 'gaze', source: 'idle', generation: 1, id: '', result: null, value: 14, label: 'lookAwayBack' },
  { tsRenderer: 9500, kind: 'blink', lane: null, source: null, generation: null, id: '', result: null, value: null, flag: true },
  { tsRenderer: 9600, kind: 'hoverAck', lane: null, source: null, generation: null, id: '', result: null, value: null, label: 'acknowledging' },
  { tsRenderer: 10000, kind: 'fps', lane: null, source: null, generation: null, id: '', result: null, value: 30, value2: 16.7 },
];

/** A full session: every main-written kind once, every renderer kind once. */
function driveSession(w: TraceWriter): void {
  w.write('presence', { presence: 'active', presentationMode: 'awake', phase: 'day', inputAgeMs: 120, probableTyping: false, valence: 0.1, arousal: 0.4, energy: 70, affection: 12, liveliness: 0.3 });
  w.write('visibility', { hidden: false, reason: 'none' });
  w.write('touch', { part: 'head', alpha: 231, burst: 1, annoyed: false });
  w.write('motion', { phase: 'fling', generation: 7, vx: 880, vy: -120, lagX: 0, lagY: 0, clamped: false });
  w.write('landing', { generation: 7, impulse: 1210, edge: 'floor' });
  w.write('proactive', { verdict: 'suppressed', reason: 'typing', templateId: 'greeting_03', bucket: 'greeting', reservationId: 'r1', displayedToday: 0, unansweredToday: 0 });
  w.write('mode', { mode: 'plain', reason: 'command' });
  w.write('resource', { privateWorkingSetMb: 212.4, privateCommitMb: 301.9, cpuPct: 2.1, processes: 5 });
  for (const rec of RENDERER_RECORDS) w.writeRenderer(rec);
  w.flush();
}

describe('TraceWriter — §12.2 guards over a real-writer session', () => {
  it('the recorded renderer payloads are valid arb:trace records (the fixture is not hand-waved)', () => {
    for (const rec of RENDERER_RECORDS) {
      const r = parseEvent(Channels.arbTrace, rec);
      expect(r.ok, `${rec.kind}: ${r.ok ? '' : r.error}`).toBe(true);
    }
  });

  it('guard 1 (allow-list): every emitted key is m|w|r|t or in the §12.2 row for its t', () => {
    const { w, io } = writer(undefined, { resource: true });
    driveSession(w);
    const lines = io.lines();
    expect(new Set(lines.map((l) => l.t))).toEqual(new Set(TRACE_KINDS));
    for (const line of lines) expect(unknownKeys(line), `${line.t} leaked ${unknownKeys(line).join(',')}`).toEqual([]);
  });

  it('guard 1 has teeth: a payload that smuggles a text field fails by existing', () => {
    const { w, io } = writer();
    w.write('visibility', { hidden: false, reason: 'none', text: '你好' } as never);
    w.flush();
    expect(unknownKeys(io.lines()[0])).toEqual(['text']);
  });

  it('guard 2 (deny regex): no line of the session matches sk-|apiKey|title|.exe|content|"text"', () => {
    const { w, io } = writer(undefined, { resource: true });
    driveSession(w);
    for (const raw of io.chunks.join('').split('\n').filter(Boolean)) expect(raw).toMatch(DENY);
  });

  it('stamps m (monotonic since open) and w (wall) on main records, and passes r through untouched on renderer records', () => {
    const { w, io } = writer();
    w.write('visibility', { hidden: true, reason: 'locked' });
    w.writeRenderer(RENDERER_RECORDS[5]);
    w.flush();
    const [a, b] = io.lines();
    expect(a).toEqual({ m: 7, w: 1_700_000_000_000, t: 'visibility', hidden: true, reason: 'locked' });
    expect(b.r).toBe(9500);
    expect(b.m).toBe(14);
    expect(b.t).toBe('blink');
    expect(b.doublet).toBe(true);
  });

  it('renderer projection omits fields that have no meaning for the kind (behaviourStart carries no lane/source/generation/result)', () => {
    const { w, io } = writer();
    w.writeRenderer(RENDERER_RECORDS[0]);
    w.writeRenderer(RENDERER_RECORDS[4]);
    w.writeRenderer(RENDERER_RECORDS[7]);
    w.flush();
    const [start, gaze, fps] = io.lines();
    expect(Object.keys(start).sort()).toEqual(['bagSize', 'durationMs', 'eligible', 'id', 'm', 'r', 'seed', 't', 'w', 'weights']);
    expect(gaze).toMatchObject({ t: 'gazeBreak', type: 'lookAwayBack', deg: 14 });
    expect(fps).toMatchObject({ t: 'fps', fps: 30, frameMs: 16.7 });
  });
});

/**
 * R3-46 (controller ruling v2.4/v2.5). `ArbTraceSchema` stays ONE flat object with optional slots in
 * the protocol, so the protocol cannot say "a blink never carries durationMs". The per-kind
 * strictness assertion lives HERE, over the lines the writer actually emits: for every one of the
 * 16 kinds, the emitted line must carry exactly the fields §12.2's row lists as present, and must
 * NOT carry any field belonging to another kind's row. A blink record that arrives with
 * `durationMs` (legal per the flat schema) must therefore never reach the trace file.
 */
describe('§12.2 per-kind strictness (R3-46): present fields and absent fields, per kind', () => {
  /** Every payload field named anywhere in §12.2's table — the universe an absence is checked over. */
  const EVERY_FIELD = [...new Set(Object.values(ALLOWED).flat())];

  /** One emitted line per kind, driven through the REAL writer. */
  function emit(drive: (w: TraceWriter) => void): TraceLine {
    const { w, io } = writer(undefined, { resource: true });
    drive(w);
    w.flush();
    const lines = io.lines();
    expect(lines).toHaveLength(1);
    return lines[0];
  }

  /**
   * Per kind: [present fields, the driver]. `absent` is derived — every §12.2 field not in
   * `present` — so a new field in another kind's row is automatically checked here too (R3-51:
   * the derivation wins over a literal list).
   */
  const CASES: Array<[TraceKind, readonly string[], (w: TraceWriter) => void]> = [
    ['presence',
      ['presence', 'presentationMode', 'phase', 'inputAgeMs', 'probableTyping', 'valence', 'arousal', 'energy', 'affection', 'liveliness'],
      (w) => w.write('presence', { presence: 'active', presentationMode: 'awake', phase: 'day', inputAgeMs: 120, probableTyping: false, valence: 0.1, arousal: 0.4, energy: 70, affection: 12, liveliness: 0.3 })],
    ['visibility', ['hidden', 'reason'],
      (w) => w.write('visibility', { hidden: true, reason: 'locked' })],
    ['touch', ['part', 'alpha', 'burst', 'annoyed'],
      (w) => w.write('touch', { part: 'head', alpha: 231, burst: 1, annoyed: false })],
    ['motion', ['phase', 'generation', 'vx', 'vy', 'lagX', 'lagY', 'clamped'],
      (w) => w.write('motion', { phase: 'fling', generation: 7, vx: 880, vy: -120, lagX: 0, lagY: 0, clamped: false })],
    ['landing', ['generation', 'impulse', 'edge'],
      (w) => w.write('landing', { generation: 7, impulse: 1210, edge: 'floor' })],
    ['proactive',
      ['verdict', 'reason', 'templateId', 'bucket', 'reservationId', 'displayedToday', 'unansweredToday'],
      (w) => w.write('proactive', { verdict: 'displayed', reason: 'gate', templateId: 'night_01', bucket: 'night', reservationId: 'r9', displayedToday: 1, unansweredToday: 0 })],
    ['mode', ['mode', 'reason'],
      (w) => w.write('mode', { mode: 'character', reason: 'restored' })],
    ['resource', ['privateWorkingSetMb', 'privateCommitMb', 'cpuPct', 'processes'],
      (w) => w.write('resource', { privateWorkingSetMb: 212.4, privateCommitMb: 301.9, cpuPct: 2.1, processes: 5 })],
    ['behaviourStart', ['id', 'durationMs', 'eligible', 'weights', 'seed', 'bagSize'],
      (w) => w.writeRenderer(RENDERER_RECORDS[0])],
    ['behaviourEnd', ['id', 'result'], (w) => w.writeRenderer(RENDERER_RECORDS[1])],
    ['laneGrant', ['lane', 'source', 'generation', 'id', 'ttlMs'], (w) => w.writeRenderer(RENDERER_RECORDS[2])],
    ['laneResult', ['lane', 'source', 'generation', 'result'], (w) => w.writeRenderer(RENDERER_RECORDS[3])],
    ['gazeBreak', ['type', 'deg'], (w) => w.writeRenderer(RENDERER_RECORDS[4])],
    ['blink', ['doublet'], (w) => w.writeRenderer(RENDERER_RECORDS[5])],
    ['hoverAck', ['state'], (w) => w.writeRenderer(RENDERER_RECORDS[6])],
    ['fps', ['fps', 'frameMs'], (w) => w.writeRenderer(RENDERER_RECORDS[7])],
  ];

  it('covers every one of the 16 kinds exactly once', () => {
    expect(CASES.map(([k]) => k).sort()).toEqual([...TRACE_KINDS].sort());
  });

  it.each(CASES)('%s carries exactly its §12.2 row and nothing from any other row', (kind, present, drive) => {
    const line = emit(drive);
    expect(line.t).toBe(kind);
    expect(Object.keys(line).filter((k) => !ENVELOPE.includes(k)).sort()).toEqual([...present].sort());
    const absent = EVERY_FIELD.filter((f) => !present.includes(f));
    for (const field of absent) {
      expect(field in line, `${kind} must not carry ${field}`).toBe(false);
    }
  });

  it('a blink record that smuggles another kind\'s slots is projected without them', () => {
    const smuggled = {
      ...RENDERER_RECORDS[5],
      durationMs: 8000, bagSize: 9, ttlMs: 4000, value2: 16.7,
      eligible: ['stretch'], weights: [1], seed: 42, label: 'lookAwayBack',
    } satisfies Payload<typeof Channels.arbTrace>;
    // The flat protocol schema accepts it — that is exactly why the strictness lives here.
    expect(parseEvent(Channels.arbTrace, smuggled).ok).toBe(true);
    const line = emit((w) => w.writeRenderer(smuggled));
    expect(Object.keys(line).sort()).toEqual(['doublet', 'm', 'r', 't', 'w']);
  });
});

describe('TraceWriter — buffering, rotation, env', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op when DS_TRACE is unset: no io call, enabled=false', () => {
    const io = new MemIo();
    const w = new TraceWriter({ path: null, io });
    w.write('visibility', { hidden: false, reason: 'none' });
    w.flush();
    w.close();
    expect(w.enabled).toBe(false);
    expect(io.chunks).toEqual([]);
  });

  it('flushes after TRACE_FLUSH_MS (200) without an explicit flush', () => {
    const { w, io } = writer();
    w.write('visibility', { hidden: false, reason: 'none' });
    expect(io.chunks).toEqual([]);
    vi.advanceTimersByTime(TRACE_FLUSH_MS - 1);
    expect(io.chunks).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(io.lines()).toHaveLength(1);
  });

  it('flushes at TRACE_FLUSH_LINES (256) buffered lines, before the timer', () => {
    const { w, io } = writer();
    for (let i = 0; i < TRACE_FLUSH_LINES; i++) w.write('blink' as never, { doublet: false } as never);
    expect(io.lines()).toHaveLength(TRACE_FLUSH_LINES);
  });

  it('rotates once the file would exceed TRACE_ROTATE_BYTES (32 MB)', () => {
    const io = new MemIo();
    io.sizeValue = TRACE_ROTATE_BYTES - 10;
    const { w } = writer(io);
    w.write('visibility', { hidden: false, reason: 'none' });
    w.flush();
    expect(io.rotated).toEqual(['C:/tmp/trace.jsonl']);
    expect(io.lines()).toHaveLength(1);
  });

  it('drops resource records unless DS_TRACE_RESOURCE=1', () => {
    const off = writer();
    off.w.write('resource', { privateWorkingSetMb: 1, privateCommitMb: 1, cpuPct: 0, processes: 1 });
    off.w.flush();
    expect(off.io.chunks).toEqual([]);
    const on = writer(undefined, { resource: true });
    on.w.write('resource', { privateWorkingSetMb: 1, privateCommitMb: 1, cpuPct: 0, processes: 1 });
    on.w.flush();
    expect(on.io.lines()).toHaveLength(1);
  });

  it('fromEnv reads DS_TRACE and DS_TRACE_RESOURCE', () => {
    expect(TraceWriter.fromEnv({}).enabled).toBe(false);
    const w = TraceWriter.fromEnv({ DS_TRACE: 'C:/tmp/x.jsonl', DS_TRACE_RESOURCE: '1' });
    expect(w.enabled).toBe(true);
    expect(w.resourceEnabled).toBe(true);
    expect(w.path).toBe('C:/tmp/x.jsonl');
    w.close();
  });

  it('close() flushes what is buffered and later writes are ignored', () => {
    const { w, io } = writer();
    w.write('visibility', { hidden: false, reason: 'none' });
    w.close();
    expect(io.lines()).toHaveLength(1);
    w.write('visibility', { hidden: true, reason: 'user' });
    vi.advanceTimersByTime(TRACE_FLUSH_MS);
    expect(io.lines()).toHaveLength(1);
  });
});
