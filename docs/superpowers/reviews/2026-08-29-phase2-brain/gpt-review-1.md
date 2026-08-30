# GPT review 1 — Phase 2 riskiest modules (gpt-5.6-sol, effort xhigh, 2026-08-30)

Files reviewed: packages/brain/src/{deepseek,stream-parser,tags,turn,sentences}.ts, apps/desktop/src/main/{ipc,key-store,brain-service}.ts

VERDICT: block | major:8 minor:6

## Major

1. **deepseek.ts:183-195 httpError; complete/testKey** — Only streaming reads have an idle timeout. A server that returns headers and then stalls the body leaves httpError(), complete(), or testKey() pending indefinitely; testKey() commonly has no caller signal. httpError() also calls res.text() before slicing, so an arbitrarily large error body is fully buffered despite the claimed 2 KB limit. → Use one bounded response-body reader for error, complete, and key-test responses, with an idle timeout, maximum byte count, and cancellation/abort of the underlying response on timeout or overflow. Limit bytes while reading rather than after res.text().
2. **deepseek.ts:340-390 streamOnce** — A clean EOF without a DeepSeek [DONE] frame is synthesized into success by `yield { kind: 'done' }`. If a proxy truncates the stream after a partial JSON line or partial answer, the malformed tail is skipped and TurnRunner commits the partial result instead of receiving a retryable network/server failure. → Treat EOF before [DONE] as a DeepSeekError. Parse any final complete line, but if it is not [DONE], cancel the reader and throw network/server; do not synthesize done. Non-retryable after a visible delta (streamWithRetries already enforces that gate).
3. **deepseek.ts httpError; brain-service.ts reportError** — Arbitrary upstream error-body text becomes DeepSeekError.message, is returned by testKey(), sent to renderers, and for chat failures is logged verbatim by `console.error('[brain] error %s %s', p.code, p.message)`. If an upstream endpoint or proxy echoes an Authorization value, the API key is persisted in logs and exposed to the renderer. → Use status/code-derived user-safe messages. If upstream detail is retained for diagnostics, keep it separate, bounded, and redact the exact active key plus recognized key patterns before any log or IPC. Never place the raw response body in DeepSeekError.message.
4. **turn.ts settleNormal, settleEmpty, fail, abandoned** — Terminal history failures can permanently wedge the runner. settleNormal/settleEmpty set `turn.settled = true` before awaiting history writes; if a write rejects, run() calls fail(), but fail() immediately returns because abandoned() treats settled as abandoned. fail() itself also sets settled before awaiting commitUser(), so a commit failure there escapes as only a background log. No error/turnDone. → Separate cancellation/abandonment from terminalization. Catch each terminal history failure, emit a deliberate storage/server failure, and guarantee a final state transition in finally. Add current-turn checks between asynchronous writes.
5. **turn.ts send, release, commitUser** — `committed` means append-started, not durably committed: commitUser sets it before history.append resolves. If a sentence starts an asynchronous user append and another send supersedes the turn, the old text is not merged, while the new turn can read its history window before that append or the old assistant append completes. The new prompt can omit the preceding turn. → Serialize history operations through a per-runner write barrier. Distinguish none, pending, durable; a new prompt must await all writes belonging before it. If a pending user commit fails, handle explicitly.
6. **turn.ts fail** — A mid-stream DeepSeek failure discards already displayed assistant history: once sentence 0 has been emitted and acknowledged, an idle timeout causes fail() to commit only the user message and ignore both `shown` and `emitted`; the visible reply is absent from future context even though cancel/supersede correctly persist shown sentences as interrupted. → Before reporting a stream failure, persist the acknowledged sentences using the same ordered interrupted-assistant helper used by retire(); exactly once and before the next history snapshot.
7. **brain-service.ts attachRunner state listener / reportError** — An error before the first sentence displays its hint for much less than its requested TTL. reportError() schedules `HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS`, then TurnRunner immediately emits idle; the idle listener sees `emittedThisTurn === 0` and calls scheduleBubbleHide(BUBBLE_HIDE_DELAY_MS), which clears and replaces the hint timer. → Do not let the empty-turn idle fallback replace an existing hide debt or active hint deadline; gate the idle fallback on `!hideOwed`; add a fake-clock test covering error then idle.
8. **brain-service.ts dispose / start did-finish-load registration** — dispose() is not a shutdown barrier. runner.cancel() starts detached retirement/history/metrics work and dispose returns immediately, so closing the SQLite database next can make those writes hit a closed handle. The anonymous bubble `did-finish-load` listener is not removed; if it fires after disposal, maybeFirstMessage() still accesses the database and sends events. → Add an awaitable TurnRunner shutdown/drain and make BrainService disposal asynchronous so the owner waits before closing SQLite. Store and remove the did-finish-load callback; disposed guard on every delayed callback.

## Minor

