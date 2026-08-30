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

export const SentenceEventSchema = z.object({
  turnId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  emotion: EmotionSchema,
  motion: z.string().optional(),
  pause: z.number().nonnegative().max(PAUSE_MAX_S).optional(),
});
export type SentenceEvent = z.infer<typeof SentenceEventSchema>;

export const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  cacheHit: z.number().int().nonnegative(),
  cacheMiss: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ErrorCodeSchema = z.enum(['auth', 'balance', 'rate', 'server', 'network', 'timeout', 'empty', 'no-key']);
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
];
export const MAIN_TO_PET: readonly Channel[] = [
  Channels.gazeCursor, Channels.shellVisibility, Channels.stageSetFps,
  Channels.debugExpression, Channels.debugMotion, Channels.debugToggle,
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone,
  Channels.avatarListening, Channels.speechMouth,
];

export const BUBBLE_TO_MAIN: readonly Channel[] = [
  Channels.playbackSentenceDone, Channels.playbackTurnDone,
  Channels.speechMouth, Channels.bubbleSize, Channels.bubbleHover, Channels.chatOpen,
];
export const MAIN_TO_BUBBLE: readonly Channel[] = [
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone, Channels.brainError,
  Channels.hintShow, Channels.bubblePlace, Channels.shellVisibility, Channels.speechComplete,
];

export const CHAT_TO_MAIN: readonly Channel[] = [
  Channels.userCancel, Channels.chatClose, Channels.chatComposing, Channels.chatResize,
  Channels.speechComplete,
];
export const MAIN_TO_CHAT: readonly Channel[] = [
  Channels.brainState, Channels.brainTurnDone, Channels.brainError,
  Channels.chatOpened, Channels.keyStatus,
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
} as const satisfies Record<ErrorCode, { text: string; level: 'info' | 'warn' | 'error'; opensKeyWindow: boolean }>;
