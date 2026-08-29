import { z } from 'zod';

export const EMOTIONS = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral'] as const;
export type Emotion = (typeof EMOTIONS)[number];

const MotionRef = z.tuple([z.string(), z.number().int().nonnegative()]);
export type MotionRef = z.infer<typeof MotionRef>;

/** expression name | motion ref | null (= clear expression) */
const EmotionTarget = z.union([z.string(), MotionRef, z.null()]);

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
});
export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;

export function parseCharacterConfig(json: unknown): CharacterConfig {
  return CharacterConfigSchema.parse(json);
}
