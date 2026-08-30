import { describe, expect, it } from 'vitest';
import { lookupMotion } from './motion-lookup';

const motionMap: Record<string, [string, number]> = { nod: ['TapBody', 0], think: ['Idle', 2] };

describe('lookupMotion (M-25)', () => {
  it('returns a declared motion', () => {
    expect(lookupMotion(motionMap, 'nod')).toEqual(['TapBody', 0]);
  });

  it('returns undefined for an absent key and for no key', () => {
    expect(lookupMotion(motionMap, 'wave')).toBeUndefined();
    expect(lookupMotion(motionMap, undefined)).toBeUndefined();
  });

  it('never resolves prototype members as motions', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(lookupMotion(motionMap, key)).toBeUndefined();
    }
  });
});
