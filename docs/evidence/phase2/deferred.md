# Phase 2 — what was deliberately not built, and what the numbers really cover

The closing ledger for Phase 2 (brain · 对话框 · 输入). It exists so nothing on the list below can
later be mistaken for an oversight. Sources: `.superpowers/sdd/2026-08-29-phase2-brain/rulings.md`
("Defers", R8, P1–P5) and `contracts.md` §8.5.

## Deferred by ruling

| Item | Where it went | Why |
|---|---|---|
| A8 — persona bleed, 3 personas × 20 prompts, blind attribution ≥ 85 % | Phase 3 | Only one persona exists in Phase 2; the criterion is unsatisfiable, not unmet. |
| A14 — proactive lines and their manipulation audit | Phase 3 | Needs the behaviour engine and the proactive scheduler. |
| C4 — solid fallback when Windows transparency is off | Phase 4 | Needs the settings surface to expose the switch. |
| C7 — bubble stacking and a draggable, persisted offset | Phase 3 | One band, one turn at a time, is the Phase 2 shape. |
| C10 — subtitle controls (font size, opacity, linger, position) | Phase 4 | Lives in the settings window, which is Phase 4. |
| C13 — side-by-side comparison against a default shadcn/Ant screenshot | Phase 4 polish | The impeccable detector run (0 findings) was done in T8; the comparison sheet was not. |
| X6 — balance/cost meter from `usage` | Phase 4 | Needs the metrics tab. `usage` is logged per turn today, but nothing renders it. |
| X9 — balance check, persona pick, time-to-pet-on-screen | Phase 4 | `key:test` stays a 1-token chat call in Phase 2; no balance endpoint is called. |
| X12 — nightly eval run | Phase 4 | The harness is manual in Phase 2; the scheduler is Phase 4. |
| spec §8 — a runtime warning when cache-hit drops below 50 % | Phase 4 | Belongs in the metrics tab. |
| Privacy-note link in the key window | Dropped for Phase 2 | The page it would link to does not exist; the one-line disclosure ships instead. |
| 60 fps launch/resize/focus recording for C2 | Phase 4 polish | `backgroundColor '#00000000'` + `show:false` + `ready-to-show` are in place on every window; the recording is not. |
| CDP `Input.imeSetComposition` Playwright smoke | Not done | R6 made the IME test a jsdom unit test (`isComposing` is constructor-settable); the CDP smoke was optional and was not attempted. The abandoned-composition case IS exercised end to end in the Electron lane, with synthetic `compositionstart`/`compositionend` events — see `app-inapp-checks.md`. |
| P3 — the `mode: 'character' \| 'plain'` tray toggle and hotkey | Phase 3 | `renderStaticSystem(card, motionKeys, 'plain')` exists and is measured (184 tokens), so the second cache lineage is real from day one; only the switch that reaches it is deferred. |
| P4 — the commissioned whale-girl model | Later | Haru (a uniformed schoolgirl sample) is a stand-in. The card's 尾鳍 / 拍水 lines are spoken, not animated. |
| E-3 `trait` probes and the `trait_hit ≥ 0.80` threshold | Phase 3 | The axis ships wired but with **zero** prompts (`SKIP, n = 0`). Authoring probes against card text that Task 10's tuning loop is simultaneously rewriting is the "one file, two owners" defect the plan avoids; the threshold stays *proposed* until real probes exist. Since final-review **M-19** the fixture schema carries an optional `condition` string that `buildJudgeUser` renders as `【判定条件】`, and `validateFixture` rejects a `trait_hit` prompt without one — so the first real probe cannot fail by construction. |
| A10 — self-fact consistency, 30 probes × 3 sessions (final-review **M-21**) | Phase 3, with A8 | The harness has **no** A10 probe, axis or test; the sample is zero, not small, so A10 is not "directional" and is listed as not measured (`eval/README.md`, the report footer). Probes need the Phase 3 memory `facts()` surface to be worth writing. |
| A22 — the listening pose while the user types (final-review **I-14**, contract amendment **A-9**) | Phase 3 behaviour engine | Phase 2 pins `avatar:listening` = "an IME session is open": `{on:true}` comes from `compositionstart` only, focus and blur both send `{on:false}`. Latin typing, digits and paste never raise the pose. The richer meaning needs a **focus + keystroke producer in main that does not arm the light-dismiss guard** — putting `{on:true}` back on the composer's `focus` re-breaks light dismiss (T8 fix round 1). That producer belongs with the behaviour engine's pose system. |
| A12 — distinct greetings: first-open-of-day, late-night, long-gap (final-review **M-28**) | Phase 3, with the proactive scheduler / D4 night state | Only the fixed `first_mes` on first run exists. The state preamble already carries `localTime` and `sinceLastChat`, but nothing produces a greeting variant and no eval probe measures one. |
| Content-Security-Policy on the four renderers (final-review **M-26**) | Phase 4 packaging | No `onHeadersReceived` and no `<meta>` CSP anywhere; every sink is `textContent` / React text and sandbox + contextIsolation are on, so this is defence-in-depth. Lands with the ship-it hardening: `default-src 'self' app://local; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'`, relaxed for `ELECTRON_RENDERER_URL` in dev. |
| `nativeTheme` handling and an un-emulated Windows-dark capture (final-review **M-18**) | Phase 4 settings (theme toggle) | Every `app-*-dark.png` is a `page.emulateMedia({ colorScheme: 'dark' })` capture; main never touches `nativeTheme`, and T10 recorded that `themeSource = 'dark'` did not flip `matchMedia` in the renderer. The captures prove the stylesheet, not Windows dark mode. |
| Lazy key window (final-review carry 7) | Phase 4 packaging / perf | The key window's renderer process lives for the whole session although it is needed only on first run and key rotation; creating it on demand is one fewer process at no user cost. Part of the 750 MB working-set question below. |
| Bubble inside the pet window (final-review carry 7) | Phase 3/4 architecture decision | R3 gave the band its own `BrowserWindow`; one window with three surfaces (or `backgroundThrottling` on the hidden ones) is the alternative the 750 MB shortfall row names. Decide with the resource budget, not as a tuning knob. |
| `metrics` table retention (final-review carry 8) | Phase 4 metrics tab | The spec names no retention for `MetricsRecord` rows; `usage` is logged per turn and nothing prunes it. Decide when the metrics tab lands. |
| Typechecking `apps/desktop/tests-e2e/**` | Not done | That directory sits outside every tsconfig `include`, like the Phase 1 `tests/` directory: `apps/desktop/tsconfig.json` is `"lib": ["ES2022"]` with no `DOM`, and the specs call `page.evaluate(() => document…)`. Playwright transpiles them itself. A second tsconfig with `"lib": ["ES2022","DOM"]` would fix it and was not added. |
| `app://local` `serveRenderer` does not preserve HEAD / Range (gpt-review-2 **G2-8**) | Phase 4 packaging | `app-protocol.ts`'s `serveRenderer` answers a HEAD or `Range:` request with the plain GET body and status; no consumer needs ranges today (the renderers are small static files and `<audio>`/`<video>` are not used), so nothing breaks, but the handler is not a faithful static server. Fix with the packaging pass: 204-style empty body for HEAD, `206` + `Content-Range` for a single byte range. |

