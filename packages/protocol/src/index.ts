import { z } from 'zod';

// ---------------------------------------------------------------------------
// Emotion vocabulary — the ONE definition (rulings D3). @ds/stage and @ds/brain
// import it from here and re-export it; each asserts identity in its own test.
// ---------------------------------------------------------------------------

export const EMOTIONS = [
  'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral',
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const EmotionSchema = z.enum(EMOTIONS);
export const isEmotion = (s: string): s is Emotion => (EMOTIONS as readonly string[]).includes(s);

// ---------------------------------------------------------------------------
// contracts.md §2.2 — the shapes shared by @ds/brain, @ds/memory and the
// brain:*/history:* IPC channels. They live here so the IPC schema and the
// package-level type can never drift. Task 6 adds the channel maps that use
// them (§2.3-§2.5) and the ERROR_HINTS table (§2.8); it adds nothing here.
// ---------------------------------------------------------------------------

export const TurnStateSchema = z.enum(['idle', 'thinking', 'speaking']);
export type TurnState = z.infer<typeof TurnStateSchema>;

/**
 * Upper bound, in seconds, of a `<|PAUSE n|>` beat (I-5). `@ds/brain` clamps in `parseTag`; the
 * schema mirrors it so a bubble can never be parked on an empty band by a runaway number.
 */
export const PAUSE_MAX_S = 3;

/** Symbolic gaze targets the LLM may name (D14 `look`). Never free coordinates from the model. */
export const LOOK_ANCHORS = ['cursor', 'user', 'away', 'up', 'down', 'left', 'right', 'screen'] as const;
export type LookAnchor = (typeof LOOK_ANCHORS)[number];
export const LookAnchorSchema = z.enum(LOOK_ANCHORS);

/** Symbolic locomotion anchors (D14 `walkTo`). Convai's `objects[].name` model: never coordinates. */
export const WALK_ANCHORS = ['left', 'right', 'center', 'corner-bl', 'corner-br', 'home'] as const;
export type WalkAnchor = (typeof WALK_ANCHORS)[number];
export const WalkAnchorSchema = z.enum(WALK_ANCHORS);

/** Phase 3 §2.6: the parsed `look=` attribute — an anchor, or a point in [-1,1]² (≤ 2 decimals at the parser). */
export const LookTargetSchema = z.union([
  z.object({ kind: z.literal('anchor'), anchor: LookAnchorSchema }),
  z.object({ kind: z.literal('point'), x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
]);
export type LookTarget = z.infer<typeof LookTargetSchema>;

export const SentenceEventSchema = z.object({
  turnId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  emotion: EmotionSchema,
  motion: z.string().optional(),
  pause: z.number().nonnegative().max(PAUSE_MAX_S).optional(),   // UNCHANGED from Phase 2
  look: LookTargetSchema.optional(),         // Phase 3 (D14)
  walkTo: WalkAnchorSchema.optional(),       // Phase 3 (D14)
});
export type SentenceEvent = z.infer<typeof SentenceEventSchema>;

export const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  cacheHit: z.number().int().nonnegative(),
  cacheMiss: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ErrorCodeSchema = z.enum(['auth', 'balance', 'rate', 'server', 'network', 'timeout', 'empty', 'no-key', 'storage']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const LintRuleSchema = z.enum([
  'assistant-leak', 'narrates-user', 'closing-moral', 'repetition', 'webnovel', 'opener-repeat',
  'rhetorical', 'question-streak', 'ellipsis', 'ellipsis-rate', 'affect-rate', 'markdown',
  'emoji', 'emoji-rate', 'emoji-sensitive',
]);
export const LintSeveritySchema = z.enum(['none', 'strip', 'regenerate']);
export const LintResultSchema = z.object({
  violations: z.array(z.object({ rule: LintRuleSchema, detail: z.string() })),
  severity: LintSeveritySchema,
});
export type LintRule = z.infer<typeof LintRuleSchema>;
export type LintSeverity = z.infer<typeof LintSeveritySchema>;
export type LintResult = z.infer<typeof LintResultSchema>;

export const MessageKindSchema = z.enum(['chat', 'proactive', 'system']);   // R10.3
export const RoleSchema = z.enum(['user', 'assistant']);

export const HistoryRowSchema = z.object({
  id: z.number().int().positive(),
  ts: z.number().int().nonnegative(),          // epoch ms
  role: RoleSchema,
  content: z.string(),
  turnId: z.string().nullable(),
  kind: MessageKindSchema,
  interrupted: z.boolean(),
});
export type HistoryRow = z.infer<typeof HistoryRowSchema>;

export const SideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type Side = z.infer<typeof SideSchema>;

// ---- Phase 3 (contracts 2026-08-30) ------------------------------------------------------

/** Liveliness (活泼度) is one normalised value with one mapping (R3-13). */
export const LIVELINESS_MIN = 0;
export const LIVELINESS_MAX = 1;
export const LIVELINESS_PRESETS = { quiet: 0.15, default: 0.30, lively: 0.70 } as const;
export type LivelinessPreset = keyof typeof LIVELINESS_PRESETS;

/** The four clock phases (D4). Wall-clock derived, recomputed every tick, never cached. */
export const CLOCK_PHASES = ['morning', 'day', 'evening', 'night'] as const;
export type ClockPhase = (typeof CLOCK_PHASES)[number];
export const ClockPhaseSchema = z.enum(CLOCK_PHASES);

/** Presence (R3-1: PRESENT := unlocked AND not suspended AND last input < 300 s). */
export const PRESENCE_STATES = ['active', 'idle-present', 'absent'] as const;
export type Presence = (typeof PRESENCE_STATES)[number];
export const PresenceSchema = z.enum(PRESENCE_STATES);

/** What the body is doing at the coarse level; drives the idle pool's `presentation` condition. */
export const PRESENTATION_MODES = ['awake', 'nap', 'sleep'] as const;
export type PresentationMode = (typeof PRESENTATION_MODES)[number];
export const PresentationModeSchema = z.enum(PRESENTATION_MODES);

/** The five arbitration lanes (R3-3). `locomotion` and `speech` are MAIN-owned. */
export const LANES = ['body', 'expression', 'gaze', 'locomotion', 'speech'] as const;
export type Lane = (typeof LANES)[number];
export const LaneSchema = z.enum(LANES);

/** Who issued a lane command (R3-3 envelope). */
export const LANE_SOURCES = ['touch', 'llm', 'behaviour', 'drag', 'sim', 'idle'] as const;
export type LaneSource = (typeof LANE_SOURCES)[number];
export const LaneSourceSchema = z.enum(LANE_SOURCES);

/** Terminal results for every lane command (rulings v2 ownership table). */
export const LANE_RESULTS = ['completed', 'expired', 'preempted', 'cancelled', 'renderer_lost'] as const;
export type LaneResult = (typeof LANE_RESULTS)[number];
export const LaneResultSchema = z.enum(LANE_RESULTS);

/** The semantic touch parts (D6: head / face / body / one ticklish zone). */
export const HIT_PARTS = ['head', 'face', 'hair', 'body', 'arm', 'ticklish'] as const;
export type HitPart = (typeof HIT_PARTS)[number];
export const HitPartSchema = z.enum(HIT_PARTS);

/** Conversation mode (R3-12). Product state in kv, never model behaviour. */
export const PERSONA_MODES_IPC = ['character', 'plain'] as const;
export type PersonaModeIpc = (typeof PERSONA_MODES_IPC)[number];
export const PersonaModeIpcSchema = z.enum(PERSONA_MODES_IPC);

/** Longest `say` the LLM may put in one sentence, in grapheme clusters (D14 `say` bound). */
export const SAY_MAX_GRAPHEMES = 120;

/** Longest a lane lease may be requested for, ms. The owner clamps every ttlMs into this. */
export const LANE_TTL_MAX_MS = 90_000;

/** Channel names. main→renderer channels are prefixed with the emitter's domain. */
export const Channels = {
  // main → pet renderer
  gazeCursor: 'gaze:cursor',
  shellVisibility: 'shell:visibility',
  stageSetFps: 'stage:setFps',
  debugExpression: 'debug:expression',
  debugMotion: 'debug:motion',
  debugToggle: 'debug:toggle',
  // pet renderer → main
  avatarHover: 'avatar:hover',
  avatarTap: 'avatar:tap',
  avatarDrag: 'avatar:drag',
  avatarDragEnd: 'avatar:dragEnd',
  stageReady: 'stage:ready',
  stageError: 'stage:error',

  // ---- Phase 2 (contracts.md §2.3) ----
  // main → pet / bubble / chat / key
  brainState: 'brain:state',
  brainSentence: 'brain:sentence',
  brainTurnDone: 'brain:turnDone',
  brainError: 'brain:error',
  hintShow: 'hint:show',
  avatarListening: 'avatar:listening',
  bubblePlace: 'bubble:place',
  chatOpened: 'chat:opened',
  keyStatus: 'key:status',
  // bubble / chat / key / pet → main
  userCancel: 'user:cancel',
  playbackSentenceDone: 'playback:sentenceDone',
  playbackTurnDone: 'playback:turnDone',
  bubbleSize: 'bubble:size',
  bubbleHover: 'bubble:hover',
  chatOpen: 'chat:open',
  chatClose: 'chat:close',
  chatComposing: 'chat:composing',
  chatResize: 'chat:resize',
  // relays: one channel, two hops through main
  speechMouth: 'speech:mouth',       // bubble → main → pet
  speechComplete: 'speech:complete', // chat → main → bubble

  // ---- Phase 3: main -> pet / bubble / chat ----
  simState: 'sim:state',
  simEvent: 'sim:event',
  simWindowMotion: 'sim:windowMotion',
  simLanding: 'sim:landing',
  proactiveTurn: 'proactive:turn',
  proactiveGate: 'proactive:gate',
  modeChanged: 'mode:changed',
  // ---- Phase 3: pet renderer -> main ----
  arbGrab: 'arb:grab',
  arbRelease: 'arb:release',
  arbTouch: 'arb:touch',
  arbPassthrough: 'arb:passthrough',
  arbTrace: 'arb:trace',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];

/**
 * Largest single `avatar:drag` step accepted, in DIP. Far above any plausible one-frame pointer
 * move, and small enough that one message can never push the window past Electron's native
 * coordinate range (where `setPosition` throws). It is deliberately *not* the whole defence: a
 * stream of in-bounds deltas would still walk her off every display, so main clamps the resulting
 * position against the current work areas as well.
 */
const DRAG_LIMIT = 4096;

/**
 * `z.number()` in zod 4 already rejects `NaN`, `Infinity` and `-Infinity`; `.finite()` states the
 * requirement in the schema so a future zod change cannot silently loosen it.
 */
const finite = (): z.ZodNumber => z.number().finite();

// ---- Phase 3 schemas (contracts §2.4) ------------------------------------------------------

/** The broadcast subset of SimState. Deliberately NOT the whole reducer state: ledger counters,
 *  rng state and the proactive reservation never cross to a renderer. */
export const SimSnapshotSchema = z.object({
  /** Monotonic ms in MAIN's domain. The renderer never compares it to performance.now(). */
  tsMain: z.number().nonnegative(),
  presence: PresenceSchema,
  presentationMode: PresentationModeSchema,
  phase: ClockPhaseSchema,
  /** R3-8: mood is 2-D. `valence` is what the prompt's moodPhrase() reads. */
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  energy: z.number().min(0).max(100),
  /** The DISPLAY value (dual-path milestone floor applied, §3.6.3), not the raw ledger. */
  affection: z.number().min(0).max(100),
  liveliness: z.number().min(LIVELINESS_MIN).max(LIVELINESS_MAX),
  /** Seconds since the last OS input, clamped to 3600 so it is never a precise absence clock. */
  userIdleS: z.number().min(0).max(3600),
  probableTyping: z.boolean(),
  /** Cursor is within CURSOR_NEAR_DIP of the pet window rect (§3.3). */
  cursorNear: z.boolean(),
  onFloor: z.boolean(),
  nearEdge: z.boolean(),
  dnd: z.boolean(),
  battery: z.object({ charging: z.boolean(), level: z.number().min(0).max(1).nullable() }),
  mode: PersonaModeIpcSchema,
  /** R3-35 / A3-1: the two tray toggles, mirrored from kv `ui_work_mode` (§5.9) and
   *  `ui_sfx_muted` (§5.12). This snapshot is the ONLY path either value takes to the pet
   *  renderer, where §5.9's work-mode fade and the SFX helper consume them. Default false. */
  uiWorkMode: z.boolean(),
  uiSfxMuted: z.boolean(),
  /** Local calendar day, 'YYYY-MM-DD'. The renderer uses it only to reset per-day one-shots. */
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SimSnapshot = z.infer<typeof SimSnapshotSchema>;

/** One-shot sim events the renderer must react to but that a snapshot cannot express. */
export const SIM_EVENT_KINDS = [
  'returned',        // D5: input resumed after >= NAP_IDLE_MS. Payload: awayMs.
  'phaseChanged',    // D4: morning/day/evening/night boundary crossed.
  'mealCue',         // D4: one of the three meal windows opened (jittered, once per day).
  'annoyed',         // D6: >= TAP_BURST_COUNT taps in TAP_BURST_WINDOW_MS.
  'typingGlance',    // D11/A22 SOFT reaction (R3-9/R3-17): glance at the screen, no expression.
  'cheer',           // D11: long typing streak ended.
  'batteryLow',      // D11: crossed below BATTERY_LOW_LEVEL while discharging.
  'onCharger',       // D11: charging edge.
  'cursorWiggle',    // D11: "wiggle near her -> curiosity" (see the predicate in §10.4).
  'wake',            // presentationMode left 'nap'/'sleep'.
] as const;
export type SimEventKind = (typeof SIM_EVENT_KINDS)[number];
export const SimEventKindSchema = z.enum(SIM_EVENT_KINDS);

export const SimEventSchema = z.object({
  kind: SimEventKindSchema,
  tsMain: z.number().nonnegative(),
  /** Present only for `returned`: how long the user was away, ms, clamped to 7 days. */
  awayMs: z.number().min(0).max(604_800_000).optional(),
  /** Present only for `phaseChanged`. */
  phase: ClockPhaseSchema.optional(),
  /** Present only for `mealCue`. */
  meal: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
});
export type SimEventPayload = z.infer<typeof SimEventSchema>;

/** R3-5. Published at 30 Hz for the duration of a motion episode, never when idle. */
export const WindowMotionSchema = z.object({
  /** Motion-episode generation, monotonically increasing in MAIN. Stale frames are ignored. */
  generation: z.number().int().nonnegative(),
  tsMain: z.number().nonnegative(),
  phase: z.enum(['drag', 'fling', 'walk', 'settling', 'rest']),
  /** Window velocity in DIP/s, already clamped to +/- FLING_VELOCITY_CAP. */
  vx: z.number().finite(),
  vy: z.number().finite(),
  /** Pointer-minus-window lag in DIP, already clamped to +/- DRAG_MAX_LAG_DIP. Drives the lean. */
  lagX: z.number().finite(),
  lagY: z.number().finite(),
  /** Model-local contact point from the press pick, normalised to [-1,1] on both axes. */
  contact: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).nullable(),
});
export type WindowMotion = z.infer<typeof WindowMotionSchema>;

/** R3-5. Generation-stamped so a stale landing cannot squash a newer drag. */
export const LandingSchema = z.object({
  generation: z.number().int().nonnegative(),
  tsMain: z.number().nonnegative(),
  /** Impact speed in DIP/s at contact. The bound IS `FLING_VELOCITY_CAP` (§7.5); the literal is
   *  written out because `@ds/protocol` must not import from `apps/desktop` — `lane-metrics.test.ts`
   *  asserts `FLING_VELOCITY_CAP === 2400` so the two can never drift apart silently. */
  impulse: z.number().min(0).max(2400),
  edge: z.enum(['floor', 'left', 'right', 'ceiling']),
});
export type Landing = z.infer<typeof LandingSchema>;

/** R3-7. Sent immediately BEFORE the proactive turn's `brain:state thinking`. */
export const PROACTIVE_BUCKETS = ['greeting', 'night', 'meal', 'longGap', 'callback', 'world'] as const;
export type ProactiveBucket = (typeof PROACTIVE_BUCKETS)[number];
export const ProactiveBucketSchema = z.enum(PROACTIVE_BUCKETS);

export const ProactiveTurnSchema = z.object({
  turnId: z.string().min(1),
  reservationId: z.string().min(1),
  templateId: z.string().min(1),
  bucket: ProactiveBucketSchema,
});

/** R3-7. Every gate evaluation, plus every 别打扰 change. Consumed by the chat status line. */
export const PROACTIVE_VERDICTS = [
  'eligible', 'rateLimited', 'unansweredCap', 'personaCap', 'suppressed', 'deferred',
  'discarded', 'displayed', 'muted',
] as const;
export type ProactiveVerdict = (typeof PROACTIVE_VERDICTS)[number];
export const ProactiveVerdictSchema = z.enum(PROACTIVE_VERDICTS);

export const ProactiveGateSchema = z.object({
  verdict: ProactiveVerdictSchema,
  /** The FIRST failing layer's reason, or '' when eligible. One of §3.10.1's reason codes. */
  reason: z.string().max(64),
  displayedToday: z.number().int().min(0),
  unansweredToday: z.number().int().min(0),
  /** Epoch ms when layers 1+2 will next allow a line, or null when muted/never. */
  nextEligibleAt: z.number().int().nonnegative().nullable(),
  /** 别打扰 state: null = off, otherwise the epoch ms it expires (8.64e15 = 'off forever'). */
  mutedUntil: z.number().int().nonnegative().nullable(),
});

/** R3-12. */
export const ModeChangedSchema = z.object({
  mode: PersonaModeIpcSchema,
  reason: z.enum(['command', 'restored', 'tray']),
});

/** R3-5 + R3-6. The renderer's press pick, in MODEL-local normalised coordinates. */
export const ArbGrabSchema = z.object({
  pressId: z.number().int().nonnegative(),
  part: HitPartSchema,
  /** Model-local contact anchor, [-1,1] on both axes; main keeps the native pointer offset. */
  modelX: z.number().min(-1).max(1),
  modelY: z.number().min(-1).max(1),
  /** Global cursor at press, DIP. Main re-reads the global cursor from here on. */
  screenX: z.number().finite(),
  screenY: z.number().finite(),
});

export const ArbReleaseSchema = z.object({
  pressId: z.number().int().nonnegative(),
  /** True when the press never exceeded TAP_SLOP_DIP - main then does NOT start a fling. */
  wasTap: z.boolean(),
});

/** R3-6/D6. Carries the OPAQUE-PIXEL semantic part; `avatar:tap` keeps its Phase 1 meaning (§2.9). */
export const ArbTouchSchema = z.object({
  pressId: z.number().int().nonnegative(),
  part: HitPartSchema,
  /** Final composited alpha at the press point, 0..255, from the 1-px GPU read (R3-6b). */
  alpha: z.number().int().min(0).max(255),
  /** Taps inside the trailing TAP_BURST_WINDOW_MS, including this one. */
  burst: z.number().int().min(1),
  /** True when this event crossed TAP_BURST_COUNT and armed the annoyance cooldown. */
  annoyed: z.boolean(),
});

/** Bar §0 hover semantics: work-mode fade is opt-in and needs main to flip native pass-through. */
export const ArbPassthroughSchema = z.object({ faded: z.boolean() });

/** R3-15. One trace record per arbitration decision. NEVER carries user text, titles or keys. */
export const ArbTraceSchema = z.object({
  /** Renderer monotonic ms (performance.now()). Main stamps wall time when it writes the line. */
  tsRenderer: z.number().nonnegative(),
  /**
   * Exactly the record types the RENDERER produces. `touch` arrives on `arb:touch` and
   * `motion` / `landing` / `presence` / `visibility` / `proactive` / `mode` / `resource` are
   * written by MAIN, so none of them appears here — §12.2's `TraceLine.t` is the union of these
   * eight renderer kinds and those eight main-written ones (16 in total). `dragVisual` is deleted:
   * nothing emitted it and nothing read it.
   */
  kind: z.enum([
    'behaviourStart', 'behaviourEnd', 'laneGrant', 'laneResult', 'gazeBreak', 'blink',
    'hoverAck', 'fps',
  ]),
  lane: LaneSchema.nullable(),
  source: LaneSourceSchema.nullable(),
  generation: z.number().int().nonnegative().nullable(),
  /** Behaviour id for behaviourStart/End; motion or expression key for laneGrant; else ''. */
  id: z.string().max(64),
  result: LaneResultSchema.nullable(),
  /** Selector diagnostics, present only on behaviourStart. */
  eligible: z.array(z.string().max(64)).max(64).optional(),
  weights: z.array(z.number()).max(64).optional(),
  seed: z.number().int().optional(),
  /** Primary numeric slot: `fps` for fps, degrees for gazeBreak, `alpha` for a hover pick. */
  value: z.number().finite().nullable(),
  /** Secondary numeric slot: `frameMs` for fps. Absent elsewhere. */
  value2: z.number().finite().optional(),
  /** Boolean slot: `doublet` for blink. Absent elsewhere. */
  flag: z.boolean().optional(),
  /** behaviourStart only: the drawn duration and the bag size at the moment of the draw. */
  durationMs: z.number().int().nonnegative().optional(),
  bagSize: z.number().int().nonnegative().optional(),
  /** laneGrant only: the requested lease lifetime. */
  ttlMs: z.number().int().nonnegative().optional(),
  /** gazeBreak: the break type; hoverAck: the new state. Both are short enums, carried as text. */
  label: z.string().max(24).optional(),
});

export const Schemas = {
  // window-local px, may legitimately be far outside the window — bounded only by finiteness.
  [Channels.gazeCursor]: z.object({ x: finite(), y: finite() }),
  [Channels.shellVisibility]: z.object({
    hidden: z.boolean(),
    reason: z.enum(['fullscreen', 'locked', 'suspended', 'user', 'none']),
  }),
  [Channels.stageSetFps]: z.object({ fps: z.union([z.literal(30), z.literal(60)]) }),
  [Channels.debugExpression]: z.object({ name: z.string().nullable() }),
  [Channels.debugMotion]: z.object({ group: z.string(), index: z.number().int().nonnegative() }),
  [Channels.debugToggle]: z.object({}), // show/hide the renderer's debug panel

  [Channels.avatarHover]: z.object({ inside: z.boolean() }),
  [Channels.avatarTap]: z.object({ hitArea: z.string() }),
  // screen px since the last event; finite and bounded (see DRAG_LIMIT).
  [Channels.avatarDrag]: z.object({
    dx: finite().min(-DRAG_LIMIT).max(DRAG_LIMIT),
    dy: finite().min(-DRAG_LIMIT).max(DRAG_LIMIT),
  }),
  [Channels.avatarDragEnd]: z.object({}),
  [Channels.stageReady]: z.object({
    character: z.string(),
    expressions: z.array(z.string()),
    motionGroups: z.record(z.string(), z.number().int()),
    hitAreas: z.array(z.string()),
  }),
  [Channels.stageError]: z.object({ message: z.string() }),

  [Channels.brainState]: z.object({ state: TurnStateSchema, turnId: z.string() }),
  [Channels.brainSentence]: SentenceEventSchema,
  [Channels.brainTurnDone]: z.object({
    turnId: z.string(),
    usage: UsageSchema.nullable(),
    ttftMs: z.number().nullable(),
    totalMs: z.number(),
    complianceMiss: z.boolean(),
    regenerated: z.boolean(),
    lint: LintResultSchema,
  }),
  [Channels.brainError]: z.object({
    turnId: z.string().optional(),
    code: ErrorCodeSchema,
    message: z.string(),
  }),
  [Channels.hintShow]: z.object({
    text: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    ttlMs: z.number().int().positive(),
  }),
  [Channels.avatarListening]: z.object({ on: z.boolean() }),
  [Channels.bubblePlace]: z.object({
    maxWidth: z.number().positive(),
    maxHeight: z.number().positive(),
    side: SideSchema,
    arrowOffset: z.number().nonnegative(),
  }),
  [Channels.chatOpened]: z.object({ focusComposer: z.boolean() }),
  [Channels.keyStatus]: z.object({
    present: z.boolean(),
    source: z.enum(['store', 'dev-env', 'none']),
    lastTest: z.object({ ok: z.boolean(), code: ErrorCodeSchema.optional(), at: z.number().int() }).nullable(),
  }),

  [Channels.userCancel]: z.object({}),
  [Channels.playbackSentenceDone]: z.object({ turnId: z.string(), seq: z.number().int().nonnegative() }),
  [Channels.playbackTurnDone]: z.object({ turnId: z.string() }),
  [Channels.bubbleSize]: z.object({ width: z.number().positive(), height: z.number().positive() }),
  [Channels.bubbleHover]: z.object({ inside: z.boolean() }),
  [Channels.chatOpen]: z.object({
    source: z.enum(['pet', 'bubble', 'tray', 'hotkey', 'key']),
    focusComposer: z.boolean(),
  }),
  [Channels.chatClose]: z.object({}),
  [Channels.chatComposing]: z.object({ on: z.boolean() }),
  [Channels.chatResize]: z.object({ rows: z.number().int().min(1).max(6), historyOpen: z.boolean() }),

  [Channels.speechMouth]: z.object({ on: z.boolean() }),
  [Channels.speechComplete]: z.object({}),

  // ---- Phase 3 (contracts §2.4) ----
  [Channels.simState]: SimSnapshotSchema,
  [Channels.simEvent]: SimEventSchema,
  [Channels.simWindowMotion]: WindowMotionSchema,
  [Channels.simLanding]: LandingSchema,
  [Channels.proactiveTurn]: ProactiveTurnSchema,
  [Channels.proactiveGate]: ProactiveGateSchema,
  [Channels.modeChanged]: ModeChangedSchema,
  [Channels.arbGrab]: ArbGrabSchema,
  [Channels.arbRelease]: ArbReleaseSchema,
  [Channels.arbTouch]: ArbTouchSchema,
  [Channels.arbPassthrough]: ArbPassthroughSchema,
  [Channels.arbTrace]: ArbTraceSchema,
} satisfies Record<Channel, z.ZodTypeAny>;

export type Payload<C extends Channel> = z.infer<(typeof Schemas)[C]>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseEvent<C extends Channel>(channel: C, payload: unknown): ParseResult<Payload<C>> {
  const schema = (Schemas as Record<string, z.ZodTypeAny | undefined>)[channel];
  if (!schema) return { ok: false, error: `unknown channel ${String(channel)}` };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data as Payload<C> } : { ok: false, error: r.error.message };
}

// ---------------------------------------------------------------------------
// Invoke channels (contracts.md §2.4). A separate map so `Schemas` stays
// request-only for send channels.
// ---------------------------------------------------------------------------

export const InvokeChannels = {
  userText: 'user:text',
  keySet: 'key:set',
  keyTest: 'key:test',
  keyClear: 'key:clear',
  historyList: 'history:list',
  historyDelete: 'history:delete',
} as const;
export type InvokeChannel = (typeof InvokeChannels)[keyof typeof InvokeChannels];

/**
 * Cap on one user message. The composer's textarea `maxLength` and its counter count UTF-16 code
 * units; zod 4's `.max` counts UTF-16 units too but falls back to code points when that length is
 * over the cap (astral characters count once), so it is never stricter than the composer. The
 * renderer therefore can never hand main a message the schema below rejects (final review I-4).
 */
export const USER_TEXT_MAX = 2000;

export const InvokeRequest = {
  [InvokeChannels.userText]: z.object({ text: z.string().min(1).max(USER_TEXT_MAX) }),
  [InvokeChannels.keySet]: z.object({ apiKey: z.string().min(8).max(200) }),
  [InvokeChannels.keyTest]: z.object({ apiKey: z.string().min(8).max(200).optional() }),
  [InvokeChannels.keyClear]: z.object({}),
  [InvokeChannels.historyList]: z.object({
    before: z.number().int().positive().optional(), // messages.id cursor, exclusive
    limit: z.number().int().min(1).max(200).default(50),
  }),
  [InvokeChannels.historyDelete]: z.object({ turnId: z.string().min(1) }),
} satisfies Record<InvokeChannel, z.ZodTypeAny>;

export const InvokeResponse = {
  [InvokeChannels.userText]: z.union([
    z.object({ ok: z.literal(true), turnId: z.string() }),
    z.object({ ok: z.literal(false), code: ErrorCodeSchema, message: z.string() }),
  ]),
  [InvokeChannels.keySet]: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
  [InvokeChannels.keyTest]: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), code: ErrorCodeSchema, message: z.string() }),
  ]),
  [InvokeChannels.keyClear]: z.object({ ok: z.literal(true) }),
  [InvokeChannels.historyList]: z.object({
    rows: z.array(HistoryRowSchema),
    nextBefore: z.number().int().positive().nullable(),
  }),
  [InvokeChannels.historyDelete]: z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() }),
} satisfies Record<InvokeChannel, z.ZodTypeAny>;

