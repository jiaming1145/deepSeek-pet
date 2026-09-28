import type { Emotion, HitPart, InteractionAction, WindowMotion } from '@ds/protocol';
import {
  EMOTION_TO_FACIAL_PRESET, FACIAL_PARAMETER_IDS, FacialExpressionController,
  type FacialControls, type FacialPresetId,
} from './facial-expression';

export const TAIL_SEGMENT_COUNT = 6;
export const INTERACTION_FIXED_STEP_S = 1 / 120;
export const INTERACTION_MAX_FRAME_S = 0.05;
export const TAIL_PARAMETER_IDS = [
  'ParamTailBone1', 'ParamTailBone2', 'ParamTailBone3',
  'ParamTailBone4', 'ParamTailBone5', 'ParamTailBone6',
] as const;

export const INTERACTION_PARAMETER_IDS = [
  ...FACIAL_PARAMETER_IDS, 'ParamBodyPullX', 'ParamBodyPullY',
  'ParamBodyBounce', 'ParamShoulderLift', 'ParamArmSwingL', 'ParamArmSwingR',
  'ParamArmReachL', 'ParamArmReachR', 'ParamLegStrideL', 'ParamLegStrideR',
  'ParamFootPlantL', 'ParamFootPlantR', ...TAIL_PARAMETER_IDS,
  'ParamTailStretch', 'ParamTailGrab', 'ParamTailMood', 'ParamPropFood', 'ParamPropDrink',
  'ParamChew', 'ParamSwallow', 'ParamBreath',
] as const;
export type InteractionParameterId = (typeof INTERACTION_PARAMETER_IDS)[number];
export type InteractionParameters = Partial<Record<InteractionParameterId, number>>;

export interface InteractionFrame {
  action: InteractionAction;
  actionPhase: number;
  grabbedPart: HitPart | null;
  parameters: Readonly<InteractionParameters>;
  tailAngles: readonly number[];
}

type ActionSpec = { durationS: number; loop: boolean };
export const ACTION_SPECS: Record<InteractionAction, ActionSpec> = {
  idle: { durationS: Number.POSITIVE_INFINITY, loop: true },
  walk: { durationS: Number.POSITIVE_INFINITY, loop: true },
  hop: { durationS: 1.1, loop: false },
  eat: { durationS: 4.2, loop: false },
  drink: { durationS: 3.8, loop: false },
  wave: { durationS: 2.4, loop: false },
  stretch: { durationS: 3.0, loop: false },
  sit: { durationS: 1.2, loop: false },
  sleep: { durationS: Number.POSITIVE_INFINITY, loop: true },
  wake: { durationS: 1.8, loop: false },
  inspect: { durationS: 2.8, loop: false },
  celebrate: { durationS: 2.2, loop: false },
  stumble: { durationS: 0.9, loop: false },
  recover: { durationS: 0.8, loop: false },
  tail_react: { durationS: 1.4, loop: false },
};

