# Fix lane RENDERER — report

Worktree: `D:\ds\.claude\worktrees\wf_d4736852-369-3`, branch `worktree-wf_d4736852-369-3`, based on main `16bf16a`.
Commits (oldest first): `a3fb167`, `e4eedb1`, `df4b78b`, `64c644b`, `b96174b`.

Checks run at the end of the lane (all verified — ran them, output in the session):
- `pnpm test` → 59 files, **625 passed**, 2 skipped (baseline main: 267 desktop tests; this lane adds 12).
- `pnpm -r --if-present typecheck` → protocol, brain, stage, memory, desktop (3 tsconfigs) all `Done`.
- `pnpm --filter @ds/desktop build` → `✓ built in 1.02s`.
- Evidence spec (scratch, not committed) → 2/2 passed; four PNGs read back with the Read tool.

Every finding the brief assigned was reproduced before it was fixed (a failing test first), and none turned out to be NOT A BUG.

## Findings

### I-4 — message > USER_TEXT_MAX silently destroyed — FIXED (`df4b78b`)
- Repro: `Composer.test.tsx` "restores the text when the send promise rejects (I-4)" — `onSend` = `Promise.reject`, 2000 × `字`, Enter → before the fix: `ta.value === ''` and vitest reported an **Unhandled Rejection**.
- Fix: `apps/desktop/src/renderer/chat/Composer.tsx` `submit()` wraps `await onSend(text)` in try/catch → `pendingRef = null; restore(text)`. Textarea gets `maxLength={USER_TEXT_MAX}`. A quiet `.composer__count` appears only in the last 200 characters: `还能写 N 字`, and `到 2000 字了` (warn tone, `data-at='cap'`) at the cap — caption size, `--c-text-3`, tabular numerals, sits inside the state line's right edge (`chat.css`).
- `packages/protocol/src/index.ts`: `export const USER_TEXT_MAX = 2000` (UTF-16 units — the unit `z.string().max`, `String.length` and `maxLength` agree on) and the `user:text` schema now uses it.
- Tests: the reject test above + "caps the textarea at USER_TEXT_MAX and shows a quiet counter only near the cap (I-4)".
- Decision: the counter's copy is in the composer's own register (short, no exclamation, same shape as `她在想…`); 200 was chosen as the "near" threshold — long enough to matter for a paste, invisible in normal chat.

### I-6 — band not re-shown after a hidden→shown edge mid-turn — FIXED (`a3fb167`)
- `apps/desktop/src/renderer/bubble/speech.ts`: `get active()` = `turnId !== null && (!finished || hideAt !== null)`.
- `apps/desktop/src/renderer/bubble/main.ts` `shell:visibility` handler: `{hidden:true}` unchanged; `{hidden:false}` → if `speech.active` then `bubble.show()` + `scheduleReport()`.
- Test: `speech.test.ts` "active is true from the first sentence through the linger, false once hidden (I-6)" (thinking → true; finished-and-lingering → true; after the linger → false; after `onError` → false). `main.ts` is module-level glue with no unit harness (as on main); the branch is four lines and reads only the tested getter.

