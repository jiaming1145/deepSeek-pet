import { describe, expect, it } from 'vitest';
import { buildExpression, EXPRESSION_FILES } from './export-facial-expressions.mjs';

describe('facial exp3 export', () => {
  it('maps all twelve authored expression slots', () => {
    expect(Object.keys(EXPRESSION_FILES)).toEqual([
      'F01', 'F02', 'F03', 'F04', 'F05', 'F06',
      'F07', 'F08', 'F09', 'F10', 'F11', 'F12',
    ]);
    expect(new Set(Object.values(EXPRESSION_FILES)).size).toBe(12);
  });

  it('emits deterministic Cubism expression parameters', () => {
    const expression = buildExpression('F03', 'angry', {
      ParamMouthFrown: 0.62,
      ParamBrowDownL: 0.82,
      ParamUnused: 0,
    });
    expect(expression.Type).toBe('Live2D Expression');
    expect(expression.Parameters).toEqual([
      { Id: 'ParamBrowDownL', Value: 0.82, Blend: 'Add' },
      { Id: 'ParamMouthFrown', Value: 0.62, Blend: 'Add' },
    ]);
    expect(expression.FadeInTime).toBeGreaterThan(0);
    expect(expression.FadeOutTime).toBeGreaterThan(0);
    expect(Object.keys(expression)).toEqual([
      'Type', 'FadeInTime', 'FadeOutTime', 'Parameters',
    ]);
  });
});
