import { z } from 'zod';
import { ClockPhaseSchema, PresentationModeSchema } from '@ds/protocol';
import { ConditionSchema } from './conditions.ts';

/** A motion reference into the model3.json groups. Validated against the live catalogue in bind(). */
export const MotionRefSchema = z.tuple([z.string().min(1), z.number().int().nonnegative()]);
export type MotionRef = z.infer<typeof MotionRefSchema>;

/** The fixed overlay presets. A behaviour may not invent parameter writes — the set is closed so
 *  every write is reviewable, and every value is clamped by Cubism to the parameter's own range. */
export const OVERLAY_PRESETS = [
  'none', 'headTilt', 'headTiltHold', 'headDroop', 'leanLeft', 'leanRight', 'lookUp', 'blush',
] as const;
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number];
export const OverlayPresetSchema = z.enum(OVERLAY_PRESETS);

/** The parameter ids each preset writes (§4.1 table). bind() drops a behaviour whose preset
 *  touches a parameter the model does not declare. Deltas/eases live in @ds/stage overlay.ts. */
export const OVERLAY_PARAMETERS: Record<OverlayPreset, readonly string[]> = {
  none: [],
  headTilt: ['ParamAngleZ'],
  headTiltHold: ['ParamAngleZ', 'ParamBodyAngleZ'],
  headDroop: ['ParamAngleY', 'ParamBodyAngleZ'],
  leanLeft: ['ParamAngleX', 'ParamBodyAngleX'],
  leanRight: ['ParamAngleX', 'ParamBodyAngleX'],
  lookUp: ['ParamAngleY'],
  blush: ['ParamTere'],
};

/** The gaze pattern the behaviour asks the gaze lane for while it owns the body lane. */
export const GAZE_PATTERNS = ['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none'] as const;
export type GazePattern = (typeof GAZE_PATTERNS)[number];
export const GazePatternSchema = z.enum(GAZE_PATTERNS);

/** Locomotion the behaviour may request. Executed by MAIN (R3-5); the renderer only asks. */
export const LOCOMOTIONS = ['stroll', 'hop'] as const;
export const LocomotionSchema = z.enum(LOCOMOTIONS);

export const BehaviorSchema = z.object({
  /** Stable id. The trace key, the recency key, the cooldown key. [a-z0-9_]{2,48}. */
  id: z.string().regex(/^[a-z0-9_]{2,48}$/),
  /** Selection weight BEFORE the liveliness multiplier. Bag copies = round(weight * 4), min 1. */
  weight: z.number().min(0.1).max(5),
  /** Bar §0: 5-20 s. min <= max is enforced by a refine. */
  minMs: z.number().int().min(5_000).max(20_000),
  maxMs: z.number().int().min(5_000).max(20_000),
  /** Per-behaviour cooldown, monotonic ms. 0 = none. */
  cooldownMs: z.number().int().min(0).max(600_000).default(0),
  /** The R3-13 gate: ineligible while liveliness < this. */
  minLiveliness: z.number().min(0).max(1).default(0),
  /** Body-lane motion, or null for a behaviour that only changes expression / gaze / overlay. */
  motion: MotionRefSchema.nullable().default(null),
  /** Expression-lane name from the model's expression list, or null to leave the lane alone. */
  expression: z.string().min(1).nullable().default(null),
  /** Weight the expression is applied at. R3-4's LLM clamp does not apply to sim/idle sources. */
  expressionWeight: z.number().min(0).max(1).default(0.55),
  gaze: GazePatternSchema.default('follow'),
  overlay: OverlayPresetSchema.default('none'),
  /** null = never asks to move. Only drawn when the liveliness locomotion roll passes (§3.4). */
  locomotion: LocomotionSchema.nullable().default(null),
  /** Free tags. `big` is the only one the engine reads (the liveliness weight multiplier). */
  tags: z.array(z.enum(['big', 'quiet', 'sleepy', 'social'])).default([]),
  /** Declarative gate. Absent = always eligible. */
  when: ConditionSchema.optional(),
}).refine((b) => b.minMs <= b.maxMs, { message: 'minMs must be <= maxMs' });
export type Behavior = z.infer<typeof BehaviorSchema>;

export const BehaviorPackSchema = z.object({
  version: z.literal(1),
  /** Must match characters/<id>/character.json `id`; bind() re-checks it. */
  character: z.string().regex(/^[a-z0-9-]+$/),
  behaviors: z.array(BehaviorSchema).min(12),          // D1's floor, at the SCHEMA level
}).refine(
  (p) => new Set(p.behaviors.map((b) => b.id)).size === p.behaviors.length,
  { message: 'behaviour ids must be unique' },
);
export type BehaviorPack = z.infer<typeof BehaviorPackSchema>;

/** Stage 1 validation (structural). Throws a zod error with the offending path. */
export function parseBehaviorPack(json: unknown): BehaviorPack {
  return BehaviorPackSchema.parse(json);
}

/** Referenced by the ConditionFacts contract; re-exported so a pack author can see the closed sets. */
export const CONDITION_PHASE_VALUES = ClockPhaseSchema.options;
export const CONDITION_PRESENTATION_VALUES = PresentationModeSchema.options;

// ---- §4.11.3 — the labelling artefact's shape -------------------------------------------------
export const MotionLabelSchema = z.object({
  file: z.string().min(1),
  registered: z.boolean(),
  /** Present when registered. The `extraMotions` name §4.9 binds against. */
  name: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/).optional(),
  poseFamily: z.enum(['idle', 'gesture', 'lean', 'reach', 'settle', 'emote']).optional(),
  energy: z.enum(['low', 'mid', 'high']).optional(),
  loopSafe: z.boolean().optional(),
  bodyParts: z.array(z.enum(['head', 'arm', 'torso', 'hair', 'face'])).optional(),
  /** Present when NOT registered. Free text, one sentence. */
  reason: z.string().max(200).optional(),
});
export const MOTION_LABEL_TARGET = 10;   // R3-27's "target >= 10 usable extra motions"