export type InvokeReq<C extends InvokeChannel> = z.infer<(typeof InvokeRequest)[C]>;
export type InvokeRes<C extends InvokeChannel> = z.infer<(typeof InvokeResponse)[C]>;

export function parseInvokeRequest<C extends InvokeChannel>(channel: C, payload: unknown): ParseResult<InvokeReq<C>> {
  const schema = (InvokeRequest as Record<string, z.ZodTypeAny | undefined>)[channel];
  if (!schema) return { ok: false, error: `unknown invoke channel ${String(channel)}` };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data as InvokeReq<C> } : { ok: false, error: r.error.message };
}

export function parseInvokeResponse<C extends InvokeChannel>(channel: C, payload: unknown): ParseResult<InvokeRes<C>> {
  const schema = (InvokeResponse as Record<string, z.ZodTypeAny | undefined>)[channel];
  if (!schema) return { ok: false, error: `unknown invoke channel ${String(channel)}` };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data as InvokeRes<C> } : { ok: false, error: r.error.message };
}

// ---------------------------------------------------------------------------
// Per-window allow-lists (contracts.md §2.5, R9/D14). One preload per window;
// a window may only name the channels it appears in. The Phase 1 global lists
// RENDERER_TO_MAIN / MAIN_TO_RENDERER are deleted — four windows cannot share
// one list without handing the pet renderer `key:set`.
// ---------------------------------------------------------------------------

