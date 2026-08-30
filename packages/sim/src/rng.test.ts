import { describe, expect, it } from 'vitest';
import { RNG_DEFAULT_SEED, nextRandom, seedRng } from './rng.ts';

describe('rng (mulberry32, serialisable state)', () => {
  it('default seed is 0x9e3779b9 and seedRng normalises to uint32', () => {
    expect(RNG_DEFAULT_SEED).toBe(0x9e3779b9);
    expect(seedRng(-1)).toBe(0xffffffff);
    expect(seedRng(2 ** 32 + 5)).toBe(5);
    expect(seedRng(1.9)).toBe(1);
  });
  it('draws in [0,1) and advances the state', () => {
    let s = seedRng(RNG_DEFAULT_SEED);
    for (let i = 0; i < 10_000; i++) {
      const r = nextRandom(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      expect(Number.isInteger(r.rngState)).toBe(true);
      expect(r.rngState).toBeGreaterThanOrEqual(0);
      s = r.rngState;
    }
  });
  it('is deterministic: same state -> same draw, and a resumed state replays bit-identically', () => {
    const a = nextRandom(123);
    const b = nextRandom(123);
    expect(a).toEqual(b);
    let s1 = seedRng(7); let s2 = seedRng(7);
    const seq1: number[] = []; const seq2: number[] = [];
    for (let i = 0; i < 50; i++) { const r = nextRandom(s1); seq1.push(r.value); s1 = r.rngState; }
    // "persist" the state half-way through the second run, then resume from the serialised integer
    for (let i = 0; i < 25; i++) { const r = nextRandom(s2); seq2.push(r.value); s2 = r.rngState; }
    const persisted = JSON.parse(JSON.stringify({ rngState: s2 })) as { rngState: number };
    let s3 = persisted.rngState;
    for (let i = 0; i < 25; i++) { const r = nextRandom(s3); seq2.push(r.value); s3 = r.rngState; }
    expect(seq2).toEqual(seq1);
  });
  it('pins the first draw of the default seed', () => {
    // mulberry32(0x9e3779b9): state' = 0x9e3779b9 + 0x6D2B79F5 = 0x0B62F3AE (mod 2^32)
    expect(nextRandom(RNG_DEFAULT_SEED).rngState).toBe(0x0b62f3ae);
  });
});
