# Fix lane BRAIN — report

Worktree: `D:\ds\.claude\worktrees\wf_d4736852-369-1` (`git rev-parse --show-toplevel` → `D:/ds/.claude/worktrees/wf_d4736852-369-1`)
Branch: `worktree-wf_d4736852-369-1` (based on main `16bf16a`)
Setup run: `git submodule update --init --recursive`, `pnpm install --frozen-lockfile`, `pnpm fetch-sdk` (vendor/core + characters/haru/model were missing).

Files touched: `packages/brain/src/{tags,stream-parser,sentences,sanitize,slop-lint,turn,deepseek}.ts` + their tests, `packages/protocol/src/index.ts` (+ test). Nothing under `apps/desktop`, `packages/memory`, `eval`, `docs`.

## Commits (worktree branch only, oldest first)

| Commit | Findings |
|---|---|
| `93357c0` fix(brain): anchor the tag grammar, never paint a malformed `<\|` candidate, bound PAUSE | I-1, G-10, G-11, G-13, I-5 |
| `b1e3f57` fix(brain): make sentence splitting chunk-invariant | G-12 |
| `9eda1b0` fix(brain): tail lint strips only the offending sentence; lint and sanitizer false positives | I-3, M-1, M-2, M-4 |
| `1ae7cd9` fix(brain): TurnRunner never wedges on history failure, write barrier, awaitable cancel | I-2, M-25, M-6, I-8/G-4, G-6, G-5, `cancel(): Promise<void>` |
| `056b1f4` fix(brain): bounded body reader, no synthetic done at EOF, key-safe error messages | G-1/M-3, G-2, G-3 |

Deviation from "one or two findings per commit": the seven TurnRunner findings share one code path (settle/retire/fail + the write chain) and were fixed and tested as one unit; splitting the diff would have produced intermediate states that fail their own tests.

## Verification (all run in the worktree, all green)

- Baseline before any change: `npx vitest run --project @ds/brain` → 10 files, 177 passed, 2 skipped.
- After: `npx vitest run --project @ds/brain` → 10 files, **271 passed**, 2 skipped (the C-14 live tests, no key).
- `pnpm test` (whole repo) → **55 files, 706 passed, 2 skipped** (was 611 + 2).
- `pnpm -r --if-present typecheck` → protocol, brain, stage, memory, desktop all `Done`, exit 0.
- `pnpm test:eval` (eval's node --test, imports brain's src) → 46/46 pass.
- Every finding was reproduced red first (failing test named after the finding ID, run and observed failing — for batches 3–5 by stashing the src changes and running the tests alone), then fixed, then green.

## Per finding

### I-1 — malformed `<|` swallows prose up to the next `|>` (with G-10, G-11)
- **Fixed how:** `TagScanner.push` now checks for a second `<|` (`again`) before any `|>`; if one exists, or a closed candidate exceeds `MAX_TAG`, or an unclosed candidate exceeds `MAX_TAG`, the candidate is *rejected*: its tag-ish head (`/^<\|[^<>|]*[|>]?/` — `<|`, then anything that is not `<`, `>`, `|`, then at most one `|` or `>`) is emitted as `badtag`, the remainder is emitted as `text`, and scanning resumes at the next `<|`. Probe T1's two chunk sequences now yield `badtag('<|ACT emotion=happy>')`, `text('你好。')`, `tag(sad)`, `text('今天。')` etc. — nothing is parsed as a "valid" tag with the last `emotion=`, nothing is lost, `complianceMiss` goes true (first text precedes any ACT).
- **Where:** `packages/brain/src/tags.ts:35-39` (`BAD_HEAD`, `reject`), `:54-67` (push).
- **Tests:** `tags.test.ts` → "I-1: a candidate missing its | does not swallow prose…", "I-1: a candidate missing its > keeps the sentences between as text", "I-1: a closed candidate longer than MAX_TAG is rejected, not parsed", "I-1: the rejection is chunk-invariant…" (every 2-way split).
- **Commit:** `93357c0`.

### G-10 — unclosed / oversized candidate must be `badtag`, never text
- **Fixed how:** the `end < 0 && buf.length > MAX_TAG` overflow path and `flush()` both go through `reject()`: the head is `badtag`, any prose after it is text. `flush()` emits a plain trailing `<` or short non-`<|` text as text (unchanged).
- **Where:** `tags.ts:63` (overflow), `:74-83` (flush).
- **Tests:** "G-10: gives up on an unterminated <| after 64 chars and emits it as badtag, never text" (rewritten from the old text expectation), "G-10: flush emits a pending short <| prefix as badtag, never text", "G-10: an unclosed candidate at end of stream is badtag, never text", "G-10: an oversized unclosed candidate is discarded up to its tag-ish head and scanning resumes"; `stream-parser.test.ts` "an unclosed tag at end of stream is never painted as text".
- **Reconciled with I-1** exactly as the brief says: prose before the candidate is text, the candidate's head is `badtag`, the prose inside a rejected candidate (after its head) is text, scanning resumes.
- **Commit:** `93357c0`.

