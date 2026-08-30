# Fix lane MAIN — report

Worktree: `D:\ds\.claude\worktrees\wf_d4736852-369-2`, branch `worktree-wf_d4736852-369-2`, based on `main` @ `16bf16a`.
Setup run in the worktree: `git submodule update --init --recursive`, `pnpm install --frozen-lockfile`, `pnpm fetch-sdk` (vendor/core + characters/haru/model were missing).

Every finding the brief assigns was reproduced with a failing test first (evidence below), fixed, and committed. No `packages/brain/**`, `apps/desktop/src/renderer/**`, `eval/**` or `docs/**` file was touched. No subagents, no real-API launch, no key read.

## Commits (oldest first)

| SHA | Message |
|---|---|
| `a8360d0` | fix(memory): resolve the trim id before summarize and sanitise memory text (I-10/M-5) |
| `8707937` | fix(desktop): resolve key and source from one decryption attempt (G-14) |
| `1f6cef6` | fix(desktop): gate ELECTRON_RENDERER_URL and DS_DEBUG on !app.isPackaged (M-9) |
| `312c641` | fix(desktop): make BrainService.dispose a barrier and fix hint/first-message/error paths (I-9/G-8/G-7/G-9/G-3/M-7/M-8/M-10) |
| `3b2b087` | fix(desktop): await the brain drain before closing the db, route every chat open through requestChat (I-9/I-7/M-8) |

## Checks (all run in the worktree after the last commit)

| Check | Result |
|---|---|
| `npx vitest run --project @ds/memory` | 3 files / 28 tests pass (baseline 25; +3) |
| `npx vitest run --project desktop` | 32 files / 301 tests pass (baseline 28 files / 292; +4 files, +9 tests net — note `pet-window`/`app-protocol` gained cases and `brain-service.test.ts` (14), `quit.test.ts` (4), `chat-request.test.ts` (7), `redact.test.ts` (2) are new) |
| `pnpm test` | 59 files, 648 passed, 2 skipped (pre-existing skips) |
| `pnpm -r --if-present typecheck` | exit 0, zero `error TS` |
| `pnpm --filter @ds/desktop build` | exit 0 (`✓ built`) |

Fail-first evidence: the 14 `brain-service.test.ts` cases were run against the pre-fix `brain-service.ts` (HEAD file swapped in, `HINT_TTL_MS` export only) → **10 failed / 4 passed** (M-7, G-7 error-then-idle, G-9 ×2, I-9 ×2, G-3, M-10, M-8 ×2 failed); against the fix → 14/14. `history.test.ts` I-10 case failed on the old code with `expected '4' to be '2'`; `key-store.test.ts` G-14 cases failed with `source === 'store'`.

## Per finding