const EMOTION_TAIL_MOOD: Record<Emotion, number> = {
  neutral: 0, happy: 0.28, sad: -0.34, angry: -0.48, think: 0.04,
  surprised: 0.34, awkward: -0.08, question: 0.1, curious: 0.16,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const add = (p: InteractionParameters, id: InteractionParameterId, value: number): void => {
  if (Math.abs(value) > 1e-6) p[id] = (p[id] ?? 0) + value;
};

/**
 * Pure, deterministic full-body interaction controller. It does not create Cubism geometry:
 * instead it emits a reviewed parameter contract that a Cubism or skeletal runtime can consume.
 */
export class RichInteractionController {
  private timeS = 0;
  private action: InteractionAction = 'idle';
  private actionElapsedS = 0;
  private grabbedPart: HitPart | null = null;
  private grabAnchor = { x: 0, y: 0 };
  private motion: WindowMotion | null = null;
  private readonly tail = new Float64Array(TAIL_SEGMENT_COUNT);
  private readonly tailVelocity = new Float64Array(TAIL_SEGMENT_COUNT);
  private tailAccumulatorS = 0;
  private readonly face = new FacialExpressionController();
  private tailMood = 0;
  private tailMoodTarget = 0;

  setEmotion(emotion: Emotion, intensity = 1): void {
    const amount = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 1);
    this.face.setPreset(EMOTION_TO_FACIAL_PRESET[emotion], amount);
    this.tailMoodTarget = EMOTION_TAIL_MOOD[emotion] * amount;
  }

  setFacialPreset(preset: FacialPresetId, intensity = 1): void {
    this.face.setPreset(preset, intensity);
  }

  setFacialControls(
    controls: FacialControls,
    options: { replace?: boolean; responseHz?: number } = {},
  ): void {
    this.face.setControls(controls, options);
  }

  startAction(action: InteractionAction): void {
    if (this.action === action && ACTION_SPECS[action].loop) return;
    this.action = action;
    this.actionElapsedS = 0;
  }

  stopAction(action?: InteractionAction): void {
    if (action && this.action !== action) return;
    if (this.grabbedPart === 'tail') return;
    this.startAction(this.action === 'recover' ? 'idle' : 'recover');
  }

  beginGrab(part: HitPart, modelX: number, modelY: number): void {
    this.grabbedPart = part;
    this.grabAnchor = { x: clamp(modelX, -1, 1), y: clamp(modelY, -1, 1) };
    if (part === 'tail') this.startAction('tail_react');
  }

  release(): void {
    if (this.grabbedPart === 'tail') {
      const kick = clamp((this.motion?.lagX ?? 0) / 120, -1, 1);
      for (let i = 0; i < TAIL_SEGMENT_COUNT; i++) this.tailVelocity[i] += kick * (7 - i) * 0.8;
      this.startAction('tail_react');
    }
    this.grabbedPart = null;
  }

  onWindowMotion(motion: WindowMotion): void {
    this.motion = motion;
  }

  currentAction(): InteractionAction {
    return this.action;
  }

  tick(deltaTimeS: number): InteractionFrame {
    const dt = clamp(Number.isFinite(deltaTimeS) ? deltaTimeS : 0, 0, INTERACTION_MAX_FRAME_S);
    this.timeS += dt;
    this.actionElapsedS += dt;
    const spec = ACTION_SPECS[this.action];
    if (!spec.loop && this.actionElapsedS >= spec.durationS) {
      this.action = this.action === 'recover' ? 'idle' : 'recover';
      this.actionElapsedS = 0;
    }
    this.tailMood += (this.tailMoodTarget - this.tailMood) * (1 - Math.exp(-6 * dt));
    this.stepTail(dt);

    const parameters: InteractionParameters = { ...this.face.tick(dt) };
    const actionPhase = this.actionPhase();
    this.applyLivingMicroMotion(parameters);
    this.applyAction(parameters, actionPhase);
    this.applyGrab(parameters);
    for (let i = 0; i < TAIL_SEGMENT_COUNT; i++) {
      add(parameters, TAIL_PARAMETER_IDS[i], this.tail[i] * 32);
    }
    return {
      action: this.action,
      actionPhase,
      grabbedPart: this.grabbedPart,
      parameters,
      tailAngles: Array.from(this.tail),
    };
  }

  private actionPhase(): number {
    const spec = ACTION_SPECS[this.action];
    if (!Number.isFinite(spec.durationS)) return this.actionElapsedS % 1;
    return clamp(this.actionElapsedS / spec.durationS, 0, 1);
  }

  private stepTail(dt: number): void {
    this.tailAccumulatorS = Math.min(0.1, this.tailAccumulatorS + dt);
    while (this.tailAccumulatorS >= INTERACTION_FIXED_STEP_S) {
      this.stepTailFixed(INTERACTION_FIXED_STEP_S);
      this.tailAccumulatorS -= INTERACTION_FIXED_STEP_S;
    }
  }

  private stepTailFixed(dt: number): void {
    const tailGrab = this.grabbedPart === 'tail' && this.motion?.phase === 'drag';
    const pullX = clamp((this.motion?.lagX ?? 0) / 120 + this.grabAnchor.x * 0.2, -1, 1);
    const pullY = clamp((this.motion?.lagY ?? 0) / 120 - this.grabAnchor.y * 0.1, -1, 1);
    const grabTarget = clamp(pullX * 0.86 - pullY * 0.28, -1, 1);
    const mood = this.tailMood;
    const idleTarget = Math.sin(this.timeS * 1.7) * 0.08 + mood * 0.22;
    for (let i = 0; i < TAIL_SEGMENT_COUNT; i++) {
      const desired = i === 0
        ? (tailGrab ? grabTarget : idleTarget)
        : this.tail[i - 1] * (tailGrab ? 0.9 : 0.76);
      const stiffness = tailGrab ? 56 - i * 4 : 30 - i * 2;
      const damping = 8.5 + i * 0.45;
      const acceleration = (desired - this.tail[i]) * stiffness - this.tailVelocity[i] * damping;
      this.tailVelocity[i] += acceleration * dt;
      this.tail[i] = clamp(this.tail[i] + this.tailVelocity[i] * dt, -1, 1);
    }
  }

  private applyLivingMicroMotion(p: InteractionParameters): void {
    const breath = (Math.sin(this.timeS * Math.PI * 0.72) + 1) * 0.5;
    add(p, 'ParamBreath', breath * (this.action === 'sleep' ? 0.42 : 0.14));
    add(p, 'ParamBodyBounce', Math.sin(this.timeS * 1.1) * 0.015);
    add(p, 'ParamBrowLY', Math.sin(this.timeS * 0.37) * 0.008);
    add(p, 'ParamBrowRY', Math.sin(this.timeS * 0.37 + 0.7) * 0.008);
  }

  private applyAction(p: InteractionParameters, t: number): void {
    const walking = this.motion?.phase === 'walk' || this.action === 'walk';
    if (walking) {
      const stride = Math.sin(this.timeS * Math.PI * 4.2);
      add(p, 'ParamLegStrideL', stride * 30);
      add(p, 'ParamLegStrideR', -stride * 30);
      add(p, 'ParamArmSwingL', -stride * 17);
      add(p, 'ParamArmSwingR', stride * 17);
      add(p, 'ParamFootPlantL', stride >= 0 ? 1 : 0);
      add(p, 'ParamFootPlantR', stride < 0 ? 1 : 0);
      add(p, 'ParamBodyBounce', Math.abs(stride) * 0.12);
      add(p, 'ParamTailMood', -stride * 0.1);
    }
    switch (this.action) {
      case 'eat': this.applyEat(p, t); break;
      case 'drink': this.applyDrink(p, t); break;
      case 'wave': {
        const envelope = smoothstep(0, 0.15, t) * (1 - smoothstep(0.82, 1, t));
        add(p, 'ParamArmReachR', envelope);
        add(p, 'ParamArmSwingR', Math.sin(t * Math.PI * 8) * 24 * envelope);
        add(p, 'ParamEyeLSmile', 0.12 * envelope);
        add(p, 'ParamEyeRSmile', 0.12 * envelope);
        break;
      }
      case 'stretch': {
        const envelope = Math.sin(t * Math.PI);
        add(p, 'ParamArmReachL', envelope);
        add(p, 'ParamArmReachR', envelope);
        add(p, 'ParamShoulderLift', envelope);
        add(p, 'ParamBodyBounce', -0.08 * envelope);
        break;
      }
      case 'hop': {
        const jump = Math.sin(t * Math.PI);
        add(p, 'ParamBodyBounce', jump * 0.8);
        add(p, 'ParamLegStrideL', -12 * jump);
        add(p, 'ParamLegStrideR', -12 * jump);
        break;
      }
      case 'sit':
        add(p, 'ParamLegStrideL', -18 * smoothstep(0, 1, t));
        add(p, 'ParamLegStrideR', -18 * smoothstep(0, 1, t));
        add(p, 'ParamBodyBounce', -0.3 * smoothstep(0, 1, t));
        break;
      case 'sleep':
        add(p, 'ParamEyeLSmile', 0.25);
        add(p, 'ParamEyeRSmile', 0.25);
        add(p, 'ParamBodyBounce', -0.2);
        add(p, 'ParamEarMoodL', -0.18);
        add(p, 'ParamEarMoodR', -0.18);
        break;
      case 'wake':
        add(p, 'ParamShoulderLift', Math.sin(t * Math.PI) * 0.35);
        add(p, 'ParamMouthOpenY', Math.sin(t * Math.PI) * 0.16);
        break;
      case 'inspect':
        add(p, 'ParamArmReachL', Math.sin(t * Math.PI) * 0.65);
        add(p, 'ParamBrowRY', Math.sin(t * Math.PI) * 0.08);
        break;
      case 'celebrate': {
        const bounce = Math.abs(Math.sin(t * Math.PI * 3));
        add(p, 'ParamArmReachL', 0.85);
        add(p, 'ParamArmReachR', 0.85);
        add(p, 'ParamBodyBounce', bounce * 0.55);
        add(p, 'ParamEyeLSmile', 0.2);
        add(p, 'ParamEyeRSmile', 0.2);
        break;
      }
      case 'stumble':
        add(p, 'ParamBodyPullX', Math.sin(t * Math.PI * 2) * (1 - t) * 0.8);
        add(p, 'ParamShoulderLift', Math.sin(t * Math.PI) * 0.5);
        break;
      case 'recover':
        add(p, 'ParamBodyPullX', Math.sin(t * Math.PI) * 0.12);
        add(p, 'ParamBodyBounce', -Math.sin(t * Math.PI) * 0.08);
        break;
      case 'tail_react':
        add(p, 'ParamShoulderLift', Math.sin(t * Math.PI) * 0.28);
        add(p, 'ParamEyeLSmile', -Math.sin(t * Math.PI) * 0.08);
        add(p, 'ParamEyeRSmile', -Math.sin(t * Math.PI) * 0.08);
        break;
      default:
        break;
    }
  }

  private applyEat(p: InteractionParameters, t: number): void {
    add(p, 'ParamPropFood', 1 - smoothstep(0.86, 1, t));
    const reach = smoothstep(0.02, 0.24, t) * (1 - smoothstep(0.78, 0.96, t));
    add(p, 'ParamArmReachR', reach);
    add(p, 'ParamMouthOpenY', smoothstep(0.2, 0.3, t) * (1 - smoothstep(0.34, 0.42, t)) * 0.72);
    const chewWindow = smoothstep(0.38, 0.46, t) * (1 - smoothstep(0.78, 0.86, t));
    add(p, 'ParamChew', Math.abs(Math.sin(t * Math.PI * 14)) * chewWindow);
    add(p, 'ParamCheekPuff', chewWindow * 0.5);
    add(p, 'ParamSwallow', smoothstep(0.78, 0.88, t) * (1 - smoothstep(0.9, 0.98, t)));
    add(p, 'ParamEyeLSmile', chewWindow * 0.12);
    add(p, 'ParamEyeRSmile', chewWindow * 0.12);
  }

  private applyDrink(p: InteractionParameters, t: number): void {
    add(p, 'ParamPropDrink', 1 - smoothstep(0.88, 1, t));
    const reach = smoothstep(0.03, 0.25, t) * (1 - smoothstep(0.8, 0.97, t));
    add(p, 'ParamArmReachL', reach);
    add(p, 'ParamMouthOpenY', smoothstep(0.24, 0.34, t) * (1 - smoothstep(0.72, 0.8, t)) * 0.2);
    add(p, 'ParamSwallow', Math.max(0, Math.sin(t * Math.PI * 8)) * smoothstep(0.35, 0.5, t) * (1 - smoothstep(0.72, 0.82, t)));
  }

  private applyGrab(p: InteractionParameters): void {
    if (!this.grabbedPart || this.motion?.phase !== 'drag') return;
    const x = clamp((this.motion.lagX ?? 0) / 120, -1, 1);
    const y = clamp((this.motion.lagY ?? 0) / 120, -1, 1);
    add(p, 'ParamBodyPullX', x * (this.grabbedPart === 'tail' ? 0.6 : 0.22));
    add(p, 'ParamBodyPullY', y * (this.grabbedPart === 'tail' ? 0.45 : 0.18));
    if (this.grabbedPart === 'tail') {
      add(p, 'ParamTailGrab', 1);
      add(p, 'ParamTailStretch', Math.min(1, Math.hypot(x, y)) * 0.32);
      add(p, 'ParamShoulderLift', Math.min(1, Math.hypot(x, y)) * 0.22);
    }
  }
}
