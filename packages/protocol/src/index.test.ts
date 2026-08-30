import { describe, expect, it } from 'vitest';
import {
  ArbTraceSchema,
  CLOCK_PHASES,
  Channels,
  ClockPhaseSchema,
  EMOTIONS,
  EmotionSchema,
  ErrorCodeSchema,
  HIT_PARTS,
  HistoryRowSchema,
  HitPartSchema,
  LANES,
  LANE_RESULTS,
  LANE_SOURCES,
  LANE_TTL_MAX_MS,
  LIVELINESS_MAX,
  LIVELINESS_MIN,
  LIVELINESS_PRESETS,
  LOOK_ANCHORS,
  LandingSchema,
  LaneResultSchema,
  LaneSchema,
  LaneSourceSchema,
  LintResultSchema,
  LintRuleSchema,
  LintSeveritySchema,
  LookAnchorSchema,
  LookTargetSchema,
  MAIN_TO_PET,
  MessageKindSchema,
  PAUSE_MAX_S,
  PERSONA_MODES_IPC,
  PRESENCE_STATES,
  PRESENTATION_MODES,
  PROACTIVE_BUCKETS,
  PROACTIVE_VERDICTS,
  PersonaModeIpcSchema,
  PresenceSchema,
  PresentationModeSchema,
  ProactiveBucketSchema,
  ProactiveVerdictSchema,
  RoleSchema,
  SAY_MAX_GRAPHEMES,
  SIM_EVENT_KINDS,
  Schemas,
  SentenceEventSchema,
  SideSchema,
  SimEventKindSchema,
  SimSnapshotSchema,
  TurnStateSchema,
  UsageSchema,
  WALK_ANCHORS,
  WalkAnchorSchema,
  isEmotion,
  parseEvent,
} from './index.ts';

