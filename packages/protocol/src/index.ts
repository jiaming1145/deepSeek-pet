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

export const SentenceEventSchema = z.object({
  turnId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  emotion: EmotionSchema,
  motion: z.string().optional(),
  pause: z.number().nonnegative().optional(),
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
} satisfies Record<Channel, z.ZodTypeAny>;

export type Payload<C extends Channel> = z.infer<(typeof Schemas)[C]>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseEvent<C extends Channel>(channel: C, payload: unknown): ParseResult<Payload<C>> {
  const schema = (Schemas as Record<string, z.ZodTypeAny | undefined>)[channel];
  if (!schema) return { ok: false, error: `unknown channel ${String(channel)}` };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data as Payload<C> } : { ok: false, error: r.error.message };
}

export const RENDERER_TO_MAIN: readonly Channel[] = [
  Channels.avatarHover, Channels.avatarTap, Channels.avatarDrag, Channels.avatarDragEnd,
  Channels.stageReady, Channels.stageError,
];
export const MAIN_TO_RENDERER: readonly Channel[] = [
  Channels.gazeCursor, Channels.shellVisibility, Channels.stageSetFps,
  Channels.debugExpression, Channels.debugMotion, Channels.debugToggle,
];
