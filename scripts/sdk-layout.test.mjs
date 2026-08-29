import { describe, expect, it } from 'vitest';
import { destinationFor } from './sdk-layout.mjs';

const P = 'CubismSdkForWeb-5-r.5/';

describe('sdk layout', () => {
  it('routes Core files to vendor/core and the public copy', () => {
    expect(destinationFor(P + 'Core/live2dcubismcore.min.js')).toEqual([
      'vendor/core/live2dcubismcore.min.js',
      'apps/desktop/public/live2d/core/live2dcubismcore.min.js',
    ]);
    expect(destinationFor(P + 'Core/live2dcubismcore.d.ts')).toEqual(['vendor/core/live2dcubismcore.d.ts']);
    expect(destinationFor(P + 'Core/live2dcubismcore.js')).toEqual([]);
  });
  it('routes shaders', () => {
    expect(destinationFor(P + 'Framework/Shaders/WebGL/vertshadersrc.vert')).toEqual([
      'apps/desktop/public/live2d/shaders/vertshadersrc.vert',
    ]);
  });
  it('routes Haru and Hiyori model files, lowercase ids', () => {
    expect(destinationFor(P + 'Samples/Resources/Haru/Haru.moc3')).toEqual(['characters/haru/model/Haru.moc3']);
    expect(destinationFor(P + 'Samples/Resources/Haru/expressions/F01.exp3.json')).toEqual([
      'characters/haru/model/expressions/F01.exp3.json',
    ]);
    expect(destinationFor(P + 'Samples/Resources/Hiyori/motions/Hiyori_m01.motion3.json')).toEqual([
      'characters/hiyori/model/motions/Hiyori_m01.motion3.json',
    ]);
  });
  it('ignores everything else', () => {
    expect(destinationFor(P + 'Samples/Resources/Mao/Mao.moc3')).toEqual([]);
    expect(destinationFor(P + 'Samples/TypeScript/Demo/src/main.ts')).toEqual([]);
    expect(destinationFor(P + 'Core/')).toEqual([]);
  });
});
