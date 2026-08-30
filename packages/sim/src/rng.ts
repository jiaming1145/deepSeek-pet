/**
 * Seeded mulberry32 (§1.3, R3-1). The state is one uint32 held in `SimState.rngState`, so a
 * persisted snapshot replays bit-identically. No module-level state, no Math.random.
 */
export const RNG_DEFAULT_SEED = 0x9e3779b9;

/** Normalises any number to a uint32 state (floor, then wrap). */
export function seedRng(seed: number): number {
  return Math.floor(seed) >>> 0;
}

/** One mulberry32 step. `value` is uniform in [0, 1); `rngState` is the next uint32 state. */
export function nextRandom(rngState: number): { value: number; rngState: number } {
  const next = (rngState + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rngState: next };
}
