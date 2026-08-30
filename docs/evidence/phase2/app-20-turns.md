# Phase 2 — 20 real turns in the shipping app — NOT MEASURED

This file is a placeholder, not a result. **The 20-real-turn pass through the shipping app was
never run.**

- prompt-cache hit, turns 3-20: **NOT MEASURED** (bar >= 70 %, X1)
- first grapheme painted after sentence 0 arrived, p50: **NOT MEASURED** (bar <= 100 ms, addendum §0)
- compliance misses: NOT MEASURED
- regenerated turns: NOT MEASURED

The test exists and is wired: `apps/desktop/tests-e2e/phase2.spec.ts` → `20 real turns: cache hit,
paint latency, composited desktop, interruption marker`. It carries
`test.skip(!process.env.DEEPSEEK_API_KEY)` and, with the key present, fails at the first turn
because the owner's DeepSeek account returns HTTP 402 **Insufficient Balance** (2026-08-29). See
[`not-measured.md`](not-measured.md) for the verification and the exact re-run command.

There is deliberately **no `app-20-turns.json`**.

## What the offline lane did measure in the same window

These are real measurements of the real built app, driven by the offline echo brain
(`DS_FAKE_BRAIN=1`) — they say nothing about DeepSeek's latency or its prompt cache, and none of
their numbers stands in for the bars above:

- [`app-desktop.png`](app-desktop.png) — the pet and a **speaking** band composited on the actual
  desktop, mouth open, band over her lower third.
- [`app-history-interrupted.png`](app-history-interrupted.png) — the `[中断]` row after `Escape`
  mid-reply, with the history keeping exactly the one sentence whose `playback:sentenceDone`
  arrived (R2).
- [`app-inapp-checks.md`](app-inapp-checks.md) — hover pin, drag-follow, display reconciliation and
  the abandoned-IME case.
- [`resources.md`](resources.md) — idle and speaking CPU / working set over the whole Electron
  process tree.