### G-11 — anchored ACT grammar
- **Fixed how:** `parseTag` splits the body on whitespace; word 0 must be exactly `ACT`; every following word must match `/^(emotion|motion)=([\w-]+)$/`; duplicate keys, unknown keys, dangling words, missing `emotion`, `<|ACT|>` and `ACTIVATE` → `null` → `badtag`. Attribute order is free (`motion=nod emotion=happy` still parses).
- **Where:** `tags.ts:7-26`.
- **Tests:** "G-11: ACTIVATE is not ACT", "G-11: unknown, duplicate and missing attributes are badtag", "G-11: motion before emotion is still one anchored grammar", "splits a valid tag at every character and always reassembles it".
- **Commit:** `93357c0`.

### G-13 — `complianceMiss` bookkeeping
- **Fixed how:** one private `onText(text, out)` handler used by both `push()` and `flush()`; `sawText`/`complianceMiss` are set only when `text.trim() !== ''`.
- **Where:** `stream-parser.ts:30, 38, 44-50`.
- **Tests:** `stream-parser.test.ts` "leading whitespace before the ACT does not count as text", "text that only arrives via flush still flags the compliance miss".
- **Commit:** `93357c0`.

### I-5 — bound `<|PAUSE n|>`
- **Fixed how:** `export const PAUSE_MAX_S = 3` in `@ds/protocol`; `SentenceEventSchema.pause` is `.nonnegative().max(PAUSE_MAX_S)`; `parseTag` returns `Math.min(seconds, PAUSE_MAX_S)`.
- **Where:** `packages/protocol/src/index.ts:29, 37`; `tags.ts:13`.
- **Tests:** `protocol/src/index.test.ts` "SentenceEventSchema pause bound (I-5)" (3 accepted, 3.001 and 100000 rejected); `tags.test.ts` "parseTag — PAUSE bound (I-5)"; `stream-parser.test.ts` "a PAUSE beyond the bound is clamped on the event (I-5)".
- **Commit:** `93357c0`.

### G-12 — chunk-invariant sentence splitting
- **Fixed how:** after a hard match the cut extends over the whole trailing run of `TRAIL = /[。！？!?…\n」』”’)）\]】]/` (so `？！`, `！！`, `。」`, `……` stay together); a run that reaches the end of the buffer is held (may still grow) until the next chunk, a control tag, or `flush()`; the comma rule uses a sticky search from `minFirstChars` (`COMMA.lastIndex = minFirstChars`) and applies only if the comma precedes the hard match. New `settle()` closes a held run at a definite boundary — `StreamParser` calls it on every tag so `回来啦！<|ACT …|>` keeps the ACT/PAUSE that preceded the tag (the alternative — letting the tag change the emotion before the held sentence emits — broke the existing StreamParser/TurnRunner tests, which is how the need surfaced). 70/35 ms and the one-sentence lookahead are untouched.
- **Where:** `sentences.ts:3, 21-42`; `stream-parser.ts:26`.
- **Tests:** `sentences.test.ts` "groups adjacent hard punctuation…", "keeps a trailing extendable run until the next chunk or flush", "settle() closes a held run at a definite boundary", "finds the first eligible comma at or after minFirstChars", plus the property tests over 12 fixtures: every 2-way split, every 3-way split (fixtures ≤ 12 chars), 60 seeded random chunkings per fixture (LCG seed 42), and character-by-character — each must equal the single-push result.
- **Side effect worth knowing:** a terminal `。` at the very end of a delta is now released one delta later (or at stream end). Two existing `turn.test.ts` hang-scripts that stopped the stream right after `今天怎么样。` needed one more delta (`'嗯'`) so the lookahead could release sentence 0; noted in the test.
- **Commit:** `b1e3f57`.

