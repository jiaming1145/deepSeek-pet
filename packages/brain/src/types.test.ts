import { describe, expect, it } from 'vitest';
import { EMOTIONS as P } from '@ds/protocol';
import { EMOTIONS as C } from './types.ts';

describe('brain types', () => {
  it('re-exports the protocol emotion list unchanged', () => {
    expect(C).toBe(P);
  });
});
