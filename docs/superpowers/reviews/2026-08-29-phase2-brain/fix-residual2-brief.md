# Fix lane RESIDUAL-2 — GPT closure-2 findings (base = main after RESIDUAL-1 merges)

You own: `apps/desktop/src/main/quit.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/chat-window.ts`, `apps/desktop/src/main/chat-request.ts`, `apps/desktop/src/main/key-request.ts`, `apps/desktop/src/renderer/bubble/speech.ts` (+ tests; `bubble/main.ts` only if wiring needs it). Nothing else. Read `gpt-closure-2.md` (and `gpt-closure-3.md` if present) in this directory first — they quote the code and scenarios. Stay consistent with contract amendments A-17..A-36 (docs/superpowers/plans/2026-08-29-phase2-contracts.md, top) and the fix-wave reports (`fix-main-report.md`, `fix-renderer-report.md`).

## Findings to fix (all)
- GC2-1 [major] quit.ts — guard `teardownSync()` like every other step; `run()` starts regardless; a finally-style guarantee that `phase` reaches `'done'` and `app.quit()` is attempted exactly once. Test: teardownSync throws → drain, teardownAfterDrain, closeDb, quit each attempted once; phase `'done'`.
- GC2-2 [major] index.ts second-instance — route through `requestChat('second-instance', true)`; if the event arrives before wiring, hold ONE pending request and replay it once `requestChat` exists. Tests: after ready → opens through the gate (and is refused while locked/fullscreen); before ready → replayed once.
- GC2-3 [major] speech.ts — a cancellation finaliser distinct from `finishTurn()`: on `brain:state idle` while paused and unfinished: invalidate timers/tokens, clear queue/current/beat, mark finished + inactive, hide, do NOT send `playback:turnDone`, resolve waiters. Test: pause → unfinished idle → resume → inactive, hidden, timer-free, no sentenceDone/turnDone.
- GC2-4 [major] speech.ts `complete()` — no-op while `!isVisible` (record the request and apply it on resume if you prefer); never `commitSentence` while paused. Test: complete() while paused emits nothing and marks no hidden text as shown.
- GC2-5 [minor] chat-window.ts — `clearPendingOpened()` from `closeChat()` including when already hidden. Test: open while loading → close → did-finish-load emits no stale `chat:opened`.
- GC3-* — any findings in `gpt-closure-3.md` (chat-request.ts / key-request.ts) if that file exists when you start; otherwise ignore.

## Rules
TDD per finding (tests named after the IDs); `npx vitest run --project @ds/desktop` green; `pnpm test`, `pnpm -r --if-present typecheck`, `pnpm --filter @ds/desktop build` green at the end; commits `fix(desktop): … (GC2-n)` / `fix(bubble): …`; no refactors beyond the findings; Electron facts from `node_modules/electron/electron.d.ts`; never touch turn.ts/history.ts/brain-service.ts (RESIDUAL-1 owns them). Report: `<worktree>/.superpowers/sdd/2026-08-29-phase2-brain/final-review/fix-residual2-report.md` with "## Amendments proposed" (§6.x second-instance rule, §5.x hidden-cancellation rule, quit.ts step guarantee).

## Added — GPT closure 3 (`gpt-closure-3.md`)
- GC3-1 [major] key-request.ts `onVerdict` — flush decision must come from `decideKeyRequest(individual flags)`, not the aggregate `hidden`; clear `pending` before `show`. Test: queue under `{locked:true,user:true}`, clear only `locked`, `onVerdict` → shown exactly once while `user` stays true.
- Integration tests GPT asked for: chat request before wiring → replayed once through the gate; speech hidden → idle → visible → cleared, no stale band, no acks (covers GC2-3).

## Added — protocol follow-up from RESIDUAL-1 (amendment A-38)
- You ALSO own `packages/protocol/src/index.ts` and `apps/desktop/src/main/brain-service.ts` for this one item: add `ErrorCode` member `'storage'` with `ERROR_HINTS.storage` = the Chinese copy RESIDUAL-1 put in `STORAGE_HINT_TEXT` (brain-service.ts), then switch GC-3's surface from `hint:show` to `brain:error {code:'storage'}` as A-38 asks; keep the redacted warn. Test: a failing assistant append → `brain:error` with `code:'storage'`, no raw error text in the payload.
