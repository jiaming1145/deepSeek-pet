import { describe, expect, it } from 'vitest';
import { CubismModelMatrix } from '@framework/math/cubismmodelmatrix';
import { ViewportFit, withOffscreenFrame } from './frame';

function fakeOffscreen() {
  const calls: string[] = [];
  return {
    calls,
    manager: {
      beginFrameProcess: () => calls.push('begin'),
      endFrameProcess: () => calls.push('end'),
      releaseStaleRenderTextures: () => calls.push('release'),
    },
  };
}

describe('withOffscreenFrame', () => {
  it('pairs begin with end + releaseStaleRenderTextures', () => {
    const { calls, manager } = fakeOffscreen();
    withOffscreenFrame(manager, {}, () => calls.push('work'));
    expect(calls).toEqual(['begin', 'work', 'end', 'release']);
  });

  it('still ends the frame when the work throws, and rethrows', () => {
    const { calls, manager } = fakeOffscreen();
    expect(() =>
      withOffscreenFrame(manager, {}, () => {
        calls.push('work');
        throw new Error('MouthDriver blew up');
      }),
    ).toThrow('MouthDriver blew up');
    expect(calls).toEqual(['begin', 'work', 'end', 'release']);
  });
});

describe('ViewportFit', () => {
  /** Haru-shaped: wider than tall in model units, and a model3.json Layout with no Width. */
  function matrixWithoutLayoutWidth(): { matrix: CubismModelMatrix; baseline: Float32Array } {
    const matrix = new CubismModelMatrix(2.0, 1.0);
    matrix.setupFromLayout(new Map<string, number>([['center_y', 0]]));
    return { matrix, baseline: new Float32Array(matrix.getArray()) };
  }

  it('returns to the post-layout baseline when the canvas goes portrait then landscape', () => {
    const { matrix, baseline } = matrixWithoutLayoutWidth();
    const fit = new ViewportFit();

    fit.apply(matrix, baseline, true); // portrait: fit by width
    expect(Array.from(matrix.getArray())).not.toEqual(Array.from(baseline));

    fit.apply(matrix, baseline, false); // landscape again
    expect(Array.from(matrix.getArray())).toEqual(Array.from(baseline));
  });

  it('only writes the matrix when the fit state changes', () => {
    const { matrix, baseline } = matrixWithoutLayoutWidth();
    const fit = new ViewportFit();

    fit.apply(matrix, baseline, true);
    const afterFirst = Array.from(matrix.getArray());

    // A caller mutating the matrix between frames must not be undone by a same-state apply.
    matrix.translateY(0.25);
    const mutated = Array.from(matrix.getArray());
    fit.apply(matrix, baseline, true);
    expect(Array.from(matrix.getArray())).toEqual(mutated);
    expect(mutated).not.toEqual(afterFirst);

    fit.apply(matrix, baseline, false);
    expect(Array.from(matrix.getArray())).toEqual(Array.from(baseline));
  });

  it('re-applies after reset()', () => {
    const { matrix, baseline } = matrixWithoutLayoutWidth();
    const fit = new ViewportFit();
    fit.apply(matrix, baseline, false);
    matrix.translateY(0.25);
    fit.reset();
    fit.apply(matrix, baseline, false);
    expect(Array.from(matrix.getArray())).toEqual(Array.from(baseline));
  });

  it('never uses setHeight, which would discard the Layout width/height', () => {
    const { matrix, baseline } = matrixWithoutLayoutWidth();
    let setHeightCalls = 0;
    const spy = {
      setMatrix: (tr: Float32Array) => matrix.setMatrix(tr),
      setWidth: (w: number) => matrix.setWidth(w),
      setHeight: () => setHeightCalls++,
    };
    const fit = new ViewportFit();
    fit.apply(spy, baseline, true);
    fit.apply(spy, baseline, false);
    expect(setHeightCalls).toBe(0);
  });
});
