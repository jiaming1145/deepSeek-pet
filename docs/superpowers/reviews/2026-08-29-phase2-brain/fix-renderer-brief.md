# Fix lane RENDERER — Phase 2 final-review fixes in `apps/desktop/src/renderer` (+ the user-text cap constant in `packages/protocol`)

You own: `apps/desktop/src/renderer/**` (bubble, chat, key, shared, pet/main.ts), `apps/desktop/src/renderer/tokens-sheet.html`, and the `USER_TEXT_MAX` constant in `packages/protocol/src/index.ts`. Do not edit `apps/desktop/src/main/**`, `packages/brain/**`, `eval/**`, `docs/**` (other lanes; the integrator applies contract amendments you PROPOSE).

Source of truth: `final-review.md` (IDs I-n / M-n) and `renderer-craft.md` in this directory — read each entry (file:line, quoted code, reproduction, proposed fix) before fixing. Visual authorities: `apps/desktop/DESIGN.md` and `.superpowers/sdd/2026-08-29-phase2-brain/task-0-direction.md` (ADV band over her lower third; 8° rail; plate; opacity-only under reduced motion).

## Findings to fix (all of them)

Correctness
- I-4 message > 2000 chars silently destroyed (`Composer.tsx:123-135`): try/catch around `onSend` → `restore(text)`; export `USER_TEXT_MAX = 2000` from `@ds/protocol` and use it in the zod schema (`packages/protocol/src/index.ts:244`) and as the textarea `maxLength`, with a quiet counter/hint near the cap in the composer's voice (DESIGN.md copy register). Test: a rejecting `onSend` leaves the text in place.
- I-6 band not re-shown after a hidden→shown edge mid-turn (`bubble/main.ts:101-105`): on `{hidden:false}` with an active turn, `bubble.show()` + `scheduleReport()`; expose `active` on `SpeechController`. Test.
- I-11 hover-then-leave does not re-arm the 3 s linger (`speech.ts:343` `setPinned` / `scheduleHide`): dedicated hide handle cleared before arming (or per-arm token). Fake-clock test: hover at 1.0 s, leave at 1.5 s → still visible at `LINGER_MS - 1` after leave, hidden after.
- M-16 pointer/click listeners on `#bubble` include transparent padding: bind on `.bubble__surface` + `.bubble__plate` (or `pointer-events: none` root / `auto` children). Keep `bubble:hover` semantics.
- M-25 (renderer half) motion allow-list via `Object.hasOwn(stage.config.motionMap, ev.motion)` (`pet/main.ts:175`). Test with `constructor` / `__proto__`.
- M-15 composer beyond `CHAT_MAX_ROWS`: `overflow-y: auto` with a token-styled thin scrollbar (`chat.css:347`).
- M-17 re-open must not clobber a retained draft: focus + caret at end; select-all stays inside `restore()` (`chat/App.tsx:18`). Propose the §2.3 amendment.
- M-27 (placeholder half) change `tokens-sheet.html:180` `sk-0123…` to a string that does NOT match `sk-[A-Za-z0-9]{20,}` (e.g. `sk-••••••••••••`).

Craft (DESIGN.md is the authority; no new colours, use tokens)
- M-11 `.bubble__anchor` detached 13 px tick (`bubble.css:229`) — align to the surface inset, mirrored for `data-side='right'` (or remove the notch if the direction reads better without it — say which and why).
- M-12 advance mark ▼ overlaps the last glyph of a full line (`bubble.css:192`) — reserve the corner.
- M-13 bubble plate: inner span counter-skewed like the chat/key plates + the 1 px `--c-border-strong` outline (`bubble.css:167`); `setName` writes into the span.
- M-14 reduced motion: opacity-only composer appear (`chat.css:509`).

## Evidence (required)
After the fixes, re-capture the band and the composer light + dark with the existing capture tooling (`scripts/` — cropped BitBlt SRCCOPY|CAPTUREBLT, `SetProcessDPIAware`, 150 % display; see `docs/evidence/phase2/README.md` for the commands; launch offline with `DS_FAKE_BRAIN=1` and a scratch `--user-data-dir` under %TEMP%; the Electron binary must be copied into the worktree from `D:\ds\node_modules\.pnpm\electron@43.4.1\...\dist` + `path.txt` if missing). Save as `docs/evidence/phase2/fix-band-{light,dark}.png` and `fix-composer-{light,dark}.png`, cropped to the windows, over a plain background (never the live desktop). Open each PNG with the Read tool and confirm: no stray tick, ▼ clear of the text, plate counter-skewed with outline. Commit them (`.gitattributes` already marks `docs/evidence/**` as `-text`).

## Rules
- TDD per finding where a unit test is possible (vitest, `--project @ds/desktop`), commit per one-or-two findings (`fix(bubble): … (I-n/M-n)`, `fix(chat): …`).
- No refactors beyond the finding; no new dependencies; tokens only; keep IME guards intact (`isComposing || keyCode === 229 || composingRef`).
- End: `pnpm test`, `pnpm -r --if-present typecheck`, `pnpm --filter @ds/desktop build` green.
- Report: `<worktree>/.superpowers/sdd/2026-08-29-phase2-brain/final-review/fix-renderer-report.md` — per finding: fixed how, file:line, test/evidence, commit; "## Amendments proposed" (§2.3 focus rule, §5.x hover re-arm wording, `USER_TEXT_MAX`).

## Added after launch — Codex review (`codex.md`, IDs CX-n). ALSO assigned to this lane; the reviewer will check them.
- CX-2 (bubble/main.ts:101, speech.ts:227; `backgroundThrottling:false`) hidden playback keeps running and acknowledging: on `shell:visibility {hidden:true}` the band hides but `SpeechController` timers continue and send `playback:sentenceDone` / `turnDone` for text nobody saw; a short hide also never restores the band (I-6). Fix: give `SpeechController` an explicit `visible` state — on hide PAUSE the reveal (no further acknowledgements, timers suspended, mouth off); on show restore the band and resume with adjusted deadlines (linger restarts from the resume). Fake-clock tests: hide mid-sentence → no sentenceDone during hide; show → reveal continues and acks; hide across the whole reply → turnDone only after show + completion. (If the hide lasts longer than N minutes the MAIN lane may retire the turn — out of your scope; just make pause/resume correct.)
- CX-9 [moderate] `chat/History.tsx:69-73` — refresh the newest page on every closed→open transition (and after `brain:turnDone` while open); keep the "park on the newest row" behaviour. Test.
- CX-10 [moderate] `pet/main.ts:179-182` — listening `{on:false}` must restore the underlying pose (neutral / thinking / current sentence emotion), not just stop the mouth; track the base pose and recompute on both edges. Test.