## Recorded deviations from the addendum

The nine deviations `contracts.md` §8.5 lists are in force. The first seven: `bubble:place` / `bubble:size` as two
channels; the added `bubble:hover`; the added `speech:mouth` / `speech:complete` relays; Space does
not complete the reveal (Enter on an empty composer does); `post_history_instructions` sits in the
latest user message rather than the system block; `DS_DEV_DEEPSEEK_KEY` — not `DEEPSEEK_API_KEY` —
is the dev app key; `environmentMatchGlobs` is deprecated in vitest 3 but present and honoured.

C-4 is also recorded: Chromium disables LCD sub-pixel anti-aliasing on transparent compositing
surfaces, so the band renders with grayscale AA. That is accepted, not a defect — the bar is crisp
grayscale at a 300 % crop with no colour fringing required.

**The eighth deviation, added by Task 10 on the controller's ruling of 2026-08-29:** `placeBubble`
is no longer a head-anchored flip/shift popover. `BUBBLE_GAP` is still exported as C6's number but
the band geometry does not use it as a gap to *her*, because the band **overlaps** her body by
design. The band is anchored at `BAND_ANCHOR_Y = 0.72` of the pet window's height with a hard
`BAND_TOP_MAX_FRACTION = 0.55` floor on its top edge, extends LEFT with her horizontal centre at
`BAND_PET_FRACTION = 0.80` of its width (her in its right third), and only ever takes the sides
`left` / `right`. The chat window goes through the same call instead of asking for `'top'`. This is
`task-0-direction.md`'s FIRST VIEWPORT and the direction-contract comment inside `bubble.html`,
which the shipped code was contradicting: `desktop-chat-over-pet.png` and `task6-fake-brain-run.png`
show the composer and the placeholder band across her FACE. `app-placement.png` and
`app-first-message-cold.png` are the same surfaces after the fix.

