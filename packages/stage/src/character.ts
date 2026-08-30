import { EMOTIONS, HIT_PARTS, HitPartSchema, type Emotion, type HitPart } from '@ds/protocol';
import { z } from 'zod';

export { EMOTIONS, HIT_PARTS };
export type { Emotion, HitPart };

const MotionRef = z.tuple([z.string(), z.number().int().nonnegative()]);
export type MotionRef = z.infer<typeof MotionRef>;

/** expression name | motion ref | null (= clear expression) */
const EmotionTarget = z.union([z.string(), MotionRef, z.null()]);

/** §4.10 / §6.4: one hitParts entry. Keyed by Cubism PART id (or a drawable id override). */
export const HitPartEntrySchema = z.object({ part: HitPartSchema, participatesInHitTest: z.boolean() });
export const HitPartMapSchema = z.record(z.string().min(1), HitPartEntrySchema);
export type HitPartMap = z.infer<typeof HitPartMapSchema>;

/** D6's one ticklish zone: normalised MODEL-space rect, u = (x + 1) / 2 (§4.10). */
export const TicklishRectSchema = z
  .object({ x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1) })
  .refine((r) => r.x0 < r.x1 && r.y0 < r.y1, { message: 'ticklishRect must have x0 < x1 and y0 < y1' });

/** §4.10 `sim`: absent = SIM_DEFAULTS. maxPerDay max 5 = R3-7 "persona may set <= 5" (PROACTIVE_PERSONA_CAP_MAX, @ds/sim). */
export const CharacterSimSchema = z.object({
  moodBase: z.object({ valence: z.number().min(-1).max(1), arousal: z.number().min(0).max(1) }).optional(),
  proactive: z.object({ maxPerDay: z.number().int().min(0).max(5) }).optional(),
});

/** §4.10 / §4.11.3: an unregistered motion file, its bind name and the labeller's tags. */
export const ExtraMotionSchema = z.object({
  file: z.string().min(1),
  name: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  tags: z.array(z.string().min(1)),
});
export const ExtraMotionsSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.array(ExtraMotionSchema));

export const CharacterConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  model: z.string(),
  emotionMap: z.object(Object.fromEntries(EMOTIONS.map((e) => [e, EmotionTarget])) as Record<Emotion, typeof EmotionTarget>),
  motionMap: z.record(z.string(), MotionRef),
  idleGroup: z.string(),
  tapMotions: z.record(z.string(), z.record(z.string(), z.array(z.number().int().nonnegative()))),
  scale: z.number().positive().default(1),
  offsetY: z.number().default(0),
  // ---- Phase 3 (§4.10), all optional so Hiyori and future bundles still parse ----
  hitParts: HitPartMapSchema.optional(),
  ticklishRect: TicklishRectSchema.optional(),
  hitPartDefault: HitPartSchema.optional(),
  sim: CharacterSimSchema.optional(),
  extraMotions: ExtraMotionsSchema.optional(),
});
export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;

export function parseCharacterConfig(json: unknown): CharacterConfig {
  return CharacterConfigSchema.parse(json);
}

/**
 * §6.4 (D6): HitArea name normalisation for the legacy `avatar:tap` path only — `arb:touch` never
 * goes through it. Strips a `HitArea` prefix and separators, lower-cases, then maps aliases.
 */
export const HIT_AREA_ALIASES: Readonly<Record<string, HitPart>> = {
  head: 'head', 头: 'head', 头部: 'head',
  face: 'face', 脸: 'face', 面: 'face',
  hair: 'hair', 头发: 'hair',
  body: 'body', 身体: 'body', 身: 'body', torso: 'body',
  arm: 'arm', arml: 'arm', armr: 'arm', hand: 'arm', 手: 'arm', 手臂: 'arm', 胳膊: 'arm',
  ticklish: 'ticklish', 痒: 'ticklish',
};

export function normalizeHitArea(name: string): HitPart | null {
  const key = name.trim().replace(/^hit[_ -]?area[_ -]?/i, '').replace(/[_ -]/g, '').toLowerCase();
  if (key === '') return null;
  return HIT_AREA_ALIASES[key] ?? null;
}