export const PET_TO_MAIN: readonly Channel[] = [
  Channels.avatarHover, Channels.avatarTap, Channels.avatarDrag, Channels.avatarDragEnd,
  Channels.stageReady, Channels.stageError, Channels.chatOpen,
  // Phase 3 (§2.5). avatar:drag / avatar:dragEnd stay: senders retired, channel kept (§2.9).
  Channels.arbGrab, Channels.arbRelease, Channels.arbTouch,
  Channels.arbPassthrough, Channels.arbTrace,
];
export const MAIN_TO_PET: readonly Channel[] = [
  Channels.gazeCursor, Channels.shellVisibility, Channels.stageSetFps,
  Channels.debugExpression, Channels.debugMotion, Channels.debugToggle,
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone,
  Channels.avatarListening, Channels.speechMouth,
  // Phase 3 (§2.5)
  Channels.simState, Channels.simEvent, Channels.simWindowMotion, Channels.simLanding,
  Channels.modeChanged,
];

export const BUBBLE_TO_MAIN: readonly Channel[] = [
  Channels.playbackSentenceDone, Channels.playbackTurnDone,
  Channels.speechMouth, Channels.bubbleSize, Channels.bubbleHover, Channels.chatOpen,
];
export const MAIN_TO_BUBBLE: readonly Channel[] = [
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone, Channels.brainError,
  Channels.hintShow, Channels.bubblePlace, Channels.shellVisibility, Channels.speechComplete,
  // Phase 3 (§2.5)
  Channels.simState, Channels.proactiveTurn, Channels.modeChanged,
];

