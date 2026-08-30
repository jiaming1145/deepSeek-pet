# Phase 2 — the in-app checks Task 6 could not exercise

Driven by `apps/desktop/tests-e2e/phase2.spec.ts` against the built app on a throwaway
user-data directory with `DS_FAKE_BRAIN=1`, so none of it depends on a DeepSeek balance.

| check | verdict | detail |
|---|---|---|
| hover holds the window interactive | PASS | setIgnoreMouseEvents(false) observed on the bubble window; still visible true after 5 s of hover (hide was armed at 3.4 s) |
| the bubble follows a drag of the pet | PASS | pet moved (-180, -60); band moved (-180, -60) |
| display-removal reconciliation | UNTESTABLE | only 1 display on this machine, so a real unplug and a real scale change cannot be produced. The handler path was exercised synthetically: pet stranded at x 3160 (outside the work area: true); after display-removed + display-metrics-changed she is back at x 2512, grabbable true, and the band is inside the work area true. The assertion is not vacuous — it fails if reconcileDisplays is removed — but it is not the physical event either. |
| pointerleave re-arms the hide | PASS | the first message had armed a hide; while the pointer was on the band it never fired, and the band hid within 20 s of pointerleave: true |
| band and composer never share a pixel | PASS | mid-reply, both windows visible: band {"x":2047,"y":1144,"width":125,"height":114,"scaleFactor":1.5}, composer {"x":1858,"y":1082,"width":360,"height":50,"scaleFactor":1.5}, pet.y 588. The band steps below the composer (contracts 5.3 step 6 / 6.1), so app-desktop.png carries both. |
| Escape mid-reply: chat stays open, history marks [中断] | PASS | 6.2 rule 4 (Escape while brainState !== idle cancels and does not close) and R2 (the history row keeps only the sentences whose playback:sentenceDone arrived, and carries the [中断] chip) |
| an abandoned IME composition is dismissed cleanly | PASS | Escape swallowed while composing (window survived: true); nothing committed to the composer (value ""); after the abandoned composition Escape closes and light-dismiss works again (true) |
