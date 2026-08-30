# Phase 2 — the in-app checks Task 6 could not exercise

Driven by `apps/desktop/tests-e2e/phase2.spec.ts` against the built app on a throwaway
user-data directory with `DS_FAKE_BRAIN=1`, so none of it depends on a DeepSeek balance.

| check | verdict | detail |
|---|---|---|
| hover holds the window interactive | PASS | setIgnoreMouseEvents(false) observed on the bubble window; still visible true after 5 s of hover (hide was armed at 3.4 s) |
| the bubble follows a drag of the pet | PASS | pet moved (-180, -60); band moved (-180, -60) |
| display-removal reconciliation | UNTESTABLE | only 1 display on this machine, so a real unplug cannot be produced. The handler path was exercised synthetically (screen.emit('display-removed') + ('display-metrics-changed')): pet inside work area true, band inside work area true, band top at 64.7 % of the pet. |
| pointerleave re-arms the hide | PASS | the first message had armed a hide; while the pointer was on the band it never fired, and the band hid within 20 s of pointerleave: true |
| Escape mid-reply: chat stays open, history marks [中断] | PASS | 6.2 rule 4 (Escape while brainState !== idle cancels and does not close) and R2 (the history row keeps only the sentences whose playback:sentenceDone arrived, and carries the [中断] chip) |
| an abandoned IME composition is dismissed cleanly | PASS | Escape swallowed while composing (window survived: true); nothing committed to the composer (value ""); after the abandoned composition Escape closes and light-dismiss works again (true) |
