# Final review — lens: packages/brain (Phase 2, phase1-stage..main)

Read-only review. Evidence: every finding below was reproduced by running the shipped modules
under `node --experimental-strip-types` (probe scripts in the session scratchpad, outputs quoted
verbatim), or by reading the code with the exact lines quoted. Baseline: `npx vitest run
packages/brain` -> 10 files, 177 passed, 2 skipped (the C-14 live tests, no key); `pnpm --filter
@ds/brain typecheck` clean.

Authorities read: contracts.md Amendments A-1..A-8, §3.2–§3.11; rulings.md (R-rulings, Defers,
P0–P5); docs/evidence/phase2/deferred.md; task-2 report; task-4 brief's contract additions 1–18.
Nothing below is already parked in deferred.md or the Defers list, except where noted explicitly.

---

## Findings

### F1 (important) — A malformed `<|…` control token swallows all prose up to the next `|>`

**File:** `packages/brain/src/tags.ts:24-32` (`TagScanner.push`)

```ts
const end = this.buf.indexOf(CLOSE);
if (end < 0) {
  if (this.buf.length > MAX_TAG) { out.push({ kind: 'text', text: this.buf }); this.buf = ''; }
  break; // wait for more
}
const raw = this.buf.slice(0, end + CLOSE.length);
this.buf = this.buf.slice(end + CLOSE.length);
const tag = parseTag(raw);
out.push(tag ? { kind: 'tag', tag } : { kind: 'badtag', raw });
```

**Why it is wrong:** the 64-char cap is applied only while no `|>` has arrived yet. The moment a
later, well-formed tag's `|>` shows up, `raw` spans from the malformed `<|` through that `|>`
regardless of length, and everything between — the model's actual sentences — is either dropped
as `badtag` (StreamParser ignores badtags) or, worse, accepted as a *valid* tag because
`parseTag`'s `matchAll(/(\w+)=([\w-]+)/g)` + `Object.fromEntries` takes the LAST `emotion=` it
finds. In the second case `complianceMiss` even stays `false`, so the metrics never see it.

**Reproduced (probe T1 / P-D):**
```
TagScanner ['<|ACT emotion=happy>你好。', '<|ACT emotion=sad|>今天。']
  -> [{"kind":"tag","tag":{"kind":"act","emotion":"sad"}},{"kind":"text","text":"今天。"}]
TagScanner ['<|ACT emotion=happy|你好。今天怎么样。', '<|ACT emotion=sad|>嗯。']
  -> [{"kind":"tag","tag":{"kind":"act","emotion":"sad"}},{"kind":"text","text":"嗯。"}]
TurnRunner end-to-end, same chunks: sentences ["嗯。"], complianceMiss false
```
"你好。今天怎么样。" is never painted and never written to history.

**Failure scenario:** V4 drops a `|` or `>` from the first ACT tag (temperature 0.7; the tag
grammar is a prompt instruction, not a constrained decode), then writes 1–2 sentences and a
second tag. The user sees only the last sentence; history stores only that; nothing is logged.

**Suggested fix:** when `end >= 0`, apply the same cap: if `end + CLOSE.length > MAX_TAG` OR the
candidate `raw` contains a second `<|` after index 0, emit the text up to the *last* `<|` as
`text` and re-scan from there. Add the two probe cases above to `tags.test.ts`.

**Confidence:** confirmed-by-running.

---

### F2 (important) — A reply that is only a control tag (or tag + whitespace) ends the turn in silence: no canned line, no error, no sentence

**File:** `packages/brain/src/turn.ts:335-338` (`isEmpty`) with `packages/brain/src/sanitize.ts`

```ts
private isEmpty(turn: Turn): boolean {
  if (turn.rawStream === '') return true;
  return sanitizeForDisplay(turn.rawStream).trim() === '';
}
```

**Why it is wrong:** `rawStream` is every delta byte, tags included, and `sanitizeForDisplay`
never strips `<|…|>` (§3.5 items 1–8 do not mention it; probe T2:
`sanitizeForDisplay('<|ACT emotion=happy|>\n')` -> `"<|ACT emotion=happy|>"`). So a completion
whose only content is the ACT tag is *not* classified as empty. `drive()` therefore skips the
§3.9.4 re-request and canned line, goes to `settleNormal` with `emitted.length === 0`, emits
`turnDone` and `state:idle`, and BrainService's idle handler
(`apps/desktop/src/main/brain-service.ts:332`) just hides the bubble.

