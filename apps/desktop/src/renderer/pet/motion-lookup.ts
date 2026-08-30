/**
 * Own-property lookup on the character's motion allow-list (final review M-25).
 *
 * `motionMap` is a plain object from zod's `z.record`, so a bare `motionMap[key]` walks the
 * prototype: `constructor`, `__proto__`, `toString`, `hasOwnProperty` … all come back truthy and
 * would reach `playMotion` as a non-tuple. Only keys the character actually declares count.
 */
export function lookupMotion<T>(motionMap: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  if (key === undefined || !Object.hasOwn(motionMap, key)) return undefined;
  return motionMap[key];
}
