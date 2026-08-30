# Phase 2 post-tuning eval report — NOT MEASURED

This file is a placeholder, not a result. **No post-tuning judged eval run exists for Phase 2.**

The report this file would hold is produced by a live, judged
`pnpm --filter @ds/eval run eval` — 46 prompts × 3 runs = 138 turns, 16 axis gates and 8 shape
gates. On 2026-08-29 the owner's DeepSeek account returns HTTP 402 **Insufficient Balance** for
every chat completion, so no turn could be generated and no judgement could be made. The key
authenticates; the balance is empty. See [`not-measured.md`](not-measured.md) for the verification
and for the exact commands that will produce the real file.

There is deliberately **no `eval-report-final.json`**. A machine-readable report is either a
measurement or a lie; a `--dry` run against Task 9's recorded corpus, or the `DS_FAKE_BRAIN` echo
brain, copied under that name would be the second thing.

Nothing else was substituted in its place:

- The A-bar (the judged writing-quality bar: A9 in-character, A19 nativeness, A3/A4/A5 leakage,
  A13 initiative, A15 refusal language, A16 sycophancy push-back, A17 humour stops, A18 emoji
  discipline, A19 memory use, P2 false disagreement) is **neither passed nor failed — unmeasured**.
- The persona tuning loop ran **zero** of its three permitted iterations
  ([`tuning-log.md`](tuning-log.md)), so `characters/haru/character.json` is byte-identical to its
  Task 3 state and `cardTokens` is still 673 / 700.
- [`eval-report.json`](eval-report.json) / [`eval-report.md`](eval-report.md) — Task 9's committed
  baseline — carry `config.dry === true`. They exercise the harness, the fixture, the aggregation
  and the gate arithmetic against a recorded corpus. They are **not** a measurement of DeepSeek's
  output either, and the evidence sheet says so.
