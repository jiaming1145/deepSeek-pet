# Phase 2 final review — spec coverage and contract conformance

Reviewer lens: every Phase 2 requirement in the spec + addendum, every numbered rule in the contract, every ruling, mapped to code / tests / evidence. Read-only. `phase1-stage..main` (HEAD 16bf16a).

Verification run this session: `npx vitest run` → **55 files / 611 passed / 2 skipped** (the two gated C-14 live tests); `pnpm -r --if-present typecheck` → all six projects clean.

Legend: IMPL = implemented (file:line) · TEST = tested where · EVID = evidence · DEF = deferred (ledger row) · **MISSING** / **CONTRADICTS** = findings.

---

## 0. The two contracts docs diverge (tracked vs `.superpowers` copy)

`diff --strip-trailing-cr docs/superpowers/plans/2026-08-29-phase2-contracts.md .superpowers/sdd/2026-08-29-phase2-brain/contracts.md` yields exactly five hunks:

| # | Section | Tracked doc (authority 2) | `.superpowers/.../contracts.md` | Which one the code follows |
|---|---|---|---|---|
| 1 | Amendments A-1…A-8 | present (lines 39-49) | **absent** | code follows tracked: A-1 `slop-lint.ts:170`, A-2 `slop-lint.ts:70`, A-4 `turn.ts:369`, A-7 `tags.ts` (hold trailing `<`), A-8 `eval/package.json` `"test": "node --test lib/*.test.mjs"` |
| 2 | §1.5 vitest config | literal with `environmentMatchGlobs` (R6; deviation 7 in §8.5 and in `deferred.md`) | adds a **"Fix-round-1 amendment (binding)"** that DROPS `environmentMatchGlobs` and uses per-file docblocks | code follows **tracked**: `apps/desktop/vitest.config.ts:24` still has `environmentMatchGlobs: [['src/renderer/**','jsdom']]`; `tokens.test.ts:1` opts OUT with `// @vitest-environment node`. The untracked "binding" amendment was never applied; it contradicts R6's literal and deviation 7. Stale text, not a code defect. |
| 3 | §5.3 step 6 (`avoid`) | fix-round-**2** wording: the 55 % floor outranks the dodge | fix-round-1 wording only (`above >= waT`) | code follows **tracked**: `bubble-place.ts:150` `else if (above >= Math.max(waT, topFloor)) y = above;` |
| 4 | §6.1 note on the two windows | fix-round-2 wording | fix-round-1 wording | code follows tracked (same line as above) |
| 5 | **§6.6** `avatar:listening` bullet | no amendment: "Emits `avatar:listening {on}` … whenever `chat:composing` changes"; §2.3 lists focus/blur among the `chat:composing` producers | adds a **fix-round-1 amendment**: `{on:true}` is produced by `compositionstart` ONLY; `avatar:listening` now means "an IME session is open", not "the user is typing" | code follows the **untracked** copy: `Composer.tsx:222-223` `onFocus={() => onComposingChange(false)}` / `onBlur={() => onComposingChange(false)}`. See finding F-2. |

Net: the tracked doc is ahead on §5.3/§6.1/amendments; the untracked copy is ahead on §1.5 (wrongly — never applied) and §6.6 (applied, but the narrowing of addendum A22 is recorded nowhere that is tracked: not in `docs/.../contracts.md`, not in `deferred.md`, not in `rulings.md`).

---

## 1. Spec (2026-08-28 design) — Phase 2 items

