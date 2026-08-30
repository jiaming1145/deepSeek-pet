# Fix lane BRAIN — Phase 2 final-review fixes in `packages/brain` (+ one zod line in `packages/protocol`)

You own: `packages/brain/src/**` and the `PAUSE` bound in `packages/protocol/src/index.ts`. Do not edit `apps/desktop/**`, `packages/memory/**`, `eval/**`, `docs/**` (other lanes own them; the integrator applies contract amendments you PROPOSE in your report).

Source of truth for each finding (read the full entry before fixing — file:line, quoted code, reproduction, proposed fix): `final-review.md` (Claude synthesis, IDs I-n / M-n) and `gpt-review-1.md` (GPT, IDs G-n = its numbered list) in this directory, plus `brain.md` for the lens's own detail. Where Claude and GPT describe the same defect, fix it once, satisfy both descriptions, and say so.

## Findings to fix (all of them)

Tags / parser
- I-1 malformed `<|` swallows prose up to the next `|>` (`tags.ts:24-30`) — cap + reject a candidate containing a second `<|`; re-scan.
- G-10 unclosed / oversized candidate must surface as `badtag`, never as visible text (flush and MAX_TAG overflow paths). Reconcile with I-1: after a rejected candidate, prose before the LAST `<|` is text, the candidate itself is `badtag`, scanning resumes.
- G-11 anchor the ACT grammar: exactly `ACT`, attributes limited to `emotion` (required) and `motion` (optional), duplicates/unknown attributes → `badtag`; `<|ACTIVATE …|>` is `badtag`.
- G-13 `complianceMiss`: `sawText` only on non-whitespace text; text emitted by `tags.flush()` goes through the same handler.
- I-5 bound `<|PAUSE n|>`: `PAUSE_MAX_S` (export from `@ds/protocol`, value 3) clamped in `parseTag` and mirrored with `.max(PAUSE_MAX_S)` in `SentenceEventSchema` (`packages/protocol/src/index.ts:31`). Test both.
- M-25 (brain half) `TurnRunner.consider` drops a `motion` not in `persona.motionKeys` (keep the emotion, log once per turn).

Sentences
- G-12 chunk invariance: group adjacent hard punctuation (`？！`, `！！`, `。」`), keep a trailing extendable run (`…`) until lookahead/flush, comma rule searches for the first eligible comma at/after `minFirstChars`. Add a property-style test: for each fixture string, every chunking (all split points for short strings; seeded random for long) yields the identical sentence list. Do not change the 70/35 ms or the one-sentence lookahead semantics (contract §3.11.2).

Sanitize / lint
- M-1 A23 leading-number strip only on the FIRST sentence of an attempt (`sanitize.ts:29`).
- M-2 `RHETORICAL`: drop `对吧` / `不是吗` / `你说是不是` from strip severity (report-only) (`slop-lint.ts:62`). Propose contract §3.6 amendment.
- M-4 `被打` prefix false positive (`slop-lint.ts:224`).
- I-3 tail lint must not delete `pending` for reply-scope violations (ellipsis-rate, affect-rate, emoji-rate, opener-repeat, repetition); only last-sentence rules (`closing-moral`, `question-streak`) may strip the pending sentence; reply-scope verdicts go to `lastLint`/metrics. Test: the stripped sentence must itself carry the violation. Propose §3.11.2 amendment.

Turn runner
- I-2 tag-only completion is EMPTY (parser fact, not sanitizer): `['<|ACT emotion=happy|>']` → re-request then canned line (`turn.ts:385-388`).
- I-8 / G-4 history-write failure after `settled` must not wedge: try/catch around every `history.append` / `record()` in `settleNormal`/`settleEmpty`/`retire`/`fail`; warn, still emit exactly one terminal event and reach idle. Separate "abandoned by supersede/cancel" from "terminalised". Test each path with a rejecting HistoryPort.
- G-6 mid-stream failure after acknowledged sentences persists them once as `interrupted:true` (reuse retire's ordered helper) before the error is reported.
- G-5 write barrier: `committed` currently means append-started. Keep a per-runner `writes: Promise<void>` chain; `send()` awaits the chain (never rejects — swallow with a warn) BEFORE reading the history window, so a superseding turn cannot overtake the previous turn's user/assistant appends. Test: deferred append + superseding send → new prompt contains the prior turn.
- **Interface for the MAIN lane (binding):** `TurnRunner.cancel(): Promise<void>` resolves after retire()'s writes (user row, interrupted assistant row, metrics) have settled — resolves, never rejects, and resolves immediately when idle. Keep the synchronous side effects (state → idle, `turnDone`) exactly where they are today so existing tests pass. MAIN's `BrainService.dispose()` will `await this.runner.cancel()`.
- M-6 `ttftMs` dispatch-relative: stamp `dispatchedAt` at the top of `runAttempt` (`turn.ts:314`).

DeepSeek client
- G-1 / M-3 one bounded body reader (`readBodyBounded(res, { maxBytes, idleMs, signal })`) used by `httpError`, `complete`, `testKey`: idle timeout, byte cap enforced WHILE reading, cancel the body on timeout/overflow. `complete()` and `testKey()` get `IDLE_TIMEOUT_MS`; the summariser's call path must end.
- G-2 EOF before `[DONE]` → `DeepSeekError` kind `network` (retryable only via the existing `!sawDelta` gate); never synthesise `done`. Parse a final complete line first.
- G-3 never put the upstream body in `DeepSeekError.message`. `message` derives from status/code (user-safe, matches `ERROR_HINTS` semantics); keep an optional `detail` (≤ 512 chars) with `sk-[A-Za-z0-9]{20,}` and the exact active key replaced by `sk-…`; `testKey()` returns the same shape. Test: an upstream body echoing the key never reaches `message`/`detail`/logs.

## Rules
- TDD per finding: failing test first (name it after the finding ID), then the fix, then `npx vitest run --project @ds/brain` green, then commit (`fix(brain): <what> (I-n/G-n)`). Small commits, one or two findings each.
- No refactors beyond the finding; no renames of contract-fixed names; no placeholders.
- At the end: `pnpm test` (whole repo), `pnpm -r --if-present typecheck`; both must be green.
- Report: `<worktree>/.superpowers/sdd/2026-08-29-phase2-brain/final-review/fix-brain-report.md` — per finding: fixed how, file:line, test name, commit; a "## Amendments proposed" section with exact contract wording for §3.6 (M-2), §3.11.2 (I-3, M-6), §3.9.3 (G-2/G-3 error shape), the scanner listing at contracts.md:1119-1149 (I-1/G-10/G-11), and the `PAUSE_MAX_S` bound; a "## Interfaces" section confirming `cancel(): Promise<void>`.

## Added after launch — Codex review (`codex.md`, IDs CX-n). ALSO assigned to this lane; the reviewer will check them.
- CX-1 (turn.ts:144, :395) a stream that finishes while the bubble is still revealing is `settled` and its FULL text is appended as a normal assistant row; a `send()` before `playback:turnDone` then does not retire it, so history contains sentences the user never saw, un-flagged (R2 sentence-granular truthful history). Fix: separate `streamFinished` from `playbackFinished`; defer the normal assistant row until `turnShown()` / playback done; a superseding send (or cancel) before that retires the turn and persists only the acknowledged sentences with `interrupted:true`. Test: stream completes → send again before turnShown → history has only the shown prefix, interrupted. Coordinate with G-5's write barrier.
- CX-8 [moderate] `deepseek.ts:100` malformed-SSE warn must log only the frame LENGTH and kind, never payload bytes (private conversation content). Test asserts the payload text is absent from the warn.
