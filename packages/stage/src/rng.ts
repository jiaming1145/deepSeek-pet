/** A source of uniform numbers in [0, 1) - injectable so `?test=1` can make picks deterministic. */
export type Rng = () => number;

/**
 * Uniform index in [0, count).
 *
 * Clamped at both ends: `Math.random()` never returns 1, but an injected rng might, and a seeded one
 * returning 0 must land on index 0 (spec §9's "with a fixed seed").
 */
export function pickIndex(count: number, rng: Rng): number {
  if (!(count > 0)) return 0;
  const raw = Math.floor(rng() * count);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw >= count ? count - 1 : raw;
}
