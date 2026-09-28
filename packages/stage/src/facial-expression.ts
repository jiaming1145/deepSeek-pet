import type { Emotion } from '@ds/protocol';

export const FACIAL_PRESET_IDS = [
  'neutral', 'curious', 'joyful', 'angry', 'sad', 'sleepy', 'surprised',
  'awkward', 'thinking', 'questioning', 'listening', 'error_panic', 'affection',
] as const;
export type FacialPresetId = (typeof FACIAL_PRESET_IDS)[number];

export const FACIAL_PARAMETER_IDS = [
  'ParamEyeLSmile', 'ParamEyeRSmile', 'ParamBrowLY', 'ParamBrowRY',
  'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamMouthForm', 'ParamMouthOpenY',
  'ParamTere', 'ParamAnger', 'ParamFaceShadow', 'ParamCheekPuff',
  'ParamNoseScrunch', 'ParamFaceSquash', 'ParamEarMoodL', 'ParamEarMoodR',
  'ParamBrowInnerUpL', 'ParamBrowInnerUpR', 'ParamBrowOuterUpL',
  'ParamBrowOuterUpR', 'ParamBrowDownL', 'ParamBrowDownR', 'ParamEyeWideL',
  'ParamEyeWideR', 'ParamEyeSquintL', 'ParamEyeSquintR', 'ParamUpperLidDropL',
  'ParamUpperLidDropR', 'ParamLowerLidRaiseL', 'ParamLowerLidRaiseR',
  'ParamPupilScale', 'ParamIrisFocusX', 'ParamIrisFocusY', 'ParamMouthSmile',
  'ParamMouthFrown', 'ParamMouthPucker', 'ParamMouthStretch', 'ParamLipPress',
  'ParamJawOpen', 'ParamCheekRaiseL', 'ParamCheekRaiseR', 'ParamCheekTension',
  'ParamTearL', 'ParamTearR', 'ParamFacePale',
] as const;
export type FacialParameterId = (typeof FACIAL_PARAMETER_IDS)[number];
export type FacialControls = Partial<Record<FacialParameterId, number>>;

const p = (values: FacialControls): Readonly<FacialControls> => Object.freeze(values);

/**
 * Full-strength poses are deliberately asymmetric and multi-dimensional. Symbols are not part of
 * this table: they are optional expression assets layered after the face has already communicated
 * the emotion.
 */
