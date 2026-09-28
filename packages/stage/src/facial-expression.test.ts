import { describe, expect, it } from 'vitest';
import {
  FACIAL_PARAMETER_IDS, FACIAL_PRESET_IDS, FACIAL_PRESETS, FacialExpressionController,
} from './facial-expression';

describe('facial expression system', () => {
  it('gives every non-neutral preset a unique multi-action-unit signature', () => {
    const signatures = new Set<string>();
    for (const id of FACIAL_PRESET_IDS.filter((value) => value !== 'neutral')) {
      const entries = Object.entries(FACIAL_PRESETS[id]).filter(([, value]) => Math.abs(value) >= 0.08);
      expect(entries.length, id).toBeGreaterThanOrEqual(8);
      const signature = entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join('|');
      expect(signatures.has(signature), id).toBe(false);
      signatures.add(signature);
    }
  });

  it('covers brows, eyes, mouth, cheeks and fin ears across the atlas', () => {
    const used = new Set(Object.values(FACIAL_PRESETS).flatMap((controls) => Object.keys(controls)));
    for (const prefix of ['ParamBrow', 'ParamEye', 'ParamMouth', 'ParamCheek', 'ParamEar']) {
      expect([...used].some((id) => id.startsWith(prefix)), prefix).toBe(true);
    }
    expect(FACIAL_PARAMETER_IDS.length).toBeGreaterThan(40);
  });

  it('eases rather than snapping and accepts direct subtle controls', () => {
    const face = new FacialExpressionController();
    face.setPreset('angry');
    const first = face.tick(1 / 60);
    expect(first.ParamBrowDownL).toBeGreaterThan(0);
    expect(first.ParamBrowDownL).toBeLessThan(FACIAL_PRESETS.angry.ParamBrowDownL!);
    face.setControls({ ParamBrowDownL: 0.12, ParamMouthFrown: 0.08 }, { responseHz: 4 });
    for (let i = 0; i < 240; i++) face.tick(1 / 60);
    const settled = face.tick(1 / 60);
    expect(settled.ParamBrowDownL).toBeCloseTo(0.12, 2);
    expect(settled.ParamMouthFrown).toBeCloseTo(0.08, 2);
  });
});