9. **brain-service.ts maybeFirstMessage** — `void store.append(...)` has no rejection handler while KV_FIRST_RUN_DONE is set immediately; an async append failure becomes an unhandled rejection and permanently suppresses the greeting. Quitting before playback marks it seen before the user saw it. → Commit greeting history + first-run marker in an ordered, handled operation, preferably after playbackTurnDone for FIRST_MES_TURN_ID; do not set the marker if persistence fails.
10. **tags.ts:23-28 TagScanner.push/flush** — An unclosed protocol tag is reclassified as visible text: a response ending with `<|ACT emotion=happy` is emitted by flush() as text; once an unclosed candidate exceeds MAX_TAG, push() emits the entire buffer as text. → Once `<|` starts a candidate, emit an unclosed or oversized candidate as badtag, never ordinary text; recover scanning after a bounded discarded candidate.
11. **tags.ts:5-12 parseTag** — ACT grammar not anchored: `body.startsWith('ACT')` + free-running attribute regex accepts `<|ACTIVATE emotion=happy|>`; unknown attributes silently ignored. → One fully anchored grammar for exactly ACT + allowed attributes; reject unmatched content as badtag.
12. **sentences.ts SentenceSplitter.push** — Output depends on chunking; splits punctuation clusters: `真的？！` → `真的？` + `！`; `……` across chunks can produce a standalone second ellipsis; if the first comma is before minFirstChars, later eligible commas are never considered (search() returns the first comma). → Group adjacent hard punctuation, retain a trailing extendable punctuation run until lookahead or flush, search for an eligible comma at or after minFirstChars; assert chunk-invariance.
13. **stream-parser.ts push/flush** — Leading whitespace defeats complianceMiss: push() sets sawText=true even when item.text.trim() is empty; text emitted only by tags.flush() bypasses compliance bookkeeping. → One handler for push and flush text; sawText only on non-whitespace.
14. **key-store.ts get/source** — A corrupt/undecryptable key.bin makes get() fall back to the dev key or null, but source() still returns `store` because the file exists. → Resolve key and source together from one decryption attempt; on decryption failure report dev-env/none and quarantine the unusable ciphertext.

## Tests to add
- deepseek: 200/500/key-test responses that send headers then stall → timeout, body cancellation, no live reader.
- deepseek: error body larger than cap → not fully buffered; active key cannot appear in messages/IPC/logs.
- deepseek: split valid UTF-8/SSE at every byte boundary incl. CRLF and [DONE] → identical output.
- deepseek: EOF after a complete delta / half a JSON frame / without [DONE] → failure, not synthetic success.
- tags: split `<|ACT emotion=happy motion=x|>` at every character; dangling `<`, `<|`, `<|ACT…`, oversized unclosed, malformed ACTIVATE.
- sentences: chunk-invariance for `真的？！`, `好吧……再说`, repeated `！`, short leading clause + later eligible comma.
- turn: rejecting user/assistant appends on normal, empty, failure paths → exactly one terminal event, eventual idle.
- turn: deferred append followed by superseding send → next history snapshot cannot overtake prior writes.
- turn: acknowledge an emitted sentence then fail the stream → persisted once as interrupted.
- brain-service: fake-clock error-before-first-sentence then idle → hint remains HINT_TTL_MS.
- brain-service: dispose during an active turn and before bubble did-finish-load → writes drain before DB close; no post-dispose callback.
- brain-service: fail first-message append or quit before playback → no unhandled rejection, no premature marker.
- key-store: undecryptable key.bin with/without dev key → present/source reflect the real usable source.

## Open questions from GPT (answered in gpt-review-2.md)
- invoke.ts handleInvoke sender/main-frame checks; app-protocol.ts isAllowedPetUrl exact origin.
- setBubbleVisible owner + quit path that closes HistoryStore/DatabaseSync (dispose-vs-close ordering; bubbleWanted replay after global visibility clears).

## Checked and found clean
- 401→auth, 402→balance, 429→rate, 5xx→server mapped correctly; auth/balance not retried.
- Stream retries blocked after the first delivered delta (no duplicated visible output).
- Caller cancellation distinguished from connect timeout; not retried.
- Streaming readers cancelled in `finally` on normal return, error, consumer cancellation, [DONE].
- Regeneration loop bounded: ≤1 lint regeneration and ≤1 empty-completion retry.
- `onFromAny` registrations restrict chat/bubble/key channels to their windows; `isFromWindow` checks webContents identity, main-frame identity, then origin outside the narrow disposed-frame catch.
- KeyStore: no plaintext fallback when safeStorage unavailable; ignores dev env key in packaged builds; writes only safeStorage ciphertext (0o600 is not a meaningful ACL on Windows, but the value is DPAPI ciphertext).
- Pinned-bubble hide path rechecks `bubblePinned` on timer fire and re-arms on pointer leave; the defect is only the error-hint timer being replaced by idle.
- The API key is not interpolated into any locally constructed error; the exposure path is the untrusted upstream body.
- SSE mechanics otherwise correct (TextDecoder streaming preserves split code points, line buffer preserves split frames, trailing `\r` removed); holding a trailing `<` is sufficient for the `<|` opener split — the gap is overflow/EOF handling of buffered candidates.