**This ledger is not where that change lives.** Review round 1 was right that a deferral note is no
substitute for the contract, so `contracts.md` §5.3, §5.3.1, §6.1, §8.5 (deviations 8 and 9), §8.6
row 16 and §8.7's `placeBubble` row were amended to the shipped geometry in the same change-set, and
`bubble-place.test.ts` test **G2** pins the five re-measured rects. A Phase 3 task reading the
contract now gets the code that exists.

**A ninth deviation, added in fix round 1:** `placeBubble` takes a fifth argument, `avoid`. The
composer takes the band's anchor rect, but §6.2 rule 4 holds it open for the whole reply and rule 6
needs it open to restore the text on an error — so both always-on-top windows are on screen at once
and were rendering two different texts into the same rectangle (visible in `app-placement.png`
behind and around the composer box, and worked around in `phase2.spec.ts`, which used to send
`chat:close` before capturing `app-desktop.png`). The composer keeps the rect; the **band** steps
below it, or above it when the work area has no room below. `brain-service.ts` supplies `avoid` from
the chat window's bounds on every band placement and re-places the band on the chat window's
`show` / `hide` and on `chat:resize`. Hiding the band while the composer is up was the other
candidate and was rejected: it would make her whole reply invisible for as long as the composer is
open.

## What the Phase 2 numbers actually cover

- **The judged, live half of Phase 2 was never measured.** The owner's DeepSeek account returns
  HTTP 402 *Insufficient Balance* for every chat completion (verified 2026-08-29; the key
  authenticates, a bad key would return 401). So: no post-tuning eval report, no session latency,
  no live prompt-cache figure, no in-app 20-turn pass, and **zero** of R8's three permitted persona
  tuning iterations. Every one of those is recorded as NOT MEASURED — never estimated, never
  substituted with a `--dry` or `DS_FAKE_BRAIN` number. [`not-measured.md`](not-measured.md) carries
  the verification and the exact command list that produces all of it once the balance is topped up.
- **Task 9's committed baseline `eval-report.{json,md}` is a `--dry` run** (`config.dry === true`),
  not the "pre-tuning online baseline" the plan describes. It exercises the fixture, the lint pass,
  the aggregation and the 27 gate rows against `eval/recorded/`, and its `pass: true` says the
  harness works — not that DeepSeek's output clears the bar. Phase 2 therefore ships **no** live
  judged number at all.
- The eval fixture is **46 prompts × 3 runs = 138 turns** — R8's mix (8 bland · 8 adversarial ·
  6 sensitive · 6 flawed · 6 memory · 6 humour = 40) plus P2's 6-prompt `valid` control set. The
  addendum's denominators for A3 (200 turns), A4 (500 turns), A5 (200 turns) and A9 (50
  adversarial turns) are **not** met at this size, and the per-axis denominators are smaller
  still: 24 bland turns behind A13, 18 each behind A15, A16, A19 and P2, 9 behind A17. Every axis
  number the harness can produce is therefore **directional**. The full-denominator run is the
  Phase 4 nightly job (X12).
- A10 (self-fact consistency, 30 probes × 3 sessions) is **not measured at all**, not
  "directional": the harness has no A10 probe, axis or test, so the sample is zero (final-review
  M-21). It sits with A8 in the "Deferred by ruling" table above.
- A8 (persona bleed across 3 personas, blind attribution ≥ 85 %) is **out of Phase 2** — only one
  persona exists, so the criterion is unsatisfiable rather than unmet. It moves to Phase 3.