### I-9 / G-8 — quit mid-reply loses the `[中断]` row and metrics; `dispose()` is not a barrier
- **Fixed how.** `BrainService.dispose(): Promise<void>` (`apps/desktop/src/main/brain-service.ts:299`): idempotent via a `disposed` flag; removes the stored bubble `did-finish-load` callback (`onBubbleLoaded`, set at `:218`); clears timers; unregisters IPC; **`await this.runner?.cancel()`** with the one-line comment the brief asked for (in this worktree `cancel()` is still typed `void`; awaiting it is harmless and becomes the real barrier once the BRAIN lane's `cancel(): Promise<void>` merges; `turn.ts` untouched). Runner listeners stay attached through the cancel so the windows still receive the retire's `turnDone`/`idle`. Every delayed callback (`listeningTimer`, `bubbleTimer`, `commitFirstMessage` after its await, the did-finish-load callback) checks `disposed`.
- **`index.ts` `before-quit`** now goes through `createBeforeQuit` (`apps/desktop/src/main/quit.ts`, wired at `index.ts:366`): first `before-quit` → `preventDefault()`, synchronous teardown (screen listeners, `markQuitting`, save position, hotkeys, cursor/foreground, tray), then `await brain.dispose()` (bounded by `DRAIN_TIMEOUT_MS = 3000`), destroy windows, `db.close()`, `app.quit()`. A re-entrant `before-quit` during the drain is also prevented (phase `draining`); the one raised by our own `app.quit()` passes (phase `done`).
- **Tests.** `brain-service.test.ts` "I-9: dispose() is a barrier …" (fake runner whose `cancel()` resolves later; asserts dispose is unresolved until release, listener removed, nothing sent after) and "I-9: dispose() is idempotent …"; `quit.test.ts` (4 cases: order `teardownSync → drain → teardownAfterDrain → closeDb → quit`, db.close strictly after the drain settles; re-entry; timeout; rejecting drain).
- **Decision recorded.** The drain is bounded at 3 s (not in the brief): a `cancel()` that never settles must not wedge the quit; the log line says so. Extracting the sequence into `quit.ts` was the only way to unit-test the order without Electron; `index.ts` keeps the wiring.
- Commits `312c641`, `3b2b087`.

### G-7 — hint TTL clobbered by the empty-turn idle fallback
- **Fixed how.** `brain-service.ts:387`: the fallback is `idle && emittedThisTurn === 0 && !this.hideOwed`. `reportError` sets `hideOwed` via `scheduleBubbleHide(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS)`, so the following `idle` no longer replaces the timer.
- **Test.** fake-clock "G-7: an error before the first sentence keeps its hint up for HINT_TTL_MS even though idle follows" (visible at `HINT_TTL_MS + 400 − 1`, hidden at `+0`), plus "G-7: a turn that emits no sentence and no error still hides via the idle fallback" (regression guard for the original purpose).
- Commit `312c641`.

### G-9 — `maybeFirstMessage` fire-and-forget append + immediate marker
- **Fixed how.** `maybeFirstMessage` only broadcasts and sets `firstMesPending` (`:542`). The bubble's `playback:turnDone` for `FIRST_MES_TURN_ID` (`:183`) calls `commitFirstMessage()` (`:550`): `await store.append(...)` then `setKv(KV_FIRST_RUN_DONE,'1')` inside one `try/catch`; no marker if the append fails; the rejection is logged (`[brain] first message could not be persisted; it will play again`), never unhandled; a second `turnDone` cannot append twice; after `dispose()` the marker is not written. aa0e9df's `bubbleWanted` replay is preserved: the show still goes through `setBubbleVisible(true)` at broadcast time (test "G-9: the first message waits for the bubble document and replays through setBubbleVisible").
- **Tests.** four `G-9:` cases in `brain-service.test.ts` (vitest fails on unhandled rejections, so the "no unhandled rejection" claim is enforced by the runner).
- **Decision recorded.** If the bubble never reports `playback:turnDone` (e.g. hidden by a verdict for the whole reveal), the greeting is not persisted and plays again next launch — that is the behaviour the finding asks for ("quitting before playback marks it seen before the user saw it" was the bug).
- Commit `312c641`.

### G-3 (log side) — `reportError` logs `p.message` raw
- **Fixed how.** New `apps/desktop/src/main/redact.ts`: `redactSecrets` (`sk-[A-Za-z0-9]{20,}` → `sk-[redacted]`) and `boundedDetail` (redacted, whitespace-collapsed, cut at 200 chars). `reportError` (`brain-service.ts:418-422`) redacts the message before the IPC payload and logs `code=%s detail=%s` with the bounded detail; never `p.message` raw.
- **Tests.** `redact.test.ts` (2); `brain-service.test.ts` "G-3: reportError never logs or forwards an upstream message raw …" (a 2 KB body with an embedded key: the key is absent from `console.error` args and from both `brain:error` payloads; the log line is < 600 chars).
- **Decision recorded.** IPC messages are redacted but not truncated (the BRAIN lane makes them user-safe; truncating could cut a legitimate hint); only the log is bounded.
- Commit `312c641`.

### I-7 — chat opened while `VisibilityState` is hidden
- **Fixed how.** New pure decision `decideChatRequest` (`apps/desktop/src/main/chat-request.ts`): not hidden → `open`; hidden with any of `locked`/`suspended`/`fullscreen` live → `refuse`; hidden by `user` alone → `reveal`. `index.ts:284` `requestChat(source, focusComposer)` applies it: `reveal` runs the same two lines as `second-instance` (`visibility.set('user', false); visibility.apply()`) before `openChat`; `refuse` logs one line (`[chat] refused: hidden reason=…`) and returns. All five entry points route through it: `chat:open` from pet/bubble/key (`:302`), the tray item (`:314`), the hotkey (`:319`). The `source === 'key'` key-window hide moved inside it unchanged.
- **Test.** `chat-request.test.ts` (7 cases incl. `locked + user` and `fullscreen + user` → refuse).
- **Decision recorded.** The flags are read individually rather than from `verdict.reason`, because `VisibilityState.reason` reports `user` first whenever it is set and would have let a locked screen through (the first draft of the test caught exactly this).
- Commit `3b2b087`.

### M-8 — verdict-driven `hideBubble()` under the pointer leaves `bubblePinned` true
- **Fixed how.** `BrainService.bubbleHidden()` (`brain-service.ts:286`): always `setBubbleClickThrough(bubble, true)`; if pinned, drop the pin and — if a hide is owed — re-arm `scheduleBubbleHide(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS)`. `index.ts:110` calls it from `applyBubbleVisibility`'s hide branch whenever the window was actually visible (the verdict path and the timer path share that branch; on the timer path nothing is pinned by construction, so it is a click-through reset only).
- **Tests.** "M-8: bubbleHidden() clears the hover pin, restores click-through and re-arms the owed hide" and "M-8: … changes nothing but click-through".
- **Decision recorded.** The brief says "reset timers"; a plain clear would strand an owed hide (verdict hides at 1 s, un-hides at 2 s → band back with no timer, forever). Re-arming the owed hide is the reset that cannot strand: the timer fires `setBubbleVisible(false)`, which also clears `bubbleWanted`, so a later un-hide does not resurrect a stale band.
- Commits `312c641`, `3b2b087`.

### M-10 — bubble shown at stale bounds
- **Fixed how.** `reposition(force = false)` (`:254`) bypasses the `isVisible()` guard when forced; new private `showBubble()` (`:471`) = `reposition(true)` then `setBubbleVisible(true)`, used by `thinking`, `reportError` and `maybeFirstMessage`. `repositionBubble` needs only the window's current bounds, which a hidden `BrowserWindow` keeps.
- **Tests.** "M-10: the bubble is re-placed BEFORE it is shown on thinking, on an error hint and on the first message" (asserts call order `repositionBubble` → `setBubbleVisible:true` with `isVisible() === false`) and "M-10: reposition() without force still respects the hidden guard".
- Commit `312c641`.

### M-9 — `ELECTRON_RENDERER_URL` / `DS_DEBUG` honoured in a packaged build
- **Fixed how.** `app-protocol.ts:18` `devRendererUrl()` (`app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined`) is the single reader; `rendererUrl`, `allowedPetOrigins` and `isAllowedPetUrl` default to it. `devDebugEnabled()` (`:24`) gates `DS_DEBUG`. `pet-window.ts:75-76` now uses `devDebugEnabled()` and `rendererUrl('pet')` like the other three windows.
- **Tests.** `app-protocol.test.ts` "M-9: dev hooks are gated on !app.isPackaged" (3 cases: unpackaged honours both; packaged → `rendererUrl('pet') === PET_URL`, `allowedPetOrigins() === ['app://local']`, dev URL rejected by `isAllowedPetUrl`, `devDebugEnabled() === false`; empty env treated as unset); `pet-window.test.ts` two `M-9:` cases (`?debug=1` only unpackaged; packaged ignores the dev URL for both the load and the `will-navigate` guard). `ipc.test.ts` mock gained `app: { isPackaged: false }`.
- **Decision recorded.** "Computed once" is implemented as one reader function gated per call rather than a module-scope constant: a module-scope value would be captured when `app-protocol.ts` is evaluated (before `ready`, though `app.isPackaged` is valid then) and, more practically, would break the existing `pet-window.test.ts` case that sets the env inside a test. The env cannot change under a running process, so every call agrees; the security property (packaged ⇒ never honoured) is what the tests pin.
- Commit `1f6cef6`.

### M-7 — `lastTest` not nulled on `KeyStore.onChange`
- **Fixed how.** `brain-service.ts:331` `this.lastTest = null` at the top of `rebuildClient()` (the `onChange` subscriber), per contracts §2.3's pinned rule.
- **Test.** "M-7: a KeyStore change nulls lastTest before the key:status it pushes" (key:test sets `{ok:true}`; a simulated 清除 `onChange` pushes `lastTest: null` to both key and chat windows). The test runs with `DS_FAKE_BRAIN=1` so `key:test` never builds a real `DeepSeekClient` (my first draft did, and the fake key hit the network once — corrected before commit).
- Commit `312c641`.

### G-14 — `KeyStore` source says `store` for an undecryptable `key.bin`
- **Fixed how.** `key-store.ts:69` `resolve()` does one decryption attempt and returns `{key, source}` together; `get()`/`source()` both read it. Undecryptable file → `dev-env` (with a dev key) or `none`; the file is NOT deleted; `console.error` once per file state (`decryptWarned`, reset on a successful decrypt or `clear()`).
- **Tests.** "G-14: … reports source none (no dev key), logs once, keeps the file" and "G-14: … falls back to the dev key AND reports source dev-env".
- **Decision recorded.** GPT's "quarantine the unusable ciphertext" was not done — the brief says do not delete the file, and the key window's next save overwrites it.
- Commit `8707937`.

### I-10 — `history:delete` during an in-flight trim moves `last_trim_id` past unsummarised rows
- **Fixed how.** `packages/memory/src/history.ts:143-151`: the `LIMIT 1 OFFSET plan.drop.length-1` lookup now runs BEFORE the `await this.summarize(...)`, while the table still matches the plan; the resolved id is written inside the same `BEGIN…COMMIT` as the summary. `id >` bounds correctly even if that row is deleted during the await. `TrimPlan` lives in `@ds/brain` (BRAIN lane), so ids are not carried in the plan; resolving early is equivalent for this store.
- **Test.** "I-10: a history:delete of a dropped row during the summarize await does not move last_trim_id past kept turns" (deletes turn `t1` while `summarize` is gated; `last_trim_id === '2'`, `window()` = 三四五六). Failed on the old code with `'4'`.
- Commit `a8360d0`.

### M-5 — running summary / facts not sanitised against forged `【记住】` lines
- **Fixed how.** `packages/memory/src/summary.ts:29` `sanitizeMemoryText`: whitespace runs → one space, `【`/`】` → `[`/`]`; `capSummary` applies it first (so `setSync` stores sanitised text); `HistoryStore.facts()` (`history.ts:100`) maps it over its rows (empty in Phase 2 — the helper is in place for Phase 3's real facts; the `join('；')` itself is in `packages/brain/src/prompt.ts`, BRAIN lane).
- **Tests.** "M-5: capSummary collapses whitespace runs and maps 【】 to []…" and "M-5: setSync stores the sanitised text".
- Commit `a8360d0`.

## NOT A BUG
None — every assigned finding reproduced.

## Amendments proposed (for the integrator; `docs/**` not edited by this lane)

- **§2.3 `key:status.lastTest`** — add: "`BrainService.rebuildClient()` sets `lastTest = null` as its first statement; this is the implementation of the pinned rule. (M-7)"
- **§5.4 / new §5.9 shutdown order** — "`before-quit` is handled by `main/quit.ts createBeforeQuit`: (1) `preventDefault()`, synchronous teardown (screen listeners, `markQuitting()`, save pet position, `globalShortcut.unregisterAll()`, cursor + foreground stop, tray destroy); (2) `await brain.dispose()` — a barrier that resolves after `TurnRunner.cancel()`'s writes settle, bounded by `DRAIN_TIMEOUT_MS = 3000`; (3) destroy bubble/chat/key windows; (4) `db.close()`; (5) `app.quit()`, whose second `before-quit` is let through. Any `before-quit` during (2) is prevented. (I-9)"
- **§6.6 `BrainService`** — signature changes: `dispose(): Promise<void>` (was `void`); new `bubbleHidden(): void` (called by index.ts from `applyBubbleVisibility`'s hide branch when the window was visible; M-8); `reposition(force = false)` (M-10). First-run broadcast set unchanged, but step 4 ("append the line with kind:'system' and set first_run_done") now happens on the bubble's `playback:turnDone { turnId:'first-mes' }`, ordered append → marker, and the marker is skipped if the append fails (G-9).
- **§6.x new rule "requestChat"** — "Every chat open (pet double-click, bubble click, key-window save, tray, Ctrl+Shift+Space) goes through `index.ts requestChat(source, focusComposer)`, which applies `chat-request.ts decideChatRequest`: not hidden → open; hidden with `locked`/`suspended`/`fullscreen` live → refuse with one log line; hidden by `user` only → `visibility.set('user', false); visibility.apply()` then open (the `second-instance` behaviour). (I-7)"
- **§2.8 / §6.6 error path** — "`brain:error.message` is passed through `redactSecrets` before IPC; the main log line is `[brain] error code=<code> detail=<boundedDetail>` (200 chars, redacted). (G-3)"
- **§6.5 `KeyStore`** — "`get()` and `source()` derive from one decryption attempt; an undecryptable `key.bin` reports `dev-env`/`none`, is left on disk and logged once. (G-14)"
- **§6.7-adjacent, app-protocol** — "`ELECTRON_RENDERER_URL` and `DS_DEBUG` are read only through `devRendererUrl()` / `devDebugEnabled()`, both `!app.isPackaged`-gated. (M-9)"
- **§4.3 `onTrimNeeded`** — "the new trim id is resolved before the `summarize` await and written in the transaction. (I-10)"; **§4.4** — "`capSummary` (and `facts()`) sanitise: whitespace runs → one space, `【】` → `[]`. (M-5)"

## Interfaces

- `BrainService.dispose(): Promise<void>` — idempotent barrier; resolves after `await this.runner?.cancel()`.
- Awaited `TurnRunner.cancel()` — this worktree still has `cancel(): void` (turn.ts untouched); `await` on it is a no-op today and becomes the real barrier when the BRAIN lane's `cancel(): Promise<void>` merges. `rebuildClient()` uses `void this.runner?.cancel()` (fire-and-forget on key rotation is intended there).
- `BrainService.bubbleHidden(): void`, `BrainService.reposition(force?: boolean): void`, exported `HINT_TTL_MS`.
- `main/quit.ts`: `createBeforeQuit(deps): { handler, phase }`, `DRAIN_TIMEOUT_MS`.
- `main/chat-request.ts`: `decideChatRequest({ hidden, get }): 'open' | 'reveal' | 'refuse'`, `ChatRequestSource`.
- `main/redact.ts`: `redactSecrets`, `boundedDetail`, `DETAIL_MAX_CHARS`, `REDACTED`.
- `main/app-protocol.ts`: `devRendererUrl()`, `devDebugEnabled()`.
- `@ds/memory`: `sanitizeMemoryText` (exported from `summary.ts`, re-exported by the barrel).

## Notes for the integrator
- The BRAIN lane's `cancel(): Promise<void>` merge needs no change on this side.
- Line endings: the index is LF (`core.autocrlf` working copy is CRLF); every file this lane wrote is LF and commits normally.
- Not verified in a live Electron run (the brief allowed a `DS_FAKE_BRAIN=1` launch; not needed — every fix is unit-tested and `pnpm --filter @ds/desktop build` is green). The e2e lane should re-run the quit-mid-reply scenario to see the `[中断]` row persist once the BRAIN lane's awaitable `cancel()` is in.

## Fix round 1

Worktree `D:\ds\.claude\worktrees\wf_d4736852-369-2`, branch `worktree-wf_d4736852-369-2`, on top of `3b2b087`. Every finding of the round-1 list is fixed, TDD per finding (fail-first evidence below), no `packages/brain/**`, `apps/desktop/src/renderer/**`, `packages/protocol/**`, `eval/**` or `docs/**` file touched, no subagents, no real-API launch, no key read.

### Commits (oldest first)

| SHA | Message |
|---|---|
| `21c0eda` | fix(memory): serialise trims on an exact cutoff id, fence the store on close, validate kv counters (G2-2/G2-3/G2-7/CX-4/CX-5) |
| `be693db` | fix(desktop): only an http(s) loopback dev URL is an IPC origin; a throwing closeDb cannot wedge the quit (G2-1/quit) |
| `4d21ce0` | fix(desktop): observe every renderer load, recover crashed windows, gate the key window, force click-through on every bubble hide (G2-2/G2-5/G2-6/CX-3/CX-6/CX-7) |

### Checks (run in the worktree after `4d21ce0`)

| Check | Result |
|---|---|
| `npx vitest run --project @ds/memory` | 3 files / 44 tests pass (round 0: 28; +16) |
| `npx vitest run --project desktop src/main` | all pass; new files `bubble-window.test.ts` (7), `chat-window.test.ts` (4), `key-window.test.ts` (2), `key-request.test.ts` (10), `bubble-visibility.test.ts` (5), `brain-service.crash.test.ts` (2); `brain-service.test.ts` +8, `app-protocol.test.ts` +24, `quit.test.ts` +2 |
| `pnpm test` | 65 files, **728 passed**, 2 skipped (pre-existing skips); round 0 was 59 files / 648 |
| `pnpm -r --if-present typecheck` | exit 0, zero `error TS` |
| `pnpm --filter @ds/desktop build` | exit 0 (`✓ built` x3) |

Fail-first evidence (new tests run with the pre-fix sources stashed): memory — **15 failed / 29 passed** (all G2-7, G2-3, CX-5, CX-4, G2-2 cases failed); app-protocol + quit — **14 failed / 39 passed**; brain-service / bubble / chat / key window tests — **15 failed / 21 passed** (the 21 are pre-existing brain-service cases; every CX-6, G2-2, G2-5, G2-6, CX-7 case failed).

### Per finding

**G2-1 (Critical) — `allowedPetOrigins` accepted any parseable scheme as a dev origin (`file:///a` gave the key `file://`)**
- Fixed how: `apps/desktop/src/main/app-protocol.ts:67-97` — `devOriginKey()` contributes a key only when the URL parses to `http:`/`https:` with hostname in `{localhost, 127.0.0.1, [::1]}` and no credentials (`originKey` still rejects userinfo); anything else grants nothing and `console.warn`s once per distinct value (the guard runs on every IPC event, so it must not spam). M-9's `!app.isPackaged` gate still applies first.
- Test: `app-protocol.test.ts` "G2-1: the dev origin table..." — 9 accepted rows (case, trailing slash, path, default/explicit port, https, IPv4/IPv6 loopback), 10 rejected rows (`file:///a`, remote host, `localhost.evil`, non-loopback IP, userinfo, bare username, `app://local.evil`, `ws:`, malformed, scheme-relative) each asserting `['app://local']` only + warn-once; `file:///a` vs `file:///b`; port mismatch; packaged override; `app://local` as the dev URL widens nothing.
- Commit `be693db`.

**CX-5 / G2-3 / CX-4 (Critical) — trim cutoff derived by length; overlapping trims; stale summary overwrite**
- Fixed how: `packages/memory/src/history.ts:147-205, 286-316`. `onTrimNeeded` serialises: one in-flight trim per store (`inFlight`); an idle store starts synchronously so the snapshot happens before the caller's next statement (I-10's guarantee kept); a busy store queues behind the current trim. `trim()` snapshots `base = last_trim_id`, resolves the cutoff as the **exact id** of the last dropped row by re-deriving the window with ids (`visibleRows`, the same safety truncation as `window()`) and matching `plan.drop` by position/role/content (`resolveCutoff`); no match → nothing written, no summariser call. After the await, inside `BEGIN`, `last_trim_id` must still equal `base` or the transaction rolls back and returns. A superseded turn's plan therefore always aborts (it finds the pointer past its prefix) and can never overwrite the newer summary.
- Tests: `history.test.ts` "G2-3 / CX-4: two overlapping trims resolving in reverse order..." (second trim queued, never on the wire, pointer `'2'` once, summary is the first's, window intact), "G2-3: a trim whose pointer moved under it... aborts inside the transaction", "CX-5: a plan built from a safety-truncated window commits the exact cutoff id" (`last_trim_id === '22'`, not 15; `window().length === plan.keep.length`), "CX-4: a plan that no longer describes the window writes nothing".
- Decision recorded: with full serialisation the second trim's summariser is never invoked (its plan is stale by the time it runs), so "resolving in reverse order" is realised as: first resolves → commits; queued second → stale-abort. This is stricter than "commit only if the snapshot matches" (also implemented) and saves a network call. `TrimPlan` still carries no ids (BRAIN lane type); matching by content is equivalent and self-validating.
- Commit `21c0eda`.

**G2-2 (Important) — no `HistoryStore.close()`; `dispose()` did not await an in-flight trim**
- Fixed how: `history.ts:84-91` `close()` sets `closed`; `trim()` returns before the snapshot (`:164`) and after the summarise await (`:185`) when closed; `trimSettled()` returns the in-flight promise (never-rejecting). `brain-service.ts:377` `dispose()` awaits `store.trimSettled()` after `runner.cancel()`. `index.ts:473` `closeDb` calls `history.close()` before `db.close()`, so a summariser the 3 s drain timed out on is fenced, not thrown into a closed handle.
- Tests: `history.test.ts` "G2-2: a summariser that resolves after close() touches nothing and rejects nothing" (store closed, db closed, summariser released → resolves, `trimSettled()` resolves, reopen shows nothing written); `brain-service.test.ts` "G2-2: dispose() also waits for an in-flight trim/summarise before resolving".
- Commits `21c0eda`, `4d21ce0`.

**CX-3 (Important) — auth failure popped the focusable key window unconditionally**
- Fixed how: new `apps/desktop/src/main/key-request.ts` — `decideKeyRequest` (`open` unless `locked`/`suspended`/`fullscreen` is live → `queue`) and `createKeyRequest` (queue the latest reason; `onVerdict(false)` flushes it once). `index.ts:280` builds the gate; `BrainService`'s `openKeyWindow` dep, the tray item and the first-run prompt all call `keyGate.request(reason)`; the visibility controller's `send` calls `keyRequest.onVerdict(verdict.hidden)` (`index.ts:79`), so the queued prompt shows the moment the verdict clears.
- Tests: `key-request.test.ts` (10: decision table incl. `locked + user`; auth over a lock screen → not shown, shown once on unlock, not twice; fullscreen queue with the latest reason winning; a showable request clears an older queued one). `brain-service.test.ts` "CX-3: an auth failure asks index.ts for the key window through the gated dep, never show()+focus() itself".
- Decision recorded: `user`-only hidden opens immediately WITHOUT revealing her (unlike `requestChat`'s `reveal`): the key window is a settings dialog, not the pet, and the tray item that asks for it is the user's own gesture. Queue (not refuse) for the system flags, because dropping the prompt would leave a dead key with no door.
- Commit `4d21ce0`.

**CX-6 (Important) — bubble `render-process-gone` stranded the active playback**
- Fixed how: `bubble-window.ts:108-131` — on `render-process-gone`: click-through, `hooks.onCrash()`, then `webContents.reload()` once; a second death, or a main-frame `did-fail-load` (code != -3) of the reload, calls `hooks.onUnrecoverable()`; `did-finish-load` after a crash calls `hooks.onReloaded()`. `brain-service.ts:314-332` `bubbleCrashed()`: `runner.cancel()` (retire as interrupted → `turnDone` + `idle`, shown prefix persisted as `[中断]`), and — found by the real-runner test — if the turn had already **settled** (stream finished, runner waiting in `speaking` for `playback:turnDone`) `cancel()` is a no-op, so the acknowledgement is given on the dead bubble's behalf with `runner.turnShown(turnId)`; then `firstMesPending=false`, pin dropped, timers and the owed hide cleared, `emittedThisTurn=0`, `setBubbleVisible(false)` (→ `bubbleHidden()` → click-through). `index.ts:203` `recreateBubble` (deferred with `setImmediate` off the dying webContents' own event) destroys the old window, creates a fresh one with the same hooks, `service.replaceBubble(fresh)` (`brain-service.ts:335` swaps `deps.bubble` and the live IPC allow-list array; `attachRunner` now reads `this.deps.bubble` at event time, `:428`), updates the `chat:open` sender list and re-applies visibility. `onReloaded` → `reposition(true)` + `visibility.resend()` (`bubble:place` + `shell:visibility` resync).
- Tests: `bubble-window.test.ts` (crash #1: click-through, `onCrash` before `reload`, one reload, `onReloaded`; crash #2 → `onUnrecoverable`, no second reload; reload `did-fail-load` matrix; destroyed-in-onCrash not reloaded); `brain-service.test.ts` "CX-6: bubbleCrashed() mid-playback..." (cancel called, window down, late first-mes turnDone persists nothing, next turn normal), "...after dispose() is inert", "replaceBubble() routes every later send and placement to the new window"; `brain-service.crash.test.ts` with the **real `TurnRunner`** and a **real `HistoryStore`** over a controllable stream: mid-stream crash → `idle` + `turnDone` for the turn, assistant row `interrupted=true` with exactly the shown first sentence, user row and metrics row present; settled-stream crash → acknowledged, `idle`, full reply row `interrupted=false`, a new turn is admitted.
- Decision recorded: "recreate on failure" is bounded — a recreated window whose own `loadURL` rejects reports through `onLoadFailure` → the shared startup failure policy (teardown + quit), never a recreate loop.
- Commit `4d21ce0`.

**G2-6 / CX-7 (Important) — `void win.loadURL(...)` on bubble/chat/key; no chat/key crash handling**
- Fixed how: `bubble-window.ts:65-68`, `chat-window.ts:75-78`, `key-window.ts:61-64` — each `loadURL` is `.catch`-observed with `isAbortedLoad` and routes to `hooks.onLoadFailure`; `index.ts:155-176` builds ONE `StartupCleanup` (destroys all four windows, stops cursor/foreground, tray, quits) and `onLoadFailure(surface)` feeds `handleLoadFailure` for pet, bubble, chat and key alike. Chat `render-process-gone` (`chat-window.ts:113-129`): `clearPendingOpened()` (removes the `did-finish-load` once-listener an `openChat` during the first load armed, so the reloaded page gets no stale `chat:opened`), `closeChat` (hide + composing false), reload once; second death or failed reload → `hooks.onUnrecoverable` → `fatal()` in index.ts. Key `render-process-gone` (`key-window.ts:88-92`): hide + `hooks.onCrash` → index.ts marks `keyCrashed`; `showKeyWindow` (`index.ts:260`) destroys and recreates the window on the next open, re-arms `holdWindowOpen`/`ready-to-show`, `service.replaceKey(fresh)`.
- Tests: `bubble-window.test.ts` (rejected load → `onLoadFailure`, `ERR_ABORTED` ignored), `chat-window.test.ts` (rejected load; crash while visible with a pending `chat:opened` → hidden, composing false, once-listener removed, reload once, reloaded page receives no `chat:opened`; second death / failed reload unrecoverable; normal open unchanged), `key-window.test.ts` (rejected load, `ERR_ABORTED` ignored; crash hides + `onCrash`).
- Commit `4d21ce0`.

**G2-5 (Important) — click-through forced only when the window was visible; no hover resync on show**
- Fixed how: new `apps/desktop/src/main/bubble-visibility.ts` — the reconciler lifted out of index.ts: EVERY hide calls `onHidden` (→ `brain.bubbleHidden()`: `setBubbleClickThrough(true)`, drop the pin, re-arm an owed hide) even when the window is already down; the hidden→visible edge calls `onShown` → `index.ts:110` resends `shell:visibility` (`{hidden:false}`) to the bubble as the renderer's resync. `setBubbleVisible` is `bubbleVis.set`; `visibility.send` calls `bubbleVis.apply()`.
- Tests: `bubble-visibility.test.ts` (5: single `onShown` per edge; `onHidden` on every hide incl. already-hidden; hover-inside → verdict hide → clear sequence; wish while hidden remembered + forces the hook; null/destroyed window); `brain-service.test.ts` "G2-5: ... cursor OUTSIDE" (hide with the window already down → click-through forced, pin gone, next hide on schedule) and "... cursor INSIDE" (the renderer's re-emitted `bubble:hover {inside:true}` re-pins and defers the hide until it leaves).
- Decision recorded (**needs the RENDERER lane**): main cannot compute the DOM hit; the resync is the existing `shell:visibility` channel (already in `MAIN_TO_BUBBLE`, so no `packages/protocol` edit — that file is co-owned by the BRAIN/RENDERER lanes this round). The bubble renderer currently ignores `{hidden:false}`; amendment proposed below. A `screen.getCursorScreenPoint()` sample was considered and rejected: a window-bounds hit is not a DOM hit and would re-pin on the transparent margin.
- Commit `4d21ce0`.

**G2-7 (Minor) — `schema_version` / `last_trim_id` not validated at open**
- Fixed how: `packages/memory/src/db.ts:93-111` `readKvInt` (`/^(0|[1-9]\d*)$/` + `Number.isSafeInteger`; missing → 0; else throws); `migrate` reads `schema_version` through it (`:121`, so `'garbage'` is no longer NaN-passed and overwritten — it is left as found and the open fails), `openDb` validates `last_trim_id` after migrate (`:153`); `HistoryStore.lastTrimId()` uses it too.
- Test: `db.test.ts` "G2-7: ..." — 9 rejected `last_trim_id` shapes (`garbage`, `-1`, `01`, `1e3`, `1.5`, `+2`, `' 2'`, `2^53+1`, `''`) → `MemoryOpenError`; garbage `schema_version` → `MemoryOpenError` and left untouched; canonical value and a missing key accepted.
- Commit `21c0eda`.

**quit.ts (Minor) — a throwing `closeDb` left `phase='draining'` forever + unhandled rejection**
- Fixed how: `apps/desktop/src/main/quit.ts:50-64` — `teardownAfterDrain` and `closeDb` each run in an isolated `step()` that logs `[quit] <name> failed: ...`; `phase = 'done'` and `deps.quit()` follow unconditionally.
- Tests: `quit.test.ts` "a throwing closeDb is logged, phase still reaches done and the app still quits" (and the later before-quit is not prevented), "a throwing teardownAfterDrain still closes the db and quits".
- Commit `be693db`.

### Amendments proposed (round 1, for the integrator)

- **§4.3 `onTrimNeeded`** — "Trims are serialised per store (one in flight). The trim point is the exact id of the last dropped row, resolved by matching `plan.drop` (position, role, content) against the current window with ids — the same safety truncation as `window()` — BEFORE the summarize await; `last_trim_id` is snapshotted and re-checked inside the transaction; a plan that no longer matches writes nothing and calls no summariser. `HistoryStore.close()` fences every post-await continuation; `trimSettled()` exposes the in-flight trim." (G2-3/CX-4/CX-5/G2-2)
- **§4.1/§4.2 kv** — "`schema_version` and `last_trim_id` are canonical non-negative safe integers (`/^(0|[1-9]\d*)$/`, `Number.isSafeInteger`); anything else fails `openDb` with `MemoryOpenError`." (G2-7)
- **§5.9 shutdown order (extends round 0)** — "(2) `await brain.dispose()` also awaits `HistoryStore.trimSettled()`; (4) `history.close()` precedes `db.close()`; (5) `teardownAfterDrain`/`closeDb` failures are logged and never prevent `app.quit()`." (G2-2/quit)
- **§5.4 bubble visibility** — "Every hide of the bubble window calls `BrainService.bubbleHidden()` (click-through forced, pin dropped) even when the window was already hidden. On the hidden→visible edge main resends `shell:visibility {hidden:false}` to the bubble; **the bubble renderer MUST treat `{hidden:false}` as a hover resync: recompute whether the last known pointer position is inside the band/hint DOM and re-emit `bubble:hover {inside}`** (RENDERER lane; today `renderer/bubble/main.ts:101` returns early on `!hidden`)." (G2-5)
- **§5.4 / §6.6 bubble crash** — "`render-process-gone` on the bubble: main calls `BrainService.bubbleCrashed()` (turn retired as interrupted, or acknowledged via `turnShown` if already settled; bubble state reset; window hidden), reloads the page once, and on a second death or a failed reload recreates the window (`replaceBubble`). The reloaded page is re-placed (`bubble:place`) and receives the shell verdict." (CX-6)
- **§6.1 chat/key windows** — "All four renderer loads are observed; a non-aborted failure runs the pet's startup failure policy. Chat `render-process-gone`: hide, clear composing and any pending `chat:opened`, reload once, else `fatal()`. Key `render-process-gone`: hide; the window is recreated on its next open." (G2-6/CX-7)
- **§6.x key window rule (companion to requestChat)** — "Every show of the key window (auth-error path, tray item, first run) goes through `key-request.ts createKeyRequest`: visible or user-only-hidden → open (without revealing her); `locked`/`suspended`/`fullscreen` live → queue the latest reason and show it when the verdict clears." (CX-3)
- **app-protocol** — "`allowedPetOrigins` = `app://local` plus, unpackaged only, an `http(s)://` loopback (`localhost`, `127.0.0.1`, `[::1]`) `ELECTRON_RENDERER_URL` without credentials; any other value is ignored with one warning. `file:` is never an origin key." (G2-1)

### Interfaces (round 1)

- `@ds/memory`: `HistoryStore.close(): void`, `HistoryStore.trimSettled(): Promise<void>`; `readKvInt(db, key): number` (exported from `db.ts`).
- `BrainService`: `bubbleCrashed(): void`, `replaceBubble(win): void`, `replaceKey(win): void`; `BrainServiceDeps.bubble`/`.key` are now reassignable (documented); `dispose()` additionally awaits `store.trimSettled()`.
- `main/bubble-window.ts`: `createBubbleWindow(hooks: BubbleWindowHooks)` (`onLoadFailure`, `onCrash`, `onReloaded`, `onUnrecoverable`); `showBubble`/`hideBubble` take the narrow `BubbleSurface`.
- `main/chat-window.ts`: `createChatWindow(hooks: ChatWindowHooks)` (`onLoadFailure`, `onUnrecoverable`).
- `main/key-window.ts`: `createKeyWindow(hooks: KeyWindowHooks)` (`onLoadFailure`, `onCrash`).
- `main/key-request.ts`: `decideKeyRequest`, `createKeyRequest(...)` → `{ request, onVerdict, pending }`.
- `main/bubble-visibility.ts`: `createBubbleVisibility(...)` → `{ set, apply, wanted }`, `BubbleSurface`.
- `main/app-protocol.ts`: behaviour change only (`allowedPetOrigins` loopback rule); no signature change.

### Notes for the integrator
- The BRAIN lane's `cancel(): Promise<void>` still needs no change here; `bubbleCrashed()` fires it with `void` on purpose (its writes are awaited by `dispose()` on quit).
- G2-5's renderer half (re-sample on `shell:visibility {hidden:false}`) is proposed above and is NOT done in this lane (renderer files are not mine); until it lands, a stationary pointer inside the band across a hide/show is re-detected on its next movement (mouse events are forwarded through the click-through window), so the failure mode is bounded to "no pin until the pointer moves".
- Not verified in a live Electron run; every fix is unit-tested and the build is green. The e2e lane can provoke the bubble crash with `webContents.forcefullyCrashRenderer()` if it wants a screenshot.