describe('protocol', () => {
  it('accepts a valid gaze:cursor event', () => {
    const r = parseEvent(Channels.gazeCursor, { x: 10, y: -3.5 });
    expect(r).toEqual({ ok: true, data: { x: 10, y: -3.5 } });
  });

  it('rejects an unknown channel', () => {
    const r = parseEvent('nope' as never, {});
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const r = parseEvent(Channels.avatarHover, { inside: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('carries debug:toggle main→renderer with an empty payload', () => {
    expect(MAIN_TO_PET).toContain(Channels.debugToggle);
    expect(parseEvent(Channels.debugToggle, {})).toEqual({ ok: true, data: {} });
  });
});

describe('numeric bounds', () => {
  it('accepts an ordinary avatar:drag delta', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: -12, dy: 7.5 })).toEqual({ ok: true, data: { dx: -12, dy: 7.5 } });
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['MAX_VALUE', Number.MAX_VALUE],
    ['over-bound', 4097],
    ['under-bound', -4097],
  ])('rejects avatar:drag dx = %s', (_label, value) => {
    expect(parseEvent(Channels.avatarDrag, { dx: value, dy: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.avatarDrag, { dx: 0, dy: value }).ok).toBe(false);
  });

  it('accepts avatar:drag exactly at the bound', () => {
    expect(parseEvent(Channels.avatarDrag, { dx: 4096, dy: -4096 }).ok).toBe(true);
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects non-finite gaze:cursor coordinates (%s)', (_label, value) => {
    expect(parseEvent(Channels.gazeCursor, { x: value, y: 0 }).ok).toBe(false);
    expect(parseEvent(Channels.gazeCursor, { x: 0, y: value }).ok).toBe(false);
  });

  it('keeps gaze:cursor unbounded in range — window-local coords go far outside the window', () => {
    expect(parseEvent(Channels.gazeCursor, { x: -8000, y: 12000 }).ok).toBe(true);
  });
});

describe('emotion vocabulary', () => {
  it('lists the nine control-grammar emotions in order', () => {
    expect(EMOTIONS).toEqual([
      'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral',
    ]);
  });

  it('accepts every listed emotion and rejects one that is not listed', () => {
    for (const e of EMOTIONS) expect(EmotionSchema.safeParse(e).success).toBe(true);
    expect(EmotionSchema.safeParse('joy').success).toBe(false);
  });

  it('narrows with isEmotion only for listed values', () => {
    expect(isEmotion('curious')).toBe(true);
    expect(isEmotion('joy')).toBe(false);
    expect(isEmotion('')).toBe(false);
  });
});

describe('brain-shared shapes', () => {
  it('parses a minimal sentence event and rejects an unlisted emotion', () => {
    expect(SentenceEventSchema.safeParse({ turnId: 't1', seq: 0, text: '你好', emotion: 'happy' })).toEqual({
      success: true,
      data: { turnId: 't1', seq: 0, text: '你好', emotion: 'happy' },
    });
    expect(SentenceEventSchema.safeParse({ turnId: 't1', seq: 0, text: '你好', emotion: 'joy' }).success).toBe(false);
  });

  it('pins every §2.2 vocabulary and record shape', () => {
    expect(TurnStateSchema.options).toEqual(['idle', 'thinking', 'speaking']);
    expect(ErrorCodeSchema.options).toEqual([
      'auth', 'balance', 'rate', 'server', 'network', 'timeout', 'empty', 'no-key', 'storage',
    ]);
    expect(LintSeveritySchema.options).toEqual(['none', 'strip', 'regenerate']);
    expect(LintRuleSchema.options).toHaveLength(15);
    expect(MessageKindSchema.options).toEqual(['chat', 'proactive', 'system']);
    expect(RoleSchema.options).toEqual(['user', 'assistant']);
    expect(SideSchema.options).toEqual(['top', 'right', 'bottom', 'left']);

    expect(UsageSchema.safeParse({ promptTokens: 812, cacheHit: 768, cacheMiss: 44, completionTokens: 57 }).success).toBe(true);
    expect(UsageSchema.safeParse({ promptTokens: 1.5, cacheHit: 0, cacheMiss: 0, completionTokens: 0 }).success).toBe(false);

    expect(LintResultSchema.safeParse({ violations: [{ rule: 'repetition', detail: 'same opener' }], severity: 'regenerate' }).success).toBe(true);
    expect(LintResultSchema.safeParse({ violations: [{ rule: 'nope', detail: 'x' }], severity: 'none' }).success).toBe(false);

    expect(HistoryRowSchema.safeParse({ id: 1, ts: 1756400000000, role: 'assistant', content: '嗯', turnId: null, kind: 'chat', interrupted: false }).success).toBe(true);
    expect(HistoryRowSchema.safeParse({ id: 0, ts: 1756400000000, role: 'assistant', content: '嗯', turnId: null, kind: 'chat', interrupted: false }).success).toBe(false);
  });
});

describe('SentenceEventSchema pause bound (I-5)', () => {
  const base = { turnId: 't', seq: 0, text: '好', emotion: 'neutral' };
  it('accepts a pause at the bound and rejects one beyond it', () => {
    expect(PAUSE_MAX_S).toBe(3);
    expect(SentenceEventSchema.safeParse({ ...base, pause: PAUSE_MAX_S }).success).toBe(true);
    expect(SentenceEventSchema.safeParse({ ...base, pause: PAUSE_MAX_S + 0.001 }).success).toBe(false);
    expect(SentenceEventSchema.safeParse({ ...base, pause: 100000 }).success).toBe(false);
  });
});

describe('Phase 3 constants (contracts §2.1)', () => {
  it('pins liveliness bounds and the three presets (R3-13, D12 "default quiet")', () => {
    expect(LIVELINESS_MIN).toBe(0);
    expect(LIVELINESS_MAX).toBe(1);
    expect(LIVELINESS_PRESETS).toEqual({ quiet: 0.15, default: 0.30, lively: 0.70 });
  });

  it('pins every enum vocabulary in order, and each schema is built from its array', () => {
    expect(CLOCK_PHASES).toEqual(['morning', 'day', 'evening', 'night']);
    expect(ClockPhaseSchema.options).toEqual([...CLOCK_PHASES]);
    expect(PRESENCE_STATES).toEqual(['active', 'idle-present', 'absent']);
    expect(PresenceSchema.options).toEqual([...PRESENCE_STATES]);
    expect(PRESENTATION_MODES).toEqual(['awake', 'nap', 'sleep']);
    expect(PresentationModeSchema.options).toEqual([...PRESENTATION_MODES]);
    expect(LANES).toEqual(['body', 'expression', 'gaze', 'locomotion', 'speech']);
    expect(LaneSchema.options).toEqual([...LANES]);
    expect(LANE_SOURCES).toEqual(['touch', 'llm', 'behaviour', 'drag', 'sim', 'idle']);
    expect(LaneSourceSchema.options).toEqual([...LANE_SOURCES]);
    expect(LANE_RESULTS).toEqual(['completed', 'expired', 'preempted', 'cancelled', 'renderer_lost']);
    expect(LaneResultSchema.options).toEqual([...LANE_RESULTS]);
    expect(HIT_PARTS).toEqual(['head', 'face', 'hair', 'body', 'arm', 'ticklish']);
    expect(HitPartSchema.options).toEqual([...HIT_PARTS]);
    expect(LOOK_ANCHORS).toEqual(['cursor', 'user', 'away', 'up', 'down', 'left', 'right', 'screen']);
    expect(LookAnchorSchema.options).toEqual([...LOOK_ANCHORS]);
    expect(WALK_ANCHORS).toEqual(['left', 'right', 'center', 'corner-bl', 'corner-br', 'home']);
    expect(WalkAnchorSchema.options).toEqual([...WALK_ANCHORS]);
    expect(PERSONA_MODES_IPC).toEqual(['character', 'plain']);
    expect(PersonaModeIpcSchema.options).toEqual([...PERSONA_MODES_IPC]);
    expect(SIM_EVENT_KINDS).toEqual([
      'returned', 'phaseChanged', 'mealCue', 'annoyed', 'typingGlance', 'cheer',
      'batteryLow', 'onCharger', 'cursorWiggle', 'wake',
    ]);
    expect(SimEventKindSchema.options).toEqual([...SIM_EVENT_KINDS]);
    expect(PROACTIVE_BUCKETS).toEqual(['greeting', 'night', 'meal', 'longGap', 'callback', 'world']);
    expect(ProactiveBucketSchema.options).toEqual([...PROACTIVE_BUCKETS]);
    expect(PROACTIVE_VERDICTS).toEqual([
      'eligible', 'rateLimited', 'unansweredCap', 'personaCap', 'suppressed', 'deferred',
      'discarded', 'displayed', 'muted',
    ]);
    expect(ProactiveVerdictSchema.options).toEqual([...PROACTIVE_VERDICTS]);
  });

  it('pins the two scalar bounds', () => {
    expect(SAY_MAX_GRAPHEMES).toBe(120);
    expect(LANE_TTL_MAX_MS).toBe(90_000);
  });
});

describe('SimSnapshotSchema (contracts §2.4)', () => {
  const snap = {
    tsMain: 1000, presence: 'active', presentationMode: 'awake', phase: 'day', valence: 0, arousal: 0.5,
    energy: 50, affection: 0, liveliness: 0.3, userIdleS: 0, probableTyping: false, cursorNear: false,
    onFloor: true, nearEdge: false, dnd: false, battery: { charging: false, level: null }, mode: 'character',
    uiWorkMode: false, uiSfxMuted: false, localDate: '2026-08-30',
  };

  it('accepts the broadcast subset and rejects each out-of-range field', () => {
    expect(SimSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(SimSnapshotSchema.safeParse({ ...snap, valence: -1.01 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, arousal: 1.01 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, energy: 101 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, affection: -1 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, liveliness: 1.5 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, userIdleS: 3601 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, battery: { charging: true, level: 1.1 } }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, localDate: '2026-8-30' }).success).toBe(false);
  });

  it('carries the two tray toggles as required booleans (R3-35 / A3-1)', () => {
    // kv keys `ui_work_mode` (§5.9) and `ui_sfx_muted` (§5.12) reach the pet renderer only here.
    expect(SimSnapshotSchema.safeParse({ ...snap, uiWorkMode: true, uiSfxMuted: true }).success).toBe(true);
    expect(SimSnapshotSchema.safeParse({ ...snap, uiWorkMode: 1 }).success).toBe(false);
    expect(SimSnapshotSchema.safeParse({ ...snap, uiSfxMuted: 'yes' }).success).toBe(false);
    const { uiWorkMode: _w, ...noWorkMode } = snap;
    expect(SimSnapshotSchema.safeParse(noWorkMode).success).toBe(false);
    const { uiSfxMuted: _s, ...noSfxMuted } = snap;
    expect(SimSnapshotSchema.safeParse(noSfxMuted).success).toBe(false);
  });

  it('never carries reducer-private fields (rng state, ledger counters, reservation)', () => {
    expect(Object.keys(SimSnapshotSchema.shape).sort()).toEqual([
      'affection', 'arousal', 'battery', 'cursorNear', 'dnd', 'energy', 'liveliness', 'localDate', 'mode',
      'nearEdge', 'onFloor', 'phase', 'presence', 'presentationMode', 'probableTyping', 'tsMain',
      'uiSfxMuted', 'uiWorkMode', 'userIdleS', 'valence',
    ]);
  });
});

describe('LandingSchema.impulse (contracts §2.4, §5.13 FLING_VELOCITY_CAP mirror)', () => {
  const base = { generation: 0, tsMain: 0, edge: 'floor' as const };
  it('accepts 0 and 2400, rejects 2400.01 and negatives', () => {
    expect(LandingSchema.safeParse({ ...base, impulse: 0 }).success).toBe(true);
    expect(LandingSchema.safeParse({ ...base, impulse: 2400 }).success).toBe(true);
    expect(LandingSchema.safeParse({ ...base, impulse: 2400.01 }).success).toBe(false);
    expect(LandingSchema.safeParse({ ...base, impulse: -1 }).success).toBe(false);
  });
});

describe('ArbTraceSchema per-kind shapes (contracts §2.4, §12.2)', () => {
  // The renderer's eight kinds, each with EXACTLY the fields §2.4 assigns it. A field with no
  // meaning for a kind is omitted, never null. Main-written kinds (touch, motion, landing, presence,
  // visibility, proactive, mode, resource) never appear on arb:trace.
  const nul = { lane: null, source: null, generation: null, result: null, value: null };
  const SHAPES: Array<[string, Record<string, unknown>]> = [
    ['behaviourStart', { tsRenderer: 1, kind: 'behaviourStart', ...nul, id: 'stretch', durationMs: 12_000,
      eligible: ['stretch', 'yawn'], weights: [1, 0.5], seed: 42, bagSize: 9 }],
    ['behaviourEnd', { tsRenderer: 2, kind: 'behaviourEnd', ...nul, id: 'stretch', result: 'completed' }],
    ['laneGrant', { tsRenderer: 3, kind: 'laneGrant', ...nul, lane: 'body', source: 'llm', generation: 7,
      id: 'nod', ttlMs: 4000 }],
    ['laneResult', { tsRenderer: 4, kind: 'laneResult', ...nul, lane: 'body', source: 'llm', generation: 7,
      id: '', result: 'preempted' }],
    ['gazeBreak', { tsRenderer: 5, kind: 'gazeBreak', ...nul, id: '', label: 'saccade', value: 18 }],
    ['blink', { tsRenderer: 6, kind: 'blink', ...nul, id: '', flag: true }],
    ['hoverAck', { tsRenderer: 7, kind: 'hoverAck', ...nul, id: '', label: 'glance' }],
    ['fps', { tsRenderer: 8, kind: 'fps', ...nul, id: '', value: 59.8, value2: 16.7 }],
  ];

  it.each(SHAPES)('accepts the canonical %s record', (_kind, rec) => {
    expect(ArbTraceSchema.safeParse(rec).success).toBe(true);
  });

  it('pins the eight renderer kinds and rejects main-written and deleted kinds', () => {
    expect(ArbTraceSchema.shape.kind.options).toEqual([
      'behaviourStart', 'behaviourEnd', 'laneGrant', 'laneResult', 'gazeBreak', 'blink', 'hoverAck', 'fps',
    ]);
    for (const k of ['touch', 'motion', 'landing', 'presence', 'visibility', 'proactive', 'mode', 'resource', 'dragVisual']) {
      expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: k, ...nul, id: '' }).success).toBe(false);
    }
  });

  it('rejects null in an optional slot — omission is the only absent form', () => {
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'blink', ...nul, id: '', flag: null }).success).toBe(false);
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'fps', ...nul, id: '', value: 60, value2: null }).success).toBe(false);
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'behaviourStart', ...nul, id: 'x', eligible: null }).success).toBe(false);
  });

  it('bounds the diagnostic arrays and text slots', () => {
    const many = Array.from({ length: 65 }, (_, i) => `b${i}`);
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'behaviourStart', ...nul, id: 'x', eligible: many }).success).toBe(false);
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'behaviourStart', ...nul, id: 'x'.repeat(65) }).success).toBe(false);
    expect(ArbTraceSchema.safeParse({ tsRenderer: 0, kind: 'hoverAck', ...nul, id: '', label: 'y'.repeat(25) }).success).toBe(false);
  });
});

