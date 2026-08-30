import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bigramSet, jaccard } from '../../tok.ts';

/**
 * §8.11's shape, verbatim. It is declared HERE rather than in `eval/run.mjs` because the harness is
 * Task 6's file and this fixture must be provably well-formed the moment it is committed — A11 is
 * NOT MEASURED in Phase 3 (R3-32: the owner's DeepSeek account returns HTTP 402 for every chat
 * completion), so the schema test is the only thing standing between the fixture and a one-shot
 * run months later. CONTRACT GAP: §8.11 names no file for MemoryRecallFixtureSchema.
 */
export const MemoryRecallFixtureSchema = z.object({
  /** 20 facts, planted one per turn across the five sessions. */
  facts: z
    .array(
      z.object({
        id: z.string().regex(/^f[0-9]{2}$/),
        /** The user utterance that plants it — natural speech, never a command. */
        plant: z.string().min(4).max(60),
        /** Which session (1..5) plants it. At least 3 facts per session. */
        session: z.number().int().min(1).max(5),
        /** The expected `facts.key` after extraction, so a key drift is visible. */
        expectKey: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
      }),
    )
    .length(20),
  /** 20 probes, one per fact, PARAPHRASED — no probe shares a CJK bigram set with its plant above
   *  NEAR_DUPLICATE_JACCARD (0.6). */
  probes: z
    .array(
      z.object({
        id: z.string().regex(/^f[0-9]{2}$/),
        session: z.number().int().min(1).max(5),
        ask: z.string().min(4).max(60),
      }),
    )
    .length(20),
});

/** packages/memory/src/fixtures/memory -> repo root is five levels up. */
const PATH = fileURLToPath(
  new URL('../../../../../eval/fixtures/memory-recall.zh.json', import.meta.url),
);

describe('A11 recall fixture (contracts §8.11, R3-32 — shipped, NOT measured)', () => {
  const raw = JSON.parse(readFileSync(PATH, 'utf8')) as unknown;
  const parsed = MemoryRecallFixtureSchema.safeParse(raw);

  it('matches MemoryRecallFixtureSchema exactly', () => {
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  });

  const fx = MemoryRecallFixtureSchema.parse(raw);

  it('plants 20 facts with unique ids and unique keys, at least 3 per session', () => {
    expect(new Set(fx.facts.map((f) => f.id)).size).toBe(20);
    expect(new Set(fx.facts.map((f) => f.expectKey)).size).toBe(20);
    for (const s of [1, 2, 3, 4, 5]) {
      expect(fx.facts.filter((f) => f.session === s).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has exactly one probe per fact, and no probe precedes its plant', () => {
    expect(fx.probes.map((p) => p.id).sort()).toEqual(fx.facts.map((f) => f.id).sort());
    for (const p of fx.probes) {
      const plant = fx.facts.find((f) => f.id === p.id);
      expect(plant).toBeDefined();
      expect(p.session).toBeGreaterThanOrEqual(plant?.session ?? 0);
    }
  });

  it('probes 17 facts in a STRICTLY later session; the three planted in session 5 are probed within it', () => {
    // §8.11 asks for "a LATER session than the plant" AND "at least 3 facts per session" — with only
    // five sessions those cannot both hold for the session-5 plants. Recorded as Concern C-12.
    const later = fx.probes.filter(
      (p) => p.session > (fx.facts.find((f) => f.id === p.id)?.session ?? 0),
    );
    expect(later).toHaveLength(17);
    const same = fx.probes.filter((p) => !later.includes(p));
    expect(same.map((p) => p.id)).toEqual(['f18', 'f19', 'f20']);
    for (const p of same) expect(p.session).toBe(5);
  });

  it('every probe is a real paraphrase: bigram Jaccard against its plant is below 0.6', () => {
    let max = 0;
    for (const p of fx.probes) {
      const plant = fx.facts.find((f) => f.id === p.id);
      const j = jaccard(bigramSet(p.ask), bigramSet(plant?.plant ?? ''));
      max = Math.max(max, j);
      expect(j).toBeLessThan(0.6);
    }
    expect(max).toBeLessThan(0.1); // measured 0.0476 this session — the margin is not accidental
  });

  it('no plant is an imperative §8.5 would refuse to extract, and none names the persona (R3-19)', () => {
    for (const f of fx.facts) {
      expect(/^(请|帮我|记住|不要|别|你要|给我)/.test(f.plant)).toBe(false);
      expect(f.plant).not.toContain('小春');
    }
    for (const p of fx.probes) expect(p.ask).not.toContain('小春');
  });
});
