# Fix lane MAIN — Phase 2 final-review fixes in `apps/desktop/src/main` and `packages/memory`

You own: `apps/desktop/src/main/**`, `apps/desktop/src/preload/**`, `packages/memory/src/**`. Do not edit `packages/brain/**`, `apps/desktop/src/renderer/**`, `eval/**`, `docs/**` (other lanes own them; the integrator applies contract amendments you PROPOSE in your report).

Source of truth for each finding (read the full entry first — file:line, quoted code, reproduction, proposed fix): `final-review.md` (IDs I-n / M-n), `gpt-review-1.md` (IDs G-n), `gpt-review-2.md` if present (IDs G2-n), and the lens reports `main-process.md`, `memory-protocol.md` in this directory.

## Findings to fix (all of them)

Shutdown / lifecycle
- I-9 / G-8 quit mid-reply loses the `[中断]` row and metrics; `dispose()` is not a barrier. Make `BrainService.dispose(): Promise<void>`: remove the bubble `did-finish-load` listener (store the callback), set a `disposed` flag checked by every delayed callback, `await this.runner.cancel()` (**interface from the BRAIN lane, being merged before you: `TurnRunner.cancel(): Promise<void>` resolves after retire's writes settle; in your worktree it may still be typed `void` — `await` it anyway, with a one-line comment; do not change turn.ts**), then resolve. In `index.ts` `before-quit`: `preventDefault()` once, `await brain.dispose()`, then `db.close()`, then `app.quit()` (guard against re-entry). Test with a fake runner whose cancel resolves later: db.close must run after it.
- G-7 hint TTL clobbered by the empty-turn idle fallback (`brain-service.ts` state listener / `reportError`): gate the idle fallback on no outstanding hint deadline; fake-clock test: error then idle → hint visible for `HINT_TTL_MS`.
- G-9 `maybeFirstMessage`: greeting append + `KV_FIRST_RUN_DONE` in one ordered, handled operation after `playbackTurnDone` for `FIRST_MES_TURN_ID`; no marker if persistence fails; no unhandled rejection. Preserve aa0e9df's `bubbleWanted` replay behaviour.
- G-3 (log side) `reportError` logs `p.code` and a redacted/bounded `detail` only — never `p.message` raw from upstream. (BRAIN lane is making `message` user-safe; keep your side defensive anyway: strip `sk-[A-Za-z0-9]{20,}` before any log/IPC.)

Visibility / windows
- I-7 chat opened while `VisibilityState` is hidden (tray, hotkey, `chat:open`): one `requestChat(reason)` in `index.ts`; `user` reason clears the user flag and applies visibility first (as second-instance does at `index.ts:106-109`); `locked`/`suspended`/`fullscreen` → refuse with one log line. Unit test on the decision function.
- M-8 verdict-driven `hideBubble()` under the pointer: reset `bubblePinned`, timers, and `setBubbleClickThrough(bubble, true)` via a `service.bubbleHidden()` hook called from the verdict-hide path.
- M-10 reposition before `setBubbleVisible(true)` on `thinking`/`reportError`/`maybeFirstMessage` (bypass the `isVisible()` guard) so the band never flashes at stale bounds.
- M-9 `ELECTRON_RENDERER_URL` and `DS_DEBUG` gated on `!app.isPackaged`, computed once (`app-protocol.ts:156`, `pet-window.ts:74-75`).
- M-7 `lastTest = null` at the top of `rebuildClient()` (`key:status` contract §2.3).
- G-14 `KeyStore`: resolve key and `source` from one decryption attempt; undecryptable `key.bin` → source `dev-env`/`none` as appropriate (do not delete the file; log once). Tests for both with/without dev key.

Memory
- I-10 `history:delete` during an in-flight trim moves `last_trim_id` past unsummarised rows: resolve the target id BEFORE the `summarize()` await (carry ids in `TrimPlan`) and write it in the transaction. Test: delete a dropped-prefix row during the await → `window()` still includes the kept turns.
- M-5 `capSummary` / facts join: collapse whitespace runs to one space and map `【`/`】` → `[`/`]` so a poisoned summary cannot forge a `【记住】` line. Test.

## Rules
- TDD per finding (test named after the ID), `npx vitest run --project @ds/desktop` / `--project @ds/memory` green, commit per one-or-two findings (`fix(desktop): … (I-n/G-n)` / `fix(memory): …`).
- Electron API facts from `node_modules/electron/electron.d.ts`, not memory. `screen` only after `ready`. Never launch against the real API; `DS_FAKE_BRAIN=1` offline launch with a scratch `--user-data-dir` is allowed if you need to see a behaviour.
- No refactors beyond the finding; no placeholders; keep the single-visibility-owner rule (only `applyBubbleVisibility` shows the bubble).
- End: `pnpm test`, `pnpm -r --if-present typecheck`, `pnpm --filter @ds/desktop build` all green.
- Report: `<worktree>/.superpowers/sdd/2026-08-29-phase2-brain/final-review/fix-main-report.md` — per finding: fixed how, file:line, test, commit; "## Amendments proposed" (§2.3 key:status, §5.x shutdown order, §6.x requestChat rule); "## Interfaces" (dispose(): Promise<void>; the awaited cancel()).

## Added after launch — GPT review 2 (`gpt-review-2.md`, IDs G2-n). These are ALSO assigned to this lane; the reviewer will check them.
- G2-1 (extends M-9): `file:` must never be an origin key — `allowedPetOrigins` accepts only `app://local` and, when `!app.isPackaged`, an explicit HTTP/HTTPS loopback `ELECTRON_RENDERER_URL`; anything else is ignored with one warn. Origin-table test (case, trailing slash, ports, userinfo, `app://local.evil`, `file:///a` vs `file:///b`, packaged override).
- G2-2 (extends I-9): the summariser continuation too — `HistoryStore` gets a closing fence (`close()` sets `closed`; every post-await continuation in `onTrimNeeded` returns without touching the db when closed), and `BrainService.dispose()` also awaits any in-flight trim/summarise promise. Test: quit with a deferred summariser pending → no db access after close, no unhandled rejection.
- G2-3 (extends I-10): concurrent trims — snapshot `last_trim_id` + the exact cutoff row id before the await, serialise trim commits (one in-flight trim per store), and inside the transaction commit only if the snapshot still matches; a stale trim returns without writing. Test: two `onTrimNeeded` resolving in reverse order → pointer advances once, no rows skipped.
- G2-4 = I-7 (already assigned; make sure tray, hotkey AND `chat:open` from the key window all go through `requestChat`).
- G2-5 (extends M-8): EVERY bubble hide forces `setBubbleClickThrough(bubble, true)` even when already hidden; on show, send the renderer a window-local cursor sample (or a `bubble:resync` message) so it recomputes its DOM hit and re-emits `bubble:hover`. Test the hover-inside → hide → show sequence with the cursor outside and inside.
- G2-6: observe `win.loadURL(...)` on the bubble and chat windows — non-aborted failures route to the same startup failure policy the pet window uses (`isAbortedLoad` for deliberate aborts); chat `render-process-gone` → hide the chat, clear `chat:opened` state, reload once, else `fatal()`. Tests with a rejected load and a simulated crash.
- G2-7 (minor): `db.ts` / `history.ts` validate `schema_version` and `last_trim_id` as canonical non-negative safe integers at open; malformed → `MemoryOpenError`. Test.
- G2-8 (minor, DEFER): HEAD/Range in `serveRenderer` — do not fix; the EVAL lane / integrator records it in `deferred.md` (Phase 4 packaging).

## Added after launch — Codex review (`codex.md`, IDs CX-n). ALSO assigned to this lane.
- CX-3 (extends I-7): the KEY window too — the automatic key-error path (`brain-service.ts:375` on auth failure) and every other `show()+focus()` of a focusable window must go through the visibility-aware request (refuse while locked/suspended/fullscreen; queue the key prompt until the verdict clears and show it then). Test.
- CX-4 (extends G2-3 / I-10): Codex confirms overlapping trims from superseded turns; also abort/ignore a superseded turn's summarisation result (stale plan must never overwrite a newer summary).
- CX-2 (main half, extends G-9): `KV_FIRST_RUN_DONE` only after the first message's `playback:turnDone` arrives (the renderer will pause acks while hidden), never on send.
- CX-5 [major] (extends I-10/G2-3 — same fix: ids in `TrimPlan`): the 32k safety truncation in `window()` (`history.ts:84-88`) makes `plan.drop` start at id 8 while `onTrimNeeded` advances by LENGTH from `last_trim_id`; commit the exact cutoff id, never a length. Test with a window that was safety-truncated.
- CX-6 [major] bubble `render-process-gone` (`bubble-window.ts:80-83`, `brain-service.ts:171-178`): force-interrupt the active turn (retire as interrupted), reset bubble state (`bubbleWanted=false`, pinned, timers), reload the bubble page once (recreate if that fails), resynchronise `bubble:place`/visibility. Test with a simulated crash mid-playback → runner reaches idle, `turnDone` emitted, history has the shown prefix as interrupted.
- CX-7 [moderate] (= G2-6 for the key window) observe `key-window.ts:50` `loadURL`; failure → `fatal()` path; `render-process-gone` → recreate on next open.
