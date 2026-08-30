# Phase 2 session — NOT MEASURED

This file is a placeholder, not a result. **The 20-turn continuous-session probe was never run
against the real DeepSeek API.**

| metric | value | bar | verdict |
|---|---|---|---|
| first-sentence close p50 | NOT MEASURED | <= 1200 ms (R4 amended) | — |
| first-sentence close p90 | NOT MEASURED | (recorded) | — |
| first delta (TTFT) p50 | NOT MEASURED | (recorded) | — |
| first emit after send p50 | NOT MEASURED | (recorded) | — |
| prompt-cache hit, turns 3+ | NOT MEASURED | >= 70.0 % (X1) | — |

On 2026-08-29 the owner's DeepSeek account returns HTTP 402 **Insufficient Balance** for every chat
completion, so `pnpm --filter @ds/eval run session` cannot produce a turn. See
[`not-measured.md`](not-measured.md) for the verification and the exact re-run command.

There is deliberately **no `session-20-turns.json`**: a report file with invented numbers in it is
worse than a missing one.

## What DID run, and what it proves

`pnpm --filter @ds/eval run session:dry` runs the same 20-turn probe against a scripted client with
a deterministic cache schedule. It writes `eval/out/session-<stamp>.{json,md}` and reports
`cache-hit from turn 3 = 78.5 %`. That number is a property of the fixture in `eval/session.mjs`,
**not** of DeepSeek: it proves `percentile`, `cacheHitRatio`, `verdict` and
`renderSessionMarkdown` (11 unit tests in `scripts/phase2-stats.test.mjs`), the prompt assembly,
the `StreamParser` timing hooks and the report writer. It proves nothing at all about latency or
about DeepSeek's prompt cache, and it is not copied into this file under a different name.