export const CHAT_TO_MAIN: readonly Channel[] = [
  Channels.userCancel, Channels.chatClose, Channels.chatComposing, Channels.chatResize,
  Channels.speechComplete,
];
export const MAIN_TO_CHAT: readonly Channel[] = [
  Channels.brainState, Channels.brainTurnDone, Channels.brainError,
  Channels.chatOpened, Channels.keyStatus,
  // Phase 3 (§2.5)
  Channels.proactiveTurn, Channels.proactiveGate, Channels.modeChanged,
];

export const KEY_TO_MAIN: readonly Channel[] = [Channels.chatOpen];
export const MAIN_TO_KEY: readonly Channel[] = [Channels.keyStatus];

export const CHAT_INVOKE: readonly InvokeChannel[] = [
  InvokeChannels.userText, InvokeChannels.historyList, InvokeChannels.historyDelete,
];
export const KEY_INVOKE: readonly InvokeChannel[] = [
  InvokeChannels.keySet, InvokeChannels.keyTest, InvokeChannels.keyClear,
];
export const PET_INVOKE: readonly InvokeChannel[] = [];
export const BUBBLE_INVOKE: readonly InvokeChannel[] = [];

// ---------------------------------------------------------------------------
// The one error-code table (contracts.md §2.8, C-10/D4). Main uses it for
// `hint:show` and for deciding whether to open the key window; the key renderer
// uses it for its failure line. There is no renderer-local copy.
// `empty` carries text '' on purpose: §3.9.4 speaks a canned line instead, so
// main must skip `hint:show` when the text is empty.
// Phase 2 has no 设置 window, so no string here may name one.
// ---------------------------------------------------------------------------