export const FACIAL_PRESETS: Record<FacialPresetId, Readonly<FacialControls>> = {
  neutral: p({}),
  curious: p({
    ParamBrowInnerUpL: 0.2, ParamBrowOuterUpL: 0.55, ParamBrowDownR: 0.12,
    ParamEyeWideL: 0.18, ParamEyeWideR: 0.08, ParamIrisFocusX: 0.32,
    ParamIrisFocusY: 0.24, ParamMouthPucker: 0.18, ParamMouthForm: -0.04,
    ParamEarMoodL: 0.38, ParamEarMoodR: 0.08,
  }),
  joyful: p({
    ParamEyeLSmile: 0.82, ParamEyeRSmile: 0.88, ParamEyeSquintL: 0.38,
    ParamEyeSquintR: 0.42, ParamLowerLidRaiseL: 0.48, ParamLowerLidRaiseR: 0.52,
    ParamBrowOuterUpL: 0.22, ParamBrowOuterUpR: 0.2, ParamMouthSmile: 0.92,
    ParamMouthForm: 0.72, ParamMouthOpenY: 0.46, ParamJawOpen: 0.38,
    ParamCheekRaiseL: 0.66, ParamCheekRaiseR: 0.7, ParamTere: 0.24,
    ParamEarMoodL: 0.46, ParamEarMoodR: 0.48,
  }),
  angry: p({
    ParamBrowDownL: 0.82, ParamBrowDownR: 0.9, ParamBrowLAngle: -0.72,
    ParamBrowRAngle: 0.76, ParamEyeSquintL: 0.48, ParamEyeSquintR: 0.56,
    ParamUpperLidDropL: 0.28, ParamUpperLidDropR: 0.34, ParamPupilScale: -0.18,
    ParamIrisFocusY: 0.08, ParamMouthFrown: 0.62, ParamLipPress: 0.72,
    ParamMouthForm: -0.68, ParamNoseScrunch: 0.58, ParamCheekTension: 0.7,
    ParamAnger: 1, ParamEarMoodL: -0.72, ParamEarMoodR: -0.78,
  }),
  sad: p({
    ParamBrowInnerUpL: 0.72, ParamBrowInnerUpR: 0.78, ParamBrowOuterUpL: -0.24,
    ParamBrowOuterUpR: -0.28, ParamUpperLidDropL: 0.2, ParamUpperLidDropR: 0.24,
    ParamLowerLidRaiseL: 0.18, ParamLowerLidRaiseR: 0.22, ParamIrisFocusY: -0.22,
    ParamMouthFrown: 0.78, ParamMouthStretch: 0.14, ParamMouthForm: -0.76,
    ParamLipPress: 0.16, ParamCheekTension: -0.28, ParamTearL: 0.38,
    ParamTearR: 0.44, ParamFaceShadow: 0.14, ParamEarMoodL: -0.62,
    ParamEarMoodR: -0.68,
  }),
  sleepy: p({
    ParamUpperLidDropL: 0.72, ParamUpperLidDropR: 0.78, ParamEyeSquintL: 0.24,
    ParamEyeSquintR: 0.28, ParamBrowOuterUpL: -0.18, ParamBrowOuterUpR: -0.22,
    ParamIrisFocusY: -0.38, ParamPupilScale: 0.08, ParamMouthPucker: 0.34,
    ParamMouthOpenY: 0.22, ParamJawOpen: 0.18, ParamCheekTension: -0.34,
    ParamEarMoodL: -0.46, ParamEarMoodR: -0.5,
  }),
  surprised: p({
    ParamBrowInnerUpL: 0.84, ParamBrowInnerUpR: 0.86, ParamBrowOuterUpL: 0.76,
    ParamBrowOuterUpR: 0.78, ParamEyeWideL: 0.88, ParamEyeWideR: 0.9,
    ParamPupilScale: -0.32, ParamMouthPucker: 0.68, ParamMouthOpenY: 0.72,
    ParamJawOpen: 0.76, ParamFaceSquash: -0.2, ParamCheekTension: 0.18,
    ParamEarMoodL: 0.82, ParamEarMoodR: 0.86,
  }),
  awkward: p({
    ParamBrowInnerUpL: 0.12, ParamBrowOuterUpL: 0.48, ParamBrowDownR: 0.3,
    ParamEyeSquintL: 0.42, ParamUpperLidDropR: 0.18, ParamIrisFocusX: -0.48,
    ParamMouthSmile: 0.18, ParamMouthStretch: 0.42, ParamLipPress: 0.3,
    ParamMouthForm: -0.14, ParamCheekRaiseL: 0.14, ParamCheekRaiseR: 0.34,
    ParamTere: 0.72, ParamCheekTension: 0.34, ParamEarMoodL: -0.34,
    ParamEarMoodR: 0.08,
  }),
  thinking: p({
    ParamBrowInnerUpL: 0.18, ParamBrowDownR: 0.28, ParamBrowOuterUpL: 0.34,
    ParamEyeSquintR: 0.22, ParamIrisFocusX: -0.46, ParamIrisFocusY: 0.42,
    ParamMouthPucker: 0.42, ParamMouthStretch: 0.18, ParamLipPress: 0.22,
    ParamCheekRaiseL: 0.12, ParamEarMoodL: 0.18, ParamEarMoodR: -0.14,
  }),
  questioning: p({
    ParamBrowOuterUpL: 0.72, ParamBrowInnerUpL: 0.28, ParamBrowDownR: 0.08,
    ParamEyeWideL: 0.28, ParamEyeWideR: 0.12, ParamIrisFocusX: 0.18,
    ParamMouthOpenY: 0.16, ParamMouthPucker: 0.28, ParamMouthForm: 0.04,
    ParamEarMoodL: 0.52, ParamEarMoodR: 0.02,
  }),
  listening: p({
    ParamBrowInnerUpL: 0.16, ParamBrowInnerUpR: 0.18, ParamEyeWideL: 0.1,
    ParamEyeWideR: 0.12, ParamIrisFocusX: 0.4, ParamMouthOpenY: 0.09,
    ParamMouthSmile: 0.08, ParamCheekTension: -0.12, ParamEarMoodL: 0.34,
    ParamEarMoodR: 0.36,
  }),
  error_panic: p({
    ParamBrowInnerUpL: 0.9, ParamBrowInnerUpR: 0.94, ParamBrowDownL: 0.18,
    ParamBrowDownR: 0.24, ParamEyeWideL: 0.92, ParamEyeWideR: 0.96,
    ParamLowerLidRaiseL: 0.34, ParamLowerLidRaiseR: 0.38, ParamPupilScale: -0.52,
    ParamIrisFocusX: -0.12, ParamIrisFocusY: -0.08, ParamMouthFrown: 0.42,
    ParamMouthStretch: 0.72, ParamMouthOpenY: 0.64, ParamJawOpen: 0.58,
    ParamCheekTension: 0.84, ParamFacePale: 0.58, ParamFaceShadow: 0.4,
    ParamEarMoodL: -0.12, ParamEarMoodR: -0.16,
  }),
  affection: p({
    ParamEyeLSmile: 0.28, ParamEyeRSmile: 0.32, ParamLowerLidRaiseL: 0.28,
    ParamLowerLidRaiseR: 0.3, ParamBrowInnerUpL: 0.2, ParamBrowInnerUpR: 0.22,
    ParamMouthSmile: 0.58, ParamMouthForm: 0.48, ParamCheekRaiseL: 0.42,
    ParamCheekRaiseR: 0.46, ParamTere: 0.76, ParamCheekTension: -0.08,
    ParamEarMoodL: 0.34, ParamEarMoodR: 0.36,
  }),
};

