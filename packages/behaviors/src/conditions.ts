import { z } from 'zod';
import type { ClockPhase, PresentationMode } from '@ds/protocol';

/** The twelve facts a condition may read. Nothing else is addressable. */
export const CONDITION_FACTS = [
  'phase', 'present', 'presentation', 'liveliness', 'mood', 'energy',
  'onFloor', 'nearEdge', 'cursorNear', 'userIdleS', 'affection', 'probableTyping',
] as const;
export type ConditionFact = (typeof CONDITION_FACTS)[number];

// The cast is load-bearing, not laziness: apps/desktop/tsconfig.renderer.json must keep
// `strictNullChecks: false` for the vendored Cubism Framework, and it compiles this file (the
// arbiter imports @ds/behaviors). With strictNullChecks off `undefined extends T` is true for
// every T, so zod 4 infers EVERY object key as optional (`eq?` instead of `eq`) and the inferred
// union stops matching `Condition`. The declared type below is the contract (§4.2) and is still
// checked for real by packages/behaviors/tsconfig.json, which is strict.
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ allOf: z.array(ConditionSchema).min(1).max(8) }),
  z.object({ anyOf: z.array(ConditionSchema).min(1).max(8) }),
  z.object({ not: ConditionSchema }),
  z.object({ fact: z.enum(CONDITION_FACTS), eq: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ fact: z.enum(CONDITION_FACTS), lt: z.number() }),
  z.object({ fact: z.enum(CONDITION_FACTS), gt: z.number() }),
  z.object({ fact: z.enum(CONDITION_FACTS), in: z.array(z.union([z.string(), z.number()])).min(1).max(8) }),
])) as z.ZodType<Condition>;
export type Condition =
  | { allOf: Condition[] } | { anyOf: Condition[] } | { not: Condition }
  | { fact: ConditionFact; eq: string | number | boolean }
  | { fact: ConditionFact; lt: number }
  | { fact: ConditionFact; gt: number }
  | { fact: ConditionFact; in: (string | number)[] };

/** The value each fact resolves to, built by the renderer from the latest SimSnapshot. */
export interface ConditionFacts {
  phase: ClockPhase;
  present: boolean;
  presentation: PresentationMode;
  liveliness: number;          // 0..1
  mood: number;                // SimSnapshot.valence, -1..1
  energy: number;              // 0..100
  onFloor: boolean;
  nearEdge: boolean;
  cursorNear: boolean;
  userIdleS: number;           // 0..3600
  affection: number;           // 0..100 (the SHOWN value, §3.6.3)
  probableTyping: boolean;
}

/** Static type of each fact, for the bind-time report (§4.2: "reported by bind()"). */
export const FACT_TYPES: Record<ConditionFact, 'string' | 'number' | 'boolean'> = {
  phase: 'string', present: 'boolean', presentation: 'string', liveliness: 'number', mood: 'number',
  energy: 'number', onFloor: 'boolean', nearEdge: 'boolean', cursorNear: 'boolean', userIdleS: 'number',
  affection: 'number', probableTyping: 'boolean',
};

/** Total; a type mismatch (`lt` on a boolean fact) evaluates to FALSE and is reported by bind(). */
export function evaluate(c: Condition | undefined, f: ConditionFacts): boolean {
  if (c === undefined) return true;
  if ('allOf' in c) return c.allOf.every((x) => evaluate(x, f));
  if ('anyOf' in c) return c.anyOf.some((x) => evaluate(x, f));
  if ('not' in c) return !evaluate(c.not, f);
  const v: string | number | boolean = f[c.fact];
  if ('eq' in c) return typeof v === typeof c.eq && v === c.eq;
  if ('lt' in c) return typeof v === 'number' && v < c.lt;
  if ('gt' in c) return typeof v === 'number' && v > c.gt;
  return typeof v !== 'boolean' && c.in.includes(v);
}

/** Every leaf whose operator cannot be true for its fact's type. [] = clean. */
export function conditionTypeIssues(c: Condition | undefined): string[] {
  if (c === undefined) return [];
  if ('allOf' in c) return c.allOf.flatMap(conditionTypeIssues);
  if ('anyOf' in c) return c.anyOf.flatMap(conditionTypeIssues);
  if ('not' in c) return conditionTypeIssues(c.not);
  const t = FACT_TYPES[c.fact];
  if ('eq' in c) return typeof c.eq === t ? [] : [`eq value type ${typeof c.eq} does not match fact ${c.fact} (${t})`];
  if ('lt' in c) return t === 'number' ? [] : [`lt on non-number fact ${c.fact}`];
  if ('gt' in c) return t === 'number' ? [] : [`gt on non-number fact ${c.fact}`];
  return t === 'boolean' ? [`in on boolean fact ${c.fact}`] : [];
}