export const ERROR_HINTS = {
  auth: { text: 'API Key 无效，重新填一下', level: 'error', opensKeyWindow: true },
  balance: { text: 'DeepSeek 余额不足了', level: 'error', opensKeyWindow: true },
  rate: { text: 'DeepSeek 有点忙，稍后再试', level: 'warn', opensKeyWindow: false },
  server: { text: 'DeepSeek 那边出问题了，等一下再聊', level: 'warn', opensKeyWindow: false },
  network: { text: '网络不太好，等一下再聊', level: 'warn', opensKeyWindow: false },
  timeout: { text: '等太久了，先歇一会儿', level: 'warn', opensKeyWindow: false },
  empty: { text: '', level: 'info', opensKeyWindow: false },
  'no-key': { text: '还没填 API Key', level: 'error', opensKeyWindow: true },
  // A-38: a history append failed (disk full, a closed handle). The reply was spoken; the user is
  // told the line was not remembered. Sent to the chat window as brain:error and to the bubble as
  // a hint only (the bubble's brain:error handler would cut a reply that is still revealing).
  storage: { text: '刚才那句没记住，硬盘好像写不进去', level: 'warn', opensKeyWindow: false },
} as const satisfies Record<ErrorCode, { text: string; level: 'info' | 'warn' | 'error'; opensKeyWindow: boolean }>;