### I-11 — hover-then-leave does not re-arm the linger — FIXED (`a3fb167`)
- Repro: `speech.test.ts` "hover-then-leave during the linger re-arms a full LINGER_MS (I-11)" — hover at +1.0 s, leave at +1.5 s, expect visible at `LINGER_MS - 1` after the leave → **received false** before the fix (the original timer fired at the original deadline).
- Fix: `speech.ts` per-arm token `hideArm`; every `scheduleHide()` increments it and the callback returns if it is stale. Chosen over a dedicated handle because the injected `raf` timer (the test clock and the contract's named seam) has no cancel API — a token works for both clocks.
- The pre-existing "pinned bubble stays up and re-arms on leave" test still passes.

### M-16 — transparent padding is part of the click/hover target — FIXED (`e4eedb1`)
- `bubble.css`: `.bubble { pointer-events: none }`, `.bubble__surface, .bubble__plate { pointer-events: auto }`. Listeners stay on `#bubble` (pointerenter/leave and click are delivered to ancestors of the hit target), so `bubble:hover` semantics and the Playwright `#bubble` hover/click specs are unchanged. The anchor notch (3 px) and rail (inside the surface's box) were left out of the target on purpose.
- Test: `bubble-css.test.ts` "M-16".
- Decision: the CSS route rather than re-binding on two elements keeps one listener set. (Corrected in fix round 1: on its own it did NOT avoid a leave/enter pair when the pointer crossed the 4 px transparent gap between the plate and the surface — see "Fix round 1" M-16 below for the bridge that closes it.)

### M-25 (renderer half) — motion allow-list walks the prototype — FIXED (`64c644b`)
- New `apps/desktop/src/renderer/pet/motion-lookup.ts` `lookupMotion(motionMap, key)` using `Object.hasOwn`; `pet/main.ts:176` uses it.
- Test: `motion-lookup.test.ts` — `constructor`, `__proto__`, `toString`, `hasOwnProperty`, `valueOf` all → `undefined`; declared key → tuple; absent/undefined → `undefined`.
- Decision: a five-line helper so the behaviour is unit-testable (`pet/main.ts` has no harness); no change to `TurnRunner.consider` (brain lane).

### M-15 — composer beyond CHAT_MAX_ROWS unreachable — FIXED (`df4b78b`)
- `chat.css .composer__input`: `overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--c-border-strong) transparent;` plus `::-webkit-scrollbar` (4 px thumb, `--r-tooltip`, transparent track). `auto` means the 1–6 row band is pixel-identical; the bar appears only when content exceeds six rows. Auto-grow measurement is unaffected (it reads `scrollHeight` with `rows=1`).
- Test: `chat-css.test.ts` "M-15".

### M-17 — re-open clobbers a retained draft — FIXED (`df4b78b`)
- `chat/App.tsx` `focusComposer()`: `focus()` + `setSelectionRange(len, len)`; `select()` removed. Select-all remains in `Composer.restore()` (`restoreTick` effect), untouched.
- Test: new `App.test.tsx` — draft `写到一半`, blur, caret to 0, fire `chat:opened {focusComposer:true}` → focused, `selectionStart === selectionEnd === 4`.
- Amendment proposed below (§2.3).

### M-27 (placeholder half) — key-shaped specimen — FIXED (`64c644b`)
- `tokens-sheet.html:181`: `sk-••••••••••••••••` (bullets are not in `[A-Za-z0-9]`, so `sk-[A-Za-z0-9]{20,}` is silent; verified with grep over `apps/desktop/src`, `apps/desktop/tests`, `docs` → no hits). The hook/versioning half is the main lane's.

### M-11 — detached anchor tick — FIXED (`e4eedb1`)
- `bubble.css`: `left` side `right: calc(var(--sp-3) + var(--notch) - 3px)`; mirrored `right` side `left: calc(...)`; and for consistency `top`/`bottom` sides use their padding minus 3 px too (`--sp-6 + --notch - 3px`, `--plate-h + --sp-1 + --notch - 3px`). The notch is now flush with the surface edge and protrudes outward.
- Decision: **kept** the notch. Contracts §5.8 names a 3 px `--c-bubble-tail` notch and DESIGN.md says "protrudes from the edge"; flush is the intent. In the captures it reads as a hairline on the pet-facing edge, not a tick.
- Test: `bubble-css.test.ts` "M-11" (all four sides).

### M-12 — ▼ over the last glyph — FIXED (`e4eedb1`)
- `bubble.css .bubble__surface` `padding: var(--sp-3) var(--sp-4) calc(var(--sp-3) + var(--sp-3))` reserves a 12 px strip; `.bubble__advance` `bottom: var(--sp-1)` sits inside it. The 24-hanzi width cap is untouched (no right padding), so no line re-wraps; the band grows 12 px taller. Rail comment updated (166 px at six lines, 11.7 px skew reach, still inside `--adv-cut`).
- Evidence: `fix-band-{light,dark}.png` — the last line is a full 24-hanzi line (`…看完了」。我在这儿。`) and ▼ is on its own row beneath it.
- Test: `bubble-css.test.ts` "M-12".

### M-13 — bubble plate skewed text, no outline — FIXED (`e4eedb1`)
- `bubble.html`: `<div class="bubble__plate" data-bubble-plate hidden><span class="bubble__plate-text" data-bubble-plate-text></span></div>`; `bubble.ts` `setName()` writes into the span (the span is a required child; the constructor error message names it); `bubble.css` `.bubble__plate-text { transform: skewX(calc(-1 * var(--adv-skew))) }`, plate gets `border: 1px solid var(--c-border-strong)` and `box-sizing: border-box` so `--plate-h` still holds.
- Evidence: `小春` upright with the outline in both captures (the echo brain's `happy` tint is the pale one the finding named).
- Tests: `bubble.test.ts` setName → span; `bubble-css.test.ts` "M-13".
- Note (not assigned): the chat and key plates still have no outline; DESIGN.md's rule applies to them too — carry item for whoever owns the next craft pass.

### M-14 — reduced motion still translates the composer — FIXED (`df4b78b`)
- `chat.css`: `@keyframes adv-appear-fade` (opacity only) and, under `prefers-reduced-motion: reduce`, `.app { animation-name: adv-appear-fade; animation-duration: 80ms }`.
- Test: `chat-css.test.ts` "M-14".

## Evidence
`docs/evidence/phase2/fix-band-light.png`, `fix-band-dark.png`, `fix-composer-light.png`, `fix-composer-dark.png` (commit `b96174b`). Method: built app (`out/main/index.cjs`) launched by the existing `tests-e2e/app.ts` harness with `DS_FAKE_BRAIN=1`, a `mkdtemp` `--user-data-dir`, `DEEPSEEK_API_KEY`/`DS_DEV_DEEPSEEK_KEY` scrubbed; a frameless, non-focusable, click-through `BrowserWindow` painted `#D9D4CB` (light) / `#2B2F3A` (dark) was placed behind the always-on-top surfaces so the crops never show the live desktop; `scripts/capture-region.ps1` (SetProcessDPIAware, BitBlt SRCCOPY|CAPTUREBLT, 150 % display) cropped to the bubble / chat window bounds with an 8 px pad. The ▼'s 1 Hz blink was frozen on its bright phase (`style.animation='none'` on the mark, which leaves the `[data-on='1']` opacity 1) so the dark shot does not catch the dim half. The Electron binary was copied into the worktree from `D:\ds\node_modules\.pnpm\electron@43.4.1\...\dist` + `path.txt`. Read-back confirmed: no stray tick, ▼ clear of the text on its own row, plate counter-skewed with outline, composer intact in both themes. The scratch spec was deleted; the tracked `e2e-report.json` was not touched (`--reporter=list`).

## Amendments proposed (integrator applies; this lane did not edit docs/)
1. **§2.3 `chat:opened` consumer column** — change "C (focus + select)" to "C (focus, caret at the end of any retained draft; select-all belongs to the restored-text path of §6.2 rule 6 only)". Rationale: `chat:close` only hides the window, so a draft survives Escape and a select-all on re-open destroys it on the first keystroke (M-17).
2. **§5.2 hover/linger wording** — after "`pointerleave` re-arms a **full** `LINGER_MS`" add: "Re-arming supersedes the previously armed hide: `scheduleHide()` invalidates the earlier arm (per-arm token in `SpeechController`), so a hover-then-leave before the original deadline always yields a full `LINGER_MS` from the leave." (I-11)
3. **§5.4 rule 5 / renderer side** — add: "On `shell:visibility {hidden:false}` the bubble renderer re-shows the band element and re-reports `bubble:size` if `SpeechController.active` (a turn still revealing or lingering); main's window re-show alone is not sufficient." (I-6)
4. **§2.4 `user:text`** — "`text: z.string().min(1).max(USER_TEXT_MAX)` where `USER_TEXT_MAX = 2000` is exported by `@ds/protocol` and is also the composer's `maxLength`; the renderer restores the text on a rejected invoke as well as on `{ok:false}`." (I-4)
5. **§5.8 anchor notch** — "The notch is flush with the surface edge (offset = the root's padding on that side − 3 px) and protrudes outward." (M-11) and **§5.5 / DESIGN.md adv-advance** — "The ▼ has its own 12 px row under the last line; it never shares a line box with text." (M-12)
6. **DESIGN.md adv-plate** — note that the bubble plate's label is wrapped in `.bubble__plate-text` with the counter-skew, like `.plate__text` (M-13).

## Decisions taken without asking
- Kept the anchor notch (contract-mandated) rather than dropping it.
- M-16 via `pointer-events` on the root/children instead of re-binding listeners.
- M-12 via a reserved bottom row instead of right padding (right padding would have pushed a full line past `--bubble-max-w` and re-wrapped at 23 hanzi).
- Counter threshold 200 characters; copy `还能写 N 字` / `到 2000 字了`.
- Four-sided fix for the notch offsets (the brief named left/right; top/bottom had the same detachment).
- Added a small `pet/motion-lookup.ts` helper so M-25 could be unit-tested.
- CSS craft fixes are pinned by two node-environment stylesheet tests (`bubble-css.test.ts`, `chat-css.test.ts`) since jsdom does no layout.

## Fix round 1

Commits (oldest first): `ef0704f` (CX-2/I-6), `2a4300d` (CX-9/CX-10), `107be6f` (M-16 bridge + USER_TEXT_MAX note).
Checks (verified — ran them): `pnpm test` → 60 files, **642 passed**, 2 skipped (+17 over the lane's 625); `pnpm -r --if-present typecheck` → protocol, brain, stage, memory, desktop (3 tsconfigs) all `Done`; `pnpm --filter @ds/desktop build` → `✓ built`. Each new behaviour test was run against the pre-fix file first (stash) and failed: 8/8 CX-2 tests, 3/3 CX-9 tests. No captures were re-taken: no pixel changed (the plate bridge is an invisible pseudo-element).

### CX-2 — hidden playback keeps running and acknowledging — FIXED (`ef0704f`)
- `apps/desktop/src/renderer/bubble/speech.ts`: explicit `isVisible` state with `get visible()` (`:173`), `pause()` (`:182`) and `resume()` (`:199`). `pause()` cancels every pending timer, stores the remainder of an in-flight `<|PAUSE n|>` beat (`beatDeadline`/`beatLeft`), closes the mouth and hides the band. While paused: `next()` sets up the sentence but does not start it (`:264`), `step()` returns (`:279`), `finishTurn()` returns before sending `playback:turnDone` (`:318`), `scheduleHide()` returns (`:333`) — so no `playback:sentenceDone` / `turnDone` / `speech:mouth on` leaves for text nobody saw, and `beginTurn()` does not show the band. `resume()` re-shows the band if `active`, continues the reveal (`armBeat()` with the stored remainder, else `step()` — the grapheme in flight restarts its own ≤ 70 ms delay), finishes a turn that ended while hidden (turnDone goes out on show), or restarts the linger in full (`hideAt = now + LINGER_MS`).
- `apps/desktop/src/renderer/bubble/main.ts:103-110`: `shell:visibility` → `hint.dismiss(); speech.pause()` / `speech.resume(); scheduleReport()`. The I-6 re-show now lives in the controller (`resume()` → `bubble.show()`), so the previously untested main.ts branch is gone and the edge is pinned by the fake-clock tests below (also closes the Minor I-6 test finding).
- Tests (`speech.test.ts` "pause/resume (CX-2 / I-6)", 8 cases): hide mid-sentence → no sentenceDone/turnDone during 10 s hidden, mouth off, band hidden; show → band back, reveal continues from '一二', acks and turnDone follow; pause beat keeps its remainder (300 ms left → first grapheme exactly 370 ms after resume); hide across the whole reply → zero acks during 60 s hidden, on show 2× sentenceDone then turnDone; turn ending while hidden with nothing left to paint → turnDone on show, then a full linger; hide during the linger → full `LINGER_MS` from the show; resume with nothing on the band does not show it / a turn begun while hidden shows on resume; idle echo while hidden keeps the linger, onError while hidden clears the turn.
- Decisions: `complete()` (the click / Ctrl+Enter gesture) still paints and acks sentences while hidden — it is an explicit user action — but the turn's end waits for `resume()`; `onState('idle')` from a cancel while hidden likewise defers its turnDone to the show (main's long-hide retirement is the MAIN lane's, per the brief). The grapheme delay in flight is restarted rather than resumed (bounded by one RevealPlan step, ≤ 70 ms; not worth a second deadline field).

### CX-9 — history never refreshes after the first opening — FIXED (`2a4300d`)
- `apps/desktop/src/renderer/chat/History.tsx`: `startedRef` removed; the load effect (`:81-84`) runs on every `open` edge and on a new `refresh` prop (`:14`); `App.tsx:101` passes `refresh={turnDone?.n ?? 0}` (the existing `brain:turnDone` signal). `loadPage` merges by id (unchanged), only the FIRST read sets the paging cursor (`:66-68`, so a refresh cannot reset `nextBefore` past pages already scrolled through), and every newest-page landing clears `parkedRef` so the park layout effect (now keyed on `rows` too) re-parks on the newest row.
- Tests (`History.test.tsx`, 3 cases): open → close → a row lands in the store → open → `msg-4` present, `list` called twice; open + `refresh` bump after two rows land → both rows present, in id order without duplicates, `scrollTop === scrollHeight` again; a refresh asks for `{limit: 50}` (the newest page) and the first cursor is kept.
- Decision: a `refresh` counter prop rather than a bridge subscription inside History keeps the component bridge-free (its tests inject `list`/`remove` only); a completed turn while open re-parks on the newest row, since that is the row the user just produced.

### CX-10 — listening pose latched — FIXED (`2a4300d`)
- New `apps/desktop/src/renderer/pet/pose.ts` `PoseTracker`: `base` (think / sentence emotion / neutral) + `listening`; `setBase()` always applies (as every event did before), `setListening()` applies `curious` on the on-edge and the base on the off-edge, nothing on a repeat. `pet/main.ts:165-185`: `brain:state` thinking/idle → `setBase('think'|'neutral')`, `brain:sentence` → `setBase(ev.emotion)`, `avatar:listening` → `setListening(on)` (mouth stop unchanged).
- Tests (`pose.test.ts`, 5 cases): on→off restores neutral; restores `think` while thinking; restores the current sentence emotion; a sentence during listening shows through and is what off restores; repeated edges apply nothing.
- Decision: a base change while listening is applied immediately (she speaks → the pet shows the line's emotion, as before), so listening never masks a reply; the off-edge then resolves to that base.

### Minor — I-6 main.ts branch untested — RESOLVED with CX-2
The four-line glue is replaced by `speech.pause()`/`speech.resume()`; the re-show is asserted in the CX-2 tests ("show re-shows the band…", "hide during the linger…", "a new turn begun while hidden shows on resume").

### Minor — M-16 plate/surface gap flicker — FIXED (`107be6f`) + report wording corrected
- `bubble.css:208`: `.bubble__plate::after` — an invisible `--sp-1` (4 px) strip below the plate with `pointer-events: auto`, so moving from the plate to the surface never leaves `#bubble` (no `bubble:hover {inside:false}`/`{inside:true}` pair, no click-through flip, no linger re-arm). Test: `bubble-css.test.ts` "M-16 (round 1)".
- The earlier claim that the CSS route "avoids a leave/enter flicker" was wrong and is corrected in the M-16 entry above.

### Minor — USER_TEXT_MAX comment imprecise — FIXED (`107be6f`)
- `packages/protocol/src/index.ts:244-247`: the comment now says the composer counts UTF-16 units while zod 4's `.max` falls back to code points once the UTF-16 length exceeds the cap (verified in `zod/v4/core/checks.js` `codePointLength` fallback), i.e. the composer cap is at least as strict as the schema. Amendment 4 (§2.4) reads accordingly: "`USER_TEXT_MAX = 2000` … also the composer's `maxLength`; the composer's cap is at least as strict as the schema's (zod 4 counts code points past the UTF-16 limit), so a message the textarea accepts is never rejected."

### Amendment 3 (§5.4 rule 5) — reworded for CX-2
"On `shell:visibility {hidden:true}` the bubble renderer pauses playback (`SpeechController.pause()`): no grapheme is painted, no `playback:sentenceDone`/`turnDone` is sent, the mouth closes, the band hides. On `{hidden:false}` it resumes (`resume()`): the band is re-shown if a turn is still on it, the reveal continues, a turn that ended while hidden is acknowledged then, and a linger restarts in full from the show."