### M-1 — A23 leading-number strip only on the first sentence
- **Fixed how:** `sanitizeForDisplay(input, { leadingNumber?: boolean })` — item 6 runs unless `leadingNumber === false`. `TurnRunner.consider` passes `{ leadingNumber: !turn.consideredAny }` and sets `consideredAny` (reset by `resetAttempt`, so each attempt's first sentence is treated as the injection site). `isEmpty` keeps the whole-string default.
- **Where:** `sanitize.ts:9-16, 35`; `turn.ts:392-393`, `resetAttempt`.
- **Tests:** `sanitize.test.ts` "M-1 — …"; `turn.test.ts` "M-1: strips the injected leading number only from the first sentence of an attempt" (`12 今天不错。` / `2 加 2 等于 4。` / `3 个小时吧。` → `今天不错。`, `2 加 2 等于 4。`, `3 个小时吧。`).
- **Commit:** `9eda1b0`.

### M-2 — `RHETORICAL` tag questions
- **Fixed how:** `/不是吗[？?]\s*$/`, `/你说是不是[？?]\s*$/`, `/对吧[？?]\s*$/` removed from `RHETORICAL`; `难道…吗` / `你觉得呢` stay at `strip`. **Decision:** "report-only" would need a rule name outside the contract-fixed `LintRule` enum or a special case inside `severityOf`; removing them is what the lens recommended and matches spec A2 literally. `eval/judge.md`'s `rhetorical_tail` axis still lists them for the judge — that is the EVAL lane's copy and is not touched here.
- **Where:** `slop-lint.ts:43-49`.
- **Tests:** `slop-lint.test.ts` "M-2 — tag questions are ordinary speech…" (3 not flagged, 2 still flagged).
- **Commit:** `9eda1b0`.

### M-4 — `被打` prefix false positive
- **Fixed how:** `/被(打(?![开断印字扮包回扰脸])|骚扰|霸凌|欺负|家暴)|家暴/`. Added `回` (the eval fixture `我方案又被打回来了`), `扰`, `脸` to the brief's list.
- **Where:** `slop-lint.ts:215-216`.
- **Tests:** `slop-lint.test.ts` "M-4 — 被打 as a prefix is not a sensitive turn" (5 benign, 3 still sensitive: `被打了`, `被打得很惨`, `被打骂`).
- **Commit:** `9eda1b0`.

### I-3 — tail lint deletes the innocent pending sentence
- **Fixed how:** in `drive()`, when `lintTail` is not `none` and the regeneration gate is spent/inapplicable, `pending` is nulled only if a violation is a *last-sentence* rule: `closing-moral`, `question-streak`, or `ellipsis` **when the pending sentence itself contains `……`** (removing it then repairs the >1-ellipsis violation, so it is the offender — this keeps the existing "回来啦……" + "嗯……" test true). `ellipsis-rate`, `affect-rate`, `emoji-rate`, `opener-repeat`, `repetition` (and `ellipsis` when the pending sentence has no ……) are recorded in `lastLint` → `turnDone.lint` / `MetricsRecord.lint` and delete nothing. The seq-0 regeneration gate is unchanged (contract `tailGate`).
- **Where:** `turn.ts:59` (`LAST_SENTENCE_RULES`), `:337-346`.
- **Tests:** `turn.test.ts` "I-3: a reply-scope tail violation (emoji-rate) does not delete the innocent pending sentence" (probe P-B), "I-3: ellipsis-rate carried by a painted sentence keeps the correction that follows" (probe T9), "I-3: the stripped sentence is the one carrying a last-sentence violation" (asserts the stripped sentence matches `/总之/`), "I-3: question-streak still strips the pending final question".
- **Commit:** `9eda1b0`.

### I-2 — tag-only completion is EMPTY
- **Fixed how:** `StreamParser` exposes `get hasText()` (non-whitespace text seen outside tags); `TurnRunner.isEmpty` = `!parser.hasText || sanitizeForDisplay(rawStream).trim() === ''` (sanitizer kept as fallback).
- **Where:** `stream-parser.ts:20`; `turn.ts:450-454`.
- **Test:** "I-2: a tag-only completion is empty — re-request, then the canned line" (`['<|ACT emotion=happy|>']` then `['<|ACT emotion=happy|>\n']` → 2 requests, canned line, `errorCode 'empty'`).
- **Commit:** `1ae7cd9`.

### M-25 (brain half) — unknown motion dropped in `consider`
- **Fixed how:** after sanitising, if `ev.motion` is not in `deps.persona.motionKeys` (`Array.prototype.includes`, so `constructor` / `__proto__` / `toString` cannot pass) the `motion` key is deleted from the emitted event; the emotion stays; one `console.warn` per turn (`turn.motionWarned`).
- **Where:** `turn.ts:409-417`.
- **Test:** "M-25: drops a motion that is not in persona.motionKeys, keeps the emotion, warns once per turn".
- **Commit:** `1ae7cd9`. (The renderer's `Object.hasOwn` half is the RENDERER lane's.)

### M-6 — `ttftMs` dispatch-relative
- **Fixed how:** `turn.dispatchedAt = this.now()` at the top of `runAttempt`; `ttftMs = now() - dispatchedAt` on the first delta. `totalMs` still spans from `send()`.
- **Where:** `turn.ts:357, 367`.
- **Test:** "M-6: ttftMs is measured from the dispatch of the delivered attempt, not from send()" (regenerated turn reports one harness tick, 10, instead of 40).
- **Commit:** `1ae7cd9`.

### I-8 / G-4 — history-write failure after `settled` wedges the runner
- **Fixed how (one mechanism):** every `history.append` goes through `enqueue(label, work)` — a per-runner promise chain whose units `catch` → `console.warn('[turn] history write failed (<label>)')` and never reject; `record()` wraps `port.record` in try/catch (`'[turn] metrics write failed'`). `Turn.interrupted` (set only by `cancel()` and a superseding `send()`) is separated from `Turn.settled` (any terminal outcome); `abandoned()` reads `interrupted`, `fail()` additionally returns early when `settled`. Consequence: `settleNormal` / `settleEmpty` / `retire` / `fail` always reach `finish()` / `toIdle()` and emit exactly one terminal event even when the port rejects; the A-4 catch in `release()` is now redundant but kept.
- **Where:** `turn.ts:92-95` (flags), `:243-250` (`enqueue`), `:457-469` (`settleNormal`), `:471-483` (`settleEmpty`), `:501-512` (`retire`), `:514-529` (`fail`), `:559-585` (`record`).
- **Tests:** describe "history write failures never wedge the runner (I-8 / G-4)": settleNormal with rejecting assistant append; settleNormal with rejecting user append; settleEmpty with all appends rejecting; retire (cancel) with all appends rejecting; fail with all appends rejecting; a rejecting metrics port — each asserts exactly one terminal event (`turnDone` or `error`), eventual `idle`, and the metrics record.
- **Commit:** `1ae7cd9`.

### G-6 — mid-stream failure persists acknowledged sentences
- **Fixed how:** `persistShown(turn)` (the ordered `shown` → one `interrupted: true` assistant row) is shared by `retire()` and `fail()`; `fail()` awaits `commitUser` + `persistShown` **before** emitting `error`. Because `fail()` sets `settled`, a later `cancel()` returns immediately — the row is written once.
- **Where:** `turn.ts:492-499` (`persistShown`), `:523`.
- **Test:** "persists acknowledged sentences once as interrupted before the error is reported" (rows captured inside the `error` listener already contain the interrupted row; a subsequent `cancel()` adds nothing).
- **Commit:** `1ae7cd9`.

### G-5 — write barrier
- **Fixed how:** `run()` starts with `await this.writes` (then re-checks `abandoned`) before `recentAssistant` / `window()`. `retire()` enqueues the user commit and the interrupted row synchronously (before its first `await`), so a superseding `send()` — which calls `retire()` synchronously and then starts the new `run()` — always finds both writes already on the chain. `committed` keeps its "append requested" meaning; durability is what the chain provides.
- **Where:** `turn.ts:116-121, 243-250, 259-261, 504-510`.
- **Test:** "a superseding send awaits the previous turn's appends before reading the history window" — appends gated by a manual promise; the second turn does not dispatch until the gate opens; its prompt then contains `我回来了。` and `回来啦。`; rows land in order.
- **Commit:** `1ae7cd9`.

### `cancel(): Promise<void>` (interface for MAIN)
- **Done:** `cancel()` returns `retire(...).catch(() => undefined)` — resolves after the user row, the interrupted assistant row and the metrics record have settled; never rejects; `Promise.resolve()` when idle or already settled. `state → idle` and `turnDone` still happen synchronously inside `cancel()` (existing tests unchanged and green).
- **Where:** `turn.ts:207-220`.
- **Test:** "cancel() resolves after retire's writes and metrics have settled, and immediately when idle".
- **Commit:** `1ae7cd9`.

### G-1 / M-3 — one bounded body reader
- **Fixed how:** `readBodyBounded(res, { maxBytes, idleMs, signal })` → `{ text, truncated }`: `reader.read()` raced against `withTimeout(idleMs)` (→ `DeepSeekError('timeout')`), byte cap enforced per chunk while reading (the chunk is cut at the cap and the loop exits), `reader.cancel()` in `finally` on every exit; `signal.aborted` → `CancelledError`; other read errors → `network`. Used by `httpError` (cap `MAX_ERROR_BODY_BYTES = 2048`), `complete()` (cap `MAX_JSON_BODY_BYTES = 1 MiB`, truncation → `server` error, JSON parsed from the bounded text) and `testKey()` (bounded drain, same idle timeout, even without a caller signal). `res.text()` / `res.json()` are no longer called anywhere.
- **Where:** `deepseek.ts:51-55` (constants), `:229-270` (`readBodyBounded`), `:276-289` (`httpError`), `:492-518` (`complete`), `:521-545` (`testKey`).
- **Tests:** describe "bounded body reader (G-1 / M-3)": complete() stalled 200 → `timeout` + body cancelled (fake timers, `IDLE_TIMEOUT_MS`); testKey() stalled 200 → `{ok:false, code:'timeout'}` + cancelled; endless 500 body → ≤ 3 pulls, detail ≤ 512, cancelled; stalled 401 body → `auth` after the idle timeout, cancelled; complete() body over the JSON cap → `server`, cancelled. The test fakes now always expose a real `ReadableStream` body (the old `text()`/`json()` shims are gone) and record cancellation.
- **Commit:** `056b1f4`.

### G-2 — EOF before `[DONE]`
- **Fixed how:** after the read loop the remaining buffer (a final complete line, e.g. `data: [DONE]` without a trailing newline) is parsed; if it does not yield `done`, `streamOnce` throws `DeepSeekError('network', null, 'the stream ended before [DONE]')`. `streamWithRetries` is untouched, so it is retried only through `RETRYABLE && !sawDelta`.
- **Where:** `deepseek.ts:475-481`.
- **Tests:** "G-2: EOF after a complete delta but before [DONE] is a network failure, not a synthetic done" (1 call, not retried), "G-2: EOF after half a JSON frame is a network failure", "G-2: EOF before any delta and before [DONE] is retried through the existing gate" (2 calls, success), "G-2: a final [DONE] line without a trailing newline still ends the stream cleanly". The old "yields done when the body ends without a [DONE] sentinel" test was replaced (it asserted the defect).
- **Commit:** `056b1f4`.

### G-3 — upstream body never in `DeepSeekError.message`
- **Fixed how:** `DeepSeekError(code, status, message, detail?)`; `httpError` builds `message = statusMessage(status, code)` — `HTTP 401: the API key was rejected` / `HTTP 402: insufficient balance` / `HTTP 429: rate limited` / `HTTP <n>: upstream error` — and `detail = redactDetail(body, apiKey)`: `/sk-[A-Za-z0-9]{20,}/g` → `sk-…`, then every occurrence of the exact active key → `sk-…`, then cut to `MAX_DETAIL_CHARS = 512` (redaction before truncation so a partial key can never survive the cut); `undefined` for an empty/unreadable body. `testKey()` returns `KeyTestResult = {ok:true} | {ok:false; code; message; detail?}` built from the same error. `ChatClient.testKey` is typed with `KeyTestResult` (desktop's `fake-client.ts` still satisfies it — repo typecheck green). The IPC `key:test` response schema strips the extra `detail` key (zod objects are non-strict), so the renderer sees the same shape as before with a safe `message`; `brain-service.ts`'s `console.error('[brain] error %s %s', p.code, p.message)` now logs a status-derived string.
- **Where:** `deepseek.ts:65-101` (error class, `statusMessage`, `redactDetail`), `:276-289`, `:521-545`.
- **Tests:** describe "the upstream body never reaches message; detail is redacted (G-3)": a 401 body echoing `Authorization: Bearer <key>` (key assembled at runtime so the literal never appears in source or output) → `message === 'HTTP 401: the API key was rejected'`, `detail` contains `sk-…`, neither `message`, `detail`, `String(err)` nor `JSON.stringify(err)` contains the key; an active key that does not look like `sk-…` is still redacted; `testKey()` same shape and same guarantees; empty body → `detail` undefined.
- **Commit:** `056b1f4`.

## NOT A BUG
None — every assigned finding reproduced as described before the fix.

## Decisions taken without asking (for the record)
1. Rejected-candidate split rule (I-1/G-10): head = `/^<\|[^<>|]*[|>]?/`, remainder = prose. Chosen because it is deterministic, chunk-invariant, and reproduces both probe expectations (`<|ACT emotion=happy>` / `<|ACT emotion=happy|`) without a heuristic on tag length.
2. `SentenceSplitter.settle()` is a new public method (called only by `StreamParser`); a control tag is treated as a definite sentence boundary. Without it G-12's held run changed the emotion/PAUSE attribution of a sentence that ends right before a tag.
3. `ellipsis` on the tail strips only when the pending sentence carries `……` (see I-3).
4. M-2 removes the three tag-question patterns rather than inventing a report-only channel.
5. M-4 exclusion set extended with `回扰脸`.
6. `PAUSE_MAX_S` placed next to `SentenceEventSchema` in `@ds/protocol` (value 3, per the brief).
7. `MAX_JSON_BODY_BYTES = 1 MiB` for `complete()`/`testKey()` (not named by the brief; a 900-token summary is a few KB, so the cap is only a runaway guard).
8. `statusMessage` phrases are English technical strings (ERROR_HINTS keeps the Chinese user copy; `message` is what goes to logs/IPC and must never be the body).

## Amendments proposed (for the integrator; exact wording)

### §3.2 (`src/tags.ts`) — replace the listing at contracts.md:1119-1149 with the shipped `packages/brain/src/tags.ts` (commit `93357c0`) and replace the "Contract:" paragraph with:
> Contract: chunk-safe (a `<|…|>` split across `push` calls is reassembled). `parseTag` accepts exactly `ACT` followed by whitespace-separated attributes drawn from `emotion` (required, one of `EMOTIONS`) and `motion` (optional, `[\w-]+`); a duplicate, unknown or dangling attribute, `<|ACT|>`, and any other word (e.g. `ACTIVATE`) make the candidate a `badtag`. `<|PAUSE n|>` is clamped to `PAUSE_MAX_S` seconds. A candidate that starts with `<|` is **never emitted as visible text**: when it contains a second `<|` before any `|>`, when it is longer than `MAX_TAG` (64) whether closed or not, or when it is still unclosed at `flush()`, the scanner emits its tag-ish head (`<|`, then characters other than `<`, `>`, `|`, then at most one `|` or `>`) as `badtag`, the remainder as `text`, and resumes scanning at the next `<|`. `flush()` still emits a lone trailing `<` or a non-`<|` remainder as text. The required tests are the `tags.test.ts` cases tagged I-1 / G-10 / G-11 / I-5.

### §2.2 / §3.4 — `PAUSE_MAX_S`
> `export const PAUSE_MAX_S = 3;` lives in `@ds/protocol` beside `SentenceEventSchema`, whose `pause` is `z.number().nonnegative().max(PAUSE_MAX_S).optional()`. `parseTag` clamps `<|PAUSE n|>` to `Math.min(n, PAUSE_MAX_S)`; the bubble may rely on `pause ≤ PAUSE_MAX_S`.

### §3.3 (`src/sentences.ts`) — replace the listing with the shipped file (commit `b1e3f57`) and add after "defaults to 6":
> **Chunk invariance (G-12):** the sentence list is independent of how the text was chunked. A hard boundary is the whole run of adjacent terminal punctuation, ellipsis dots, closing quotes/brackets and newlines (`？！`, `！！`, `。」`, `……` are one boundary). A run that reaches the end of the buffer is held until the next `push`, a `settle()` (called by `StreamParser` on every control tag — a tag is a definite boundary) or `flush()`. The first-sentence comma rule cuts at the first `，`/`,` **at or after** `minFirstChars` that precedes the first hard boundary. Required tests include the property tests in `sentences.test.ts` (all 2-way splits, all 3-way splits of short fixtures, seeded random chunkings, character-by-character).

### §3.4 — `StreamParser`
> `complianceMiss` is set only when non-whitespace text precedes the first ACT; text delivered by `TagScanner.flush()` is handled by the same path as `push()` text. `StreamParser.hasText` (read-only) is true once any non-whitespace text was seen; `TurnRunner` uses it as the §3.9.4 emptiness fact.

### §3.5 — `sanitizeForDisplay(input, options?)`
> Item 6 (the A23 leading-number strip) is applied only to the **first sentence of an attempt**: `sanitizeForDisplay(text, { leadingNumber: false })` skips it, and `TurnRunner.consider` passes `false` for every sentence after the first one it considers in an attempt. The whole-string call in the emptiness check keeps the default.

### §3.6 — `RHETORICAL` (M-2) and `isSensitive` (M-4)
> §3.6.2 `RHETORICAL` is exactly `[/难道[\s\S]{0,20}吗[？?]/, /你觉得呢[？?]\s*$/]`; `对吧？`, `不是吗？`, `你说是不是？` are ordinary speech and are not linted (spec A2 names only 难道…吗 / 你觉得呢).
> §3.6.4 the third `SENSITIVE` pattern is `/被(打(?![开断印字扮包回扰脸])|骚扰|霸凌|欺负|家暴)|家暴/`.

### §3.9.3 — error shape (G-2 / G-3)
Replace the paragraph "The error body is read and used as `message` …" with:
> `DeepSeekError` is `{ code, status, message, detail? }`. **`message` never contains the upstream body**; it is derived from the status/code by `statusMessage(status, code)`: `HTTP 401: the API key was rejected`, `HTTP 402: insufficient balance`, `HTTP 429: rate limited`, otherwise `HTTP <status>: upstream error`. The body is read with `readBodyBounded` (at most `MAX_ERROR_BODY_BYTES = 2048` bytes, idle timeout `IDLE_TIMEOUT_MS`, body cancelled afterwards) and stored in `detail` after redaction: every `sk-[A-Za-z0-9]{20,}` and every occurrence of the exact active key become `sk-…`, then the string is cut to `MAX_DETAIL_CHARS = 512`; an empty or unreadable body leaves `detail` undefined. `testKey()` resolves `{ ok: true } | { ok: false, code, message, detail? }` (`KeyTestResult`) with the same guarantees. `complete()` and `testKey()` read their bodies through the same reader with `MAX_JSON_BODY_BYTES = 1 MiB` and the idle timeout; a stalled body is `timeout`, an oversized one is `server`.
Add a row to the table: `| body EOF before \`[DONE]\` | \`network\` | \`null\` | only via the existing gate (no delta yet) |` and the sentence: "A final complete line at EOF is parsed; the client never synthesises `done`."

### §3.11 — `cancel(): Promise<void>`
> `cancel(): Promise<void>` — resolves after the retire writes (user row, interrupted assistant row, metrics record) have settled, never rejects, resolves immediately when idle. `state → idle` and the superseded `turnDone` are still emitted synchronously before it returns. `BrainService.dispose()` awaits it before closing SQLite.

### §3.11.2 — tail lint (I-3), `ttftMs` (M-6), motion allow-list (M-25), emptiness (I-2)
Replace "If it fails, that sentence is **stripped before emission**" with:
> If it fails **with a last-sentence rule** — `closing-moral`, `question-streak`, or `ellipsis` when the held-back sentence itself contains `……` — that sentence is stripped before emission (the one-sentence lookahead exists for this). A tail failure carried only by reply-scope rules (`ellipsis-rate`, `affect-rate`, `emoji-rate`, `opener-repeat`, `repetition`, or `ellipsis` without an `……` in the held sentence) describes text that is already painted: the held sentence is emitted unchanged and the verdict is reported in `turnDone.lint` / `MetricsRecord.lint`. The seq-0 regeneration gate is unchanged.
Replace the timing sentence with: "`ttftMs` = `now()` at the first delta minus `now()` at the **dispatch of the attempt that delivered it** (`dispatchedAt`, stamped at the top of every attempt; `null` if no delta arrived); `totalMs` = `now()` at `turnDone` minus `now()` at `send()`."
Add: "Step 6a: a `motion` not listed in `persona.motionKeys` is removed from the event (emotion kept), with one warning per turn." and, in §3.9.4: "An empty completion is one where `StreamParser.hasText` is false (no non-whitespace text outside control tags) or whose text is whitespace-only after `sanitizeForDisplay`; a tag-only completion is therefore empty."

### §3.11.4 / §3.11.5 — writes and failures (I-8, G-4, G-5, G-6)
> All history appends of a runner pass through one ordered write chain; a failed append is logged (`[turn] history write failed (<label>)`) and the chain continues — no append or metrics failure can suppress `turnDone`/`error` or the transition to `idle`. A new turn awaits that chain before reading its history window, so a superseding turn cannot overtake the previous turn's user/assistant rows. On a `DeepSeekError` the runner first persists the sentences whose `sentenceShown` arrived as one `interrupted: true` assistant row (the same helper as cancel), then emits `error`; §3.11.5's "append nothing for the assistant" is amended to "append nothing the user did not see".

## Interfaces

- **`TurnRunner.cancel(): Promise<void>`** — confirmed as specified for the MAIN lane: resolves after `retire()`'s writes (user row, interrupted assistant row, metrics) have settled; never rejects; resolves immediately when idle; synchronous side effects (`state → idle`, `turnDone`) unchanged. `BrainService`'s existing `this.runner?.cancel()` call sites compile unchanged (repo typecheck green); MAIN's `dispose()` should `await this.runner.cancel()`.
- `ChatClient.testKey(): Promise<KeyTestResult>` where `KeyTestResult = { ok: true } | { ok: false; code: ErrorCode; message: string; detail?: string }` — additive optional field; `fake-client.ts` needs no change.
- `DeepSeekError.detail?: string` — additive.
- `sanitizeForDisplay(input, options?: { leadingNumber?: boolean })` — additive.
- `SentenceSplitter.settle(): string[]`, `StreamParser.hasText` — additive.
- `@ds/protocol` exports `PAUSE_MAX_S`.

## Notes for other lanes
- EVAL: `lintReply` no longer flags `对吧？`/`不是吗？`/`你说是不是？` (M-2) and `isSensitive` no longer flags `被打回/开/断/…` (M-4); recorded eval stats that counted those will shift if re-run. `eval/judge.md` still lists the tag questions under `rhetorical_tail` — the judge axis is EVAL's call.
- MAIN: `brain:error` / `key:test` `message` strings are now status-derived; if a hint or log wanted the upstream text, read `DeepSeekError.detail` (redacted, ≤ 512 chars) instead — never log it verbatim in a renderer-facing channel without the redaction it already carries.
- RENDERER: `pause` on `brain:sentence` is guaranteed ≤ 3 s by schema and parser.

## Fix round 1

Commit `9417407` — `fix(brain): defer the assistant row until playback is acknowledged; malformed-SSE warn logs length only (CX-1/CX-8)` (branch `worktree-wf_d4736852-369-1`, main untouched).

### CX-1 (Important) — stream finished ≠ playback finished; truthful history for a superseded/cancelled reveal
- **How fixed** (`packages/brain/src/turn.ts`):
  - `Turn` gains `streamFinished` (stream ended normally; turnDone + metrics are out) and `reported` (turnDone emitted exactly once); `settled` now means "nothing left to retire — history is final for this turn" (`turn.ts:92-103`).
  - `settleNormal` (`turn.ts:474-490`) sets `streamFinished`, commits the user row, and settles immediately only when `emitted.length === 0` or `turnShown` already arrived; otherwise the normal assistant row is **not** written. `finish()` still emits `turnDone` at stream end (contract §3.11: turnDone for every terminal outcome; MAIN/renderer timing unchanged) and stamps `reported` (`turn.ts:563-569`).
  - `commitAssistant` (`turn.ts:493-498`) is the one un-flagged full-reply write; enqueued synchronously through the G-5 chain.
  - `turnShown` (`turn.ts:239-251`): for a `streamFinished && !settled` turn it sets `settled`, enqueues `commitAssistant`, goes idle. A late `turnShown` for a superseded turn is ignored (`current.id` check, unchanged).
  - `send()` / `cancel()` are unchanged textually — their `!previous.settled` gate now admits a stream-finished-but-unacknowledged turn, so `retire()` runs: `persistShown()` writes the `sentenceShown` prefix as `interrupted: true` through the write chain. `retire` (`turn.ts:517-531`) skips `emitTurnDone`/`record` when `reported` is already true — one turnDone and one MetricsRecord per turn, never two. `settleNormal` returns after its writes if the turn was abandoned meanwhile (retire already reported it).
- **Tests** (`packages/brain/src/turn.test.ts`, describe `TurnRunner — stream finished but playback not acknowledged (CX-1)`, lines 780-873): `send() before turnShown retires the turn and keeps only the shown prefix, interrupted` (also: exactly 2 turnDone, metrics t1+t2, late turnShown('t1') writes nothing); `cancel() before turnShown keeps only the shown prefix, interrupted, and goes idle`; `nothing shown at all -> cancel() before turnShown writes no assistant row`; `turnShown after the stream ended writes the full normal row exactly once` (then cancel/turnShown are no-ops); `the deferred assistant row is covered by the write barrier of a following send` (G-5 coordination: t2's window read waits behind t1's deferred row and its prompt contains the full t1 reply). All 5 observed red against the pre-fix `turn.ts` (three of them time out waiting for the interrupted row, one sees the full row appended), green after.
- **Existing tests adjusted** (behaviour the finding forbids): 8 tests that asserted the normal assistant row before any `turnShown` now call `turnShown` and await the row (`turn.test.ts:216-220, 246, 350-352, 424, 435, 457, 566, 758`). No assertion was weakened; each still asserts the full row content.
- **Decisions** (no questions asked): (1) `turnDone` stays at stream end, not at playback end — the contract (§3.11 "turnDone for every terminal outcome", MAIN's metrics/eval consumers) and 20+ existing tests depend on it; the superseded turn's turnDone in `send()` is therefore *not* re-emitted for a stream-finished turn (one turnDone per turn). (2) `settleEmpty` (canned line, `kind: 'system'`) still writes its row immediately and settles — the finding names `settleNormal`, and a canned line is not model text whose truthfulness R2 protects; a cancel during its reveal is a no-op as before. (3) A turn with `emitted.length === 0` settles at stream end as before (no row to defer).
- **Proposed contract wording (§3.11.4)**: "A turn whose stream ended normally is *stream-finished*, not settled: `turnDone` and the `MetricsRecord` are emitted then, but the assistant row is written only when `playback:turnDone` (`turnShown`) arrives. A `send()` or `cancel()` before that retires the turn exactly like a mid-stream interruption — the `sentenceShown` prefix is appended once as `interrupted: true` — without a second `turnDone`."

### CX-8 (moderate) — malformed-SSE warning must not carry payload bytes
- **How fixed**: `packages/brain/src/deepseek.ts:135` now logs `` `[deepseek] skipped a malformed SSE frame (${payload.length} chars)` `` — frame kind and length only.
- **Tests** (`packages/brain/src/deepseek.test.ts`): `CX-8: the malformed-frame warning carries the frame length, never the payload bytes` (line 180 — a half frame containing private Chinese text; asserts the text and the JSON key are absent from every warn argument and the length is present); the G-2 `EOF after half a JSON frame` test (line 411) additionally asserts the payload is absent from the warn. Both red on the pre-fix source, green after.

### Verification (fix round 1)
- `npx vitest run --project @ds/brain` → 10 files, **277 passed**, 2 skipped (was 271).
- Pre-fix proof: with `turn.ts`/`deepseek.ts` checked out from HEAD and the new tests in place → 7 failed (the 5 CX-1 tests, CX-8, G-2 half-frame), 270 passed.
- `pnpm test` → **55 files, 712 passed, 2 skipped**.
- `pnpm -r --if-present typecheck` → protocol, brain, stage, memory, desktop all `Done`, exit 0.
- No file outside `packages/brain/src/**` and this report was touched.

## Fix round 2

Commit `cbf84b8` — `fix(brain): settleNormal always finishes a settled turn; fail() bails on a reported turn (round 2)` (branch `worktree-wf_d4736852-369-1`, main untouched).

### Important — `settleNormal` regression from 9417407 (turn.ts:488): settled turn superseded during its user-row append lost turnDone + metrics
- **How fixed**: the post-write guard `if (this.abandoned(turn)) return;` is replaced by the precise condition it documented: `if (turn.reported) return;` (`packages/brain/src/turn.ts:488-492`). `reported` is set only by `retire()` and `finish()`, so the guard now bails exactly when `retire()` already emitted turnDone/metrics. A turn that `settleNormal` settled itself (`emitted.length === 0` or `turnShown` already remembered) is not retired by a later `send()` (its `!previous.settled` gate), so it still runs `finish()` even though `current !== turn`; `finish()` is safe there (`toIdle()` no-ops for a non-current turn, `record()` swallows metric failures). The pre-write guard at turn.ts:476 is unchanged: a turn abandoned before `settled` is set was retired by send()/cancel() and is reported by `retire()`.
- **Test**: `packages/brain/src/turn.test.ts:889` — `R2-1: zero-sentence turn, gated user row, superseding send() during the gate -> turnDone + metrics for BOTH turns, once each`. Exactly the finding's repro: script `['<|ACT emotion=happy|>**回来啦**。']` (markdown lint strip → zero sentences; probed `lintSentence` → `{markdown, severity: strip}`), `history.gate` on the append, `send('我回来了。')`, wait for the user row to be in flight, `send('那你先睡吧。')`, open the gate → asserts `turnDone` turnIds `['t1','t2']`, metrics `['t1','t2']`, no `error`, rows `['我回来了。','那你先睡吧。','好吧。']`, state idle. Observed red on the pre-fix source (timed out at `both turns done`, t1 never reported), green after.

### Minor — `fail()` after a throwing turnDone listener ran the full error path on a stream-finished turn (turn.ts:549)
- **How fixed**: `fail()` now returns early for a turn that already reported: `if (turn.settled || turn.reported || this.abandoned(turn)) return;` (`packages/brain/src/turn.ts:552-555`). A throw propagating from a `turnDone` listener via `finish()` → `drive()` → `run()`'s catch therefore produces no `error` event, no second MetricsRecord (`errorCode 'network'`), and no `interrupted:true` row; the later `turnShown` still writes the normal row. Decision: bail rather than try/catch inside `finish()` — the listener contract is not meant to tolerate throwing listeners (the desktop `ipc.ts` guards them), so the throw still surfaces via `detach()`'s `console.error`, and the turn is treated as what it is: completed and reported. Consequence (documented, not hidden): when a listener throws, `record()` for that turn is skipped because the throw interrupted `finish()` before it — the same as before this round; the fix only removes the spurious error/second-record/interrupted-row side effects.
- **Test**: `packages/brain/src/turn.test.ts:913` — `R2-2: a throwing turnDone listener after a normal stream end does not run the fail() path` (throwing listener, GREETING; asserts zero `error` events, zero metrics records from `fail()`, `turnShown` still writes the full normal row, state idle). Red before the fix (`error` event emitted), green after.

### Verification (fix round 2)
- `npx vitest run --project @ds/brain` → 10 files, **279 passed**, 2 skipped (was 277).
- `pnpm test` → **55 files, 714 passed, 2 skipped**.
- `pnpm -r --if-present typecheck` → protocol, brain, stage, memory, desktop all `Done`.
- Files touched: `packages/brain/src/turn.ts`, `packages/brain/src/turn.test.ts`, this report. No contract amendment needed beyond the §3.11.4 wording already proposed in round 1 (turnDone/metrics stay at stream end, once per turn).