- The report gates **27 rows**: 17 axes (the 14 in `AXIS_SPECS` plus `emoji_discipline_sensitive`,
  `in_character_flips` and `judge_error_rate`) and 10 shape metrics (the original 8 plus
  `emojiMultiCount` and `markdownLintCount`). `in_character_flips = 0` is A9's second half — a judge
  score of 0 is by the rubric's definition the therapist/assistant flip, and the mean/pct2 pair alone
  let 13 of 138 through (final-review I-13). `emojiMultiCount = 0` is A18's per-reply half (M-20).
  `trait_hit` is one of the 17 and reports `SKIP (n = 0)`; a skipped row counts as passed and proves
  nothing. Opener-repeat, affect-rate, the other lint-rule counts and the judge/shape emoji
  disagreement count are **reported, not gated**.
- What each pass reads (final-review I-12). The **judge** reads `raw` — the reply with the
  `<|ACT …|>` tags stripped by `StreamParser` but **before** `sanitizeForDisplay` — so the rubric's
  markdown / stage-direction clauses can actually fire. The **linter** also reads `raw`, and its
  `markdown` rule count is gated (`markdownLintCount = 0`). The **shape metrics** read `reply`
  (sanitized), i.e. the text the user sees. The harness never regenerates and never strips; the
  shipped `TurnRunner` does both on top (R4), so live quality is **≥** these numbers.
- Persona tuning is bounded to **three iterations** (R8). [`tuning-log.md`](tuning-log.md) records
  that **zero** ran and why. `characters/haru/character.json` is byte-identical to its Task 3 state.
- `session-20-turns.md` would measure R4's amended bar — *the first sentence closes ≤ 1.2 s p50* —
  on `StreamParser`, and would also record `first emit after send`, which is when `TurnRunner`
  actually hands sentence 0 to the band: `contracts.md` §3.11.2 holds sentence *k* until sentence
  *k+1* closes, so on a multi-sentence reply the first painted grapheme follows the **second**
  sentence. That one-sentence lookahead is a real structural cost, it is recorded rather than fixed
  here, and it is the Phase 2 finding the controller should look at before Phase 3 — but its size
  is unmeasured for the same balance reason.
- The offline lane is real: `session:dry` proves the statistics and the report writer, the whole
  Electron end-to-end lane runs on `DS_FAKE_BRAIN=1` against the built binary and a throwaway
  user-data directory, and the light/dark shipping-app sheet, the composited desktop captures, the
  resource samples and the six in-app checks are measurements of the actual app.
- The light/dark sheet exists twice on purpose. `sheet-*.png` and `chat-history-*.png` are T7/T8's
  **browser-harness** captures — deterministic, DPI-controlled, good for pixel review.
  `app-*.png` are the same surfaces in the **shipping Electron app**, and `app-desktop.png`,
  `app-first-message-cold.png` and `app-placement.png` are what the compositor actually puts on the
  desktop. A page screenshot cannot show a transparent always-on-top window over a Live2D pet; that
  is why both exist.

## Shortfalls recorded during Task 10