describe('SentenceEventSchema is additive in Phase 3 (contracts §2.6)', () => {
  const p2 = { turnId: 't1', seq: 0, text: '你回来啦！', emotion: 'happy', motion: 'nod', pause: 1.5 };

  it('still parses every Phase 2 payload shape unchanged', () => {
    expect(SentenceEventSchema.safeParse({ turnId: 't1', seq: 0, text: '你好', emotion: 'happy' })).toEqual({
      success: true,
      data: { turnId: 't1', seq: 0, text: '你好', emotion: 'happy' },
    });
    expect(SentenceEventSchema.safeParse(p2)).toEqual({ success: true, data: p2 });
    expect(parseEvent(Channels.brainSentence, p2).ok).toBe(true);
  });

  it('accepts look as an anchor or a point, and walkTo as an anchor only', () => {
    expect(SentenceEventSchema.safeParse({ ...p2, look: { kind: 'anchor', anchor: 'cursor' } }).success).toBe(true);
    expect(SentenceEventSchema.safeParse({ ...p2, look: { kind: 'point', x: -0.75, y: -0.5 } }).success).toBe(true);
    expect(SentenceEventSchema.safeParse({ ...p2, look: { kind: 'point', x: 1.01, y: 0 } }).success).toBe(false);
    expect(SentenceEventSchema.safeParse({ ...p2, look: { kind: 'anchor', anchor: 'behind' } }).success).toBe(false);
    expect(SentenceEventSchema.safeParse({ ...p2, look: 'cursor' }).success).toBe(false);
    expect(SentenceEventSchema.safeParse({ ...p2, walkTo: 'corner-br' }).success).toBe(true);
    expect(SentenceEventSchema.safeParse({ ...p2, walkTo: { x: 0, y: 0 } }).success).toBe(false);
    expect(SentenceEventSchema.safeParse({ ...p2, walkTo: 'nowhere' }).success).toBe(false);
  });

  it('keeps the pause bound and adds exactly two keys', () => {
    expect(SentenceEventSchema.safeParse({ ...p2, pause: PAUSE_MAX_S + 0.001 }).success).toBe(false);
    expect(Object.keys(SentenceEventSchema.shape)).toEqual(['turnId', 'seq', 'text', 'emotion', 'motion', 'pause', 'look', 'walkTo']);
  });

  it('LookTargetSchema is the discriminated pair §2.6 writes', () => {
    expect(LookTargetSchema.safeParse({ kind: 'anchor', anchor: 'screen' }).success).toBe(true);
    expect(LookTargetSchema.safeParse({ kind: 'point', x: 1, y: -1 }).success).toBe(true);
    expect(LookTargetSchema.safeParse({ kind: 'point', x: 1 }).success).toBe(false);
  });
});

describe('Phase 3 Schemas rows (contracts §2.4)', () => {
  it('maps each new channel to its named schema object', () => {
    expect(Schemas[Channels.simState]).toBe(SimSnapshotSchema);
    expect(Schemas[Channels.simLanding]).toBe(LandingSchema);
    expect(Schemas[Channels.arbTrace]).toBe(ArbTraceSchema);
  });
});