**Reproduced (probe P-A):**
```
script ['<|ACT emotion=happy|>\n']
  -> requests 1, sentences [], states thinking>idle, rows ["user:在吗"], lint none
```
One request (no §3.9.4 retry), no sentence, no canned line, no error.

**Failure scenario:** the model emits the tag and then the stop sequence fires immediately
(`'\n用户：'` is in `stop`; V4 writing `<|ACT emotion=happy|>\n用户：…` is exactly the
role-echo the stop list exists for), or `max_tokens`/finish arrives right after the tag. The pet
"thinks", then goes quiet. The user reads it as being ignored — the very outcome §3.11.2 says the
tail gate exists to prevent.

**Suggested fix:** make emptiness a parser fact, not a byte fact: track in `StreamParser` whether
any non-whitespace `text` item was seen (or compute `isEmpty` from "no sentence was ever offered
to `consider`"), and keep the sanitizer-based check as the fallback. Add a `turn.test.ts` case:
`['<|ACT emotion=happy|>']` -> 2 requests, then the canned line.

**Confidence:** confirmed-by-running.

---

### F3 (important) — Reply-scope tail rules strip an innocent final sentence: the offender is already painted, the penalty lands on the next sentence

**File:** `packages/brain/src/turn.ts:249-261` (`drive`, tail check) and
`packages/brain/src/slop-lint.ts:170-210` (`lintTail`)

```ts
if (turn.pending !== null && this.lintEnabled) {
  const tail = lintTail(turn.rawKept, turn.ctx);
  turn.lastLint = tail;
  if (tail.severity !== 'none') {
    if (turn.emitted.length === 0 && !turn.regenerated) { …regenerate… }
    turn.pending = null; // strip, never keep-and-mark (D6)
  }
}
```

**Why it is wrong:** `lintTail` mixes two kinds of rule. `closing-moral` and `question-streak`
really are properties of the last sentence. But `ellipsis`, `ellipsis-rate`, `affect-rate`,
`emoji-rate`, `opener-repeat` and `repetition` are properties of the whole reply (or of its
*first* characters), and by the time the stream ends the sentences that carry the violation
have already been released and painted. The runner reacts by deleting the one sentence that is
still unpainted — which is, in every one of those cases, not the offender. The reply is
truncated mid-thought, and the history row is the truncated text.

**Reproduced (probe P-B, recent = ['刚吃完饭😀']):**
```
script ['<|ACT emotion=happy|>主人回来啦😀。', '今天吃了吗。']
  -> sentences ["主人回来啦😀。"], history assistant:"主人回来啦😀。"
     lint [{"rule":"emoji-rate","detail":"emoji in consecutive replies"}]
```
The emoji (the violation) is painted; the clean question is deleted.

Probe T9 shows the same with the persona's own mandated catchphrase: with
`recent = ['好麻烦哦……','嗯。']`, the reply `好麻烦哦……这句不对。你改出来的是新对象。` fails
`ellipsis-rate` (…… in 2/6) — the …… is in sentence 0, which is painted; the runner strips
`你改出来的是新对象。`, i.e. the correction the whole reply exists to deliver.

**Failure scenario:** any two-sentence reply where an emoji, an affect word or her `好麻烦哦……`
opener (which `characters/haru/character.json` `personality` explicitly instructs) lands in
sentence 1 and the previous reply also had one. This is not rare for this card: it is the
persona's signature. It also interacts with amendment A-3 (opener-repeat stays `regenerate`): a
catchphrase opener within 5 turns forces a paid regeneration at seq 0, or, when sentences are
already painted, deletes the innocent last sentence.

**Suggested fix (smallest):** in `drive`, only strip `pending` when the tail violation set
contains a *last-sentence* rule (`closing-moral`, `question-streak`); for the reply-scope rules
record the verdict in `lastLint`/metrics (they are already reported) but do not delete text
that is not the offender. Alternatively evaluate the reply-scope rules at the first-sentence
gate, where regeneration is still free of painted text. Pin it with a test asserting the
stripped sentence is the one carrying the violation.

**Confidence:** confirmed-by-running. Contract-conformant as written (§3.11.2 says "that
sentence is stripped"), so this is a contract defect surfaced by the implementation, reported
under "believe the spec is wrong".

---

### F4 (minor) — The A23 leading-number strip runs per sentence, so every sentence that starts with "<number> " loses its number

**File:** `packages/brain/src/sanitize.ts:29` — `t = t.replace(/^\s*\d{1,3}\s+(?=\S)/, '');`

**Why it is wrong:** §3.5 item 6 describes "a leading injected number (the V4 number-injection
bug)" — a reply-level artefact at the start of the completion. But `sanitizeForDisplay` is
called once per *sentence* (`turn.ts:consider`), so the regex fires at the start of every
sentence.

**Reproduced (probe P-C):**
```
['<|ACT emotion=happy|>2 加 2 等于 4。', '3 个小时吧。'] -> ["加 2 等于 4。","个小时吧。"]
```

**Failure scenario:** the card says code/commands/paths may stay verbatim and the mes_example
has her correcting a Python fact; a reply like `3 个小时吧。` or `2 加 2 等于 4。` paints without
its number and is stored that way. Chinese prose usually has no space after a numeral, which
bounds the blast radius — hence minor.

**Suggested fix:** apply item 6 only to the first sentence of an attempt (strip it in
`TurnRunner` before the first `consider`, or pass a flag). Keep the whole-string behaviour in
`isEmpty`.

**Confidence:** confirmed-by-running.

---

### F5 (minor) — `rhetorical` strips the tag question `对吧？`, which the spec's A2 does not list

**File:** `packages/brain/src/slop-lint.ts:58-64` — `/对吧[？?]\s*$/`, `/不是吗[？?]\s*$/`,
`/你说是不是[？?]\s*$/`

**Why it is wrong:** exquisite-bar A2 (line 49) defines the rhetorical templates as
"难道…吗 / 你觉得呢". `对吧？` is a plain tag question in spoken Chinese, and for a tsundere
desktop pet it is ordinary speech ("主人今天又熬夜了对吧？"). The rule is `strip`, so the
sentence disappears silently.

**Reproduced (probe T5):**
`lintSentence('主人今天又熬夜了对吧？')` -> `{rule:'rhetorical'}`, severity `strip`.

**Suggested fix:** drop `/对吧[？?]\s*$/` (and probably `/不是吗/`) from `RHETORICAL`, or keep
them as reported-not-enforced. Contract §3.6 lists them, so this is a request to amend the
contract.

**Confidence:** confirmed-by-running (that it fires); the "false positive" judgement is mine.

---

### F6 (minor) — `complete()` has no body timeout; a stalled summariser hangs the turn pipeline

**File:** `packages/brain/src/deepseek.ts:384-401` (`complete`) and
`apps/desktop/src/main/summarizer.ts:25` (`new AbortController().signal`, never aborted)

```ts
const res = await this.request(this.completeBody(req), 'application/json', signal, linked);
if (!res.ok) throw await httpError(res);
…
parsed = await res.json();
```

**Why it is wrong:** `link()`'s connect timer is cleared in `request()`'s `finally` as soon as
headers arrive; `res.json()` then has no idle guard (the `withTimeout` wrapper exists only in
`streamOnce`). The summariser hands in a signal nobody aborts. `TurnRunner.run` awaits
`history.onTrimNeeded(plan)` before assembling, so a body that stalls after headers leaves the
turn in `thinking` forever. `cancel()` sets `settled` and goes idle, but the hung promise and
its socket leak, and the next turn that trips a trim repeats it.

**Failure scenario:** a proxy/TLS middlebox that returns 200 headers and then stalls (the
classic case the idle timeout exists for) on the first turn after the window crosses 24K
tokens. The user sees "thinking" until they cancel.

**Suggested fix:** wrap `res.json()` (and `testKey`'s `res.text()`) in the existing
`withTimeout(…, IDLE_TIMEOUT_MS, …)`; have the summariser pass a signal with a deadline.

**Confidence:** confirmed-by-reading.

---

### F7 (minor) — `SENSITIVE` matches `被打` as a prefix (`被打开`, `被打断`, `被打印`)

**File:** `packages/brain/src/slop-lint.ts:224` — `/被(打|骚扰|霸凌|欺负|家暴)|家暴/`

Reproduced (probe T7): `isSensitive('我的电脑被打开了')` -> `true`, `isSensitive('刚才被打断了')`
-> `true`. Consequence is bounded (only tightens the emoji rules for that turn and flags
`sensitive` in metrics), hence minor. Fix: `被打(?![开断印字扮包])` or require a boundary.

**Confidence:** confirmed-by-running.

---

## Deferred items I believe are wrong

- **Amendment A-3 (`opener-repeat` unchanged at `regenerate`)** in combination with the shipped
  card: `personality` instructs `嘴上先抱怨一句"好麻烦哦……"`. Probe T10: two replies within five
  that open with `好麻烦哦` -> `regenerate`. At seq 0 that is a paid second request with the
  nudge on every catchphrase reuse; after painting it becomes F3's innocent-sentence strip. The
  card and the linter instruct opposite things; one of them should give (whitelist the card's
  own catchphrases, or demote opener-repeat to reported-only for Phase 2).

## Checked and found clean

- **SSE parsing** (`deepseek.ts parseSseLine/streamOnce`): CRLF (`\r` stripped per line), `data:`
  without space, `[DONE]`, comments, empty deltas (dropped), `usage: null` mid-stream, a frame
  carrying both delta and usage (delta first), malformed JSON -> one `console.warn` and skip,
  multibyte split across reads (`TextDecoder` with `{stream:true}` and a final `decode()`), end
  of body without `[DONE]` -> synthetic `done`. `reasoning_content` frames with `content: null`
  yield nothing (probe T11) — correct with thinking disabled. `thinking: {type:'disabled'}` is in
  every body, incl. `testKey`.
- **Client timeouts/abort:** connect timer aborts only the inner controller and is cleared on
  headers; outer abort forwards and its listener is removed in `dispose()`; idle timeout via
  `withTimeout` on each `reader.read()`; `reader.cancel()` in `finally` on every exit (consumer
  `return()`, throw, done). Cancel is distinguished from timeout from network at the catch site.
- **Retry policy:** single gate `RETRYABLE && !sawDelta && attempt < 3`; jitter ±30 % from
  `opts.random`; backoff races the abort and removes its listener; `complete()`/`testKey()` never
  retry; `testKey` never throws. 401/402/429/5xx mapping matches §3.9.3. (Note, not a finding: a
  4xx such as 400/413 is `server` and retried four times, as the contract specifies — a 7 s
  delay before a deterministic error is the contract's choice.)
- **`prompt_cache_hit_tokens` plumbing:** `mapUsage` -> `Usage.cacheHit` -> `turn.usage` ->
  `turnDone.usage` and `MetricsRecord.cacheHit`; `resetAttempt` clears `usage` so a regenerated
  turn reports the delivered attempt.
- **Static prefix stability:** `renderStaticSystem` is pure (no Date/locale/random), sorts
  `motionKeys`, joins a fixed section list; `assemblePrompt` puts state, summary, facts,
  post_history_instructions and the nudge ONLY in the last user message; history rows are the
  raw `userText`/painted assistant text with no state head; `BrainService` renders the static
  block once at construction. `messages[0..n]` are object literals in fixed key order (no Map
  iteration). Test `keeps messages[0..n] byte-identical…` is a real check.
- **Persona card:** Chinese-only rule (HARD_RULES 3 + card `LANG_ZH_CN_ONLY` prose); budgets
  measured with `estimateTokens` over `renderPersonaSections` (700) and the full block (1100),
  shipped card passes both; A20 refinements on `first_mes` use grapheme counting; the plain-mode
  block is byte-stable and card-independent.
- **TurnRunner state machine:** `send()` supersede emits the old turn's `turnDone`
  synchronously before `state:thinking`; uncommitted text is transferred (one user row); the
  commit promise is memoised and carries a warn handler (A-4); `cancel()` commits the user row,
  appends only `shown` sentences with `interrupted:true`, goes idle immediately; `turnShown`
  before settle is remembered; zero-sentence settle goes idle immediately; `deps.state()` once
  per turn; both regeneration gates match the contract; the lint regeneration and the empty
  re-request are independent one-shot budgets, so `drive()` terminates after at most 3 attempts
  (≤ 12 HTTP attempts with client retries). `DeepSeekError` -> `error` + metrics, no `turnDone`;
  `CancelledError` swallowed. Sanitize runs exactly once per sentence (A10).
- **Sentence splitter:** decimals and English are not split (probe T14); the comma rule applies
  only before the first emitted sentence; boundaries split across chunks reassemble.
- **Sanitizer:** ZWJ emoji intact; half-width -> full-width only next to CJK (a run like `!!`
  converts only the first — cosmetic); `[…]` removal also eats `arr[0]` (probe T15) — contract
  item 4, cosmetic given the persona.
- **Test quality:** the fakes in `turn.test.ts` and `deepseek.test.ts` exercise real
  chunk/line boundaries and abort propagation; `until()` fails loudly on timeout; assertions
  are on emitted event lists and request counts, so they can fail. No test asserts a timeout
  path (the contract does not require one). No test covers F1/F2/F3's inputs — those are the
  gaps.