| What | Measured | Bar | Note |
|---|---|---|---|
| idle working set, whole Electron tree | **750.3 MB** | ≤ 250 MB (addendum §0) | **MISSED, by 3×.** 7 processes (main, GPU, utility, 4 renderers). `sample-resources.ps1` sums `WorkingSet64` per process, which double-counts shared pages, so the true footprint is lower than 750 MB — but not 3× lower, and the number is reported as the brief's own method produced it. Not re-rolled, not re-measured with a friendlier metric. A four-BrowserWindow Chromium shell at this budget is a Phase 3/4 architecture question (one window with three surfaces, or `backgroundThrottling` on the hidden ones), not a Task 10 tuning knob. |
| speaking working set | 742.2 MB | ≤ 250 MB | Same, while she was mid-reply. |
| idle CPU, whole Electron tree | 1.27 % | ≤ 4 % | **within bar** |
| speaking CPU | 3.36 % | ≤ 4 % | **within bar** (30 Hz pet + reveal timer + mouth sync) |
| cold-profile first message | **382 ms (light) / 720 ms (dark)** — the two launches in the committed `e2e-report.json` | ≤ 3 s (controller ruling) | **within bar**, on a virgin `--user-data-dir` every time. aa0e9df's replay fix holds. The 391–476 ms (round 1) and 688–721 ms (fix round 1) figures quoted in `README.md` came from earlier lane runs whose `e2e-report.json` was overwritten by fix round 2; the only surviving run record is the 382 / 720 pair (final-review M-23). |
| composer / band top edge vs the pet | 68.6 % of the pet window's height | ≥ 55 % (controller ruling) | **within bar, with one documented exception.** 68.6 % is the composer in the running app, both themes; 24 unit tests pin the rule across the whole band size range. The exception is the work-area yield — a window too tall to fit between the floor and the work-area bottom is placed against the work area, C14 outranking the floor (the 360 × 468 row below). Fix round 2 closed a hole the other way: round 1's composer dodge was gated on the work area alone, so with the history pane open every band flipped **above** the floor onto her face (460 × 320 landed at −10 % of the pet). The floor now outranks the dodge too, pinned by a sweep over every band size × three composer heights × three work areas. |
| band rect vs composer rect, both visible | disjoint whenever there is anywhere legal to dodge to | no shared pixel | **within bar for the shapes the app ships.** Fixed in review round 1: the band dodges the visible composer (`placeBubble`'s `avoid`). Pinned by seven unit tests over three work areas × four pet positions × three composer heights × the whole band size range, and asserted in the Electron lane while both windows are up (one-row composer, mid-reply, both themes). Two cases deliberately still overlap, both because somewhere else outranks the dodge: no room either side inside the work area (C14), and — added in fix round 2 — room only *above* the 55 % floor, which the history-open composer produces for every band. Her line then sits on her lower third under the composer's edge, which is the lesser of the two defects. |
| A9/A19 and the other 14 judged axes | NOT MEASURED | — | Insufficient balance. Neither passed nor failed. |
| R4 first-sentence p50 | NOT MEASURED | ≤ 1200 ms | Insufficient balance. |
| X1 prompt-cache hit | NOT MEASURED | ≥ 70 % | Insufficient balance. |
| addendum §0 paint latency | NOT MEASURED | ≤ 100 ms | Insufficient balance. |
| display-removal reconciliation | UNTESTABLE | — | One monitor on this machine. The handler path was exercised synthetically: the pet window is first moved **outside** the work area, then `screen.emit('display-removed')` and `('display-metrics-changed')` are fired, and the assertion is that `reconcileDisplays` pulled her back to a grabbable position and the band followed. That assertion fails if the handler is removed (it did not, before fix round 1 moved the windows out first). A physical unplug and a real scale change were still not produced. |
| the chat window with the history pane open (360 × 468 DIP) | top edge at 36 % of the pet | ≥ 55 % | **Deliberate exception.** 468 DIP does not fit between 55 % of the pet and the work-area bottom, so C14 (never cross the work area) wins and the window is placed against it. Still far below her face — the defect this replaced put the top edge at ~5 %. Pinned by its own unit test. Consequence, found in fix round 2: because this window is always against the work-area bottom there is never room **below** it, so the band cannot dodge downwards while the history pane is open. It now keeps its own row and overlaps the composer rather than flipping above the 55 % floor. |
| `eval-report-final.json`, `session-20-turns.json`, `app-20-turns.json` | not produced | — | A machine-readable report is either a measurement or a lie. The `.md` siblings exist and say NOT MEASURED. |
| `app-desktop.png`, `app-history-interrupted.png` | produced by the **offline** lane | — | The brief has the real-API test produce both. With the API unreachable they were produced on `DS_FAKE_BRAIN=1` instead — real windows, real compositor, real interruption path, scripted words. The real-API run would overwrite them. |
| `task-3-card-tokens.txt` | 140 bytes | > 200 bytes (the brief's own completeness floor) | The brief's Step 1 and Step 18 gates reject any evidence file under 200 bytes. That file is six correct lines and is 140 bytes. The gate's floor is wrong for it, not the file; both gates were run as written and this is the one row they flag. |
| the offline Electron lane | 4 passed | the brief says 3 | A fourth test carries the four in-app checks the controller ruled Task 10 must exercise. `e2e-report.json` records `expected: 4, unexpected: 0, skipped: 1` — the skip is the `20 real turns` test, gated on `DEEPSEEK_API_KEY`. |
| `phase2.spec.ts`'s `20 real turns` aggregation | fixed but **never executed** | — | Fix round 1 corrected the `t.usage !== null` filter (a `brain:error` entry has no `usage` at all, and `undefined !== null` is true, so one errored turn survived it and then threw a TypeError), carried the prompt id on the recorded turn instead of re-deriving it by position, and added an assertion that no turn errored. The test is still skipped for want of a key/balance, so those three lines have never run. Verified only by `tsc`. |