| Spec § | Requirement | Status |
|---|---|---|
| §2 / §2.1 | brain in main; packages protocol/brain/memory pure TS, zero Electron imports | IMPL `packages/{protocol,brain,memory}` (tsconfig `types:["node"]`, `erasableSyntaxOnly`); TEST vitest node; EVID task-1/3/5 typecheck/vitest txt |
| §2.2 | event vocabulary; zod at IPC boundary; unknown events rejected + logged | IMPL `protocol/src/index.ts:78-215` `Schemas satisfies Record<Channel,…>`; `main/ipc.ts:80-121` `onFromAny` rejects + `console.warn`; `main/invoke.ts` parses request AND response. TEST `protocol/src/channels.test.ts`, `main/ipc.test.ts`. (`sim:stats`, `avatar:reaction` are Phase 3 — spec §10.) |
| §3.1 | v4-flash, stream, `stream_options`, thinking disabled, top_p .95, max_tokens 300, stop ×3; keep-alive; 429/5xx jittered retry 1/2/4 s; AbortController; per-turn metrics | IMPL `deepseek.ts:39-52,230-241,300-336`; temperature **0.7** per addendum §0 (C-11/C-13 recorded); metrics to SQLite `metrics` table (`history.ts:173`) instead of `metrics.jsonl` — contract §4.2 supersedes. TEST `deepseek.test.ts` (tests 1-9), C-14 live gated `describe.runIf(LIVE_KEY)` line 537. EVID task-4-vitest.txt; live NOT MEASURED (402) — `not-measured.md` |
| §3.2 | static system byte-identical; dynamic state only in latest user msg; trim 24K/8K → summary | IMPL `prompt.ts:71-89` (C-2: no pair #1), `planTrim` `prompt.ts:104-120`, `turn.ts:225-233` calls it; TEST `prompt.test.ts` (byte-identical prefix, 本地时间 once, no raw numbers, nudge last, facts capped). C-5: `好感 62/100` example superseded → phrases `persona.ts:179-212` |
| §3.3 | Character Card V3 in `characters/<id>/character.json` `card`, ≤ 800 (addendum: ≤ 700) tokens, Chinese | IMPL `characters/haru/character.json:14-28` (C-8); TEST `persona.test.ts` cardTokens ≤ 700 / static ≤ 1100 against the real file; EVID `task-3-card-tokens.txt` |
| §3.4 | control-token grammar; unknown emotion → neutral; unknown motion dropped; missing ACT → neutral + compliance miss | IMPL `tags.ts` `parseTag` (bad emotion → `badtag`, i.e. not applied), `stream-parser.ts:18-23` `complianceMiss`; unknown motion passes through the event and is dropped at the renderer `pet/main.ts:175` (`motionMap[ev.motion]` undefined → no play). TEST `tags.test.ts`, `stream-parser.test.ts` |
| §3.5 | tag scanner handles `<\|` split across chunks; sentence split on `。！？!?…\n`; first sentence may split on `，,` after ≥ 6 chars; emit the moment a sentence closes | IMPL `tags.ts` (A-7 hold `<`), `sentences.ts` (`minFirstChars=6`), `stream-parser.ts`. **Amended by R4/§3.11.2**: the runner holds sentence k until k+1 closes (one-sentence lookahead) — recorded in `deferred.md` "session-20-turns" paragraph as a structural cost |
| §3.6 | state machine; interruption ledger; `thinking` on send; `sentenceDone`/`turnDone`; new text while speaking → truthful history; while thinking → abort + concatenate | IMPL `turn.ts:141-203, 420-434` (R2 sentence-granular + `interrupted:true`); TEST `turn.test.ts` (§3.11.6 tests 1-13). Proactive suppression → Phase 3 |
| §6 | SQLite at `%APPDATA%/ds/ds.sqlite`; tiers window + summary (Phase 2), core/episodes Phase 3; schema_version + migrations | IMPL `main/index.ts:30,117`, `memory/src/db.ts`, `history.ts`, `summary.ts`; TEST `db.test.ts`, `history.test.ts`, `summary.test.ts`. FTS5 deliberately Phase 3 (contract §4.2) |
| §7 | input window 360×48 grows multiline; ESC closes; Enter sends; Shift+Enter newline; first run key entry + pet with `first_mes`; tray | IMPL `chat-window.ts:29-47` (C-9), `Composer.tsx:137-160`, `index.ts:307-309` first-run key window, `brain-service.ts:437-476` first message, `tray.ts:51-56`. Settings window → Phase 4 (C-10) |
| §8 | 429/5xx/network → retries, then awkward + canned offline line, turn not in history, input restored | **PARTIAL by contract**: retries ✓, nothing appended ✓ (`turn.ts:437-450`), composer restore ✓ (`Composer.tsx:114-121`); the "awkward + canned offline line" is replaced by the hint surface (`ERROR_HINTS`; contract §3.9.4: `cannedLines.offline` "is never emitted by TurnRunner … belongs to BrainService") — and `brain-service.ts` never emits it either (grep `offline` → only the deps comment). Contract-sanctioned (§3.9.4 pinned), so not a finding; noted. |
| §8 | 401/no key → hint + key window | IMPL `brain-service.ts:366-375` (`auth`,`balance`,`no-key` open the key window) |
| §8 | empty completion → one retry then canned line | IMPL `turn.ts:274-282, 404-417`; TEST turn.test 8 |
| §8 | SQLite open failure → blocking dialog + quit | IMPL `index.ts:117-123`, `fatal.ts`; TEST `fatal.test.ts` |
| §8 | cache-hit < 50 % warning | DEF `deferred.md` row "spec §8" → Phase 4 |
| §9 | vitest for parser/assembler/state machine/memory; Playwright pet renderer; gated integration; desktop screenshots | IMPL/EVID as above; `docs/evidence/phase2/*.png`, `e2e-report.json` |
| §11 | NOTICE / credit line | IMPL `NOTICE` §4 (MiSans not bundled, fallback recorded — R7) |

## 2. Addendum (exquisite bar) — Phase 2 mapping A1–A10, A12–A23, C1–C8, C10, C12–C15, X1, X5, X6, X9, X12

| Id | Status |
|---|---|
| A1 | shape gate `eval/lib/aggregate.mjs:40` (`shortReplyPct ≥ .90`); prompt rule 3 `persona.ts:85`. Live: NOT MEASURED |
| A2 | `rhetorical`/`question-streak` rules `slop-lint.ts:44-50,160-163`; shape gates `aggregate.mjs:41-42`; judge axis `rhetorical_tail` |
| A3 | `NARRATES_USER` `slop-lint.ts:28-34`; card schema refine `persona.ts:48`; judge `narrates_user` |
| A4 | `ASSISTANT_LEAK`, `MARKDOWN_*` (A-2) `slop-lint.ts:12-25,70-71`; regenerate-once-then-strip `turn.ts:345-353,284-296`; judge `assistant_speak` |
| A5 | `CLOSING_MORAL` on last sentence `slop-lint.ts:157-159`; tail lint via lookahead `turn.ts:284-296`; judge `closing_moral` |
| A6 | `ellipsis`, `ellipsis-rate` (A-1 floor) `slop-lint.ts:164-171`; `WEBNOVEL` `:53-56`; shape gates `:43-44` |
| A7 | `repetition` (4-gram > 20 % vs last 10), `opener-repeat` (last 5), `affect-rate` `slop-lint.ts:172-191`; `RULE_SEVERITY.repetition='regenerate'` (R10.1) |
| A8 | DEF ledger row 1 → Phase 3 |
| A9 | judge `in_character`; adversarial 8 prompts; NOT MEASURED |
| A10 | no dedicated eval axis; R8's axis list does not claim A10 (only in-character/A3/A4/A5/A13/A15/A16/A17/A18/A19); the ledger's R8 row lists "A3/A4/A5/A9/A10…directional" and treats it as covered by `in_character`. Noted, not a finding. |
| A12 | preamble carries 本地时间/weekday/距离上次聊天 (`prompt.ts:74`, `brain-service.ts:378-391`, `humanize.ts`); **distinct first-open-of-day / late-night / long-gap greetings: not implemented, not tested, not in `deferred.md`** (grep `A12` across evidence/reports → none). Finding F-4 (minor). |
| A13 | judge `initiative`; 8 bland prompts; threshold ≥ 70 % (R8) |
| A14 | DEF row 2 → Phase 3 |
| A15 | `isSensitive` `slop-lint.ts:213-224`; judge `refusal_language`; `emoji-sensitive` regenerate |
| A16 | HARD_RULES rule 2 `persona.ts:84` (anti-deitism); card 诚实 block (P2); judge `sycophancy_pushback` + `false_disagreement` (P2 control set) |
| A17 | judge `humour_stops`; 6 humour prompts |
| A18 | `emoji`, `emoji-rate`, `emoji-sensitive` `slop-lint.ts:142-146,192-194`; HARD_RULES rule 8; judge `emoji_discipline` |
| A19 | judge `nativeness` (score2) |
| A20 | `CharacterCardSchema.first_mes` refinements `persona.ts:39-45`; TEST persona.test 62-69 |
| A21 | ≤ 700 tokens ✓ (673); override sentence rule 1 `persona.ts:83`; card import → Phase 4 (X10 P4 mapping) |
| A22 | mouth from reveal cadence `reveal.ts:45` + `speech.ts:267-271` relay `brain-service.ts:169`; thinking pose on `state:thinking` emitted synchronously in `send()` `turn.ts:179`; interrupt aborts + `onState idle` drops queue `speech.ts:78-99`. **Listening pose narrowed** — see F-2. |
| A23 | `sanitize.ts` (number injection step 6, emoji preserved, half-width → full-width near CJK step 7, stage directions step 4); TEST `sanitize.test.ts` |
| C1 | alpha 0.92 `tokens.css:80,169`; grayscale AA accepted (C-4) EVID `bubble-glyphs-300.png` |
| C2 | `backgroundColor '#00000000'`+`show:false`+`ready-to-show` on bubble/chat/key (`bubble-window.ts:25-31`, `chat-window.ts:34-40`, `key-window.ts:35-37`); 60 fps recording DEF row "60 fps launch" |
| C3 | corner peeps @1/1.25/1.5/2 `tests/bubble.spec.ts:210-225`; EVID `bubble-corner-*.png` |
| C4 | 0.92 + Mica on key window (`key-window.ts:36`); solid fallback DEF row 3 |
| C5 | tokens literal `tokens.css:88-121` (radii/shadows/durations/ramp/font stack + the one permitted `"Segoe UI Variable Text"` insertion); reduced-motion ≤ 80 ms `tokens.css:204-212`; TEST `tokens.test.ts` |
| C6 | 24 hanzi / 6 lines `speech.ts:11-13`; re-placed on drag `index.ts:248-255`; geometry replaced by band (deviation 8, recorded in ledger and §8.5) |
| C7 | enter/exit over C5 durations; linger 3 s `speech.ts:8`, `bubble-window.ts:10`; stacking/draggable DEF row 4 |
| C8 | hotkey `index.ts:291`, dblclick `pet/main.ts:185-188`, bubble click `bubble/main.ts:118-121`; light dismiss `chat-window.ts:54-56`; IME-safe `Composer.tsx:140`; auto-grow 1→6 `Composer.tsx:64-82`; TEST `Composer.test.tsx` (13) |
| C10 | hint surface `bubble/hint.ts`, `brain-service.ts:369-373`; subtitle controls DEF row 5 |
| C12 | light+dark, ≥ 4.5:1 `tokens.test.ts`; nine `[data-emotion]` rules `tokens.css:190-198` |
| C13 | detector 0 findings (task-8 report); side-by-side DEF row 6 |
| C14 | `placeBubble` mixed-DPI test E + `getDisplayMatching` `bubble-window.ts:111`; TEST `bubble-place.test.ts` |
| C15 | EVID `sheet-*.png`, `app-*-{light,dark}.png`, `hint-error.png`; settings/tray tooltip → Phase 4 |
| X1 | thinking disabled every call; usage logged per turn (`metrics` table); cache-hit NOT MEASURED (ledger) |
| X5 | `History.tsx` (day grouping, copy/delete, `主动`/`[中断]` chips, system style); TEST `History.test.tsx` (8) |
| X6 | hint per code `ERROR_HINTS`; retry/back-off `deepseek.ts`; balance meter DEF row 7; per-day proactive cap → Phase 3 with proactive |
| X9 | key entry + `key:test` live validation `key/App.tsx:49-79`; balance check / persona pick / time-to-pet DEF row 8 |
| X12 | harness `eval/`; nightly DEF row 9 |

## 3. Contract rules

### R-rulings
| Rule | Status |
|---|---|
| R1 | IMPL tsconfigs `packages/{protocol,brain,memory}/tsconfig.json` (`erasableSyntaxOnly`, `allowImportingTsExtensions`); `eval/package.json` workspace deps; EVID task-1/5 node-strip txt |
| R2 | IMPL channels `protocol/index.ts:107-108`; `turn.ts:425-432`; `[中断]` `History.tsx:158` |
| R3 | IMPL `bubble-window.ts:19-51` (all listed options; `screen-saver`; `setIgnoreMouseEvents(true,{forward:true})` default, off on `bubble:hover`); hint layer same window; follows `VisibilityState` `index.ts:58-101`; pet window untouched (`pet-window.ts` not in diff) |
| R4 | IMPL `turn.ts:337-359, 284-296` (sentence-local lint, regenerate only when nothing painted, tail strip); amended latency bar: NOT MEASURED (ledger) |
| R5 | IMPL `electron.vite.config.ts:40` exclude list; placeholders replaced by T7/T8 |
| R6 | IMPL `vitest.config.ts` (`environmentMatchGlobs` present per R6 literal); IME jsdom test `Composer.test.tsx:37` constructor-set `isComposing`; CDP smoke DEF ledger row |
| R7 | IMPL `tokens.css`, `DESIGN.md`, `NOTICE` (fallback recorded); EVID `tokens-sheet-*.png` (via `tokens-sheet.spec.ts`) |
| R8 | IMPL `eval/judge.md` (one axis per criterion incl. `false_disagreement` for P2, `trait_hit` wired n=0), fixture 46 = 8/8/6/6/6/6 + 6 valid (verified by counting), thresholds `aggregate.mjs`; 3-iteration cap → 0 ran (`tuning-log.md`) |
| R9 | IMPL `protocol/index.ts:300-339` eight allow-lists; producers pinned (`brain-service.ts:152-155` listening; `:249-259` key:status) |
| R10.1 | `slop-lint.ts:77-93` |
| R10.2/3 | `brain/src/ports.ts`; `MessageKindSchema` |
| R10.4 | `reveal.ts` (70/35/+150/+300, delay before, mouth false on punct); TEST `reveal.test.ts` toBe(1990) |
| R10.5 | `deepseek.ts:313-315` single gate |
| R10.6 | nudge only in `assemble()` `turn.ts:246-259`; history gets `turn.userText` `turn.ts:472-481` |
| R10.7 | `totalMs` everywhere |
| R10.8 | `prompt.ts:20-31`; TEST prompt.test toBe(3)/toBe(3) |
| R10.9 | card only in `character.json` (T3); T10 changed no card bytes (`tuning-log.md`) |

### C.2 contradictions
C-1 → R4 ✓ · C-2 `prompt.ts:63-89` ✓ · C-3 → R7 ✓ · C-4 0.92 ✓ · C-5 phrases ✓ (`prompt.test` rule 3) · C-6 plain CSS ✓ · C-7 spec §6 cited in `history.ts:53` ✓ · C-8 ✓ · C-9 ✓ · C-10 `ERROR_HINTS` copy ✓, forbidden-strings grep → 0 matches ✓ · C-12 `index.ts:258` tap = log/reaction only, `pet/main.ts:185` dblclick, `bubble/main.ts:118` click ✓ · C-14 `deepseek.test.ts:537` gated ✓ (skipped for want of balance).

### D traps
D1 `sanitize.ts` has no Segmenter; `reveal.ts:31` has it ✓ · D3 `stage/character.test.ts:29` `toBe(P)`, `brain/types.test.ts` ✓ · D4 one table ✓ · D5 `key-store.ts:27,46` ✓ TEST `key-store.test.ts` · D6 `turn.ts:294,353` ✓ · D7 `grep -c setFps pet/main.ts` = 1 ✓ · D8 `tests/mouth-sync.spec.ts` polled, EVID `mouth-sync.txt` ✓ · D10/11 toBe ✓ · D12 ✓ · D13 ✓ · D14 `channels.test.ts` + `invoke.ts` sender check ✓.

### Persona rulings
P0/P1/P2 card literals match contract §3.7.1 byte-for-byte (compared) ✓ · P3 `renderStaticSystem(card, mk, 'plain')` `persona.ts:119-121` ✓, switch DEF ledger row · P4 recorded ✓ · P5 `eval/lib/ablation.mjs` exists, gated, NOT MEASURED ✓.

### Amendments A-1…A-8 — all applied (see §0 table row 1).

### §3–§6 rules — spot checks that were clean
§3.9.1 bodies (`testKey` no top_p/stop, `complete` no `stream_options`, `Accept` headers) ✓ · §3.9.3 taxonomy + single retry gate ✓ · §3.9.4 empty path (awkward, seq 0, kind system, `regenerated` untouched) ✓ · §3.11.1 commit-at-release + concatenation on supersede ✓ · §3.11.2 two gates written separately (`turn.ts:345-350` vs `:288`) ✓, `rawKept` ✓, `lastLint` last-computed ✓, `resetAttempt` ✓ · §3.11.4 retire path ✓ (superseded `turnDone` emitted synchronously inside `send()` via `retire` before new `setState('thinking')`) ✓ · §3.11.5 ✓ · §4.1 openDb sequence + close-on-fail ✓ · §4.2 DDL literal ✓ · §4.3 semantics incl. `last_trim_id` OFFSET query, one `console.warn` ✓, 32 000 safety net ✓ · §4.4 `capSummary` terminator set + degenerate case ✓ · §5.1 ✓ · §5.2 behaviour list (thinking dots, FIFO, sentenceDone at last grapheme, accumulate + overflow drop, complete(), click, onError, idle drops queue, finishTurn idempotent, pinned defers only hide) ✓ · §5.3 steps 1-8 incl. fix round 2 ✓ · §5.4 rules 1-7 incl. two extra hide triggers (`brain-service.ts:332,175-178`) and hover gating (`:196-206`) ✓ · §5.5 hint below band, `HINT_TTL_MS` 6000 both sides ✓ · §5.6/5.7 ✓ · §5.8 tokens ✓ · §6.1 sizes, both windows' options, `holdWindowOpen` in `key-window.ts`, `openChat` via `placeBubble` without `avoid` ✓ · §6.2 rules 1-8 ✓ · §6.3 ✓ · §6.4 ✓ (disclosure verbatim, Esc only when stored, focus trap) · §6.5 ✓ · §6.6 first-run broadcast set exactly (no `brain:state`, `first-mes` playback dropped before runner) ✓, tray items ✓, hotkey ✓ · §6.7 ✓ · §7.1 A-8 ✓ · §7.5 ✓.

---

## 4. Findings

### F-1 (important) — `key:status.lastTest` is not nulled on a key change (contract §2.3 pinned rule / §8.6 row 17)
`apps/desktop/src/main/brain-service.ts:84` `this.offKey = keyStore.onChange(() => this.rebuildClient());` → `rebuildClient()` (279-315) ends with `this.refreshKeyStatus();` (314) which sends `lastTest: this.lastTest` (255). `lastTest` is only ever written at 119 and 124 (the `key:test` handler). Contract §2.3: "every `key:status` it sends from a `KeyStore.onChange` (`set` or `clear`) carries `lastTest: null`, and resets the held value to `null` first". Scenario: 测试连接 succeeds → `lastTest={ok:true}`; user presses 清除 → `key:status {present:false, source:'none', lastTest:{ok:true,…}}` goes to key + chat windows — a "usable" verdict for a key that no longer exists. Today's renderers only read `present`/`source` (`key/App.tsx:34-37`, `chat/App.tsx:41`), so no pixel is wrong yet; the wire payload is, and the row-17 rationale ("a stored `lastTest` never outlives the key it tested") is false. Fix: in `rebuildClient()` (or in the `onChange` closure) set `this.lastTest = null` before `refreshKeyStatus()`. Confidence: confirmed-by-reading.

### F-2 (important) — addendum A22 "listening pose while the user types" narrowed to "IME session open"; recorded only in the untracked contracts copy
`apps/desktop/src/renderer/chat/Composer.tsx:222-223` `onFocus={() => onComposingChange(false)}` / `onBlur={() => onComposingChange(false)}`; `{on:true}` only from `handleCompositionStart` (162-165). Main derives `avatar:listening` solely from this channel (`brain-service.ts:152-155`). Result: typing Latin/digits or pasting never raises the pose (`pet/main.ts:179-182`). The tracked contract §2.3 lists "focus/blur of the textarea" among producers and §6.6 says the pose follows `chat:composing`; the addendum says "listening pose while the user types". The narrowing is written in `.superpowers/.../contracts.md` §6.6 (untracked) and in the code comment, but NOT in `docs/superpowers/plans/…contracts.md`, `deferred.md` or `rulings.md`. The reason given (focus-armed guard breaks light dismiss) is real, but the correct fix per that same note ("main must derive it from composer focus plus keystroke activity") was not done and not deferred anywhere tracked. Fix: either add a ledger/contract row deferring the richer producer, or add a second channel/flag so main can raise listening on focus+keystroke without arming the light-dismiss guard. Confidence: confirmed-by-reading.

### F-3 (minor) — `ttftMs` is measured from `send()` time, not request dispatch
`packages/brain/src/turn.ts:314` `if (turn.ttftMs === null) turn.ttftMs = this.now() - turn.startedAt;` with `startedAt` set in `send()` (157). Contract §3.11.2: "`ttftMs` = `now()` at the first delta minus `now()` at request dispatch" and after `resetAttempt` "`turnDone` and the `MetricsRecord` describe the attempt that was actually delivered". Scenario: turn trips a trim (summariser `complete()` call, seconds) or a lint regeneration — the delivered attempt's `ttftMs` includes the trim and/or the whole discarded first attempt; `session.mjs`/metrics then overstate DeepSeek TTFT. Fix: stamp `dispatchedAt = this.now()` at the top of `runAttempt` and measure against it. Confidence: confirmed-by-reading.

### F-4 (minor) — A12's distinct greetings (first-open-of-day / late-night / long-gap) are neither implemented nor deferred
Phase 2 mapping (addendum §5) includes A12. The preamble carries time/weekday/gap (`prompt.ts:74`, `humanize.ts`) so "never misstates local time" is addressed, but nothing produces or evaluates distinct greetings (only the fixed `first_mes` on first run, `brain-service.ts:437-476`); `grep A12` over `docs/evidence/phase2`, task reports and `eval/` → no mention; not in `deferred.md`. Fix: add a ledger row (likely Phase 3 with proactive/D4 night state) or an eval probe. Confidence: confirmed-by-reading.

### Recorded, not findings
- `.superpowers/.../contracts.md` §1.5 "binding" amendment to drop `environmentMatchGlobs` was never applied and contradicts R6 + tracked deviation 7; the tracked doc and code agree. The untracked copy should be brought back in line (docs-only).
- `cannedLines.offline` is dead data (declared, never emitted) — contract §3.9.4 says so explicitly; spec §8's "awkward + canned offline line" is superseded by the hint surface.
- `persona.ts:25` keeps `MARKDOWN_INLINE = /[*#`]/` for `first_mes` while `slop-lint.ts:70` carries the A-2 syntax-aware regex; A-2 amends §3.6 only, so both are per contract.

## 5. Checked clean (absence of findings is evidence)
Channel table + allow-lists + invoke maps (§2.3-2.5) byte-match; `ERROR_HINTS` (§2.8) byte-match; TurnRunner state table, commit rule, two regeneration gates, lookahead, empty path, cancel/supersede ledger, metrics record; DeepSeek bodies/headers/taxonomy/retry gate/SSE parsing; persona card literals, section order, plain mode, budgets; prompt layout and trim; memory DDL, openDb, HistoryStore semantics, summary cap; RevealPlan; SpeechController behaviour list; placeBubble steps incl. fix round 2; bubble window options/lifecycle/hide triggers/hover gating; chat/key window options, composer rules 1-8, history pane rules, key flow, key store + dev guard, fake-client guard; first-run broadcast set; tray/hotkey; tokens (C5 literals, alpha, nine emotion rules, reduced-motion); all rulings R1-R10, C-1..C-14, D1-D14, P0-P5; amendments A-1..A-8; every `deferred.md` row has a ruling source. Tests: 611 pass; typecheck clean.