export const EMOTION_TO_FACIAL_PRESET: Record<Emotion, FacialPresetId> = {
  neutral: 'neutral',
  happy: 'joyful',
  sad: 'sad',
  angry: 'angry',
  think: 'thinking',
  surprised: 'surprised',
  awkward: 'awkward',
  question: 'questioning',
  curious: 'curious',
};

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));

/** Continuous action-unit blender intended for both AI presets and direct application control. */
export class FacialExpressionController {
  private current: FacialControls = {};
  private target: FacialControls = {};
  private preset: FacialPresetId = 'neutral';
  private responseHz = 8;

  setPreset(preset: FacialPresetId, intensity = 1): void {
    this.preset = preset;
    const amount = Math.min(1, Math.max(0, intensity));
    this.target = Object.fromEntries(
      Object.entries(FACIAL_PRESETS[preset]).map(([id, value]) => [id, clamp(value * amount)]),
    ) as FacialControls;
  }

  setControls(controls: FacialControls, options: { replace?: boolean; responseHz?: number } = {}): void {
    if (options.responseHz !== undefined) this.responseHz = Math.min(30, Math.max(0.5, options.responseHz));
    const next = options.replace ? {} : { ...this.target };
    for (const [id, value] of Object.entries(controls)) {
      next[id as FacialParameterId] = clamp(Number.isFinite(value) ? value : 0);
    }
    this.target = next;
  }

  tick(deltaTimeS: number): Readonly<FacialControls> {
    const dt = Math.min(0.05, Math.max(0, Number.isFinite(deltaTimeS) ? deltaTimeS : 0));
    const gain = 1 - Math.exp(-this.responseHz * dt);
    const next: FacialControls = {};
    for (const id of FACIAL_PARAMETER_IDS) {
      const value = (this.current[id] ?? 0) + ((this.target[id] ?? 0) - (this.current[id] ?? 0)) * gain;
      if (Math.abs(value) > 1e-5) next[id] = value;
    }
    this.current = next;
    return { ...next };
  }

  currentPreset(): FacialPresetId {
    return this.preset;
  }
}

