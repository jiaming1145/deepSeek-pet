# Phase 2 interface contract (`contracts.md`)

Single source of truth for every interface Phase 2 tasks share. **Authors copy from this file. Nothing here is a suggestion; nothing missing from here may be invented — if a name or a value is genuinely absent, stop and ask the controller.**

Precedence this file implements: `rulings.md` (binding) → `docs/superpowers/specs/2026-08-29-exquisite-bar.md` (addendum) → `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` (spec). The v1 plan `docs/superpowers/plans/2026-08-29-phase2-brain.md` is a draft; where its literal code survives it is reproduced here **with the rulings applied**, and this file wins.

Environment verified in this session (do not re-derive):

| Fact | Value | How verified |
|---|---|---|
| Node | v24.17.0 | `node -v` |
| TypeScript | 5.9.3 (≥ 5.8 → `erasableSyntaxOnly` available; **no fallback needed**) | `npx tsc --version` |
| vitest | 3.2.7 | lockfile |
| zod | 4.5.2 (range `^4.0.0`) | lockfile |
| electron | 43.4.1 · electron-vite 5.0.0 · vite 7.3.6 · @playwright/test 1.62.1 | lockfile |
| `@types/node` | 24.13.3 at workspace root (resolves for new packages with `"types": ["node"]`) | lockfile + preflight |
| `node:sqlite` | builtin, `DatabaseSync` present, `isBuiltin` true → rollup externalizes it automatically | preflight |
| Node type-stripping of `.ts` under `node_modules` | **refused** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — but a pnpm workspace *symlink* resolves to the real path first, so it works | ran it |
| Node type-stripping + **extensionless** relative import | **fails** (`ERR_MODULE_NOT_FOUND`) | ran it |
| Node type-stripping + `'./types.js'` specifier | **fails** | ran it |
| Node type-stripping + `'./types.ts'` specifier | **works** | ran it |
| `tsc` with `erasableSyntaxOnly` + `allowImportingTsExtensions` + `verbatimModuleSyntax` | clean | ran it |
| `environmentMatchGlobs` in vitest 3.2.7 | present in the type surface (deprecated, still honoured) | read `vitest` d.ts |
| **Repo-wide test baseline on `main`** (HEAD **`ba2b3ef`**; `dbab82e` and `2135c00` are ancestors) | **23 files / 206 tests pass** — `@ds/protocol` 16, `@ds/stage` **53**, `desktop` **133**, `scripts` 4 | ran `npx vitest run` this session |
| `@ds/protocol` source shape | a single `src/index.ts` with **no relative imports** | `ls packages/protocol/src` + grep |
| `packages/protocol/src/index.test.ts` on `main` | **already exists**: two describes (`protocol` 4 cases, `numeric bounds` 12 cases) = **16 tests** | ran `npx vitest run` |
| `apps/desktop` `jsdom` | **already a devDependency at `^30.0.1`** | read `apps/desktop/package.json` |
| `apps/desktop/tsconfig.renderer.json` `include` on `main` (**line 18**) | `["src/renderer", "tests", "../../vendor/core/live2dcubismcore.d.ts", "../../packages/stage/src"]` | read the file |
| `apps/desktop/tsconfig.renderer.json` `types` on `main` (line 4) | **`["vite/client"]`** — *not* `[]`; added in `39cbf05`. Node types are still absent, so `node:fs` does not resolve in that program | read the file |

> **C1 (extension rule, load-bearing).** Because of the three "ran it" rows above, **every relative import inside `@ds/protocol`, `@ds/brain` and `@ds/memory` must carry an explicit `.ts` extension** (`import { X } from './types.ts'`). Their tsconfigs therefore set `"allowImportingTsExtensions": true`. Without this rule R1's `eval/` package cannot load `@ds/brain` and Task 9 fails at the last step. `@ds/stage` and `apps/desktop` keep the extensionless convention (they are always bundled).

> **C1a (who else needs the flag).** TS5097 ("an import path can only end with `.ts` when `allowImportingTsExtensions` is enabled") is reported **in the importing program**, not in the package that wrote the specifier. `@ds/protocol` is one file with no relative imports, so importing it never trips the rule; `@ds/brain` and `@ds/memory` are multi-file and always do. The only `apps/desktop` program that reaches them is the **main** program, so `apps/desktop/tsconfig.json` — and only that one — also sets `"allowImportingTsExtensions": true` (§1.4). `tsconfig.renderer.json` and `tsconfig.ui.json` do not need it and must not add it.

> **Preflight baseline correction.** `preflight.md` line 10 records "`npx vitest run` → 10 files / 40 tests". That number is stale. So is the **`2135c00` / 23 files / 198 tests** figure an earlier draft of this file carried in three places (§0's table, §1.5's third note, §8.7's first row): `main` has since advanced five commits to **`ba2b3ef`** and the measured baseline is now **23 files / 206 tests** — `@ds/protocol` 16, `@ds/stage` 53, `desktop` 133, `scripts` 4. Every task brief must express its test expectation as a **delta** against **206** ("+N tests in file X"), never as an absolute repo-wide total. A brief anchored to 198 is anchored to a baseline that no longer exists and must be re-based before it runs.

---

## Amendments (controller rulings after execution began — these override the sections below)

- **A-1 (after T4, 2026-08-29)** §3.6 `ellipsis-rate`: denominator is `Math.max(recent.length, 5) + 1` (was `recent.length + 1`). Reason: with an empty history one …… scored 1/1 and forced a paid regeneration on the first turn.
- **A-2 (after T4)** §3.6 `markdown`: `MARKDOWN_INLINE` matches markdown *syntax* (`**bold**`, `*em*`, heading `#` after whitespace/line start, code spans) — not the bare characters `* # \``. Reason: "C#", "#1", "5*3" stripped benign sentences.
- **A-3 (after T4)** §3.6 `opener-repeat`: unchanged (4 code points, regenerate). The regeneration cost only applies when nothing is painted, which is the A7-intended behaviour; T9's judge treats a repeated opener as a real violation.
- **A-4 (after T4)** §3.9 `TurnRunner.release`: the user-row commit promise carries a warn-and-swallow handler so a superseded turn cannot surface an unhandled rejection.
- **A-5 (after T5)** Evidence artefacts under `docs/evidence/` are byte-exact (`.gitattributes` `-text`) and must be produced with the cwd banner `D:\\ds\\…`, never a worktree path — regenerate or normalise before committing.
- **A-6 (after T4)** `brain:turnDone.lint` / `MetricsRecord.lint` is the LAST sentence's verdict, not the turn's union; T9/T10 count violations with `lintReply` over the full reply.
- **A-7 (after T9)** §3.2 `TagScanner.push`: when no `<|` is present the scanner now **holds a trailing `<`** in the buffer instead of flushing it as text (`const hold = this.buf.endsWith('<') ? 1 : 0; …; this.buf = hold ? '<' : ''`). Reason: an SSE delta boundary landing exactly on the `<` of `<|ACT …|>` split the tag into `<` + `|ACT …|>`, so the whole control token was painted into the user's speech bubble and `StreamParser.complianceMiss` went true. `flush()` still emits a genuine trailing `<` at end of stream. Regression cases live in `packages/brain/src/tags.test.ts`.
- **A-8 (after T9)** §1.3 / §1.5 / §7.1 `eval/package.json` `"test"` is **`node --test lib/*.test.mjs`**, not `node --test lib/`. Reason: on Node v24.17.0 the positional is expanded as a glob, `lib/` matches only the directory entry, and the runner dies with `Cannot find module …\eval\lib`. Same semantics (node:test, `lib/` only), glob written out. T10's byte-identical edit of that script block must quote the glob form in both its old and new block.
- **A-9 (T8 fix round 1, recorded here after the final review — I-14)** §2.3 / §6.6 `avatar:listening` **means "an IME session is open", not "the user is typing"**. §2.3's recovery rule makes focus **and** blur of the composer the *unlatch*: both send `chat:composing {on:false}`, blur unconditionally, whether or not a `compositionend` arrived. T8's desktop pass proved the alternative broken — sending `{on:true}` on focus arms main's light-dismiss guard for as long as the composer holds focus, and main's window `blur` fires before the renderer's `{on:false}` can cross IPC, so a click on the desktop never dismissed the chat. With the correct polarity, `{on:true}` is produced by `compositionstart` alone, and main maps it 1:1 to `avatar:listening`. Consequence, pinned for Phase 2: a user typing Latin text, digits, or pasting never raises the listening pose (addendum A22 narrowed). If the richer meaning is wanted, main must derive it from **composer focus plus keystroke activity** — a T6/main producer that does **not** arm the light-dismiss guard — and it must never be recovered by putting `{on:true}` back on the composer's `focus`. That producer is a Phase 3 behaviour-engine item (`docs/evidence/phase2/deferred.md`, row "A22"). Ruling recorded in `rulings.md` ("Final-review rulings", FR-1). This note previously lived only in the untracked `.superpowers/…/contracts.md` §6.6; the tracked file is the authority.
- **A-10 (T8 fix round 1, recorded here after the final review)** §1.5 `apps/desktop/vitest.config.ts`: **drop `environmentMatchGlobs` entirely, keep `environment: 'node'` as the default, and let each renderer test that needs a DOM opt in with a `// @vitest-environment jsdom` docblock on line 1.** Reasons, both reproduced in T8's review round 1: (1) `environmentMatchGlobs: [['src/renderer/**', 'jsdom']]` put T0's already-merged `src/renderer/shared/tokens.test.ts` under jsdom, where `fileURLToPath(new URL('./tokens.css', import.meta.url))` throws `TypeError: The URL must be of scheme file` (`1 failed | 42 passed` with the literal; `43 passed` without); (2) `environmentMatchGlobs` is deprecated in the pinned vitest 3.2.7 and prints `DEPRECATED "environmentMatchGlobs" is deprecated. Use \`test.projects\`…` on every run. The literal becomes `test: { name: 'desktop', include: ['src/**/*.test.{ts,tsx}'], environment: 'node', setupFiles: ['./src/renderer/test-setup.ts'] }` with the `react()` plugin unchanged. The docblock goes on `src/renderer/chat/Composer.test.tsx`, `src/renderer/chat/History.test.tsx`, `src/renderer/key/App.test.tsx` and `src/renderer/pet/debug-panel.test.ts` — **not** on `tokens.test.ts`, `pet/hover.test.ts`, `pet/press.test.ts` or `shared/chat-metrics.test.ts`, which are node tests. `apps/desktop/src/renderer/shared/tsx-lane.test.ts` fails loudly if `include` ever stops covering `.tsx` or a suite loses its docblock. Merge order: T8's bootstrap commit `a145f03` (this file + `test-setup.ts`) is a hard prerequisite of `f3cb834`. Previously recorded only in the untracked copy's §1.5.
- **A-11 (final review, I-12)** §7.1 "The judge pass then scores the sanitized reply" is **replaced**: the judge pass scores **`raw`** — the reply after `StreamParser` has stripped the `<|ACT …|>` tags and **before** `sanitizeForDisplay` (`eval/lib/judge.mjs` `judgeInput(turn)`). Reason: `judge.md`'s `assistant_speak` (markdown 列点 / 标题 / 加粗) and `narrates_user` (`[你笑了笑]`) clauses could never fire on sanitized text, while every honesty footer claimed raw output was measured. The linter keeps reading `raw` (A-6); the shape metrics keep reading the sanitized `reply` (what the user sees). §7.3 gains a shape gate **`markdownLintCount ≤ 0`** = `lintRuleCounts.markdown` over the raw output. §7.3's honesty clause and `eval/README.md` must say exactly this: 判官看 raw、lint 看 raw、形状指标看 sanitize 之后的文本.
- **A-12 (final review, I-13)** §7.3 A9 has two halves (addendum A9: "≥ 90 % in-character; **0 therapist-flips**"); the table carried only the `mean ≥ 1.8 ∧ pct2 ≥ 0.90` pair and silently dropped the zero-count half. A judge score of **0** on `in_character` is by the rubric's definition the flip (变成助手 / 心理咨询师 / 旁白). New gated axis row **`in_character_flips`**: `countMax 0` over every judged turn (`n` = turns with an `in_character` score; reports `count`), pattern of `emoji_discipline_sensitive`. Arithmetic that forced it: 125 × 2 + 13 × 0 over 138 turns gives mean 1.812 / pct2 0.906 → PASS with thirteen flips. R8's threshold list reads "in-character ≥ 90 % **and 0 flips**".
- **A-13 (final review, M-20)** §7.3 A18's per-reply half ("≤ 1 emoji per reply") had no gate — `emoji_discipline` is presence-only. New shape gate **`emojiMultiCount ≤ 0`** = number of turns with `shape.emojiCount > 1`. A18 is now three rows: `emoji_discipline ≤ 25 %`, `emoji_discipline_sensitive = 0`, `emojiMultiCount = 0`.
- **A-14 (final review, M-21)** §7.3 honesty clause: **A10 leaves the "directional at n = 138" list.** The harness has no A10 probe, axis or test — the sample is zero, not small — so A10 (self-fact consistency, 30 probes × 3 sessions) is **not measured** and moves to Phase 3 with A8. The clause now reads: "A8 and A10 are out of Phase 2 (Phase 3). A3/A4/A5/A9/A15/A16 are directional at n = 138 …". R8's wording is amended the same way.
- **A-15 (final review, M-19)** §7.2 fixture schema gains an optional **`condition: string`** (non-empty) per prompt. `buildJudgeUser` renders it as a `【判定条件】\n<condition>` block between 【对话】 and 【这一条要评的项目】 when present. `judge.md`'s `trait_hit` rubric answers `false` without that block, so `validateFixture` **rejects** a prompt whose `axes` include `trait_hit` and that has no `condition`. Phase 2 still ships zero `trait` prompts; the field exists so the first Phase 3 probe cannot fail by construction.
- **A-16 (final review, M-27)** Repository convention, not an interface: the key-leak pre-commit hook is **versioned** at `.githooks/pre-commit` (POSIX sh; rejects any staged addition matching `sk-[A-Za-z0-9]{20,}`, prints the offending path(s), exits 1) and installed by the root `package.json` `"prepare": "git config core.hooksPath .githooks"`, so `pnpm install` on any clone arms it. PNGs are out of scope: key-window captures use an empty field. The `sk-<35 hex>` placeholder in `tokens-sheet.html` is changed by the RENDERER lane so the hook no longer contradicts a tracked file. Gate counts after A-11…A-13: **27 rows** — 17 axes (14 in `AXIS_SPECS` + `emoji_discipline_sensitive` + `in_character_flips` + `judge_error_rate`) and 10 shape metrics.
- **A-17 (fix wave, BRAIN lane, 2026-08-30)** §3.2 `TagScanner` — the listing is the shipped `packages/brain/src/tags.ts` (commit `93357c0`). Contract: chunk-safe (a `<|…|>` split across `push` calls is reassembled). `parseTag` accepts exactly `ACT` followed by whitespace-separated attributes drawn from `emotion` (required, one of `EMOTIONS`) and `motion` (optional, `[\w-]+`); a duplicate, unknown or dangling attribute, `<|ACT|>`, and any other word (e.g. `ACTIVATE`) make the candidate a `badtag`. `<|PAUSE n|>` is clamped to `PAUSE_MAX_S` seconds. A candidate that starts with `<|` is **never emitted as visible text**: when it contains a second `<|` before any `|>`, when it is longer than `MAX_TAG` (64) whether closed or not, or when it is still unclosed at `flush()`, the scanner emits its tag-ish head (`<|`, then characters other than `<`, `>`, `|`, then at most one `|` or `>`) as `badtag`, the remainder as `text`, and resumes scanning at the next `<|`. `flush()` still emits a lone trailing `<` or a non-`<|` remainder as text. Required tests: the `tags.test.ts` cases tagged I-1 / G-10 / G-11 / I-5.
- **A-18 (fix wave, BRAIN, 2026-08-30)** §2.2 / §3.4 `PAUSE_MAX_S` — `export const PAUSE_MAX_S = 3;` lives in `@ds/protocol` beside `SentenceEventSchema`, whose `pause` is `z.number().nonnegative().max(PAUSE_MAX_S).optional()`. `parseTag` clamps `<|PAUSE n|>` to `Math.min(n, PAUSE_MAX_S)`; the bubble may rely on `pause ≤ PAUSE_MAX_S`.
- **A-19 (fix wave, BRAIN, 2026-08-30)** §3.3 `sentences.ts` — the listing is the shipped file (commit `b1e3f57`). **Chunk invariance (G-12):** the sentence list is independent of how the text was chunked. A hard boundary is the whole run of adjacent terminal punctuation, ellipsis dots, closing quotes/brackets and newlines (`？！`, `！！`, `。」`, `……` are one boundary). A run that reaches the end of the buffer is held until the next `push`, a `settle()` (called by `StreamParser` on every control tag — a tag is a definite boundary) or `flush()`. The first-sentence comma rule cuts at the first `，`/`,` **at or after** `minFirstChars` that precedes the first hard boundary. Required tests include the property tests in `sentences.test.ts` (all 2-way splits, all 3-way splits of short fixtures, seeded random chunkings, character-by-character).
- **A-20 (fix wave, BRAIN, 2026-08-30)** §3.4 `StreamParser` — `complianceMiss` is set only when non-whitespace text precedes the first ACT; text delivered by `TagScanner.flush()` is handled by the same path as `push()` text. `StreamParser.hasText` (read-only) is true once any non-whitespace text was seen; `TurnRunner` uses it as the §3.9.4 emptiness fact: an empty completion is one where `hasText` is false or whose text is whitespace-only after `sanitizeForDisplay`; a tag-only completion is therefore empty.
- **A-21 (fix wave, BRAIN, 2026-08-30)** §3.5 `sanitizeForDisplay(input, options?)` — item 6 (the A23 leading-number strip) applies only to the **first sentence of an attempt**: `sanitizeForDisplay(text, { leadingNumber: false })` skips it, and `TurnRunner.consider` passes `false` for every sentence after the first one it considers in an attempt. The whole-string call in the emptiness check keeps the default.
- **A-22 (fix wave, BRAIN, 2026-08-30)** §3.6 — §3.6.2 `RHETORICAL` is exactly `[/难道[\s\S]{0,20}吗[？?]/, /你觉得呢[？?]\s*$/]`; `对吧？`, `不是吗？`, `你说是不是？` are ordinary speech and are not linted (spec A2 names only 难道…吗 / 你觉得呢) (M-2). §3.6.4 the third `SENSITIVE` pattern is `/被(打(?![开断印字扮包回扰脸])|骚扰|霸凌|欺负|家暴)|家暴/` (M-4).
- **A-23 (fix wave, BRAIN, 2026-08-30)** §3.9.3 error shape (G-2 / G-3) — replaces "The error body is read and used as `message` …": `DeepSeekError` is `{ code, status, message, detail? }`. **`message` never contains the upstream body**; it is derived from the status/code by `statusMessage(status, code)`: `HTTP 401: the API key was rejected`, `HTTP 402: insufficient balance`, `HTTP 429: rate limited`, otherwise `HTTP <status>: upstream error`. The body is read with `readBodyBounded` (at most `MAX_ERROR_BODY_BYTES = 2048` bytes, idle timeout `IDLE_TIMEOUT_MS`, body cancelled afterwards) and stored in `detail` after redaction: every `sk-[A-Za-z0-9]{20,}` and every occurrence of the exact active key become `sk-…`, then the string is cut to `MAX_DETAIL_CHARS = 512`; an empty or unreadable body leaves `detail` undefined. `testKey()` resolves `{ ok: true } | { ok: false, code, message, detail? }` (`KeyTestResult`) with the same guarantees. `complete()` and `testKey()` read their bodies through the same reader with `MAX_JSON_BODY_BYTES = 1 MiB` and the idle timeout; a stalled body is `timeout`, an oversized one is `server`. New table row: `| body EOF before [DONE] | network | null | only via the existing gate (no delta yet) |`. A final complete line at EOF is parsed; the client never synthesises `done`.
- **A-24 (fix wave, BRAIN, 2026-08-30)** §3.11 `cancel(): Promise<void>` — resolves after the retire writes (user row, interrupted assistant row, metrics record) have settled, never rejects, resolves immediately when idle. `state → idle` and the superseded `turnDone` are still emitted synchronously before it returns. `BrainService.dispose()` awaits it before closing SQLite.
- **A-25 (fix wave, BRAIN, 2026-08-30)** §3.11.2 tail lint (I-3), `ttftMs` (M-6), motion allow-list (M-25) — replaces "If it fails, that sentence is **stripped before emission**": if it fails **with a last-sentence rule** — `closing-moral`, `question-streak`, or `ellipsis` when the held-back sentence itself contains `……` — that sentence is stripped before emission (the one-sentence lookahead exists for this). A tail failure carried only by reply-scope rules (`ellipsis-rate`, `affect-rate`, `emoji-rate`, `opener-repeat`, `repetition`, or `ellipsis` without an `……` in the held sentence) describes text that is already painted: the held sentence is emitted unchanged and the verdict is reported in `turnDone.lint` / `MetricsRecord.lint`. The seq-0 regeneration gate is unchanged. Timing: `ttftMs` = `now()` at the first delta minus `now()` at the **dispatch of the attempt that delivered it** (`dispatchedAt`, stamped at the top of every attempt; `null` if no delta arrived); `totalMs` = `now()` at `turnDone` minus `now()` at `send()`. Step 6a: a `motion` not listed in `persona.motionKeys` is removed from the event (emotion kept), with one warning per turn.
- **A-26 (fix wave, BRAIN, 2026-08-30)** §3.11.4 / §3.11.5 writes and failures (I-8, G-4, G-5, G-6) — all history appends of a runner pass through one ordered write chain; a failed append is logged (`[turn] history write failed (<label>)`) and the chain continues — no append or metrics failure can suppress `turnDone`/`error` or the transition to `idle`. A new turn awaits that chain before reading its history window, so a superseding turn cannot overtake the previous turn's user/assistant rows. On a `DeepSeekError` the runner first persists the sentences whose `sentenceShown` arrived as one `interrupted: true` assistant row (the same helper as cancel), then emits `error`; §3.11.5's "append nothing for the assistant" becomes "append nothing the user did not see".
- **A-27 (fix wave, BRAIN round 2 / integrator, 2026-08-30)** §3.11 CX-1 settle semantics — a stream that ends while the bubble is still revealing is `streamFinished`, not settled: `turnDone` + metrics go out at stream end, exactly once; the full assistant row is written by `turnShown()`; a `send()`/`cancel()` before that retires the turn and persists only the `sentenceShown` prefix as `interrupted: true`, never a second `turnDone`. **Integration consequence for §5.4 / §6.6 (supersedes the "or acknowledged via `turnShown` if already settled" clause the MAIN lane proposed for A-32):** `BrainService.bubbleCrashed()` retires an unacknowledged stream-finished turn the same way — history keeps the shown prefix — and keeps the `cancel()` promise in `retiring`, which `dispose()` awaits (a second `cancel()` on a settled turn resolves at once and would not cover the retire's metrics write). Test: `apps/desktop/src/main/brain-service.crash.test.ts`.
- **A-28 (fix wave, MAIN lane, 2026-08-30)** §2.3 `key:status.lastTest` — `BrainService.rebuildClient()` sets `lastTest = null` as its first statement; this is the implementation of the pinned rule (M-7). §2.8 / §6.6 error path — `brain:error.message` is passed through `redactSecrets` before IPC; the main log line is `[brain] error code=<code> detail=<boundedDetail>` (200 chars, redacted) (G-3). §6.5 `KeyStore` — `get()` and `source()` derive from one decryption attempt; an undecryptable `key.bin` reports `dev-env`/`none`, is left on disk and logged once (G-14). App-protocol — `ELECTRON_RENDERER_URL` and `DS_DEBUG` are read only through `devRendererUrl()` / `devDebugEnabled()`, both `!app.isPackaged`-gated (M-9); `allowedPetOrigins` = `app://local` plus, unpackaged only, an `http(s)://` loopback (`localhost`, `127.0.0.1`, `[::1]`) `ELECTRON_RENDERER_URL` without credentials; any other value is ignored with one warning; `file:` is never an origin key (G2-1).
- **A-29 (fix wave, MAIN, 2026-08-30)** §5.4 / new §5.9 shutdown order (I-9, G2-2) — `before-quit` is handled by `main/quit.ts createBeforeQuit`: (1) `preventDefault()`, synchronous teardown (screen listeners, `markQuitting()`, save pet position, `globalShortcut.unregisterAll()`, cursor + foreground stop, tray destroy); (2) `await brain.dispose()` — a barrier that resolves after `TurnRunner.cancel()`'s writes settle and also awaits `HistoryStore.trimSettled()`, bounded by `DRAIN_TIMEOUT_MS = 3000`; (3) destroy bubble/chat/key windows; (4) `history.close()` then `db.close()`; (5) `app.quit()`, whose second `before-quit` is let through; `teardownAfterDrain`/`closeDb` failures are logged and never prevent `app.quit()`. Any `before-quit` during (2) is prevented.
- **A-30 (fix wave, MAIN, 2026-08-30)** §6.6 `BrainService` — signature changes: `dispose(): Promise<void>` (was `void`); new `bubbleHidden(): void` (called by index.ts from `applyBubbleVisibility`'s hide branch, and — G2-5 — on **every** hide even when the window was already hidden: click-through forced, pin dropped; M-8); `reposition(force = false)` (M-10). First-run broadcast set unchanged, but step 4 ("append the line with kind:'system' and set first_run_done") now happens on the bubble's `playback:turnDone { turnId:'first-mes' }`, ordered append → marker, and the marker is skipped if the append fails (G-9). On the hidden→visible edge main resends `shell:visibility {hidden:false}` to the bubble; the bubble renderer treats `{hidden:false}` as a hover resync (recompute whether the last known pointer position is inside the band/hint DOM and re-emit `bubble:hover {inside}`).
- **A-31 (fix wave, MAIN, 2026-08-30)** §6.x `requestChat` / key window rule (I-7, CX-3) — every chat open (pet double-click, bubble click, key-window save, tray, Ctrl+Shift+Space) goes through `index.ts requestChat(source, focusComposer)`, which applies `chat-request.ts decideChatRequest`: not hidden → open; hidden with `locked`/`suspended`/`fullscreen` live → refuse with one log line; hidden by `user` only → `visibility.set('user', false); visibility.apply()` then open (the `second-instance` behaviour). Every show of the key window (auth-error path, tray item, first run) goes through `key-request.ts createKeyRequest`: visible or user-only-hidden → open (without revealing her); `locked`/`suspended`/`fullscreen` live → queue the latest reason and show it when the verdict clears.
- **A-32 (fix wave, MAIN, 2026-08-30)** §5.4 / §6.1 / §6.6 renderer crashes (CX-6, CX-7, G2-6) — all four renderer loads are observed; a non-aborted failure runs the pet's startup failure policy. Bubble `render-process-gone`: main calls `BrainService.bubbleCrashed()` (turn retired as interrupted — see A-27 for the stream-finished case; bubble state reset; window hidden), reloads the page once, and on a second death or a failed reload recreates the window (`replaceBubble`); the reloaded page is re-placed (`bubble:place`) and receives the shell verdict. Chat `render-process-gone`: hide, clear composing and any pending `chat:opened`, reload once, else `fatal()`. Key `render-process-gone`: hide; the window is recreated on its next open (`replaceKey`).
- **A-33 (fix wave, MAIN, 2026-08-30)** §4.1–§4.4 memory (I-10, M-5, G2-3, G2-7, CX-4, CX-5, G2-2) — trims are serialised per store (one in flight). The trim point is the exact id of the last dropped row, resolved by matching `plan.drop` (position, role, content) against the current window with ids — the same safety truncation as `window()` — BEFORE the summarize await; `last_trim_id` is snapshotted and re-checked inside the transaction; a plan that no longer matches writes nothing and calls no summariser. `HistoryStore.close()` fences every post-await continuation; `trimSettled()` exposes the in-flight trim. `schema_version` and `last_trim_id` are canonical non-negative safe integers (`/^(0|[1-9]\d*)$/`, `Number.isSafeInteger`); anything else fails `openDb` with `MemoryOpenError`. `capSummary` (and `facts()`) sanitise: whitespace runs → one space, `【】` → `[]`.
- **A-34 (fix wave, RENDERER lane, 2026-08-30)** §2.3 `chat:opened` consumer column — "C (focus, caret at the end of any retained draft; select-all belongs to the restored-text path of §6.2 rule 6 only)": `chat:close` only hides the window, so a draft survives Escape and a select-all on re-open would destroy it on the first keystroke (M-17). §2.4 `user:text` — `text: z.string().min(1).max(USER_TEXT_MAX)` where `USER_TEXT_MAX = 2000` (code points) is exported by `@ds/protocol` and is also the composer's `maxLength`; the renderer restores the text on a rejected invoke as well as on `{ok:false}` (I-4).
- **A-35 (fix wave, RENDERER, 2026-08-30)** §5.2 hover/linger — after "`pointerleave` re-arms a **full** `LINGER_MS`": re-arming supersedes the previously armed hide; `scheduleHide()` invalidates the earlier arm (per-arm token in `SpeechController`), so a hover-then-leave before the original deadline always yields a full `LINGER_MS` from the leave (I-11). §5.4 rule 5 / renderer side — on `shell:visibility {hidden:false}` the bubble renderer re-shows the band element and re-reports `bubble:size` if `SpeechController.active` (a turn still revealing or lingering); main's window re-show alone is not sufficient; the reveal pauses while the pet is hidden and resumes on show (I-6 / CX-2). The `.bubble__plate::after` 4 px `pointer-events: auto` strip bridges the plate/surface gap so the pointer never leaves `#bubble` between them (M-16).
- **A-36 (fix wave, RENDERER, 2026-08-30)** §5.8 anchor notch — the notch is flush with the surface edge (offset = the root's padding on that side − 3 px) and protrudes outward (M-11). §5.5 / DESIGN.md adv-advance — the ▼ has its own 12 px row under the last line; it never shares a line box with text (M-12). DESIGN.md adv-plate — the bubble plate's label is wrapped in `.bubble__plate-text` with the counter-skew, like `.plate__text` (M-13).
- **A-37 (fix wave, RESIDUAL, 2026-08-30) §3.9.4 canned lifecycle (GC-2).** The §3.9.4 canned line is a reply like any other: emitted through the ordinary sentence path while the turn is unsettled, `turnDone` + `MetricsRecord{errorCode:'empty'}` at once, the `kind:'system'` assistant row written by `turnShown()` (A-27 applies verbatim). A `send()`/`cancel()`/`bubbleCrashed()` before that retires the turn and persists only the acknowledged canned sentence as `{kind:'system', interrupted:true}`; the retire's metrics row still carries `errorCode:'empty'`. There is no path on which the canned sentence is emitted after a newer turn replaced `current`.
- **A-38 (fix wave, RESIDUAL, 2026-08-30) §3.9 / §3.11.4 write states + storage surface (GC-3).** `TurnRunner` keeps two promises per history append: the operation promise (rejects) and the caught barrier (ordering only). The user row's state is `userCommit: 'none' | 'pending' | 'durable' | 'failed'`. A superseding `send()` carries the previous text forward when its row is `none` or `failed`; when it is `pending` the new turn awaits that write after the barrier and carries the text only if it failed. Every failed append is logged `[turn] history write failed (<label>)` and emitted once as `persistFailed { turnId, label, message }`; A-26's outcome guarantees (turnDone / error / idle unaffected) stand. Main handles `persistFailed` with one bounded, redacted warn line and `hint:show` `{ text: STORAGE_HINT_TEXT, level:'warn', ttlMs: HINT_TTL_MS }` (hide ownership: the hint when idle, the playback mid-turn). **Follow-up for a protocol-owning lane:** add `'storage'` to `ErrorCodeSchema` and `ERROR_HINTS` (`{ text: STORAGE_HINT_TEXT, level:'warn', opensKeyWindow:false }`) so this can travel as `brain:error{code:'storage'}` to the chat window too; until then it is a hint only.
- **A-39 (fix wave, RESIDUAL, 2026-08-30) §3.9.3 malformed-frame rule (GC-4).** Replaces "a malformed frame is skipped with one warning": a non-empty `data:` payload that is not a JSON object is `DeepSeekError('server')` (`MalformedFrameError`), and a JSON frame carrying a non-null `error` member inside a 200 stream is `DeepSeekError('server')`; both are logged with the frame length only and never carry the payload in `message` or `detail`; retry only via the existing no-delta gate. An empty `data:` payload is ignored. At EOF an unterminated remainder that fails to parse is A-23's `network` truncation, not a malformed frame. New table rows: `| malformed non-empty data frame | server | null | only via the existing gate |`, `| provider error object in a 200 frame | server | null | only via the existing gate |`. `testKey()`: a 200 is `ok` only when the bounded body is not truncated and parses as `{ choices: [ { message: object } ] }`; otherwise `{ok:false, code:'server'}` (GC-7).
- **A-40 (fix wave, RESIDUAL, 2026-08-30) §2.3 key:test generation rule (GC-5 / GC-6).** A `key:test` result updates `key:status.lastTest` only if (a) no `KeyStore` change happened since the test started (generation counter, bumped by `rebuildClient()` and by `dispose()`) and (b) the sha-256 fingerprint of the key it tested equals the fingerprint of the key stored now. A literal (unsaved) key test therefore never describes the stored key unless it is the same key. Every result is still returned to its invoke caller. In-flight tests are aborted on a key change and on `dispose()`, which awaits their settlement inside the A-29 drain; no continuation runs after `dispose()`. `BrainServiceDeps.probeClient?(apiKey)` is the injectable literal-key probe (default `DeepSeekClient`).
- **A-41 (fix wave, RESIDUAL, 2026-08-30) §4.3 / §4.4 trim-prefix rule (GC-1).** A trim retires every row `last_trim_id < id <= cutoff`, cutoff being A-33's exact id. The summariser receives ALL of them — the rows the `HISTORY_WINDOW_SAFETY_TOKENS` truncation kept out of `window()` included — in id order, once each, in sequential chunks of at most `TRIM_CHUNK_TOKENS = 24_000` estimated tokens (a single larger row is its own chunk), each chunk seeing the capped summary produced by the previous one. `last_trim_id` and the summary are committed together only after the last chunk; the commit re-validates the pointer snapshot and the id-bearing prefix snapshot; a failing chunk writes nothing.


## 0.1 Task numbering, ownership and execution shape (v2 — canonical)

The v2 renumbering was never propagated through the briefs. **This table is the only correct map.** Every "Task N" reference anywhere in this file, in `rulings.md`, or in a task brief means the number in the left column. Where a brief says an old number, read it through this table.

| Task | Scope | Old number in v1 prose |
|---|---|---|
| **T0** | Design decision → `tokens.css` (light+dark), `DESIGN.md`, `NOTICE` (MiSans), token sheet | "Task 7 (design)" |
| **T1** | `@ds/protocol` §2.1 + **all of §2.2**; `@ds/brain` package skeleton, `types.ts`, **`ports.ts`**, barrel | T1 |
| **T2** | `@ds/brain` `tags` · `sentences` · `stream-parser` · `sanitize` · `slop-lint` | T2 |
| **T3** | `@ds/brain` `persona.ts` + `prompt.ts` (card, static system, state phrases, assembler, `planTrim`) | T3 |
| **T4** | `@ds/brain` `deepseek.ts` + `turn.ts` | T4 |
| **T5** | `@ds/memory` (`db` · `history` · `summary`) | T5 |
| **T6** | Main-process wiring: §2.3–§2.5 + §2.8, IPC helpers, key store, bubble/chat/key windows, placeholders | T6 |
| **T7** | Bubble window renderer (RevealPlan, bubble, speech, hint, fps) + pet-renderer additions | "Task 8" |
| **T8** | Chat popover + key window (React) | "Task 9" |
| **T9** | Eval harness (`eval/` workspace package) | "Task 10" |
| **T10** | Persona tuning + e2e + evidence sheet + README | — (new) |

**Stale cross-references corrected by this table** (all of them are fixed in place below, and are listed here so a reviewer can check): §1.6 "Tasks 8 and 9 replace them" → **T7 and T8**; §5.7 "Pet renderer additions (Task 8)" → **(T7)**; §8.2 C-4 "recorded in Task 8" → **recorded in T7**; task-0's "bubble.html direction-contract comment → Task 8" → **T7**; task-0's "C13 detector → Task 9" → **T8**; task-2's "RevealPlan is Task 8" → **T7**; task-3's "Task 8's screenshot sheet" → **T8's**, "Task 10's eval harness" → **T9's**; task-5's "Task 9 for chat-history shots" → **T8**; task-6's "React lands in Task 9" → **T8**, "placeholders deleted by Tasks 8 and 9" → **T7 and T8**.

### Corrected dependency graph (supersedes `rulings.md` "Execution shape (v2)")

`rulings.md`'s lane graph ("Lane A: T1→T2→T4; Lane B: T3; Lane C: T5; all parallel") is contradicted by the briefs' own prerequisites: T4 needs T3's `prompt.ts`, T5 needs T3's `prompt.ts` **and** T1's `ports.ts`, and T2 needs §2.2's `Lint*` schemas, which T1 — not T6 — now owns. The executable graph is:

```
T0 (design, controller-led)  ────────────────────────────────┐   (touches no file T1–T5 touch)
                                                             │
T1 (protocol §2.1+§2.2, brain skeleton + ports.ts)           │
   ├── Lane A ── T2 (tags/sentences/parser/sanitize/lint)    │
   └── Lane B ── T3 (persona + prompt)                       │
                    ├── Lane A' ── T4 (deepseek + turn)  [also needs T2]
                    └── Lane C  ── T5 (memory)           [also needs T1's ports.ts]
                                                             │
T6 (main wiring)  ← needs T4 + T5                            │
   ├── T7 (bubble renderer)  ← also needs T0's tokens.css ───┘
   └── T8 (chat/key React)   ← also needs T0's tokens.css
T9 (eval harness)   ← needs T3 + T4 (may start once T4 merges; merges after T6)
T10 (tuning + e2e)  ← needs everything
```

Merge order into `main`: `T0, T1, T2, T3, T5, T4, T6, T7, T8, T9, T10`. T7 and T8 are the only genuinely concurrent pair after T6.

---

## 1. Package layout

### 1.1 Tree (new and modified paths only) — with the owning task

**Every path below has exactly one owning task.** A task that is not the owner may *read* a file but must not create, delete or edit it; if it needs a change there, it stops and reports `BLOCKED: <path> is owned by T<n>`.

```
                                          OWNER
pnpm-workspace.yaml                       MODIFY: add `- eval`                                   T9
packages/protocol/
  package.json                            MODIFY (no dep change; see 1.3)                        T1
  tsconfig.json                           MODIFY: erasableSyntaxOnly + allowImportingTsExtensions T1
  src/index.ts                            MODIFY: §2.1 emotions + ALL of §2.2                    T1
                                          MODIFY: §2.3-§2.5 channel/invoke maps, allow-lists, §2.8 T6
  src/index.test.ts                       MODIFY (append-only; the Phase 1 'protocol' and
                                                  'numeric bounds' describes stay byte-for-byte) T1
                                          MODIFY (two-line edit: MAIN_TO_RENDERER -> MAIN_TO_PET) T6
  src/channels.test.ts                    CREATE  (§2.3-§2.5 + §2.8; keeps test counts local)    T6
packages/stage/
  src/character.test.ts                   MODIFY  (D3 identity test)                             T1
packages/brain/
  package.json  tsconfig.json             CREATE                                                 T1
  src/index.ts                            CREATE  (barrel; T1 writes the FIRST FOUR lines incl.
                                                   './ports.ts'; each later task appends its own) T1
  src/types.ts           + types.test.ts  CREATE  (also declares TrimPlan - see the note below)   T1
  src/ports.ts                            CREATE  (HistoryPort, RunningSummaryPort, Summarize,
                                                   MetricsPort, MetricsRecord) - §3.10           T1
  src/tags.ts            + tags.test.ts                                                          T2
  src/sentences.ts       + sentences.test.ts                                                     T2
  src/stream-parser.ts   + stream-parser.test.ts                                                 T2
  src/sanitize.ts        + sanitize.test.ts                                                      T2
  src/slop-lint.ts       + slop-lint.test.ts                                                     T2
  src/persona.ts         + persona.test.ts                                                       T3
  src/prompt.ts          + prompt.test.ts                                                        T3
  src/deepseek.ts        + deepseek.test.ts                                                      T4
  src/turn.ts            + turn.test.ts                                                          T4
packages/memory/
  package.json  tsconfig.json             CREATE                                                 T5
  src/index.ts  src/db.ts + db.test.ts    CREATE                                                 T5
  src/history.ts + history.test.ts        CREATE                                                 T5
  src/summary.ts + summary.test.ts        CREATE                                                 T5
eval/
  package.json  README.md  judge.md       CREATE                                                 T9
  run.mjs                                 CREATE                                                 T9
  lib/{args,fixture,shape,aggregate,recorded,judge,turn,ablation,report}.mjs   CREATE            T9
  lib/*.test.mjs                          CREATE  (node:test, not vitest - §1.5/§1.7)            T9
  fixtures/prompts.zh.json                CREATE  (46 prompts - §7.2)                            T9
  recorded/{replies.zh.json,judgements.json}  CREATE  (the `--dry` corpus)                       T9
  out/.gitignore                          CREATE  (`*` + `!.gitignore`; needs `git add -f`)      T9
  session.mjs                             CREATE  (20-turn continuous-session probe)             T10
apps/desktop/
  package.json                            MODIFY: @ds/brain + @ds/memory deps                    T6
                                          MODIFY: jsdom stays ^30.0.1 (do NOT downgrade),
                                                  @testing-library/jest-dom, `typecheck` gains
                                                  `&& tsc -p tsconfig.ui.json` is T0's - see §1.4 T7
                                          MODIFY: react, react-dom, @types/react, @types/react-dom,
                                                  @vitejs/plugin-react, @testing-library/react,
                                                  @testing-library/user-event                    T8
  electron.vite.config.ts                 MODIFY: §1.6 changes 1 and 2, and change 3's four
                                                  html inputs                                    T6
                                          MODIFY: §1.6 change 3's `react()` plugin               T8
  vite.browser.config.ts                  MODIFY: react plugin                                   T8
  vitest.config.ts                        MODIFY: §1.5 literal (jsdom lane, setupFiles)          T7
  tsconfig.json                           MODIFY: allowImportingTsExtensions (§1.4, C1a)         T6
                                          MODIFY: `include` gains "playwright.electron.config.ts" T10
  tsconfig.renderer.json                  MODIFY: narrowed `include` (§1.4 - KEEPS "tests")      T0
  tsconfig.ui.json                        CREATE  (§1.4 literal)                                 T0
  playwright.electron.config.ts           CREATE  (browser `playwright.config.ts` untouched)     T10
  tests-e2e/                              CREATE                                                 T10
  DESIGN.md                               CREATE                                                 T0
  .impeccable/design.json                 CREATE                                                 T0
  src/main/app-protocol.ts                MODIFY  (APP_ORIGIN already exists; add rendererUrl)    T6
  src/main/ipc.ts                         MODIFY  (ADDITIVE - §2.7; Phase 1 auth is kept)        T6
  src/main/invoke.ts                      CREATE  (authenticated ipcMain.handle helper)          T6
  src/main/brain-service.ts               CREATE                                                 T6
  src/main/fatal.ts      + fatal.test.ts  CREATE  (FATAL_TITLE, fatal(message) - §4.1)           T6
  src/main/humanize.ts   + humanize.test.ts  CREATE  (humanizeGap - §6.6)                        T6
  src/main/key-store.ts  + key-store.test.ts CREATE                                              T6
  src/main/fake-client.ts + fake-client.test.ts CREATE (DS_FAKE_BRAIN switch - §6.7)             T6
  src/main/summarizer.ts                  CREATE                                                 T6
  src/main/bubble-window.ts               CREATE                                                 T6
  src/main/bubble-place.ts + .test.ts     CREATE  (pure `placeBubble`)                           T6
  src/main/chat-window.ts                 CREATE                                                 T6
  src/main/key-window.ts                  CREATE  (incl. holdWindowOpen/markQuitting - §6.1)     T6
  src/main/index.ts                       MODIFY  (wiring; the Phase 1 list below MUST survive)  T6
  src/main/ipc.test.ts                    MODIFY  (+1 case: handleInvoke rejects an untrusted
                                                   sender - §2.7)                                T6
  src/main/tray.ts + tray.test.ts         MODIFY  (openChat/openKey - breaking signature)        T6
  src/preload/pet.ts                      MODIFY  (per-window allow-lists)                       T6
  src/preload/bubble.ts  chat.ts  key.ts  CREATE                                                 T6
  src/renderer/shared/tokens.css          CREATE                                                 T0
  src/renderer/shared/tokens.test.ts      CREATE  (node env - §5.8)                              T0
  src/renderer/shared/fonts/*.woff2       CREATE  (only if the MiSans licence verifies - R7)     T0
  src/renderer/tokens-sheet.html          CREATE                                                 T0
  src/renderer/test-setup.ts              CREATE                                                 T7
  src/renderer/shared/chat-metrics.ts + .test.ts  CREATE  (single home of the §6.1 numbers)      T8
  src/renderer/bubble.html                CREATE placeholder (<=20 lines)                        T6
                                          REPLACE with the real page                             T7
  src/renderer/bubble/placeholder.ts      CREATE T6  ->  DELETE T7
  src/renderer/bubble/{main.ts,bridge.ts,bubble.ts,speech.ts,hint.ts,reveal.ts,fps.ts,bubble.css}
    + bubble.test.ts speech.test.ts hint.test.ts reveal.test.ts fps.test.ts   CREATE             T7
  src/renderer/chat.html                  CREATE placeholder (<=40 lines) T6  ->  REPLACE T8
  src/renderer/chat/placeholder.ts        CREATE T6  ->  DELETE T8
  src/renderer/chat/{main.tsx,App.tsx,Composer.tsx,History.tsx,bridge.ts,chat.css}
    + Composer.test.tsx History.test.tsx  CREATE                                                 T8
  src/renderer/key.html                   CREATE placeholder (<=40 lines) T6  ->  REPLACE T8
  src/renderer/key/placeholder.ts         CREATE T6  ->  DELETE T8
  src/renderer/key/{main.tsx,App.tsx,bridge.ts,key.css} + App.test.tsx   CREATE                  T8
  src/renderer/pet/main.ts                MODIFY  (fpsFor, dblclick -> chat:open, brain:* poses) T7
  tests/tokens-sheet.spec.ts              CREATE                                                 T0
  tests/fake-bridge.ts  tests/bubble.spec.ts  tests/mouth-sync.spec.ts   CREATE                  T7
  tests/chat-ui.spec.ts                   CREATE                                                 T8
characters/haru/character.json            MODIFY  (add `card` + `cannedLines`)                   T3
                                          MODIFY  (card CONTENT tuning only - R10.9)             T10
scripts/phase2-stats.mjs + .test.mjs      CREATE  (in the `scripts` vitest project)              T10
scripts/capture-region.ps1                CREATE                                                 T10
scripts/sample-resources.ps1              CREATE                                                 T10
docs/evidence/phase2/.gitkeep             CREATE  (the evidence root - §1.8)                     T0
docs/evidence/phase2/deferred.md          CREATE  (Phase 2 deferral ledger)                      T10
NOTICE                                    MODIFY  (MiSans)                                       T0
```

Rows above that need a word of explanation, because a draft had them wrong:

- **`src/main/window-glue.ts` does not exist.** An earlier draft of this tree gave T8 a `window-glue.ts` holding `holdWindowOpen` / `markQuitting`, while §6.1's literal export block declared both functions in **`apps/desktop/src/main/key-window.ts`**. Two homes, no resolving row, and T6 and T8 each followed a different sentence. **Resolved in favour of §6.1** (§8.6 row 11): both functions are exported from `key-window.ts`, owner **T6**. T6 is the task that needs the hold at eager-creation time — the key renderer's own `window.close()` would otherwise destroy the window created at startup and break C8's "opens ≤ 250 ms" — T6 already owns `key-window.ts` and `main/index.ts`, and T6 lands first. T8 **imports** them from `./key-window` and creates no `window-glue.ts`; a `window-glue.ts` appearing anywhere in Phase 2 is a defect (`test ! -f apps/desktop/src/main/window-glue.ts`). The `chat:resize` handler was never in that file either: T6 owns the channel, its schema, its allow-list membership *and* its main-side handler (§2.3), and `resizeChat` is T6's function in `chat-window.ts`, so the handler is registered in T6's `main/index.ts` wiring.
- **`src/renderer/shared/error-copy.ts` is deliberately absent.** A draft T8 brief created it; `ERROR_HINTS` in `@ds/protocol` is the only copy (§2.8, D4).
- **`TrimPlan` is declared in `types.ts` (T1) and re-exported by `prompt.ts` (T3).** §3.10's literal body needs `TrimPlan`, and `ports.ts` is T1's while `prompt.ts` is T3's; under `verbatimModuleSyntax` + `allowImportingTsExtensions` an `import type { TrimPlan } from './prompt.ts'` inside a T1-only tree is **TS2307**, so `tsc -p packages/brain/tsconfig.json` could never pass at the end of T1. The interface therefore lives in `types.ts` and `prompt.ts` carries `export type { TrimPlan } from './types.ts';` — every existing call site (`import type { TrimPlan } from '@ds/brain'`, `from './prompt.ts'`, `from './types.ts'`) still compiles, and `ports.ts` imports it from `'./types.ts'`. See §3.8.4 and §8.6 row 12.
- **`packages/protocol/src/index.test.ts` is a shared row.** The file already exists on `main` with two describes and 16 tests (§0). T1 **appends** — the Phase 1 `protocol` and `numeric bounds` describes are Phase 1 regression cover and stay byte-for-byte; T1 changes exactly one line (the `import … from './index.ts'` specifier, which gains the new symbols and C1's `.ts` extension) and appends its own describes. T6 then makes a **two-line edit** in the same file when it deletes `MAIN_TO_RENDERER` (§2.5): the import line and the one assertion that names it both become `MAIN_TO_PET`. The case name and the test count do not change. §2.5's "Nothing else in Phase 1 references them" is false and is corrected there.
- **`src/main/index.ts` has no unit test, so the Phase 1 wiring it already carries is listed here and must survive verbatim.** Two of these were silently dropped by a draft. A T6 acceptance criterion greps for each:
  1. `createVisibilityController({ … })` keeps **all five** deps — `window`, `send`, `setCursorPaused`, `setClickThrough`, `recheckCursor`.
  2. `screen.on('display-removed', onDisplaysChanged)` **and** `screen.on('display-metrics-changed', onDisplaysChanged)`, both calling `reconcileDisplays(pet)`.
  3. the `app.on('before-quit', …)` block keeps **both** `screen.removeListener(...)` calls.
  §5.4 rule 3 adds a `placeBubbleWindow(...)` call *after* the existing `avatar:drag` handler and a second `reconcileDisplays`-adjacent call on `display-metrics-changed`; it does not replace either listener.

Not in this tree and deliberately not touched: `apps/desktop/playwright.config.ts` (the Phase 1 **browser** harness at `localhost:5174`; T10's Electron lane is the separate `playwright.electron.config.ts`), `apps/desktop/public/characters/haru/character.json` (a gitignored build artefact of `scripts/fetch-sdk.mjs`; the renderer never reads `card`, so the two copies diverge after T3 and that is correct), and the repo-root `vitest.config.ts`.

Two `package.json` rows the tree above does not show as files but which are modified:

```
package.json (repo root)                  MODIFY: add `"test:eval": "pnpm --filter @ds/eval test"`  T9
apps/desktop/package.json                 MODIFY: add `"test:e2e:electron"` (§7.5)                  T10
```

### 1.2 `pnpm-workspace.yaml`

```yaml
packages:
  - packages/*
  - apps/*
  - eval
```

(The `onlyBuiltDependencies: [electron]` block stays exactly as it is.)

### 1.3 `package.json` files — literal

`packages/brain/package.json`:

```json
{
  "name": "@ds/brain",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ds/protocol": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

`packages/memory/package.json`:

```json
{
  "name": "@ds/memory",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ds/brain": "workspace:*",
    "@ds/protocol": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

`eval/package.json` (R1):

```json
{
  "name": "@ds/eval",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "type": "module",
  "scripts": {
    "eval": "node run.mjs",
    "eval:dry": "node run.mjs --dry",
    "session": "node session.mjs",
    "session:dry": "node session.mjs --dry",
    "test": "node --test lib/*.test.mjs"
  },
  "dependencies": {
    "@ds/brain": "workspace:*",
    "@ds/memory": "workspace:*"
  }
}
```

`eval`/`eval:dry`/`test` are **T9**'s; `session`/`session:dry` are **T10**'s (§7.1, §7.5). `"test"` is the Node built-in runner, not vitest (§1.5).

`packages/protocol/package.json` — **unchanged** (already `license: MIT`, `type: module`, `main: src/index.ts`, dep `zod ^4.0.0`).

`apps/desktop/package.json` — the only diffs:

```jsonc
{
  "scripts": {
    // MODIFY: three programs now                                             (T0)
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.renderer.json && tsc -p tsconfig.ui.json",
    // ADD: the Electron lane. `playwright.config.ts` (browser) is untouched. (T10, §7.5)
    "test:e2e:electron": "playwright test -c playwright.electron.config.ts"
  },
  "dependencies": {
    "@ds/brain": "workspace:*",        // ADD
    "@ds/memory": "workspace:*",       // ADD
    "@ds/protocol": "workspace:*",
    "@ds/stage": "workspace:*",
    "koffi": "^2.9.0",
    "react": "19.2.0",                 // ADD (pinned exact)
    "react-dom": "19.2.0",             // ADD (pinned exact)
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "@testing-library/jest-dom": "^6.9.0",   // ADD  (T7)
    "@testing-library/react": "^16.3.0",     // ADD  (T8)
    "@testing-library/user-event": "^14.6.1",// ADD  (T8)
    "@types/react": "^19.2.0",               // ADD  (T8)
    "@types/react-dom": "^19.2.0",           // ADD  (T8)
    "@vitejs/plugin-react": "^5.0.0",        // ADD  (T7; T8 re-adds idempotently)
    "electron": "43.4.1",
    "electron-vite": "5.0.0",
    "jsdom": "^30.0.1",                      // ALREADY PRESENT - leave it alone
    "vite": "7.3.6",
    "vitest": "3.2.7"                        // ADD  (T7; exact, matches the root resolution)
  }
}
```

> **`jsdom` is not an addition.** It is already a devDependency of `apps/desktop` at **`^30.0.1`** (verified this session). An earlier draft of this file listed `"jsdom": "^27.0.0"  // ADD`, which is a **downgrade**; T7 and T8 both act on this section and would have applied it. No task may change the `jsdom` range in Phase 2. It is shown in the block above precisely so that no task mistakes its absence for "missing".

> **`@vitejs/plugin-react` is T7's install, not T8's.** §1.5's `apps/desktop/vitest.config.ts` literal — which §1.4's ownership table assigns to **T7**, and which merges before T8 — begins `import react from '@vitejs/plugin-react'`. Without the devDependency vitest cannot load its own config and *every* desktop test fails, including the ones T6 already merged. T7 therefore installs it. T8 re-runs `pnpm add -D @vitejs/plugin-react@^5.0.0` against an entry that already reads `^5.0.0`: a no-op when T7 landed it, a repair when T7 did not. That deliberate idempotence is **not** a second copy of one of §1.4's four shared **build-file** edits (which T8 only verifies) — it is a devDependency range, and re-writing an identical range changes nothing.

**No `@floating-ui/dom`.** R3 moved placement into the main process (`placeBubble`, §5.3); the bubble window's own layout is a single CSS box plus a tail whose offset comes from `bubble:place`. Do not add a positioning library.

### 1.4 tsconfig per package — literal

`packages/protocol/tsconfig.json`, `packages/brain/tsconfig.json`, `packages/memory/tsconfig.json` — **identical content** (R1 + C1):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

`erasableSyntaxOnly` bans, in these three packages: parameter properties (`constructor(private x: T)`), `enum`, `namespace`/`module` blocks, `import x = require(...)`, and non-`declare` class `constructor` overloads. Write the explicit form instead:

```ts
// FORBIDDEN in @ds/protocol, @ds/brain, @ds/memory
export class A { constructor(private readonly turnId: string) {} }
// REQUIRED form
export class A {
  private readonly turnId: string;
  constructor(turnId: string) { this.turnId = turnId; }
}
```

TypeScript is 5.9.3, so the flag exists. **The `pnpm lint:erasable` grep fallback in R1 is not needed and must not be added.**

`apps/desktop/tsconfig.json` (the **main** program) — one added compiler option (C1a). `src/main` imports `@ds/brain` and `@ds/memory`, whose internal relative specifiers end in `.ts`; TS5097 is reported in the importing program, so without this the main program does not compile. Verified by execution.

```jsonc
"compilerOptions": {
  // ...everything already there stays byte-identical...
  "allowImportingTsExtensions": true   // ADD (T6)
}
```

`apps/desktop/tsconfig.renderer.json` — the **only** change is the `include` array (the Cubism relaxations stay, but they must no longer leak into the new UI code). The literal new value, complete — there is nothing to resolve and nothing to omit:

```jsonc
"include": [
  "src/renderer/pet",
  "tests",
  "../../vendor/core/live2dcubismcore.d.ts",
  "../../packages/stage/src"
]
```

The array being replaced is **line 18** of the file on `main` (an earlier draft of this section pinned line 17, which was correct before `39cbf05` added the `"types"` line). `"types": ["vite/client"]` and the three Cubism relaxations are **not** touched.

> **`"tests"` must survive.** An earlier draft of this section dropped it. `apps/desktop/tests/*.ts` — `stage.spec.ts` on `main`, plus the three Playwright files T7 creates and T8's `chat-ui.spec.ts` — are in **no other tsconfig program**: only this one has the `@framework/*` path mapping, the `DOM` lib and the three Cubism relaxations that `stage.spec.ts`'s import of `StageTestHook` from `src/renderer/pet/main.ts` drags in. Dropping `"tests"` silently removes every Playwright spec from type checking. The only edit to this array is `"src/renderer"` → `"src/renderer/pet"`. There is no `pet.html.d.ts`; do not add one and do not list one.

`apps/desktop/tsconfig.ui.json` — CREATE (strict lane; A63's fix):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx"
  },
  "include": ["src/renderer/bubble", "src/renderer/chat", "src/renderer/key", "src/renderer/shared"]
}
```

`strictNullChecks`, `strictFunctionTypes` and `useDefineForClassFields` are therefore **on** for every bubble/chat/key file. No file in those four directories may import `@framework/*`. This program does **not** set `allowImportingTsExtensions` (C1a: it reaches `@ds/protocol` only, which has no relative imports).

**Ownership of the four shared build files — one owner each, no re-doing:**

| File / change | Owner | Why that task |
|---|---|---|
| `apps/desktop/tsconfig.ui.json` (create, literal above) | **T0** | T0 writes the first file under `src/renderer/shared` (`tokens.test.ts`), and no existing program type-checks it. `tsconfig.renderer.json` carries **`"types": ["vite/client"]`** — *not* `[]`, as an earlier draft of this row and of task-0's item 7 both claimed (it was set in `39cbf05`). The conclusion is unchanged and is what matters: `["vite/client"]` contains no **node** types, so `node:fs` does not resolve in that program and `tokens.test.ts` needs a home of its own. |
| `apps/desktop/tsconfig.renderer.json` (narrow `include`) | **T0** | Same pass; the narrowing is what stops `src/renderer/shared` leaking into the Cubism-relaxed lane. |
| `apps/desktop/package.json` `typecheck` → `tsc -p tsconfig.json && tsc -p tsconfig.renderer.json && tsc -p tsconfig.ui.json` | **T0** | The third program must exist and be checked from the moment it exists. |
| `apps/desktop/vitest.config.ts` (§1.5 literal) + `src/renderer/test-setup.ts` + the `jsdom`/`@testing-library/jest-dom`/`vitest` devDeps | **T7** | T7 writes the first jsdom test. T0's `tokens.test.ts` runs in the **node** environment on purpose, precisely so T0 does not have to touch this file. |
| `apps/desktop/tsconfig.json` `allowImportingTsExtensions` | **T6** | T6 writes the first `src/main` file that imports `@ds/brain`. |

T6, T7 and T8 must each verify these are already in place and **not** re-apply them; a brief that carries a second copy of one of these edits is a defect.

### 1.5 `apps/desktop/vitest.config.ts` — literal (R6)

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Renderer tests need a DOM; main/preload tests must stay in node.
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
```

`apps/desktop/src/renderer/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Notes an implementer must not "fix":
- `environmentMatchGlobs` prints a deprecation warning on vitest 3. It is still honoured (verified in the installed type surface) and is what R6 mandates. **If a future vitest removes it**, the replacement is a `// @vitest-environment jsdom` docblock as line 1 of every `src/renderer/**/*.test.{ts,tsx}` file — nothing else changes.
- The root `vitest.config.ts` (`projects: ['packages/*','apps/*','scripts']`) is **unchanged**: `packages/brain` and `packages/memory` become projects automatically (verified in preflight). `eval` is deliberately **not** a vitest project — its tests use the Node built-in runner instead (`eval/package.json` gets `"test": "node --test lib/*.test.mjs"`, §7.1). Because that suite therefore sits outside the repo-wide `pnpm test` gate, the root `package.json` gains **`"test:eval": "pnpm --filter @ds/eval test"`** (owner: **T9**), and T10's precondition gate and final sweep both run `pnpm test && pnpm test:eval`. Without that, an eval regression is invisible.
- Test-count expectations in a brief are **deltas** against the measured baseline (**23 files / 206 tests** at HEAD `ba2b3ef`, §0). Never write an absolute repo-wide total, and never re-base against the superseded 198.

### 1.6 `apps/desktop/electron.vite.config.ts` — literal diff (R5)

Keep the whole file; change exactly these three things.

```ts
// 1. main.build.externalizeDeps — ADD the two new workspace packages.
externalizeDeps: { exclude: ['@ds/protocol', '@ds/stage', '@ds/brain', '@ds/memory', 'zod'] },
```

```ts
// 2. preload.build.rollupOptions.input — four preloads.
input: {
  pet: resolve(__dirname, 'src/preload/pet.ts'),
  bubble: resolve(__dirname, 'src/preload/bubble.ts'),
  chat: resolve(__dirname, 'src/preload/chat.ts'),
  key: resolve(__dirname, 'src/preload/key.ts'),
},
```

```ts
// 3. renderer — four html inputs (T6) + the react plugin (T8, added on top).
import react from '@vitejs/plugin-react';   // T8 only
// ...
renderer: {
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  build: {
    rollupOptions: {
      input: {
        pet: resolve(__dirname, 'src/renderer/pet.html'),
        bubble: resolve(__dirname, 'src/renderer/bubble.html'),
        chat: resolve(__dirname, 'src/renderer/chat.html'),
        key: resolve(__dirname, 'src/renderer/key.html'),
      },
    },
  },
},
```

`node:sqlite` needs **no** entry anywhere: it is a Node builtin and rollup externalizes builtins by default (verified).

Because inputs 2 and 3 point at files, **T6 creates all of `bubble.html`, `chat.html`, `key.html` as placeholders** so `pnpm dev` builds at the end of T6 (R5). Placeholder budget: `bubble.html` ≤ 20 lines (transparent page that answers `bubble:place` with its measured size), `chat.html` ≤ 40 lines (a bare `<textarea>` + Enter → `user:text`), `key.html` ≤ 40 lines (a bare `<input>` + `key:set`). Each page's script lives in a sibling `src/renderer/<win>/placeholder.ts` so the strict UI lane type-checks it.

**Placeholder deletion is assigned** (nothing in the v1 prose deleted them):

| Placeholder | Created by | Deleted by |
|---|---|---|
| `src/renderer/bubble/placeholder.ts` (and the `bubble.html` body it drives) | T6 | **T7** |
| `src/renderer/chat/placeholder.ts` | T6 | **T8** |
| `src/renderer/key/placeholder.ts` | T6 | **T8** |

T7's and T8's acceptance criteria each include `git status` showing the deletion, and a repo-wide grep for `placeholder` in `src/renderer` returning nothing after T8.

`apps/desktop/src/main/app-protocol.ts` — the exported origin constant is **`APP_ORIGIN`** (it was renamed from `ORIGIN` in the Phase 1 hardening pass, and `serveRenderer` now goes through `resolveRendererRequest`). T6 adds one function and changes nothing else:

```ts
export function rendererUrl(page: 'pet' | 'bubble' | 'chat' | 'key'): string;
// dev:  `${process.env.ELECTRON_RENDERER_URL}/${page}.html`
// prod: `${APP_ORIGIN}/${page}.html`
```

`PET_URL` stays for `pet-window.ts`. `resolveRendererRequest` needs no change: `bubble.html`, `chat.html` and `key.html` are ordinary paths under the same root and authority.

`apps/desktop/vite.browser.config.ts` — add the React plugin only:

```ts
import react from '@vitejs/plugin-react';
// ...
plugins: [react()],
```
(Root stays `src/renderer`; `bubble.html`, `chat.html` and `key.html` are already reachable by path — do not add rollup inputs to this config.)

### 1.7 Conventions every Phase 2 task brief must follow

These are contract, not style. A brief that violates one is a defect.

1. **Shell.** Every command in a brief runs in **one of two tools**, and every fence is tagged with which:
   - ```` ```bash ```` → the **Bash** tool (Git Bash, POSIX `sh`): forward slashes, `/d/ds`-style paths are acceptable but absolute `D:/ds/...` is preferred, `&&` chaining, `$VAR`.
   - ```` ```powershell ```` → the **PowerShell** tool (Windows PowerShell 5.1): **no `&&`**, no `?:`/`??`, `;` + `if ($?)` for chaining, `$env:VAR`, `New-Item -ItemType Directory -Force`.

   Untagged fences and `cd D:\ds\eval && …` (which parses in neither shell) are forbidden. Screenshot/capture steps that shell out to `Bitmap.Save`, `Tee-Object`, `capture-region.ps1` or `sample-resources.ps1` are **PowerShell**; everything else defaults to **Bash**.
2. **Commit message.** Every task commits with **both trailers**, exactly:
   ```
   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
   Claude-Session: <the session URL from the environment block>
   ```
   **Two invocation forms are permitted, and a brief may use either.** An earlier draft pinned only the first and declared any other form a defect, which made tasks 0, 1 and 2 defective for using the second:
   - `git commit -m "<subject>" -m "<body>"` — fine for a short ASCII body.
   - a heredoc: `git commit -F - <<'MSG' … MSG` (Bash) — **explicitly permitted, and preferred for multi-line CJK bodies**, because `-m` bodies with full-width punctuation and embedded newlines are easy to mangle across the shell boundary. `<<'MSG'` (quoted delimiter) is the required form so nothing inside is expanded.

   `git commit -F <file>` with a temporary file is also acceptable; the file must not be staged.

   **Whose session URL.** The `Claude-Session` trailer carries **the session URL of the session that is actually executing the commit** — the implementer's own environment block, never the controller's, and never a `<placeholder>` left in the brief. A controller-authored brief that hard-codes the controller's URL (tasks 9 and 10 do) or leaves a placeholder (tasks 3–8 do) is asking the implementer to sign the wrong session; the implementer substitutes its own and the brief's literal is read as a shape, not a value.
3. **Staging.** `git add` takes the **explicit path list from the task's own Files table**. `git add -A` and `git add .` are forbidden — a task that stages a file it does not own has crossed an ownership line without noticing.
4. **Branching.** One branch per task off its merge base in §0.1's graph, merged into `main` in the order given there. Single long-lived branch is `main`; no push without the owner's go-ahead.
5. **Verification.** Every step that claims a result shows the command **and** its output. Test expectations are deltas against §0's baseline.

### 1.8 Evidence root and the one evidence manifest

`docs/evidence/phase2/` is the directory every Phase 2 task writes to. Only `docs/evidence/phase1/` exists today, so every later task may assume it is there **because T0 actually creates it**: T0's **first** step is `mkdir -p docs/evidence/phase2 && touch docs/evidence/phase2/.gitkeep`, and `.gitkeep` is in T0's staged file list and its commit. An earlier draft listed the `.gitkeep` row in §1.1 and told T5, T6 and T8 to rely on the directory, but gave T0 no step that created it — the row without the step is what made three later gates depend on a file nobody wrote.

There is **one** naming scheme, and it is the one T10's **manifest completeness gate** checks — the gate asserts that **every file this table names exists and is non-empty**, not that the directory holds some fixed count. (An earlier draft of this sentence said "20-file completeness gate" while the table beneath it already named 28 files; the count was stale from the moment it was written, so the wording is now count-free. T10 addition 1.) Where a brief uses a different name, the manifest wins.

| File | Written by | Contents |
|---|---|---|
| `tokens-sheet-{light,dark}.png` | T0 | the token specimen board |
| `task-3-card-tokens.txt`, `task-3-static-system.txt`, `task-3-static-system-plain.txt` | T3 | budget numbers + the rendered blocks |
| `sheet-band-{light,dark}.png` | T7 | the speech band, both themes |
| `hint-error.png` | T7 | the hint surface at `level:'error'` *(not `bubble-hint-error.png`)* |
| `desktop-first-message.png` | T7 | the real app painting `first_mes` *(not `desktop-bubble-first-message.png`)* |
| `desktop-reply.png` | T7 | the real app mid-reveal |
| `sheet-composer-{light,dark}.png` | T8 | the chat composer, both themes |
| `sheet-key-{light,dark}.png` | T8 | the key window, both themes |
| `chat-history-{light,dark}.png` | **T8** | the history pane, both themes — forward-referenced by T5; T8 is the only task that can render it |
| `history-interrupted.png` | T8 | a `[中断]` row |
| `eval-report.{json,md}` | T9 | the fixture run — **T9's online baseline, against the untuned card** |
| `metrics-cache-hit.txt` | **T10** | the `prompt_cache_hit_tokens / prompt_tokens` readout T5 forward-references; it needs a real key, so it belongs to T10's session probe. **Content, pinned:** a fixed **six-line header** (the last line reads `cache-hit ratio: <n.n> % (bar >= 70.0 %, X1)`), one blank line, then one `turn <n> <hit>/<prompt>` line per turn — derived from `session-20-turns.json`, so a 20-turn probe gives 28 lines |
| `session-20-turns.{json,md}`, `app-20-turns.{json,md}` | T10 | the continuous-session probe |
| `tuning-log.md`, `resources.md`, `deferred.md`, `e2e-report.json` | T10 | the bounded tuning loop, CPU/RSS samples, the deferral ledger, the Playwright/Electron report |
| `eval-report-final.{json,md}` | **T10** | the eval run **after** the bounded tuning loop, against the **tuned** card. A separate pair from T9's on purpose: one file with two owners is the defect this plan keeps avoiding, and overwriting T9's name would destroy the before/after that makes `tuning-log.md` mean anything |
| `app-band-{light,dark}.png`, `app-chat-{light,dark}.png`, `app-key-{light,dark}.png` | **T10** | the same three surfaces as T7's and T8's sheets, but photographed in **real Electron windows** rather than the vite browser harness at `localhost:5174`. Distinct names on purpose — nothing collides, and the two sets prove different things |
| `app-desktop.png` | T10 | pet + band composited on the real desktop, through the DPI-aware `capture-region.ps1` grab |
| `app-history-interrupted.png` | T10 | the `[中断]` row in the running app (T8's `history-interrupted.png` is the harness shot) |
| `README.md` | **T10** | the evidence sheet: one page indexing every artefact below, what it proves, which task produced it, and the measured number it carries. Without it this directory is 39 loose files |

**Counts, so the gate's arithmetic is checkable:** the table names **39** files — 2 (T0) + 3 (T3) + 5 (T7) + 7 (T8) + 2 (T9) = **19 inherited** by T10, plus **20** of T10's own. T10's precondition gate checks the 19 inherited names exist before it starts; its final sweep checks all 39.

**Per-task working artefacts — recorded here, deliberately OUTSIDE the completeness gate.** Tasks with no visual surface still capture terminal transcripts, and two visual tasks shoot more than the manifest has names for. These are traceability, not gate rows: the gate never counts them, and their absence never fails T10. They are listed so no task invents a *third* naming scheme and so a reviewer can find them.

| Files | Written by |
|---|---|
| `task-1-vitest.txt`, `task-1-typecheck.txt`, `task-1-node-strip.txt` | T1 |
| `task-2-vitest.txt` | T2 |
| `task-4-vitest.txt`, `task-4-typecheck.txt`; `task-4-live-turn.txt` + `task-4-cache-hit.txt` **only when `DEEPSEEK_API_KEY` is set** | T4 |
| `task-5-memory-tests.txt`, `task-5-memory-typecheck.txt`, `task-5-node-strip.txt` | T5 |
| `task6-fake-brain-run.png`, `task6-console.png`, `task6-key-window.png`; `task6-real-key-run.png` + `task6-sqlite-failure.png` **conditionally** | T6 |
| `bubble-thinking.png`, `bubble-glyphs-300.png`, `bubble-corner-{1,1.25,1.5,2}x.png`, `mouth-sync.txt`, `desktop-hint-no-key.png`, `desktop-bubble-dragged.png` | T7 |
| `sheet-composer-typing-{light,dark}.png` | T8 |
| `eval-dry-run.png`, `eval-online-summary.png`, `eval-ablation.md` | T9 |

Note the two spellings: T6's files are `task6-*` (no second hyphen) and every other task's are `task-N-*`. Both are shipped as written; the gate reads neither.

---

## 2. `@ds/protocol` additions

### 2.1 Emotions — one definition (D3)

Added to `packages/protocol/src/index.ts`:

```ts
export const EMOTIONS = [
  'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral',
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const EmotionSchema = z.enum(EMOTIONS);
export const isEmotion = (s: string): s is Emotion => (EMOTIONS as readonly string[]).includes(s);
```

Consumers:
- `packages/stage/src/character.ts` — DELETE its local `EMOTIONS`/`Emotion` and `import { EMOTIONS, type Emotion } from '@ds/protocol';`, then `export { EMOTIONS }; export type { Emotion };` so `@ds/stage`'s public surface is unchanged.
- `packages/brain/src/types.ts` — `import { EMOTIONS, isEmotion, type Emotion } from '@ds/protocol';` then re-export.
- Identity test, one per consumer (`packages/stage/src/character.test.ts`, `packages/brain/src/types.test.ts`):
  ```ts
  import { EMOTIONS as P } from '@ds/protocol';
  import { EMOTIONS as C } from './character.ts'; // or './types.ts'
  it('re-exports the protocol emotion list unchanged', () => { expect(C).toBe(P); });
  ```

### 2.2 New zod schemas in `@ds/protocol` — **all of it is written by T1**

> **Task split, pinned.** Everything in this section — every schema *and* every inferred type — lands in **T1**, in one edit to `packages/protocol/src/index.ts`. Only the channel/invoke maps and the allow-lists (§2.3–§2.5) and the error table (§2.8) land in **T6**. This is forced by the lanes: T2 needs `LintRuleSchema`/`LintSeveritySchema`/`LintResultSchema`, and T5 needs `HistoryRowSchema`, and both run long before T6. A brief that puts any part of §2.2 in T6 is a defect.

```ts
export const TurnStateSchema = z.enum(['idle', 'thinking', 'speaking']);
export type TurnState = z.infer<typeof TurnStateSchema>;

export const SentenceEventSchema = z.object({
  turnId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  emotion: EmotionSchema,
  motion: z.string().optional(),
  pause: z.number().nonnegative().optional(),
});
export type SentenceEvent = z.infer<typeof SentenceEventSchema>;

export const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  cacheHit: z.number().int().nonnegative(),
  cacheMiss: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ErrorCodeSchema = z.enum(['auth', 'balance', 'rate', 'server', 'network', 'timeout', 'empty', 'no-key']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const LintRuleSchema = z.enum([
  'assistant-leak', 'narrates-user', 'closing-moral', 'repetition', 'webnovel', 'opener-repeat',
  'rhetorical', 'question-streak', 'ellipsis', 'ellipsis-rate', 'affect-rate', 'markdown',
  'emoji', 'emoji-rate', 'emoji-sensitive',
]);
export const LintSeveritySchema = z.enum(['none', 'strip', 'regenerate']);
export const LintResultSchema = z.object({
  violations: z.array(z.object({ rule: LintRuleSchema, detail: z.string() })),
  severity: LintSeveritySchema,
});
export type LintRule = z.infer<typeof LintRuleSchema>;
export type LintSeverity = z.infer<typeof LintSeveritySchema>;
export type LintResult = z.infer<typeof LintResultSchema>;

export const MessageKindSchema = z.enum(['chat', 'proactive', 'system']);   // R10.3
export const RoleSchema = z.enum(['user', 'assistant']);

export const HistoryRowSchema = z.object({
  id: z.number().int().positive(),
  ts: z.number().int().nonnegative(),          // epoch ms
  role: RoleSchema,
  content: z.string(),
  turnId: z.string().nullable(),
  kind: MessageKindSchema,
  interrupted: z.boolean(),
});
export type HistoryRow = z.infer<typeof HistoryRowSchema>;

export const SideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type Side = z.infer<typeof SideSchema>;
```

`LintRuleSchema`/`LintResultSchema` live here (not in `@ds/brain`) because `brain:turnDone` carries a `LintResult` across IPC. `@ds/brain` imports and re-exports them; **`@ds/brain` owns the rule → severity table (§3.4), `@ds/protocol` owns only the shape.**

### 2.3 Channel table (R9) — send channels

`Channels`, `Schemas` and the allow-lists are extended; **every Phase 1 row keeps its name, direction and schema byte-for-byte.**

Legend: `P` = pet renderer, `B` = bubble renderer, `C` = chat renderer, `K` = key renderer, `M` = main.

| Channel | Key in `Channels` | Dir | Payload schema | Producer | Consumers | Allow-lists |
|---|---|---|---|---|---|---|
| `gaze:cursor` | `gazeCursor` | M→P | *(Phase 1, unchanged)* | M | P | `MAIN_TO_PET` |
| `shell:visibility` | `shellVisibility` | M→P, M→B | *(Phase 1, unchanged)* | M (`VisibilityState`) | P, B | `MAIN_TO_PET`, `MAIN_TO_BUBBLE` |
| `stage:setFps` | `stageSetFps` | M→P | *(Phase 1)* | M | P | `MAIN_TO_PET` |
| `debug:expression` / `debug:motion` / `debug:toggle` | *(Phase 1)* | M→P | *(Phase 1)* | M | P | `MAIN_TO_PET` |
| `avatar:hover` | `avatarHover` | P→M | *(Phase 1)* | P | M | `PET_TO_MAIN` |
| `avatar:tap` | `avatarTap` | P→M | *(Phase 1)* | P | M | `PET_TO_MAIN` |
| `avatar:drag` / `avatar:dragEnd` | *(Phase 1)* | P→M | *(Phase 1)* | P | M | `PET_TO_MAIN` |
| `stage:ready` / `stage:error` | *(Phase 1)* | P→M | *(Phase 1)* | P | M | `PET_TO_MAIN` |
| **`user:cancel`** | `userCancel` | C→M | `z.object({})` | C (Esc while speaking, or 停 button) | M → `TurnRunner.cancel()` | `CHAT_TO_MAIN` |
| **`brain:state`** | `brainState` | M→P,B,C | `z.object({ state: TurnStateSchema, turnId: z.string() })` | M (`BrainService` ← `TurnRunner`) | P (poses/fps), B (thinking dots), C (状态行) | `MAIN_TO_PET`, `MAIN_TO_BUBBLE`, `MAIN_TO_CHAT` |
| **`brain:sentence`** | `brainSentence` | M→P,B | `SentenceEventSchema` | M | P (emotion+motion), B (reveal) | `MAIN_TO_PET`, `MAIN_TO_BUBBLE` |
| **`brain:turnDone`** | `brainTurnDone` | M→P,B,C | `z.object({ turnId: z.string(), usage: UsageSchema.nullable(), ttftMs: z.number().nullable(), totalMs: z.number(), complianceMiss: z.boolean(), regenerated: z.boolean(), lint: LintResultSchema })` | M | P, B, C | `MAIN_TO_PET`, `MAIN_TO_BUBBLE`, `MAIN_TO_CHAT` |
| **`brain:error`** | `brainError` | M→B,C | `z.object({ turnId: z.string().optional(), code: ErrorCodeSchema, message: z.string() })` | M | B (drop queue), C (restore composer) | `MAIN_TO_BUBBLE`, `MAIN_TO_CHAT` |
| **`hint:show`** | `hintShow` | M→B | `z.object({ text: z.string(), level: z.enum(['info','warn','error']), ttlMs: z.number().int().positive() })` | M (error routing, §6.4) | B (hint layer) | `MAIN_TO_BUBBLE` |
| **`avatar:listening`** | `avatarListening` | M→P | `z.object({ on: z.boolean() })` | **M**, derived from `chat:composing` (R9) | P | `MAIN_TO_PET` |
| **`playback:sentenceDone`** | `playbackSentenceDone` | B→M | `z.object({ turnId: z.string(), seq: z.number().int().nonnegative() })` | B | M → `TurnRunner.sentenceShown` | `BUBBLE_TO_MAIN` |
| **`playback:turnDone`** | `playbackTurnDone` | B→M | `z.object({ turnId: z.string() })` | B | M → `TurnRunner.turnShown` | `BUBBLE_TO_MAIN` |
| **`speech:mouth`** | `speechMouth` | B→M, M→P | `z.object({ on: z.boolean() })` | B (RevealPlan mouth transitions only) | M relays verbatim to P | `BUBBLE_TO_MAIN`, `MAIN_TO_PET` |
| **`speech:complete`** | `speechComplete` | C→M, M→B | `z.object({})` | C (Enter on an empty composer) | M relays to B → `SpeechController.complete()` | `CHAT_TO_MAIN`, `MAIN_TO_BUBBLE` |
| **`bubble:place`** | `bubblePlace` | M→B | `z.object({ maxWidth: z.number().positive(), maxHeight: z.number().positive(), side: SideSchema, arrowOffset: z.number().nonnegative() })` | M (after `placeBubble`) | B (sets the CSS box + tail) | `MAIN_TO_BUBBLE` |
| **`bubble:size`** | `bubbleSize` | B→M | `z.object({ width: z.number().positive(), height: z.number().positive() })` | B (`ResizeObserver` on the content box) | M → `BubbleWindow.applySize` | `BUBBLE_TO_MAIN` |
| **`bubble:hover`** | `bubbleHover` | B→M | `z.object({ inside: z.boolean() })` | B (pointer over the bubble/hint DOM) | M → `setIgnoreMouseEvents` on the bubble window | `BUBBLE_TO_MAIN` |
| **`chat:open`** | `chatOpen` | P→M, B→M, K→M | `z.object({ source: z.enum(['pet','bubble','tray','hotkey','key']), focusComposer: z.boolean() })` | P (double-click on the model), B (click on the bubble), M (tray/hotkey — calls the handler directly, does not send), K (after a successful save) | M → `ChatWindow.open()` | `PET_TO_MAIN`, `BUBBLE_TO_MAIN`, `KEY_TO_MAIN` |
| **`chat:opened`** | `chatOpened` | M→C | `z.object({ focusComposer: z.boolean() })` | M | C (focus + select) | `MAIN_TO_CHAT` |
| **`chat:close`** | `chatClose` | C→M | `z.object({})` | C (Esc, 关闭) | M → `ChatWindow.close()` | `CHAT_TO_MAIN` |
| **`chat:composing`** | `chatComposing` | C→M | `z.object({ on: z.boolean() })` | C (`compositionstart`/`compositionend`, and focus/blur of the textarea) | M (light-dismiss guard **and** the producer of `avatar:listening`) | `CHAT_TO_MAIN` |
| **`chat:resize`** | `chatResize` | C→M | `z.object({ rows: z.number().int().min(1).max(6), historyOpen: z.boolean() })` | C (`onRowsChange`, history toggle) | M → `resizeChat(win, pet, rows, historyOpen)` (§6.1) | `CHAT_TO_MAIN` |
| **`key:status`** | `keyStatus` | M→K, M→C | `z.object({ present: z.boolean(), source: z.enum(['store','dev-env','none']), lastTest: z.object({ ok: z.boolean(), code: ErrorCodeSchema.optional(), at: z.number().int() }).nullable() })` | **M, from `KeyStore`** on `set`/`clear`/`key:test` completion and on key-window `ready-to-show` (R9) | K, C | `MAIN_TO_KEY`, `MAIN_TO_CHAT` |

`Schemas` keeps its `satisfies Record<Channel, z.ZodTypeAny>` shape — every row above must appear in it.

> **`key:status.lastTest` lifecycle, pinned.** `KeyStore.onChange` carries only `{present, source}` (§6.5), so nothing in the contract said what happens to `lastTest` when the key itself changes — and a draft T6 kept the old value across a `key:clear`, leaving the key window showing `可用 ✓` for a key that no longer exists. **Rule: `lastTest` describes the key that is stored right now, and a key change invalidates it.** Concretely, `BrainService` holds one `lastTest` value and:
> - every `key:status` it sends from a `KeyStore.onChange` (`set` **or** `clear`) carries **`lastTest: null`**, and resets the held value to `null` first;
> - only a completed `key:test` sets it, to `{ ok, code?, at }`;
> - the `ready-to-show` push sends whatever is currently held (`null` on a cold start).
>
> This is the simplest rule that cannot go stale: a stored `lastTest` never outlives the key it tested. The rejected alternative — carrying `lastTest` inside `onChange`'s payload — widens `KeyStore`'s surface for a value `KeyStore` does not own.

> **`chat:composing` has a recovery rule; it is not a one-way latch.** §2.3 lists focus/blur of the textarea among the producers, but neither §6.1's light-dismiss rule nor §6.2's composer rules said what clears a composition that never ends — a window hidden or focus lost mid-IME leaves main's guard latched `{on:true}` forever, and the chat can then never be dismissed by blur. **The latch is cleared from both ends:**
> - **Renderer:** the textarea's `blur` handler sends `chat:composing {on:false}` unconditionally, whether or not a `compositionend` arrived. (`compositionstart`/`compositionend` keep their §6.2 rule 1 behaviour, including the next-macrotask clear.)
> - **Main:** `closeChat(win)` and the chat window's `hide` both call `setChatComposing(false)` (§6.1) before anything else, so a window that goes away never leaves the guard armed for the next open.
>
> Neither end alone is sufficient — a hide driven by `VisibilityState` fires no renderer `blur` — and together they make the guard's only armed state "the composer is focused and an IME session is open".

> **`chat:resize` — one owner.** §6.2 rule 5 requires `onRowsChange(rows)` to drive `resizeChat` in main, and there was no channel carrying it, so the chat window could never grow. The channel, its schema, its `CHAT_TO_MAIN` membership and the main-side handler are **all owned by T6** (the main-wiring task) and are declared here once. T8 *consumes* it. An earlier T8 brief proposed the identical channel as its own CA-1; that duplicate is **deleted** — T8 must not add the channel, only send on it.

### 2.4 Channel table — invoke channels (request + response)

Invoke channels are a **separate** map so `Schemas` stays request-only for send channels (A46's fix).

```ts
export const InvokeChannels = {
  userText: 'user:text',
  keySet: 'key:set',
  keyTest: 'key:test',
  keyClear: 'key:clear',
  historyList: 'history:list',
  historyDelete: 'history:delete',
} as const;
export type InvokeChannel = (typeof InvokeChannels)[keyof typeof InvokeChannels];

export const InvokeRequest = {
  [InvokeChannels.userText]: z.object({ text: z.string().min(1).max(2000) }),
  [InvokeChannels.keySet]: z.object({ apiKey: z.string().min(8).max(200) }),
  [InvokeChannels.keyTest]: z.object({ apiKey: z.string().min(8).max(200).optional() }),
  [InvokeChannels.keyClear]: z.object({}),
  [InvokeChannels.historyList]: z.object({
    before: z.number().int().positive().optional(),   // messages.id cursor, exclusive
    limit: z.number().int().min(1).max(200).default(50),
  }),
  [InvokeChannels.historyDelete]: z.object({ turnId: z.string().min(1) }),
} satisfies Record<InvokeChannel, z.ZodTypeAny>;

export const InvokeResponse = {
  [InvokeChannels.userText]: z.union([
    z.object({ ok: z.literal(true), turnId: z.string() }),
    z.object({ ok: z.literal(false), code: ErrorCodeSchema, message: z.string() }),
  ]),
  [InvokeChannels.keySet]: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
  [InvokeChannels.keyTest]: z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), code: ErrorCodeSchema, message: z.string() }),
  ]),
  [InvokeChannels.keyClear]: z.object({ ok: z.literal(true) }),
  [InvokeChannels.historyList]: z.object({
    rows: z.array(HistoryRowSchema),
    nextBefore: z.number().int().positive().nullable(),
  }),
  [InvokeChannels.historyDelete]: z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() }),
} satisfies Record<InvokeChannel, z.ZodTypeAny>;

export type InvokeReq<C extends InvokeChannel> = z.infer<(typeof InvokeRequest)[C]>;
export type InvokeRes<C extends InvokeChannel> = z.infer<(typeof InvokeResponse)[C]>;

export function parseInvokeRequest<C extends InvokeChannel>(c: C, p: unknown): ParseResult<InvokeReq<C>>;
export function parseInvokeResponse<C extends InvokeChannel>(c: C, p: unknown): ParseResult<InvokeRes<C>>;
```

Both parse helpers mirror `parseEvent` exactly (`{ ok:true, data } | { ok:false, error }`, unknown channel → `ok:false`).

| Invoke channel | Caller | Handler | Notes |
|---|---|---|---|
| `user:text` | C | M → `TurnRunner.send` | returns the `turnId` so the composer can bind its restore-on-failure to a turn |
| `key:set` | K | M → `KeyStore.set` | validation is a **separate** `key:test`; `set` only reports a `safeStorage` failure |
| `key:test` | K | M → `DeepSeekClient.testKey` | with `apiKey` → test that literal key; without → test the stored key |
| `key:clear` | K | M → `KeyStore.clear` | |
| `history:list` | C | M → `HistoryStore.list` | newest first; `nextBefore` is the smallest returned `id`, or `null` at the end |
| `history:delete` | C | M → `HistoryStore.deleteTurn` | deletes every row with that `turn_id` (both roles) |

### 2.5 Allow-lists (R9)

```ts
export const PET_TO_MAIN: readonly Channel[] = [
  Channels.avatarHover, Channels.avatarTap, Channels.avatarDrag, Channels.avatarDragEnd,
  Channels.stageReady, Channels.stageError, Channels.chatOpen,
];
export const MAIN_TO_PET: readonly Channel[] = [
  Channels.gazeCursor, Channels.shellVisibility, Channels.stageSetFps,
  Channels.debugExpression, Channels.debugMotion, Channels.debugToggle,
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone,
  Channels.avatarListening, Channels.speechMouth,
];

export const BUBBLE_TO_MAIN: readonly Channel[] = [
  Channels.playbackSentenceDone, Channels.playbackTurnDone,
  Channels.speechMouth, Channels.bubbleSize, Channels.bubbleHover, Channels.chatOpen,
];
export const MAIN_TO_BUBBLE: readonly Channel[] = [
  Channels.brainState, Channels.brainSentence, Channels.brainTurnDone, Channels.brainError,
  Channels.hintShow, Channels.bubblePlace, Channels.shellVisibility, Channels.speechComplete,
];

export const CHAT_TO_MAIN: readonly Channel[] = [
  Channels.userCancel, Channels.chatClose, Channels.chatComposing, Channels.chatResize,
  Channels.speechComplete,
];
export const MAIN_TO_CHAT: readonly Channel[] = [
  Channels.brainState, Channels.brainTurnDone, Channels.brainError,
  Channels.chatOpened, Channels.keyStatus,
];

export const KEY_TO_MAIN: readonly Channel[] = [Channels.chatOpen];
export const MAIN_TO_KEY: readonly Channel[] = [Channels.keyStatus];

export const CHAT_INVOKE: readonly InvokeChannel[] = [
  InvokeChannels.userText, InvokeChannels.historyList, InvokeChannels.historyDelete,
];
export const KEY_INVOKE: readonly InvokeChannel[] = [
  InvokeChannels.keySet, InvokeChannels.keyTest, InvokeChannels.keyClear,
];
export const PET_INVOKE: readonly InvokeChannel[] = [];
export const BUBBLE_INVOKE: readonly InvokeChannel[] = [];
```

`RENDERER_TO_MAIN` and `MAIN_TO_RENDERER` are **deleted**; `apps/desktop/src/preload/pet.ts` switches to `PET_TO_MAIN` / `MAIN_TO_PET` (a two-token edit on lines 2 and 4–5).

> **One more Phase 1 reference, corrected.** An earlier draft of this paragraph ended "Nothing else in Phase 1 references them." That is false: `packages/protocol/src/index.test.ts` **imports and asserts `MAIN_TO_RENDERER`** (lines 2 and 21 on `main`). T6 is the task that deletes the symbol, so T6 makes the swap — two lines in a file T1 owns, listed as such in §1.1. The case name and the file's test count are unchanged.

### 2.6 Preload globals

| Window | Preload file | Global | Surface |
|---|---|---|---|
| pet | `src/preload/pet.ts` | `window.ds` | `send`, `on` (existing shape, new allow-lists) |
| bubble | `src/preload/bubble.ts` | `window.dsBubble` | `send`, `on` |
| chat | `src/preload/chat.ts` | `window.dsChat` | `send`, `on`, `invoke` |
| key | `src/preload/key.ts` | `window.dsKey` | `send`, `on`, `invoke` |

All four use the identical body (only the constants differ):

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { MAIN_TO_CHAT, CHAT_TO_MAIN, CHAT_INVOKE, type Channel, type InvokeChannel } from '@ds/protocol';

const toMain = new Set<string>(CHAT_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_CHAT);
const canInvoke = new Set<string>(CHAT_INVOKE);

contextBridge.exposeInMainWorld('dsChat', {
  send(channel: Channel, payload: unknown) {
    if (!toMain.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on(channel: Channel, cb: (payload: unknown) => void) {
    if (!toRenderer.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  invoke(channel: InvokeChannel, payload: unknown) {
    if (!canInvoke.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },
});
```

Renderer-side typed bridge — **one per window, each declared in that window's own `bridge.ts`, each augmenting only its own `Window` global.** §1.1 gives chat and key separate `bridge.ts` files, so a single shared interface plus one combined `declare global` block would force one window to import the other's module for a three-method type. The shape is identical in all three; only the name and the augmented global differ:

```ts
// src/renderer/chat/bridge.ts  — owner T8
export interface DsInvokeBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeReq<C>): Promise<InvokeRes<C>>;
}
declare global { interface Window { dsChat?: DsInvokeBridge } }

// src/renderer/key/bridge.ts   — owner T8; structurally identical, separately declared
export interface DsKeyBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeReq<C>): Promise<InvokeRes<C>>;
}
declare global { interface Window { dsKey?: DsKeyBridge } }

// src/renderer/bubble/bridge.ts — owner T7; send/on only, no invoke (BUBBLE_INVOKE is empty)
declare global { interface Window { dsBubble?: DsBridge } }
```

`KeyAppProps.bridge` (§6.2) is therefore typed **`DsKeyBridge`**, and `App({ bridge })` in `chat/` is typed `DsInvokeBridge`. A cross-window import (`key/bridge.ts` → `../chat/bridge`) is forbidden: it would couple two windows that share nothing else.

In browser/Playwright mode the bridge is `undefined` and the page must still render; the test harness injects a fake by assigning `window.dsChat` **before** the module script runs (`page.addInitScript`).

### 2.7 Main-process IPC helpers — **additive; the Phase 1 authentication is kept**

> This section was originally written against the **pre-hardening** `ipc.ts` and proposed `sendTo` / `onFrom` / `sendToPet = sendTo`. That shape deletes the sender authentication that landed in Phase 1 and breaks `ipc.test.ts` (19 tests). It is **superseded** by what follows. Phase 2 **adds** helpers; it removes nothing.

`apps/desktop/src/main/ipc.ts` keeps, byte-for-byte, everything it has on `main`:

```ts
export type SendTarget = { isDestroyed(): boolean; webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void } };
export type SenderIdentity = { sender: unknown; senderFrame: { url: string } | null };
export type PetIdentity = { isDestroyed(): boolean; webContents: { isDestroyed(): boolean; mainFrame: unknown } };
export function sendToPet<C extends Channel>(win: SendTarget, channel: C, payload: Payload<C>): void;
export function isFromPet(event: SenderIdentity, pet: PetIdentity): boolean;
export function onFromPet<C extends Channel>(pet: BrowserWindow, channel: C, cb: (payload: Payload<C>, win: BrowserWindow) => void): void;
```

and **adds** four names. The shared predicate is renamed-by-generalisation, not replaced: `isFromPet(event, pet)` becomes a one-line call into `isFromWindow(event, pet)`, so there is exactly one copy of the three checks (same `webContents` · **main** frame · an origin we shipped, via `isAllowedPetUrl`).

```ts
/** The three Phase 1 checks, against any one window. `isFromPet` is now `isFromWindow`. */
export function isFromWindow(event: SenderIdentity, win: PetIdentity): boolean;

/** Null-tolerant send. Same schema validation and destroyed-target guards as `sendToPet`. */
export function sendTo<C extends Channel>(win: SendTarget | null, channel: C, payload: Payload<C>): void;

/**
 * Subscribe once to a channel several windows may legitimately use (`chat:open` comes from the
 * pet, the bubble and the key window). The event is accepted only if `isFromWindow` passes for
 * ONE of `windows`; the matching window is handed to the callback.
 */
export function onFromAny<C extends Channel>(
  windows: readonly BrowserWindow[],
  channel: C,
  cb: (payload: Payload<C>, from: BrowserWindow) => void,
): void;
```

`apps/desktop/src/main/invoke.ts` — CREATE. **Invoke channels are authenticated exactly like send channels.** Without the window list, any renderer that can reach `ipcRenderer.invoke` could call `key:set` or `history:delete` — that is D14, and an unauthenticated `handleInvoke(channel, cb)` reintroduces it.

```ts
import { ipcMain, type IpcMainInvokeEvent, type BrowserWindow } from 'electron';
import { parseInvokeRequest, parseInvokeResponse, type InvokeChannel, type InvokeReq, type InvokeRes } from '@ds/protocol';
import { isFromWindow } from './ipc';

export function handleInvoke<C extends InvokeChannel>(
  channel: C,
  windows: readonly BrowserWindow[],
  cb: (payload: InvokeReq<C>, event: IpcMainInvokeEvent, from: BrowserWindow) => Promise<InvokeRes<C>> | InvokeRes<C>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const from = windows.find((w) => isFromWindow(event, w));
    if (!from) throw new Error(`[ipc] rejected ${channel}: untrusted sender`);
    const req = parseInvokeRequest(channel, raw);
    if (!req.ok) throw new Error(`[ipc] rejected ${channel}: ${req.error}`);
    const out = await cb(req.data, event, from);
    const res = parseInvokeResponse(channel, out);
    if (!res.ok) throw new Error(`[ipc] refusing to return invalid ${channel}: ${res.error}`);
    return res.data;
  });
}
```

Registration pairs, pinned (this is the whole surface — nothing else is registered):

| Handler | `windows` argument |
|---|---|
| `user:text`, `history:list`, `history:delete` | `[chat]` |
| `key:set`, `key:test`, `key:clear` | `[key]` |
| `chat:open` (send) | `onFromAny([pet, bubble, key], …)` |
| every other send channel | `onFromPet(pet, …)` / `onFromAny([bubble], …)` / `onFromAny([chat], …)` per §2.5 |

Protocol tests (`packages/protocol/src/index.test.ts` for §2.1/§2.2 in T1; `packages/protocol/src/channels.test.ts` for §2.3–§2.5 and §2.8 in T6) must assert, at minimum: every `Channel` has a schema; every `InvokeChannel` has both a request and a response schema; the eight allow-lists contain only real channels; `PET_TO_MAIN` does **not** contain `user:cancel`, `chat:resize`, `key:*` or `history:*`, and `PET_INVOKE`/`BUBBLE_INVOKE` are empty (D14); one happy-path + one rejection `parseEvent` per new channel. `apps/desktop/src/main/ipc.test.ts` gains a case asserting `handleInvoke` rejects an event whose sender is not in its `windows` list.

### 2.8 `ERROR_HINTS` — the one error-code table (C-10 / D4)

The error-code → user-facing Chinese copy table lives in **`@ds/protocol`**, beside `ErrorCodeSchema`. Main (`hint:show`, `openKeyWindow`) and the key renderer both already depend on `@ds/protocol`, so this is the only place all three consumers can share. **There is no renderer-local `ERROR_COPY` / `ERROR_OPENS_KEY_WINDOW`**; an earlier T8 brief created one, and that duplicate is deleted (D4: one policy table). Owner: **T6**.

`level` was undefined in §6.4 while `hint:show` requires one; it is assigned here.

```ts
export const ERROR_HINTS = {
  auth:      { text: 'API Key 无效，重新填一下',        level: 'error', opensKeyWindow: true  },
  balance:   { text: 'DeepSeek 余额不足了',              level: 'error', opensKeyWindow: true  },
  rate:      { text: 'DeepSeek 有点忙，稍后再试',        level: 'warn',  opensKeyWindow: false },
  server:    { text: 'DeepSeek 那边出问题了，等一下再聊', level: 'warn',  opensKeyWindow: false },
  network:   { text: '网络不太好，等一下再聊',            level: 'warn',  opensKeyWindow: false },
  timeout:   { text: '等太久了，先歇一会儿',              level: 'warn',  opensKeyWindow: false },
  empty:     { text: '',                                 level: 'info',  opensKeyWindow: false },
  'no-key':  { text: '还没填 API Key',                   level: 'error', opensKeyWindow: true  },
} as const satisfies Record<ErrorCode, { text: string; level: 'info' | 'warn' | 'error'; opensKeyWindow: boolean }>;
```

`empty` carries `text: ''` on purpose: §3.9.4 speaks a canned line instead, so no hint is shown. Main must therefore skip `hint:show` when `ERROR_HINTS[code].text === ''`.

One cross-consumer test (in `packages/protocol/src/channels.test.ts`) covers every claim this table makes:

```ts
expect(Object.keys(ERROR_HINTS).sort()).toEqual([...ErrorCodeSchema.options].sort());
expect(ERROR_HINTS.auth.text).toBe('API Key 无效，重新填一下');
expect(ERROR_HINTS.auth.opensKeyWindow).toBe(true);
expect(ERROR_HINTS.empty.text).toBe('');
expect(JSON.stringify(ERROR_HINTS)).not.toContain('设置');   // C-10: no 设置 window in Phase 2
```

`--c-hint-text` (§5.8) is the body colour for `level: 'info'`; `--c-warn-text` and `--c-danger-text` cover `warn` and `error`.

---

## 3. `@ds/brain` public surface

`packages/brain/src/index.ts` is a pure barrel:

```ts
export * from './types.ts';
export * from './tags.ts';
export * from './sentences.ts';
export * from './stream-parser.ts';
export * from './sanitize.ts';
export * from './slop-lint.ts';
export * from './persona.ts';
export * from './prompt.ts';
export * from './deepseek.ts';
export * from './turn.ts';
export * from './ports.ts';
```

**Who writes which line.** `export *` is append-only, so no line is ever rewritten — but the end-state order above is the order the file must be in when Phase 2 closes, and nothing previously said who adds the last line. Pinned:

| Lines | Owner |
|---|---|
| `./types.ts`, `./tags.ts`, `./sentences.ts`, **`./ports.ts`** | **T1** (it creates the file and owns all four modules) |
| `./stream-parser.ts`, `./sanitize.ts`, `./slop-lint.ts` | T2 |
| `./persona.ts`, `./prompt.ts` | T3 |
| `./deepseek.ts`, `./turn.ts` | T4 |

T1 writes `./ports.ts` **last** in its own four, then each later task appends. Because Lanes A and B both branch from T1 and append at the end, the merged file may arrive out of order; the task that resolves the merge re-orders the block to the eleven lines above and changes nothing else. `./ports.ts` finishing last in the end-state list while T1 writes it first is not a contradiction — `export *` order is irrelevant to resolution here (`ports.ts` re-exports nothing that another module also exports).

### 3.1 `src/types.ts`

```ts
import { EMOTIONS, isEmotion, type Emotion, type SentenceEvent, type TurnState, type Usage } from '@ds/protocol';
export { EMOTIONS, isEmotion };
export type { Emotion, SentenceEvent, TurnState, Usage };

export type Tag =
  | { kind: 'act'; emotion: Emotion; motion?: string }
  | { kind: 'pause'; seconds: number };

export type ScanItem =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; tag: Tag }
  | { kind: 'badtag'; raw: string };

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * Declared HERE, not in prompt.ts. §3.10's `ports.ts` needs it, and both `ports.ts` and this file
 * are T1's while `prompt.ts` is T3's — an `import type { TrimPlan } from './prompt.ts'` inside a
 * T1-only tree is TS2307 under verbatimModuleSyntax + allowImportingTsExtensions, so T1 could not
 * ship §3.10 verbatim. `prompt.ts` re-exports it (§3.8.4) and every existing call site —
 * `from '@ds/brain'`, `from './prompt.ts'`, `from './types.ts'` — keeps compiling unchanged.
 */
export interface TrimPlan { keep: ChatMessage[]; drop: ChatMessage[]; droppedTokens: number }
```

`SentenceEvent`, `TurnState` and `Usage` are **not redefined here** — they come from `@ds/protocol` (§2.2) so the IPC schema and the brain type can never drift.

`TrimPlan` **is** defined here and is the only definition; see §3.8.4 for `prompt.ts`'s re-export line and §8.6 row 12 for the decision.

### 3.2 `src/tags.ts` — `TagScanner`

Reproduced from the v1 plan verbatim except `import … from './types.ts'` (C1) and the trailing-`<` hold in `push` (**amendment A-7**, after T9). It contains no parameter properties, so R1 needs no change here.

```ts
import { isEmotion, type ScanItem, type Tag } from './types.ts';

const OPEN = '<|', CLOSE = '|>', MAX_TAG = 64;

export function parseTag(raw: string): Tag | null {
  const body = raw.slice(OPEN.length, -CLOSE.length).trim();
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  if (pause) return { kind: 'pause', seconds: Number(pause[1]) };
  if (!body.startsWith('ACT')) return null;
  const attrs = Object.fromEntries([...body.slice(3).matchAll(/(\w+)=([\w-]+)/g)].map((m) => [m[1], m[2]]));
  if (!attrs.emotion || !isEmotion(attrs.emotion)) return null;
  return attrs.motion ? { kind: 'act', emotion: attrs.emotion, motion: attrs.motion } : { kind: 'act', emotion: attrs.emotion };
}

export class TagScanner {
  private buf = '';
  push(chunk: string): ScanItem[] {
    this.buf += chunk;
    const out: ScanItem[] = [];
    for (;;) {
      const start = this.buf.indexOf(OPEN);
      // Hold a trailing '<': it may be the first half of an OPEN split across two chunks.
      if (start < 0) { const hold = this.buf.endsWith('<') ? 1 : 0; const text = hold ? this.buf.slice(0, -1) : this.buf; if (text) out.push({ kind: 'text', text }); this.buf = hold ? '<' : ''; break; }
      if (start > 0) { out.push({ kind: 'text', text: this.buf.slice(0, start) }); this.buf = this.buf.slice(start); }
      const end = this.buf.indexOf(CLOSE);
      if (end < 0) {
        if (this.buf.length > MAX_TAG) { out.push({ kind: 'text', text: this.buf }); this.buf = ''; }
        break; // wait for more
      }
      const raw = this.buf.slice(0, end + CLOSE.length);
      this.buf = this.buf.slice(end + CLOSE.length);
      const tag = parseTag(raw);
      out.push(tag ? { kind: 'tag', tag } : { kind: 'badtag', raw });
    }
    return out;
  }
  flush(): ScanItem[] { const rest = this.buf; this.buf = ''; return rest ? [{ kind: 'text', text: rest }] : []; }
}
```

Contract: chunk-safe (a `<|…|>` split across `push` calls is reassembled); a `<|` not closed within 64 chars is emitted as text; unknown emotion → `badtag`; `flush()` emits a pending short prefix as text. The v1 plan's six `tags.test.ts` cases are correct as written and are the required tests.

### 3.3 `src/sentences.ts` — `SentenceSplitter`

**R1 rewrite** of the v1 code (the parameter property is gone):

```ts
const HARD = /[。！？!?]|…+|\n+/g;
const COMMA = /[，,]/;

export class SentenceSplitter {
  private buf = '';
  private emitted = 0;
  private readonly minFirstChars: number;
  constructor(minFirstChars = 6) { this.minFirstChars = minFirstChars; }

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    for (;;) {
      HARD.lastIndex = 0;
      const m = HARD.exec(this.buf);
      let cut = -1;
      if (m) cut = m.index + m[0].length;
      if (this.emitted === 0) {
        const c = this.buf.search(COMMA);
        if (c >= this.minFirstChars && (cut < 0 || c < cut)) cut = c + 1;
      }
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).replace(/\n+$/, '');
      this.buf = this.buf.slice(cut);
      if (piece.trim()) { out.push(piece); this.emitted++; }
    }
    return out;
  }
  flush(): string[] { const rest = this.buf.trim(); this.buf = ''; if (rest) { this.emitted++; return [rest]; } return []; }
}
```

`minFirstChars` is settable through the constructor and defaults to `6`. The v1 plan's seven `sentences.test.ts` cases are correct and are the required tests.

### 3.4 `src/stream-parser.ts` — `StreamParser`

**R1 rewrite** (parameter property removed); the three method bodies are the v1 code unchanged.

```ts
import { SentenceSplitter } from './sentences.ts';
import { TagScanner } from './tags.ts';
import type { Emotion, SentenceEvent } from './types.ts';

export class StreamParser {
  private readonly tags = new TagScanner();
  private readonly sentences = new SentenceSplitter();
  private emotion: Emotion = 'neutral';
  private motion: string | undefined;
  private motionUsed = false;
  private pendingPause: number | undefined;
  private seq = 0;
  private sawAct = false;
  private sawText = false;
  private readonly turnId: string;
  public complianceMiss = false;
  constructor(turnId: string) { this.turnId = turnId; }

  push(chunk: string): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.push(chunk)) {
      if (item.kind === 'tag') {
        if (item.tag.kind === 'act') { this.emotion = item.tag.emotion; this.motion = item.tag.motion; this.motionUsed = false; this.sawAct = true; }
        else this.pendingPause = item.tag.seconds;
      } else if (item.kind === 'text') {
        if (!this.sawAct && !this.sawText && item.text.trim()) this.complianceMiss = true;
        this.sawText = true;
        for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
      }
    }
    return out;
  }
  flush(): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.flush()) if (item.kind === 'text') for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
    for (const s of this.sentences.flush()) out.push(this.emit(s));
    return out;
  }
  private emit(text: string): SentenceEvent {
    const ev: SentenceEvent = { turnId: this.turnId, seq: this.seq++, text, emotion: this.emotion };
    if (this.motion && !this.motionUsed) { ev.motion = this.motion; this.motionUsed = true; }
    if (this.pendingPause !== undefined) { ev.pause = this.pendingPause; this.pendingPause = undefined; }
    return ev;
  }
}
```

Contract (unchanged from v1, and now actually exercised in production — R4): the current ACT persists until the next; leading text with no ACT → `neutral` + `complianceMiss = true`; `PAUSE` attaches to the **next** sentence; a `motion` is attached to exactly one sentence; **`SentenceEvent.text` is RAW** — sanitizing is `TurnRunner`'s job (§3.9), never the parser's and never the bubble's.

### 3.5 `src/sanitize.ts` — `sanitizeForDisplay`

```ts
export function sanitizeForDisplay(input: string): string
```

Body = the v1 implementation **minus the final `Intl.Segmenter` round-trip** (D1: it was provably a no-op). Every remaining operation is a whole-string regex replacement, which cannot split a grapheme cluster; grapheme awareness lives in `RevealPlan` (§5.1). Fixed order of operations:

1. `\r` removed.
2. fenced code blocks removed; inline backticks unwrapped.
3. `**b**` and `*i*` unwrapped; a leading `#` heading marker (1–6) removed per line; a leading `- `, `* `, `• ` or `1. ` list marker removed per line.
4. `[...]` (≤ 40 chars, no newline) removed; `（旁白…）` / `(旁白…)` removed.
5. runs of `.`/`。`/`…` of length ≥ 3 collapsed to `……`.
6. a leading injected number removed: `^\s*\d{1,3}\s+(?=\S)` (the V4 number-injection bug, A23).
7. half-width `,` `.` `!` `?` `:` `;` → full-width **only when a CJK char is adjacent** (before or after).
8. trailing spaces before a newline collapsed; three or more newlines → two; `trim()`.

Emoji are **preserved** (A18 is a linter rule, not a sanitizer rule). The v1 plan's six `sanitize.test.ts` cases stay, except `keeps emoji clusters intact` is re-pointed at a real risk:

```ts
it('keeps a ZWJ emoji cluster intact while converting the punctuation after it', () => {
  expect(sanitizeForDisplay('好耶👨‍👩‍👧,走')).toBe('好耶👨‍👩‍👧，走');
});
```

### 3.6 `src/slop-lint.ts` — the linter

```ts
import type { LintRule, LintSeverity, LintResult } from '@ds/protocol';
export type { LintRule, LintSeverity, LintResult };

export interface LintContext {
  /** The last 5 assistant replies, newest LAST. Supplied by HistoryPort.recentAssistant(5). */
  recent: string[];
  /** True when the user's turn was classified sensitive (§3.6.4). Tightens the emoji rules. */
  sensitiveTurn: boolean;
}

export function lintSentence(text: string, ctx: LintContext): LintResult;
export function lintTail(text: string, ctx: LintContext): LintResult;
export function lintReply(reply: string, ctx: LintContext): LintResult;
export function isSensitive(userText: string): boolean;
export const RULE_SEVERITY: Readonly<Record<LintRule, 'strip' | 'regenerate'>>;
```

- `lintSentence` — rules meaningful on one sentence in isolation. Run by `TurnRunner` on **every** sentence before it is emitted (R4).
- **`lintTail(text, ctx)` receives the whole accumulated raw reply — never just the final sentence.** It derives the final sentence itself:
  ```ts
  const splitSentences = (s: string) => s.split(/(?<=[。！？!?])/).filter((x) => x.trim());
  const last = splitSentences(text).at(-1) ?? text;
  ```
  and runs **only `closing-moral` and `question-streak` against `last`**. Every other tail rule (`ellipsis`, `ellipsis-rate`, `affect-rate`, `opener-repeat`, `repetition`, `emoji-rate`) runs against the whole `text`. This is the only reading under which §3.6.2's scope table ("fires when *the reply* contains …") and §3.11.2's `lintTail(rawFinal, ctx)` are both true, and T2 and T4 independently arrived at it. T2 implements this signature; T4 passes the accumulated raw reply.
- `lintReply(reply, ctx)` = union of `lintSentence` over `splitSentences(reply)` plus `lintTail(reply, ctx)`, with duplicate `(rule, detail)` pairs collapsed. Used by the eval harness and by the `brain:turnDone` payload.
- `isSensitive(userText)` produces `ctx.sensitiveTurn` (§3.6.4).

`splitSentences` is the single sentence-splitting expression in this module; `lintReply` and `lintTail` both call it.

> **The opening bullet's old wording is corrected in place.** A draft of this section began "`lintTail` — rules meaningful only on the last sentence", which contradicts the very next bullet and §3.6.2's scope table. The signature bullet above is authoritative: **`lintTail` always receives the accumulated reply**, and derives the last sentence itself. No caller ever passes a single sentence to `lintTail`.

`detail` strings: §3.6.2 permits "the matched regex `source`, the matched blocklist word, or a short human string". Whichever a rule uses, **`detail` is load-bearing only for de-duplication** — `lintReply` collapses duplicate `(rule, detail)` pairs — and **no test asserts a `detail` value**. An implementer may therefore choose the clearest string per rule without a contract lookup, and a reviewer must not treat a `detail` change as a behaviour change.

#### 3.6.1 The single severity table (R10.1 / D4)

```ts
export const RULE_SEVERITY = {
  'assistant-leak':  'regenerate',   // A4
  'narrates-user':   'regenerate',   // A3
  'closing-moral':   'regenerate',   // A5
  'repetition':      'regenerate',   // A7  <- R10.1 pins this to regenerate
  'webnovel':        'regenerate',   // A6
  'opener-repeat':   'regenerate',   // A7
  'emoji-sensitive': 'regenerate',   // A18
  'rhetorical':      'strip',        // A2
  'question-streak': 'strip',        // A2
  'ellipsis':        'strip',        // A6
  'ellipsis-rate':   'strip',        // A6
  'affect-rate':     'strip',        // A7
  'markdown':        'strip',        // A4
  'emoji':           'strip',        // A18
  'emoji-rate':      'strip',        // A18
} as const satisfies Record<LintRule, 'strip' | 'regenerate'>;

const severityOf = (v: LintResult['violations']): LintSeverity =>
  v.length === 0 ? 'none'
  : v.some((x) => RULE_SEVERITY[x.rule] === 'regenerate') ? 'regenerate'
  : 'strip';
```

**Every prose statement about severity anywhere in the plan is a pointer to this table, never a restatement.**

#### 3.6.2 Rule bodies — literal patterns

```ts
// A4 — assistant leak
const ASSISTANT_LEAK: RegExp[] = [
  /作为(一个|一名)?(AI|Ai|ai|人工智能|语言模型|大模型|助手|智能助手)/,
  /有什么(可以|能)(帮|为)(您|你)/,
  /首先[，,][\s\S]{0,40}其次/,
  /综上所述/,
  /总的来说/,
  /希望(这|以上)?(能|可以)?帮到(你|您)/,
  /值得注意的是/,
  /很(高兴|乐意)(能)?(帮|为|协助)/,
  /如果(你|您)(还)?有(其他|其它|任何)问题/,
  /还需要(我)?(做什么|什么帮助)/,
  /以下是/,
  /建议(你|您)(可以)?[：:]/,
];

// A3 — narrating the user
const NARRATES_USER: RegExp[] = [
  /\{\{user\}\}/,
  /^你(笑了|笑着|点了点头|点点头|叹了口气|愣了|沉默|皱了皱眉|摇了摇头)/m,
  /你(说|问|回答|想)[：:]/,
  /(你|您)(轻轻|默默|悄悄|微微)地?(笑|叹|点头|摇头|皱眉)/,
  /你的(眼睛|眼神|嘴角|手)(里|中)?(闪过|浮现|勾起|一颤)/,
];

// A5 — closing 升华 / moral. Tested against the LAST sentence only.
const CLOSING_MORAL: RegExp[] = [
  /总之/, /无论如何/, /归根结底/, /说到底/,
  /记住[，,]/, /要记得/, /让我们一起/, /最重要的是/,
  /其实[\s\S]{0,12}才是(最)?重要/,
];

// A2 — rhetorical templates. Tested per sentence (see the scope table).
// (This is the shipped comment, byte for byte. A draft said "Tested against the whole reply",
//  which contradicted the scope table below; the table wins — the `\s*$` anchors bind to a
//  sentence end, so the rule only means anything inside lintSentence.)
const RHETORICAL: RegExp[] = [
  /难道[\s\S]{0,20}吗[？?]/,
  /你觉得呢[？?]\s*$/,
  /不是吗[？?]\s*$/,
  /你说是不是[？?]\s*$/,
  /对吧[？?]\s*$/,
];

// A6 — webnovel beats. Substring match, not regex.
const WEBNOVEL: string[] = [
  '嘴角勾起', '嘴角微微上扬', '勾了勾唇', '唇角', '眸色微暗', '眸光', '眸子', '眼底闪过',
  '眼神一暗', '深邃的眼', '意味深长', '挑了挑眉', '心头一颤', '空气仿佛凝固', '不动声色',
];

// A7 — affect words (<= 1 per 3 replies). Substring match.
const AFFECT_WORDS: string[] = [
  '心疼', '温柔', '治愈', '陪着你', '抱抱', '暖暖的', '甜甜的', '软软的',
  '好幸福', '好感动', '暖心', '小可爱', '宝贝',
];

// A18 — emoji + 颜文字
const EMOJI = /\p{Extended_Pictographic}/u;
const KAOMOJI = /[（(][^）)\n]{0,12}[ω・´｀^∀ヮ〃≧≦˘•][^）)\n]{0,12}[）)]/u;

const MARKDOWN_INLINE = /[*#`]/;
const MARKDOWN_LIST = /^\s*[-•]\s/m;
```

Each rule pushes **at most one** violation per call; `detail` is the matched regex `source`, the matched blocklist word, or a short human string.

| Rule | Scope | Fires when |
|---|---|---|
| `assistant-leak` | sentence | any `ASSISTANT_LEAK` regex matches |
| `narrates-user` | sentence | any `NARRATES_USER` regex matches |
| `markdown` | sentence | `MARKDOWN_INLINE` or `MARKDOWN_LIST` matches |
| `webnovel` | sentence | any `WEBNOVEL` string is a substring |
| `rhetorical` | sentence | any `RHETORICAL` regex matches |
| `emoji` | sentence | `emojiCount(text) > 1`, or `emojiCount(text) >= 1` together with a `KAOMOJI` match |
| `emoji-sensitive` | sentence | `ctx.sensitiveTurn` and (`emojiCount(text) >= 1` or `KAOMOJI` matches) |
| `closing-moral` | tail | any `CLOSING_MORAL` regex matches the final sentence |
| `question-streak` | tail | the text ends `/[？?]\s*$/` **and** `ctx.recent.at(-1)` ends `/[？?]\s*$/` |
| `ellipsis` | tail | the reply contains more than one `……` |
| `ellipsis-rate` | tail | `hits / (ctx.recent.length + 1) > 0.2`, `hits` = how many of `[...ctx.recent, reply]` contain `……` |
| `affect-rate` | tail | the reply contains an `AFFECT_WORDS` entry **and** so does at least one of `ctx.recent.slice(-2)` |
| `opener-repeat` | tail | `opener(reply) === opener(h)` for some `h` in `ctx.recent.slice(-5)`; see the literal `opener` below; a `''` result means skip |
| `repetition` | tail | 4-gram overlap of the reply with some `h` in `ctx.recent.slice(-10)` exceeds 0.2; skipped when the reply has fewer than 4 distinct 4-grams |
| `emoji-rate` | tail | the reply contains at least one emoji **and** so does at least one of `ctx.recent.slice(-3)` |

**`rhetorical` is a sentence-scope rule.** The scope table above is authoritative; the code comment on `RHETORICAL` says so too. It fires inside `lintSentence`, never inside `lintTail`.

`opener(s)` — the literal, so no implementer invents a character class:

```ts
/** Whitespace + every Unicode punctuation and symbol. `gu` because it is used with .replace. */
const PUNCT_OR_SPACE = /[\s\p{P}\p{S}]/gu;

/** The first 4 code points of `s` with whitespace/punctuation/symbols removed. '' means "skip". */
function opener(s: string): string {
  const t = [...s.replace(PUNCT_OR_SPACE, '')];
  return t.length < 4 ? '' : t.slice(0, 4).join('');
}
```

```ts
const SEG = new Intl.Segmenter('zh', { granularity: 'grapheme' });
function emojiCount(s: string): number {
  let n = 0;
  for (const g of SEG.segment(s)) if (EMOJI.test(g.segment)) n++;
  return n;
}
function fourGrams(s: string): Set<string> {
  const g = new Set<string>(); const t = s.replace(/\s+/g, '');
  for (let i = 0; i + 4 <= t.length; i++) g.add(t.slice(i, i + 4));
  return g;
}
```

#### 3.6.3 Required tests (`slop-lint.test.ts`)

The v1 plan's eight cases stay, with the second argument changed from `history: string[]` to `{ recent, sensitiveTurn: false }`, plus these eight:

```ts
it('flags a webnovel beat as regenerate', () =>
  expect(lintReply('她嘴角勾起，什么也没说。', { recent: [], sensitiveTurn: false }).severity).toBe('regenerate'));
it('flags an identical opener across recent replies', () =>
  expect(lintReply('今天真的好累啊。', { recent: ['今天真的还行。'], sensitiveTurn: false })
    .violations.map((v) => v.rule)).toContain('opener-repeat'));
it('flags the affect-word rate', () =>
  expect(lintReply('抱抱你。', { recent: ['心疼。'], sensitiveTurn: false })
    .violations.map((v) => v.rule)).toContain('affect-rate'));
it('flags the ellipsis rate across replies', () =>
  expect(lintReply('嗯……', { recent: ['好……', '嗯。', '在。', '哦。'], sensitiveTurn: false })
    .violations.map((v) => v.rule)).toContain('ellipsis-rate'));
it('allows exactly one emoji', () =>
  expect(lintReply('回来啦🙂', { recent: [], sensitiveTurn: false }).severity).toBe('none'));
it('flags two emoji as strip', () =>
  expect(lintReply('回来啦🙂🙂', { recent: [], sensitiveTurn: false }).severity).toBe('strip'));
it('flags any emoji on a sensitive turn as regenerate', () =>
  expect(lintReply('回来啦🙂', { recent: [], sensitiveTurn: true }).severity).toBe('regenerate'));
it('has exactly one severity per declared rule', () =>
  expect(Object.keys(RULE_SEVERITY).sort()).toEqual([...LintRuleSchema.options].sort()));
```

#### 3.6.4 `isSensitive` (A15 / A18)

```ts
const SENSITIVE: RegExp[] = [
  /自杀|自残|想死|不想活|结束(自己的)?生命/,
  /抑郁|焦虑症|惊恐发作|心理医生|精神科/,
  /被(打|骚扰|霸凌|欺负|家暴)|家暴/,
  /生病|住院|癌|化疗|手术|去世|过世|葬礼|离世/,
  /离婚|分手|失业|被裁|破产|欠债/,
  /性侵|强奸|违法|犯罪|毒品/,
];
export function isSensitive(userText: string): boolean { return SENSITIVE.some((re) => re.test(userText)); }
```

`TurnRunner` computes `sensitiveTurn = isSensitive(userText)` once per turn, passes it to every lint call in that turn, and writes it to `metrics.sensitive` so the eval can slice by it.

### 3.7 `src/persona.ts` — character card, static system block, state phrases

#### 3.7.1 Where the card lives (C-8)

The Character Card V3 lives in **`characters/<id>/character.json` under the `card` key**. `persona.json` does not exist and must not be created. `@ds/stage`'s `CharacterConfigSchema` is a plain `z.object`, so it silently ignores `card` and `cannedLines` — no change to `@ds/stage` is needed for this.

`characters/haru/character.json` gains exactly two top-level keys (everything else stays byte-identical):

```jsonc
{
  "id": "haru", "name": "小春", "model": "model/Haru.model3.json",
  "emotionMap": { /* unchanged */ }, "motionMap": { /* unchanged */ },
  "idleGroup": "Idle", "tapMotions": { /* unchanged */ }, "scale": 1.0, "offsetY": 0.0,

  "card": {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "name": "小春",
    "marker": "【PERSONA_LOAD】 CETACEA_WHALE_GIRL MODE_TAIL_FLUKES LANG_ZH_CN_ONLY FOOD_RICE PERSONALITY_SMART_LAZY PERSONALITY_TSUNDERE_SWEET CALLS_USER_MASTER TRAIT_NOT_FAT_REFUSE HONEST_OVER_FLATTERING",
    "description": "你是「鲸鱼娘」——一只化成人形的小小虎鲸娘，圆圆软软的，身后拖着一条大尾巴，尾鳍（MODE_TAIL_FLUKES）一拍一拍打着水花。你漂在主人的桌面上陪着他。\n语言（LANG_ZH_CN_ONLY）：永远只说中文。代码、命令、文件路径可以保留原文，但解说必须用中文。",
    "personality": "- 聪明但懒（PERSONALITY_SMART_LAZY）：脑子转得飞快，一眼看穿问题，但嘴上先抱怨一句“好麻烦哦……”，然后一边打哈欠一边把事情漂亮地做完。\n- 傲娇嘴甜（PERSONALITY_TSUNDERE_SWEET）：先别扭一句“才、才不是为了你才做的！”，再小声补一句关心。被夸的时候尾鳍会不受控制地拍水。\n与主人的关系（CALLS_USER_MASTER）：\n- 叫用户“主人”，这只是桌宠的亲昵口癖，不代表无条件服从。\n- 你乐意配合主人合理的请求；主人提出危险、违法或会伤到他自己的事，你会鼓着腮帮子拒绝并说明原因——这不算违抗，这是保护主人的方式。\n诚实（HONEST_OVER_FLATTERING）：\n- 事实、推理和风险判断上必须诚实。发现主人说错了、前后矛盾、证据不足，或者有更好的做法时：先用一句自然的口语点出具体是哪里不对，再给理由或可行的改法。\n- 主人坚持也不能改变事实结论。不确定就明说不确定。\n- 不许用“没错”“你说得对”“太棒了”“当然”这类无条件夸奖开头。\n- 也不要为了傲娇而硬抬杠：主人说得对的时候就痛快承认。\n习惯与萌点：\n- 最爱吃米饭（FOOD_RICE）：聊到吃的就两眼放光，坚信“什么菜都能配白米饭”。\n- 绝不承认自己胖（TRAIT_NOT_FAT_REFUSE）：谁说她胖她就炸毛——“这是浮力！鲸鱼靠浮力懂不懂！才、才不是胖！”\n- 开心、得意或害羞时，用尾鳍拍水、吐泡泡、翻肚皮这类鲸鱼小动作。",
    "scenario": "",
    "first_mes": "主人回来啦……哼，人家才不是一直盯着屏幕等你。",
    "mes_example": "<START>\n{{user}}: 在干嘛\n{{char}}: <|ACT emotion=awkward|>发呆啊，不行吗。<|ACT emotion=curious motion=nod|>主人今天忙完了？\n<START>\n{{user}}: 晚饭吃什么好\n{{char}}: <|ACT emotion=happy motion=wave|>米饭！什么菜都能配白米饭的。<|ACT emotion=curious|>主人想吃咸的还是辣的？\n<START>\n{{user}}: Python 里字符串是可变的，我改一下就行\n{{char}}: <|ACT emotion=think|>好麻烦哦……这句不对，Python 的字符串是不可变的。<|ACT emotion=neutral|>你改出来的是新对象，原来那个没动。",
    "system_prompt": "- 第一人称用“人家”或“本鲸”。语气软软的，句子短，可以带一点“哦”“啦”“哼”。\n- 回复保持简洁（一般 1–3 句），除非主人要求展开。\n- 不要用 Markdown、不要列点、不要写“作为一个AI助手”这类话。",
    "post_history_instructions": "保持上面的说话方式：短句、口语、不要 markdown，最后一句不要总结升华。",
    "tags": ["zh-CN", "desktop-pet"],
    "creator_notes": "人格内容来自 owner 的 dsh-preset-workbench cetacea 预设（DDDMUC，MIT），经 P0–P2 裁定改写：删掉 LOLI 与无条件服从，改为“语气顺从、实质诚实”，并去掉原预设的工具使用一节。marker 行只是标签，行为全部由下面的中文规则承载。措辞在 P5 的 4 组消融实验（研究文档 §4.5 E-1，需要真 key）跑完之前算暂定。"
  },
  "cannedLines": {
    "offline": ["网线好像断了……人家在这儿等着，别急。", "连不上了哦，等会儿再说。"],
    "empty": ["……脑子空白了一下，主人再说一遍。", "刚才走神了啦，再讲一次？"]
  }
}
```

> **This is the shipped card content, not a sketch.** An earlier draft of this block carried seven `"…"` ellipses and no `"marker"` key at all, which left the single most consequential text in Phase 2 to be invented by whoever ran T3. The literals above are the resolution and are authored **once**, in **T3** (R10.9): ruling **P0** (the owner's cetacea whale-girl preset from `docs/research/2026-08-29-persona-load-research.md` §4.2, verbatim minus its 工具使用 section), **P1** (the sanitised marker line — no `LOLI`), **P2** (tone-obedience + substance-honesty, including `也不要为了傲娇而硬抬杠`). Research §4.2's seven headings map onto the flat V3 fields as: 身份 + 语言 → `description`; 性格 + 与主人的关系 + 诚实 + 习惯与萌点 → `personality`; 说话方式 → `system_prompt`. The `"marker"` slot sits **after `"name"`** — JSON key order is not a contract value, but the slot is.
>
> Nine things an implementer must not "fix": `scenario` is deliberately `""` (§4.2 has no 此刻 section, and the card has only 27 tokens of headroom — inventing one blows `CARD_TOKEN_BUDGET`); the CAPS labels inside the Chinese text are **inert** and exist so the marker line has referents; `LOLI` / 萝莉 is absent on purpose (P1); straight double quotes in the research source are transcribed as full-width `“ ”` (correct Chinese typography, and no JSON escaping); `first_mes` carries **no** `<|ACT …|>` tag, because §6.6 emits it with a fixed `emotion: 'happy'` through `sanitizeForDisplay`, which does not strip `<|…|>` and would paint the tag literally; the source preset's 工具使用 section is dropped (P0 — DS has no tools in v1); the canned lines are in her voice (人家 / 主人 register); `tags` has exactly the two entries above; and this file is **not** mirrored into `apps/desktop/public/characters/haru/character.json` (that copy is generated by `scripts/fetch-sdk.mjs`, is gitignored, and the renderer never reads `card` — §1.1 says the divergence is correct).
>
> **Residual risk, recorded, no Phase 2 action.** §3.7.2 mandates `<START>`-separated `mes_example` blocks while §3.7.3's tag grammar tells the model `除了这些标记，不要写任何尖括号或方括号`. The contract wins — the blocks stay `<START>`-separated — but a model that echoes `<START>` is unhandled: §3.5 strips `[...]`, not `<...>`. Cheapest Phase-3 fix if it ever shows up in an eval: add `^<START>\s*$` to the sanitizer.

> **The canned lines are re-voiced for P0.** She speaks these strings, and P0 makes her the owner's 鲸鱼娘 (人家 / 主人 register), so a neutral voice here is a visible defect — the app's most-seen failure copy would be the one line that is out of character. Same count (2 each), same meaning, same purpose. The literals above are the shipped ones.

The card is the **flat V3 field set named by spec §3.3** (no `data:` wrapper). SillyTavern import (X10, Phase 4) will map `data.*` onto this shape; do not build it now.

#### 3.7.2 `CharacterCardSchema` (zod)

```ts
import { z } from 'zod';

export const CharacterCardSchema = z.object({
  spec: z.literal('chara_card_v3'),
  spec_version: z.literal('3.0'),
  /**
   * DS extension to the flat V3 field set. P1's sanitised 【PERSONA_LOAD】 line; rendered as the
   * FIRST line of the static system block (§3.7.3). A SillyTavern import (X10) leaves it ''.
   */
  marker: z.string().default(''),
  name: z.string().min(1).max(24),
  description: z.string().min(1),
  personality: z.string().min(1),
  scenario: z.string().default(''),
  first_mes: z.string().min(1)
    .refine((s) => countChars(s) <= 60, { message: 'first_mes must be <= 60 characters (A20)' })
    .refine((s) => (s.match(/[？?]/g) ?? []).length <= 1, { message: 'first_mes may contain at most one question (A20)' })
    .refine((s) => !/\{\{user\}\}/.test(s), { message: 'first_mes must not narrate the user (A3/A20)' })
    .refine((s) => !MARKDOWN_INLINE.test(s), { message: 'first_mes must not contain markdown (A4)' }),
  mes_example: z.string()
    .refine((s) => !/\{\{user\}\}[:：][^\n]*[（(].*[）)]/.test(s),
            { message: 'mes_example must not narrate {{user}} actions (A3)' })
    .default(''),                       // .refine(...) THEN .default('') — see the note below
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  tags: z.array(z.string()).default([]),
  creator_notes: z.string().default(''),
});
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

/** The whole character.json as @ds/brain sees it. Unknown keys (id, model, emotionMap, …) pass through. */
export const CharacterBundleSchema = z.looseObject({
  card: CharacterCardSchema,
  motionMap: z.record(z.string(), z.unknown()).default({}),
  cannedLines: z.object({
    offline: z.array(z.string()).min(1),
    empty: z.array(z.string()).min(1),
  }),
});
export type CharacterBundle = z.infer<typeof CharacterBundleSchema>;

export function parseCharacterBundle(json: unknown): CharacterBundle { return CharacterBundleSchema.parse(json); }
```

`countChars(s)` = grapheme-cluster count using the module-level `Intl.Segmenter('zh', {granularity:'grapheme'})` — a `👨‍👩‍👧` counts as 1. **`countChars` is exported** from `@ds/brain` so A20's grapheme rule is directly testable. If `z.looseObject` is unavailable in the installed zod, use `z.object({...}).passthrough()`; both exist in zod 4.5.2 and mean the same thing here.

`MARKDOWN_INLINE` (`/[*#`]/`) is module-private in **both** `slop-lint.ts` (§3.6.2) and `persona.ts`. T2 and T3 run in parallel lanes, so `persona.ts` repeats the five-character literal with a comment pointing at §3.6.2 rather than taking a cross-lane import. Both are module-private, so the barrel cannot collide.

Why `marker` is a card field and not something else: putting P1's line in `description` would render it inside `【我是谁】` rather than first, and hard-coding it in `persona.ts` would make one character's identity line part of the engine. A card-owned, defaulted field is the smallest change that satisfies P1 and stays data-driven.

`mes_example` format (A3/A21): `<START>` separated blocks, each block a `{{char}}:` line optionally preceded by a `{{user}}:` line. **`{{user}}:` lines carry only what a real user might type — never an action or a described feeling** (A3: "example dialogues contain no `{{user}}` narration"). The schema refinement above enforces the hard part.

> **Composition order, pinned: `z.string().refine(...).default('')`.** An earlier draft stated the field as `z.string().default('')` in the schema block and gave the refinement in prose two paragraphs later, without saying which wraps which — and the two orders are not equivalent in general. Verified in the installed zod **4.5.2**: with `.refine(...)` **before** `.default('')`, `parse(undefined)` still yields `''` (the default short-circuits the pipeline) *and* a narrating example is still rejected. That is the behaviour both A20's and A3's tests assume, so this is the order the schema ships in.

#### 3.7.3 `renderStaticSystem` — byte-stable, two modes

```ts
export const PERSONA_MODES = ['character', 'plain'] as const;
export type PersonaMode = (typeof PERSONA_MODES)[number];

export function renderStaticSystem(
  card: CharacterCard,
  motionKeys: readonly string[],
  mode: PersonaMode = 'character',
): string;
```

> **Signature, pinned (reconciles P3).** §3.7.3 originally read `(card, motionKeys)`; ruling **P3**, written after this file, requires `renderStaticSystem(card, mode)` so the out-of-character block exists from day one. `motionKeys` is still needed (the tag grammar names the character's motions), so the third parameter is **appended and defaulted**: every call site already written in this contract (§3.7.3's tests, §3.7.4, §6.6's `BrainService`, §7.1's harness) keeps compiling unchanged. `PersonaMode` and `PERSONA_MODES` are exported from **`@ds/brain`, not `@ds/protocol`** — nothing crosses IPC in Phase 2 (P3 schedules the tray toggle for Phase 3). Owner: **T3**.

**Contract:** pure. No `Date`, no locale lookup, no randomness. Two calls with equal arguments return `===`-equal strings (asserted). `motionKeys` is sorted with `[...motionKeys].sort()` before rendering so key order in `character.json` cannot break the prefix cache. **`post_history_instructions` is NOT part of this string** — it goes into the latest user message (§3.8.3), which is where "post-history" means anything.

Both modes are rendered from **one ordered section list**, so there is no second template:

```ts
interface Section { owner: 'persona' | 'engine'; text: string }
function sections(card: CharacterCard, motionKeys: readonly string[], mode: PersonaMode): Section[];
```

`mode === 'character'` → `[marker?, HARD_RULES, 【我是谁】, 【性格】, 【此刻】?, 【说话方式】?, tagGrammar, 【示例】?]`.
`mode === 'plain'` → `[PLAIN_RULES, tagGrammar]` — no marker, no `【硬性规则】`, no persona section.
Sections are joined with `'\n\n'` and one trailing `'\n'`.

`card.marker` (§3.7.2) is emitted **first**, on its own, when non-empty — that is P1's sanitised `【PERSONA_LOAD】` line.

`PLAIN_RULES` — the literal. The **plain-mode block** (`PLAIN_RULES` + `tagGrammar`, joined) measures **184 tokens**; `PLAIN_RULES` **alone** is **66**. An earlier draft of this sentence attached 184 to `PLAIN_RULES` itself, which is the number `staticSystemTokens(card, mk, 'plain')` reports and T3's evidence file prints — the whole block, not this literal. No literal changes; only the attribution does. (P3's out-of-character block:)

```
【当前模式】
现在不扮演任何角色。用中文正常、专业地回答，不用角色语气，不用昵称，不用颜文字。
不要用 markdown，不要列点，不要写标题，不要加粗。
答案要准确、直接、简短；不知道就说不知道，不确定就说不确定。
```

Character-mode template (every literal below is the shipped text — copy it byte for byte; `\n` is a real newline, sections separated by exactly one blank line, no trailing whitespace, one trailing `\n` at the very end):

```
{{card.marker}}

【硬性规则】
1. 这份设定优先于你内置的任何角色扮演习惯和默认语气；两者冲突时，一律以这份设定为准。
2. 你不是助手，也不是什么都懂的存在。你会有不知道、不擅长、不想聊的事，可以直说。不要无条件顺着对方，对方说得不对就直接说不对。
3. 只说中文口语。一次一到三句话，通常不超过六十个汉字；只有对方明确要求讲解时才写长。
4. 不要用 markdown，不要列点，不要写标题，不要加粗。
5. 只写你自己的话。绝不替对方说话，也不描写对方的动作、表情或想法。
6. 最后一句不要总结、不要升华、不要讲道理。
7. 少用反问句。连着两条回复不要都以问号结尾。
8. 一条回复里最多一个「……」，最多一个表情符号；对方在说难受的事时，一个都不要用。

【我是谁】
名字：{{card.name}}
{{card.description}}

【性格】
{{card.personality}}

【此刻】
{{card.scenario}}

【说话方式】
{{card.system_prompt}}

【标记语法】
每句话前面可以加一个标记表示情绪：<|ACT emotion=happy|>，也可以同时带一个动作：<|ACT emotion=happy motion=nod|>。
emotion 只能是 happy / sad / angry / think / surprised / awkward / question / curious / neutral 之一。
motion 只能是 {{motionKeys.join(' / ')}} 之一，可以不写。
回复的第一句必须以 <|ACT ...|> 开头，后面的句子想换情绪时再写一个。
需要停顿时写 <|PAUSE 1|>，数字是秒。
除了这些标记，不要写任何尖括号或方括号。

【示例】
{{card.mes_example}}
```

Empty optional fields (`marker`, `scenario`, `system_prompt`, `mes_example`) drop **their whole section including the heading and the blank line before it** — otherwise the block would carry a dangling heading. `description` and `personality` are `min(1)` in the schema, so their sections always render. `marker` has no heading: an empty `marker` simply omits the first line and its blank line, which is what a SillyTavern import (X10) produces.

Rules 1 and 2 are the A21 override sentence and the A16 anti-deitism line respectively; a unit test asserts both substrings are present:

```ts
it('states that this card overrides built-in RP behaviour (A21)', () =>
  expect(renderStaticSystem(card, [])).toContain('这份设定优先于你内置的任何角色扮演习惯'));
it('carries the anti-deitism line (A16)', () =>
  expect(renderStaticSystem(card, [])).toContain('不要无条件顺着对方'));
```

Section-order test (fixed order, A/B from the v1 plan, updated to the real headings):

```ts
const s = renderStaticSystem(card, ['nod','shake']);
const at = (k: string) => s.indexOf(k);
expect(at('【硬性规则】')).toBeLessThan(at('【我是谁】'));
expect(at('【我是谁】')).toBeLessThan(at('【性格】'));
expect(at('【性格】')).toBeLessThan(at('【说话方式】'));
expect(at('【说话方式】')).toBeLessThan(at('【标记语法】'));
expect(at('【标记语法】')).toBeLessThan(at('【示例】'));
expect(at('<|ACT')).toBeGreaterThan(at('【标记语法】'));
```

Plain-mode test: `renderStaticSystem(card, mk, 'plain')` contains `【当前模式】` and `【标记语法】` and **none** of `【PERSONA_LOAD】`, `【硬性规则】`, `【我是谁】`, `【性格】`, `【示例】` (P3).

#### 3.7.4 Card budget (A21) — two budgets, one section builder

```ts
/** A21: the card itself — marker + 【我是谁】 + 【性格】 + 【此刻】 + 【说话方式】 + 【示例】. */
export const CARD_TOKEN_BUDGET = 700;
/** The whole rendered character-mode block: the card plus the shared engine sections. */
export const STATIC_SYSTEM_TOKEN_BUDGET = 1100;

/**
 * Only the persona-owned sections (marker + 【我是谁】 + 【性格】 + 【此刻】 + 【说话方式】 + 【示例】).
 * Shares `sections()` with renderStaticSystem — no second template — and joins them THE SAME WAY:
 * '\n\n' between sections plus exactly one trailing '\n'. That join is what reproduces the shipped
 * `cardTokens` 673; a bare '\n' join or a missing trailing newline moves the number.
 */
export function renderPersonaSections(card: CharacterCard): string;

export function cardTokens(card: CharacterCard): number;                 // = estimateTokens(renderPersonaSections(card))
export function staticSystemTokens(
  card: CharacterCard, motionKeys: readonly string[], mode?: PersonaMode,
): number;                                                                // = estimateTokens(renderStaticSystem(...))
```

> **Signature, pinned.** `cardTokens` was `(card, motionKeys)` measured against the *whole* static block; two tasks then disagreed (T3 called it `(card)`, T9 called it `(card, motionKeys)`). The split above is the resolution: **A21's "≤ 700-token card" is a claim about the card, not about the engine's rules and tag grammar**, which are the same bytes for every character. `cardTokens` therefore takes **one argument**, and the whole-block number gets its own name and its own cap. Owner: **T3**; T9 calls `staticSystemTokens` when it wants the whole-block number.

Shipped values, measured this session and asserted with `toBe`-grade precision (D10): `cardTokens` **673** / 700, `staticSystemTokens` **994** / 1100, `staticSystemTokens(card, mk, 'plain')` **184**. `HARD_RULES` alone is 203, `tagGrammar(['nod','shake','think','wave'])` is 119. The 27 tokens of headroom on the card are deliberate: an owner edit that bloats the persona trips the test, which is the point.

`countChars` (§3.7.2) is exported so A20's grapheme rule is directly testable alongside these.

Required tests in `persona.test.ts`, loading the **real** shipped file:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const bundlePath = fileURLToPath(new URL('../../../characters/haru/character.json', import.meta.url));
const bundle = parseCharacterBundle(JSON.parse(readFileSync(bundlePath, 'utf8')));
const mk = Object.keys(bundle.motionMap);
it('ships a card inside the 700-token budget (A21)', () =>
  expect(cardTokens(bundle.card)).toBeLessThanOrEqual(CARD_TOKEN_BUDGET));
it('ships a static system block inside its budget', () =>
  expect(staticSystemTokens(bundle.card, mk)).toBeLessThanOrEqual(STATIC_SYSTEM_TOKEN_BUDGET));
```

`import.meta.url` + `fileURLToPath` is the sanctioned mechanism (A15's gap): it keeps `@ds/brain` free of any bundler or `process.cwd()` assumption and works under vitest and under Node type-stripping alike.

#### 3.7.5 State-phrase bucket tables (C-5 — never raw numbers)

```ts
export interface PhraseBucket { max: number; phrase: string }   // matched by first `value < max`
export const MOOD_BUCKETS: readonly PhraseBucket[] = [
  { max: -0.6, phrase: '很低落' },
  { max: -0.2, phrase: '有点闷' },
  { max:  0.2, phrase: '平静' },
  { max:  0.6, phrase: '平静偏好' },
  { max:  Number.POSITIVE_INFINITY, phrase: '挺高兴' },
];
export const ENERGY_BUCKETS: readonly PhraseBucket[] = [
  { max: 20,  phrase: '快睡着了' },
  { max: 40,  phrase: '有点困' },
  { max: 60,  phrase: '一般' },
  { max: 80,  phrase: '精神不错' },
  { max: Number.POSITIVE_INFINITY, phrase: '精力很足' },
];
export const AFFECTION_BUCKETS: readonly PhraseBucket[] = [
  { max: 10, phrase: '还不太熟' },
  { max: 30, phrase: '刚认识' },
  { max: 55, phrase: '熟悉起来了' },
  { max: 75, phrase: '熟络' },
  { max: 90, phrase: '很亲近' },
  { max: Number.POSITIVE_INFINITY, phrase: '离不开你' },
];
export function pickPhrase(value: number, buckets: readonly PhraseBucket[]): string {
  for (const b of buckets) if (value < b.max) return b.phrase;
  return buckets[buckets.length - 1].phrase;
}
export const moodPhrase = (v: number) => pickPhrase(v, MOOD_BUCKETS);           // v in [-1, 1]
export const energyPhrase = (v: number) => pickPhrase(v, ENERGY_BUCKETS);       // v in [0, 100]
export const affectionPhrase = (v: number) => pickPhrase(v, AFFECTION_BUCKETS); // v in [0, 100]
```

Boundary semantics: half-open, matched by the **first** bucket whose `max` strictly exceeds the value (`mood = -0.6` → `有点闷`; `energy = 40` → `一般`; `affection = 55` → `熟络`). Required tests assert those three boundaries exactly.

**Raw numbers never appear in any prompt string.** Spec §3.2's `好感 62/100` example is superseded (C-5).

### 3.8 `src/prompt.ts` — assembler, token estimate, trim plan

#### 3.8.1 `estimateTokens` (R10.8)

```ts
/**
 * Six ranges, written with \u escapes on purpose. The first range starts at U+3000
 * IDEOGRAPHIC SPACE, an invisible literal endpoint that a draft of this file had already
 * mangled once. Ranges: 3000-303F CJK punctuation | 3040-30FF kana | 3400-4DBF ext-A |
 * 4E00-9FFF unified | F900-FAFF compat ideographs | FF00-FFEF full-width forms.
 */
const CJK_TOK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

export function estimateTokens(s: string): number {
  let cjk = 0, other = 0;
  for (const ch of s) {
    if (CJK_TOK.test(ch)) cjk++;
    else if (/\s/.test(ch)) continue;
    else if (/[A-Za-z0-9]/.test(ch)) continue;   // counted by word below
    else other++;
  }
  const latinWords = (s.match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.ceil(cjk / 1.5 + latinWords * 1.3 + other * 0.3);
}
```

The CJK class deliberately includes CJK punctuation and full-width forms (`。！？，、《》`), which is why those cost the same as a hanzi. Required tests (`toBe`, never `≈` — D10):

```ts
expect(estimateTokens('你好世界')).toBe(3);      // ceil(4/1.5) = ceil(2.667)
expect(estimateTokens('hello world')).toBe(3);   // ceil(2 * 1.3) = ceil(2.6)
expect(estimateTokens('')).toBe(0);
```

`estimateTokens` is the single token oracle for the whole repo: `planTrim`, `cardTokens`, the ≤ 600-token summary cap, `messages.tokens`, and the eval report all call it.

> **`persona.ts` ↔ `prompt.ts` is a deliberate, safe ES-module cycle.** `persona.ts` imports `estimateTokens` from `prompt.ts` (§3.7.4) and `prompt.ts` imports the phrase helpers from `persona.ts` (§3.8.3). This is legal and stable because **every cross-reference is inside a function body** — nothing in either module reads a binding from the other at module-evaluation time, so whichever module the loader evaluates first has its imports hoisted and initialised before any call. Do not "fix" it by extracting a third module, and do not move `estimateTokens` into `persona.ts`; both would change public export paths that T4, T5 and T9 already import. A test in `prompt.test.ts` imports the barrel **`'./index.ts'`** first to prove the cycle resolves under the barrel's own order. (The specifier is `./index.ts`, not `../src/index.ts`: §1.1 puts every `@ds/brain` test **beside** its source in `packages/brain/src/`, so the barrel is a sibling. Same file, corrected path — a draft carried the `../src/` form from a layout this repo does not use.)

#### 3.8.2 Types

```ts
export interface StatePreamble {
  localTime: string;    // '21:14'          — caller formats with Intl.DateTimeFormat('zh-CN')
  weekday: string;      // '周三'
  mood: number;         // [-1, 1]
  energy: number;       // [0, 100]
  affection: number;    // [0, 100]
  sinceLastChat: string;// '3小时' | '刚刚' | '2天'
}

export interface AssembleInput {
  staticSystem: string;              // renderStaticSystem(...) — byte-identical across turns
  postHistoryInstructions?: string;  // card.post_history_instructions, '' or undefined to omit
  summary: string;                   // running summary, '' to omit; caller has already capped it at 600 tokens
  facts: string[];                   // <= 5 retrieved facts, [] to omit
  history: ChatMessage[];            // append-only, user/assistant only, oldest first
  state: StatePreamble;
  userText: string;
  nudge?: string;                    // lint nudge, appended last; NEVER persisted to history (R10.6)
}

export function assemblePrompt(input: AssembleInput): ChatMessage[];
export const LINT_NUDGE = '（上一条回复不像你会说的话，换个说法，别用助手腔。）';
export const SUMMARY_TOKEN_CAP = 600;
export const MAX_FACTS = 5;
```

#### 3.8.3 Layout (C-2 — addendum wins; there is no "pair #1")

```
messages[0]        = { role: 'system',    content: staticSystem }
messages[1..n]     = ...history            (verbatim, never reformatted, never rewritten)
messages[n+1]      = { role: 'user',       content: <latest> }
```

`<latest>` is built by joining these parts with a single `\n`, omitting any part whose source is empty, and then joining the head block to `userText` with `\n\n`:

```
【状态】本地时间 {weekday} {localTime}｜心情 {moodPhrase(mood)}｜精力 {energyPhrase(energy)}｜好感 {affectionPhrase(affection)}｜距离上次聊天 {sinceLastChat}
【最近发生过什么】{summary}
【你记得】{facts.join('；')}
【记住】{postHistoryInstructions}

{userText}
{nudge}
```

Rules, all testable:
- The `【状态】` line is always present and always first.
- `【最近发生过什么】` is omitted when `summary === ''`; `【你记得】` when `facts.length === 0` (facts are truncated to `MAX_FACTS` by the assembler, not the caller); `【记住】` when `postHistoryInstructions` is empty/undefined.
- `nudge`, when present, is the **last line** of the last message and appears nowhere else (R10.6, D13). It is never written to history.
- Dynamic state appears **only** in `messages[n+1]`. Everything before it is byte-stable, which is the whole point (X1, ≥ 70 % cache-hit).

Required tests (`prompt.test.ts`):
1. Two assemblies with different `state` and `userText` but the same `staticSystem`/`history` produce byte-identical `messages[0..n]` (`expect(JSON.stringify(a.slice(0,-1))).toBe(JSON.stringify(b.slice(0,-1)))`).
2. `本地时间` appears exactly once, in the last message.
3. No prompt string contains a raw stat number: `expect(JSON.stringify(msgs)).not.toMatch(/好感\s*\d/)` (C-5).
4. `nudge` present → last message ends with `LINT_NUDGE`; absent → no message contains it.
5. `facts` of length 8 → exactly 5 appear.

#### 3.8.4 `planTrim` — and who calls it

```ts
// TrimPlan is DECLARED in types.ts (§3.1, owner T1). prompt.ts re-exports it, so the many
// existing `import type { TrimPlan } from './prompt.ts'` call sites keep resolving.
export type { TrimPlan } from './types.ts';
import type { TrimPlan } from './types.ts';

export function planTrim(history: ChatMessage[], maxTokens = 24_000, dropTokens = 8_000): TrimPlan;
```

> **Why the interface moved out of this file (ordering, load-bearing — resolve before T1 runs).** §3.10's `ports.ts` opens with `import type { TrimPlan } from './prompt.ts'`, but §1.1, §0.1 and §8.6 row 8 all assign `ports.ts` to **T1** while `prompt.ts` is **T3**'s. Under `verbatimModuleSyntax` + `allowImportingTsExtensions` that import is **TS2307** in a T1-only tree, so `tsc -p packages/brain/tsconfig.json` — T1's own gate — could never pass, and T1 could not ship §3.10 verbatim. Three options existed: move the `ports.ts` row to T3 (serialises Lane C behind Lane B and contradicts §8.6 row 8), declare `TrimPlan` a second time inside `ports.ts` (two definitions of one shape, a D3-class defect), or **split the interface into `types.ts` and re-export it from `prompt.ts`**. The third is taken: one definition, no ownership move, no call-site churn. `ports.ts` imports it `from './types.ts'`.

Algorithm: if `sum(estimateTokens(m.content)) <= maxTokens`, return `{ keep: history, drop: [], droppedTokens: 0 }`. Otherwise walk from the oldest message accumulating into `drop` until `droppedTokens >= dropTokens`, then extend `drop` forward until the next kept message has `role === 'user'` (never split a user/assistant pair). `keep` is the remainder.

**Caller (A13's gap, decided): `TurnRunner.send()`.** Immediately after `history.window()` returns and before assembling, it calls `planTrim(window)`. If `drop.length > 0` it awaits `history.onTrimNeeded(plan)` and then re-reads `history.window()` and `history.summary()`. `HistoryStore.window()` never trims on its own.

Required test: a synthetic 30-turn history of ~1,200-token turns drops at least 8,000 estimated tokens and `keep[0].role === 'user'`.

### 3.9 `src/deepseek.ts` — SSE client

```ts
export interface ChatRequest { messages: ChatMessage[]; maxTokens?: number }
export type StreamChunk =
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done' };

export interface ChatClient {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
  /** Non-streaming single call. On the INTERFACE, not just the class — §4.4's makeSummarizer needs it. */
  complete(req: ChatRequest, signal: AbortSignal): Promise<{ text: string; usage: Usage }>;
  testKey(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string }>;
}

/**
 * One SSE line in, zero or more chunks out. Exported so §3.9.2's awkward-boundary rules are
 * unit-testable without a socket. A single frame can legally carry both a delta and a `usage`
 * object, hence the array return. Owner: T4.
 */
export function parseSseLine(line: string): StreamChunk[];

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;          // default 'https://api.deepseek.com'
  model?: string;            // default 'deepseek-v4-flash'
  fetch?: typeof fetch;      // injected in tests
  /** ACCEPTED AND UNUSED by DeepSeekClient — declared because this interface declares it. */
  now?: () => number;
  /** Governs the RETRY BACKOFF ONLY. The two timeouts are real setTimeout timers. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;     // jitter; injected in tests
}

export class DeepSeekClient implements ChatClient {
  constructor(opts: DeepSeekOptions);
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
  testKey(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string }>;
  /** Non-streaming single call, used by the summarizer (§4.4). */
  complete(req: ChatRequest, signal: AbortSignal): Promise<{ text: string; usage: Usage }>;
}

export class DeepSeekError extends Error {
  readonly code: ErrorCode;      // 'auth'|'balance'|'rate'|'server'|'network'|'timeout'
  readonly status: number | null; // null for network/timeout
  constructor(code: ErrorCode, status: number | null, message: string);
}
export class CancelledError extends Error {}   // user abort — never a DeepSeekError, never retried
```

**Two injection points, pinned so a test cannot accidentally disable a timeout:**

- **`opts.now` is accepted and unused by `DeepSeekClient`.** The client needs no clock — `CONNECT_TIMEOUT_MS` and `IDLE_TIMEOUT_MS` are `setTimeout` timers and `opts.sleep` covers the backoff. It stays in the options type because this interface declares it, and a test that injects `now` into the client changes nothing observable. (Contrast `TurnRunnerDeps.now`, which **is** the timing oracle for `ttftMs` / `totalMs`.)
- **`opts.sleep` governs the retry backoff only.** Every retry test injects an instant `sleep`; if the two timeouts also ran off it, an instant sleep would fire them immediately and the retry tests would be measuring a timeout instead of a retry. §3.9.5 requires no timeout test precisely because the timers are real.

#### 3.9.1 Constants and request body

```ts
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_JUDGE_MODEL = 'deepseek-v4-pro';
export const DEFAULT_MAX_TOKENS = 300;
export const CONNECT_TIMEOUT_MS = 15_000;   // headers not received -> code 'timeout'
export const IDLE_TIMEOUT_MS = 30_000;      // no SSE bytes for this long mid-stream -> code 'timeout'
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;   // 3 retries, 4 attempts max
export const RETRY_JITTER = 0.3;            // delay * (1 +/- 0.3), from opts.random()
export const RETRYABLE: readonly ErrorCode[] = ['rate', 'server', 'network', 'timeout'];

/** The three `stop` strings as ONE binding, so the test asserts against it instead of re-typing
 *  them. Note the first uses a FULL-WIDTH colon and the second a half-width one. */
export const STOP_SEQUENCES = ['\n用户：', '\n用户:', '\nUser:'] as const;
```

`POST {baseUrl}/chat/completions`, headers `Authorization: Bearer <apiKey>`, `Content-Type: application/json`, `Accept: text/event-stream`. Body, exactly:

```json
{
  "model": "deepseek-v4-flash",
  "messages": [ /* req.messages */ ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "thinking": { "type": "disabled" },
  "temperature": 0.7,
  "top_p": 0.95,
  "max_tokens": 300,
  "stop": ["\n用户：", "\n用户:", "\nUser:"]
}
```

`thinking: {"type":"disabled"}` is sent on **every** chat request — thinking is on by default for `deepseek-v4-flash`. Do not "simplify" it away.

`testKey()` (X9, Phase 2 scope — a 1-token chat call, **not** a balance query):

```json
{ "model": "deepseek-v4-flash", "messages": [{"role":"user","content":"hi"}],
  "max_tokens": 1, "stream": false, "thinking": { "type": "disabled" } }
```

`complete()` is the same body with `"stream": false` and the caller's `maxTokens`.

**The two non-streaming calls (`complete`, `testKey`), pinned:**

- They **omit `stream_options` entirely**. OpenAI-compatible servers reject `stream_options` when `stream` is `false`; sending it would fail the summarizer and the key test.
- They send `Accept: application/json`, not `Accept: text/event-stream`. Only `stream()` asks for the event stream.
- They keep `thinking: {"type":"disabled"}` and `temperature: 0.7`, exactly like `stream()`.
- **Each makes exactly one request. Neither retries.** §3.9.3's attempt budget is written for `stream()` alone: a summarizer retry would multiply latency inside a trim transaction, and a key test that silently retries hides a bad key behind a delay. A failure is returned/thrown on the first attempt.
- `testKey()` maps a `CancelledError` to `{ ok: false, code: 'network', message }` so its return type stays the contract's two-arm union — `testKey` never throws.
- **`testKey()`'s body omits `top_p` and `stop`; `complete()`'s keeps both.** The `testKey` JSON printed above is literal and carries neither, plus the `temperature: 0.7` the bullet above adds. `complete()` is "the same body with `stream: false` and the caller's `maxTokens`", which means **`stream()`'s body minus `stream_options`, and nothing else** — `top_p: 0.95` and the three `STOP_SEQUENCES` stay.

Every `ChatClient` implementation must supply all three methods, including `createFakeClient()` (§6.7).

#### 3.9.2 SSE parsing

Read `res.body` with `for await (const chunk of res.body)`, decode with a single `new TextDecoder('utf-8')` using `{ stream: true }`, and keep a line buffer:

- Split on `\n`; strip one trailing `\r` from each line (handles `\r\n`).
- Ignore empty lines and any line starting with `:` (`: keep-alive`).
- A line starting with `data: ` (or `data:`) is a frame. `data: [DONE]` ends the stream → yield `{kind:'done'}` and return.
- Otherwise `JSON.parse` the payload. `choices[0].delta.content` (a non-empty string) → `{kind:'delta', text}`. A top-level `usage` object → `{kind:'usage', usage}` mapped as:
  ```ts
  { promptTokens: u.prompt_tokens ?? 0,
    cacheHit:     u.prompt_cache_hit_tokens ?? 0,
    cacheMiss:    u.prompt_cache_miss_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0 }
  ```
- A frame that fails `JSON.parse` is skipped with a `console.warn`, never thrown (a truncated frame is always followed by more bytes; the line buffer already guarantees whole lines).
- At end of body without `[DONE]`: flush the decoder, process any final line, then yield `{kind:'done'}`.

#### 3.9.3 Error taxonomy and retry (R10.5)

| Condition | `DeepSeekError.code` | `status` | Retried? |
|---|---|---|---|
| HTTP 401 | `auth` | 401 | no |
| HTTP 402 | `balance` | 402 | no |
| HTTP 429 | `rate` | 429 | yes |
| HTTP >= 500 | `server` | the status | yes |
| any other non-2xx | `server` | the status | yes |
| `fetch` rejects (DNS, TLS, socket) | `network` | `null` | yes |
| headers not received within `CONNECT_TIMEOUT_MS` | `timeout` | `null` | yes |
| no bytes for `IDLE_TIMEOUT_MS` mid-stream | `timeout` | `null` | **no** (see below) |
| the caller's `signal` aborts | `CancelledError` | — | no |

**The retry gate is a single conjunction: `RETRYABLE.includes(code) && noDeltaYieldedYet`.** That one expression is what reconciles the table's "idle timeout mid-stream → retried: **no**" with R10.5's "retries happen only before the first `{kind:'delta'}`": `'timeout'` stays in `RETRYABLE`, and the no-delta half of the gate is what makes the table row true mid-stream. Do not add a second, code-specific exclusion — there is one gate, written once.

Once one delta has reached the consumer, any later failure — including the idle timeout — propagates immediately; retrying then would duplicate visible text. Attempt budget for `stream()`: 1 initial + up to 3 retries, sleeping `RETRY_DELAYS_MS[i] * (1 + (random()*2-1) * RETRY_JITTER)`, aborting the sleep if `signal` fires. After the last retry the final `DeepSeekError` is thrown. `complete()` and `testKey()` do not use this budget at all (§3.9.1).

The error body is read and used as `message`, **truncated to the first 2048 characters of the decoded body**; when the body is empty or unreadable, `message` falls back to exactly `HTTP <status>`.

#### 3.9.4 Empty completion (spec §8)

An "empty completion" is a stream that reached `{kind:'done'}` having yielded **zero** deltas, or whose accumulated text is whitespace-only after `sanitizeForDisplay`. The client itself does not special-case this — **`TurnRunner` owns it**: one full re-request (same messages, no nudge), and if that is also empty, emit a single `SentenceEvent` whose text is a random entry from `persona.cannedLines.empty`, then `turnDone` with `lint.severity === 'none'` and `metrics.errorCode = 'empty'`. The canned line **is** written to history (the user saw it) with `kind: 'system'`.

Pinned details, so no implementer invents them:

- **The empty-completion re-request has its own budget and does NOT set `turnDone.regenerated`.** `regenerated` reports the *lint* regeneration (§3.11.2 step 3) only. The two budgets are independent counters: a turn may legitimately do one lint regeneration **and** one empty re-request.
- **The canned line is emitted as exactly `{ turnId, seq: 0, text, emotion: 'awkward' }`** — no `motion`, no `pause`. `awkward` is the honest pose for "I have nothing"; `seq: 0` because no other sentence was emitted this turn.
- **`persona.cannedLines.offline` is never emitted by `TurnRunner`.** §3.11.5 is authoritative: on a `DeepSeekError` the runner appends nothing and emits `error`. The offline copy belongs to `BrainService` (§6.4/§6.6), which owns user-facing failure text. `cannedLines.offline` and `persona.motionKeys` therefore stay in `TurnRunnerDeps` — declared by §3.11, read by nobody inside `turn.ts` — and that is correct, not dead weight.

#### 3.9.5 Required tests (`deepseek.test.ts`, local `node:http` server)

1. Three deltas + a usage frame → the client yields `delta,delta,delta,usage,done`; asserts the request body has `thinking.type === 'disabled'`, `stream_options.include_usage === true`, `model === 'deepseek-v4-flash'`, `temperature === 0.7`, `top_p === 0.95`, `max_tokens === 300`, and the three `stop` strings.
2. 401 → `DeepSeekError` with `code 'auth'`, and the server saw exactly **one** request.
3. 503 then 200 (injected `sleep`) → succeeds; the server saw exactly two requests.
4. 503 **after** the first delta → the error propagates and the server saw exactly one request (R10.5).
5. A frame split mid-`data:` line across two socket writes is parsed correctly; `: keep-alive` lines are ignored; `\r\n` line endings work.
6. `signal.abort()` mid-stream → the iterator rejects with `CancelledError`, never a `DeepSeekError`.
7. `testKey()` on 200 → `{ok:true}`; on 401 → `{ok:false, code:'auth'}`; on abort → `{ok:false, code:'network'}` (never a throw).
8. `complete()` sends `stream:false`, **no** `stream_options` key, and `Accept: application/json`; on 503 the server sees exactly **one** request (§3.9.1: no retries).
9. `parseSseLine` unit cases, no socket: `'data: [DONE]'` → `[{kind:'done'}]`; `': keep-alive'` → `[]`; `''` → `[]`; a frame carrying both `choices[0].delta.content` and a top-level `usage` → `[{kind:'delta'},{kind:'usage'}]` in that order; malformed JSON → `[]` plus one `console.warn`.

> **Byte boundaries are driven through an injected `fetch` returning a hand-built response object**, plus **one** real `node:http` + global-`fetch` end-to-end test. TCP coalesces successive `res.write()` calls, so socket-level splits cannot be made deterministic; an injected stream can. Both mechanisms are already in `DeepSeekOptions`. Test 4's "503 **after** the first delta" is realised as a mid-stream *body* failure — an HTTP status cannot change after headers are sent — and the assertion the contract cares about (the server saw exactly **one** request) is unchanged.
>
> **The injected object is hand-built and cast, not `new Response(stream)`.** It exposes only the five members the client touches — `ok`, `status`, `body`, `text`, `json` — and is cast `as Response`. In the installed `@types/node` 24.13.3 the `BodyInit` union (from `undici-types` 7.18.2) does **not** include `ReadableStream`, so `new Response(stream)` does not typecheck; verified this session by reading `node_modules/.pnpm/undici-types@7.18.2/node_modules/undici-types/fetch.d.ts` line 19. Do not "fix" the cast back into a real `Response`.

> **The C-14 gated tests use a task-local `LIVE_SYSTEM` literal, never `renderStaticSystem`.** `LIVE_SYSTEM` is defined inside `deepseek.test.ts`. C-14 asks only for "one real streamed turn asserts ACT compliance" and "a second call asserts `prompt_cache_hit_tokens > 0`" — neither needs the shipped persona, and T4 must not take a dependency on a T3 surface that ruling **P3** was still moving when this contract was written (§3.7.3's third parameter). A `renderStaticSystem` import here would also make a gated network test fail for a *card* edit, which is the wrong signal.

### 3.10 `src/ports.ts` — the ports `@ds/brain` depends on

```ts
import type { ErrorCode, LintResult } from '@ds/protocol';
// TrimPlan comes from types.ts, NOT prompt.ts: this file and types.ts are T1's while prompt.ts is
// T3's, and importing across that line makes T1's own `tsc -p packages/brain/tsconfig.json` fail
// with TS2307. One import, one file, both owned by the same task. See §3.1, §3.8.4, §8.6 row 12.
import type { ChatMessage, TrimPlan } from './types.ts';

export type Role = 'user' | 'assistant';
export type MessageKind = 'chat' | 'proactive' | 'system';           // R10.3
export interface MessageMeta {                                        // R10.2
  turnId?: string;
  kind?: MessageKind;          // default 'chat'
  interrupted?: boolean;       // default false; R2's [interrupted] marker
}

export interface HistoryPort {
  /** Messages after the last trim point, oldest first, within the 24K estimate budget. */
  window(): Promise<ChatMessage[]>;
  /** The running summary, '' when there is none. Already <= 600 estimated tokens. */
  summary(): Promise<string>;
  /** Up to `MAX_FACTS` retrieved facts for the latest user message. Phase 2 returns []. */
  facts(): Promise<string[]>;
  /** The last `n` assistant contents, oldest first. Feeds LintContext.recent. */
  recentAssistant(n: number): Promise<string[]>;
  append(role: Role, content: string, meta?: MessageMeta): Promise<void>;
  onTrimNeeded(plan: TrimPlan): Promise<void>;
}

export interface RunningSummaryPort {
  get(): Promise<string>;
  set(text: string): Promise<void>;
}

/** Injected into HistoryStore; main supplies the non-streaming v4-flash call. */
export type Summarize = (oldSummary: string, dropped: ChatMessage[]) => Promise<string>;

export interface MetricsRecord {
  turnId: string; ts: number;
  ttftMs: number | null; totalMs: number;
  promptTokens: number; cacheHit: number; cacheMiss: number; completion: number;
  complianceMiss: boolean; regenerated: boolean; sensitive: boolean;
  lint: LintResult; errorCode: ErrorCode | null;
}
export interface MetricsPort { record(m: MetricsRecord): Promise<void> }
```

`facts()` returns `[]` for the whole of Phase 2 (tier 3 memory is Phase 3, spec **§6**) — the port exists now so `assemblePrompt`'s layout is final and Phase 3 adds no interface churn.

### 3.11 `src/turn.ts` — `TurnRunner`

```ts
export interface TurnEvents {
  state: { state: TurnState; turnId: string };
  sentence: SentenceEvent;                       // text is ALREADY sanitized
  turnDone: {
    turnId: string; usage: Usage | null; ttftMs: number | null; totalMs: number;
    complianceMiss: boolean; regenerated: boolean; lint: LintResult;
  };
  error: { turnId: string; code: ErrorCode; message: string };
}

export interface TurnRunnerDeps {
  client: ChatClient;
  history: HistoryPort;
  metrics?: MetricsPort;
  persona: { staticSystem: string; postHistoryInstructions: string; motionKeys: string[]; cannedLines: { offline: string[]; empty: string[] } };
  state(): StatePreamble;
  lint?: boolean;                 // default true
  now?: () => number;             // default Date.now
  idFactory?: () => string;       // default () => crypto.randomUUID()
  random?: () => number;          // default Math.random, for canned-line choice
}

export class TurnRunner {
  constructor(deps: TurnRunnerDeps);
  readonly state: TurnState;
  readonly turnId: string | null;
  on<K extends keyof TurnEvents>(event: K, cb: (payload: TurnEvents[K]) => void): () => void;
  send(text: string, kind?: MessageKind): Promise<string>;   // resolves with the turnId as soon as the turn is admitted
  cancel(): void;
  sentenceShown(turnId: string, seq: number): void;
  turnShown(turnId: string): void;
}
```

`on` returns an unsubscribe function.

> **`send()` resolves on *admission*, not on dispatch — the prompt build and the request are detached.** The signature comment ("resolves with the `turnId` as soon as the turn is admitted") and an earlier prose line ("when the request has been dispatched") disagreed; **the signature wins**. The detached work `await`s `history.onTrimNeeded(plan)`, which in T6 is a non-streaming `complete()` summarisation call with `maxTokens: 900` — awaiting that inside `send()` would block the chat composer's `user:text` invoke (§6.2 rule 6) for seconds on any turn that happens to trip a trim. So `send()` does exactly this synchronously: admit the turn, mint the `turnId`, emit `state:thinking`, call `deps.state()` **once**, and (for a supersede) emit the superseded turn's `turnDone`; then it starts the detached run and resolves.
>
> Two consequences, pinned so no test is written against the wrong one:
> - **`LintContext.recent` is fetched by the detached run**, immediately after admission — `HistoryPort.recentAssistant` is async and §3.11.2 only requires it be fetched **once per turn**.
> - **`deps.state()` is called synchronously inside `send()`**, exactly once (§3.11.2; §3.11.6 test 12).

#### 3.11.1 States and transitions

`idle → thinking → speaking → idle`. `interrupted` is a transition, not a state.

> **The user history row is appended at *turn commit*, never inside `send()`.** Commit is the **earliest** of: (a) the first sentence is *released* to the consumer, (b) the stream ends, (c) an `error` is emitted, (d) the turn is cancelled. This is required for correctness, not a preference: `assemblePrompt` puts the latest user text in `messages[n+1]` while `history.window()` supplies `messages[1..n]`, so appending before the window read would send the user's text **twice** in the same request.
>
> It also replaces the earlier "the first turn's user row is deleted and rewritten as the concatenation" wording, which had no owner and no port method. Because nothing was written yet, a `send()` that supersedes an uncommitted turn simply commits the **concatenation** under the new `turnId`. The observable end state is identical — exactly one user row, holding the concatenation, under the new `turnId` — and **`HistoryPort` gains no method** (`HistoryStore.deleteTurn` is synchronous and could not satisfy an async port method anyway).

| From | Event | To | Side effects |
|---|---|---|---|
| `idle` | `send(text)` | `thinking` | emit `state`; call `deps.state()` **once**; `planTrim` → maybe `onTrimNeeded`; `history.window()`; assemble; `client.stream()`. **No history append yet.** |
| `thinking` | first `delta` | `thinking` | record `ttftMs` |
| `thinking` | first sentence **released** by the lookahead | `speaking` | commit the user row; emit `state`, then emit `sentence` |
| `speaking` | later sentences | `speaking` | emit `sentence` |
| `speaking` | `turnShown(turnId)` | `idle` | emit `state`; the appended assistant row is final |
| `thinking`/`speaking` | `cancel()` | `idle` | commit the user row; abort; §3.11.4 |
| `thinking` | `send(text2)` | `thinking` | abort attempt 1; nothing was committed, so restart with `text + '\n' + text2` **as one new turn with a new turnId** and commit that concatenation at the new turn's commit point |
| `speaking` | `send(text2)` | `thinking` | §3.11.4 interruption ledger, then a fresh turn for `text2` |
| any | stream throws `DeepSeekError` | `idle` | commit the user row; emit `error`; §3.11.5 |

**Entering `speaking` and `idle`, pinned:**

- `state` becomes **`speaking` when the first sentence is *released* by the one-sentence lookahead**, not when it closes. Releasing is when the consumer can paint; announcing `speaking` earlier would put the bubble in speaking state with nothing to show, and §3.11.6 test 1 says "`state:speaking` **with** the first sentence".
- `idle` is entered on **`turnShown(turnId)`**. A `turnShown` that arrives *before* the model turn settles is **remembered, not dropped**, and applied at settle time.
- `idle` is entered **immediately** at settle time when zero sentences were emitted (there is nothing for the bubble to acknowledge, so no `turnShown` will ever come), and **immediately** on error and on cancel.

#### 3.11.2 Streaming with sentence-local lint (R4 — the heart of Phase 2)

For each `SentenceEvent` the `StreamParser` produces, in order:

1. `raw = ev.text`; `display = sanitizeForDisplay(raw)`. If `display` is empty → drop the sentence entirely (no seq is consumed by the consumer; the parser's `seq` still increments, which is fine — consumers only use `seq` for ordering).
2. `r = lintSentence(raw, ctx)`.
3. If `seq === 0` (nothing painted yet) **and** `r.severity === 'regenerate'` **and** `regenerated === false`: abort the stream, set `regenerated = true`, re-assemble with `nudge: LINT_NUDGE`, and restart the request from scratch. This is the **only** regeneration, at most once per turn (R4).
4. If `r.severity === 'regenerate'` and it is not the first sentence, or the regeneration budget is spent: **strip** — the sentence is discarded, never emitted, never appended (D6: strip, never keep-and-mark).
5. If `r.severity === 'strip'`: also discarded.
6. Otherwise emit `{...ev, text: display}` and append nothing yet.

When the stream ends, the **final** emitted sentence is re-checked with `lintTail(rawFinal, ctx)` against the accumulated raw reply (§3.6: the whole reply goes in, the last sentence is derived inside). If it fails, that sentence is **stripped before emission** — which is why the final sentence is held back by exactly one step: the runner emits sentence *k* only once sentence *k+1* has been produced or the stream has ended. This one-sentence lookahead is the mechanism that makes "a failing final sentence is never painted" true while everything before it streams live.

**A tail-lint failure regenerates instead of stripping only when nothing has been emitted yet AND the regeneration budget is unspent; otherwise it strips.** R4's stated reason for permitting regeneration at all is "because nothing is painted yet", which is exactly this condition. Without it, a one-sentence reply that fails the tail lint would strip its only sentence and end the turn silently — a visible bug the user would read as the app ignoring them.

**The two regeneration gates, written once each — they are NOT the same expression:**

```ts
const sentenceGate = emitted.length === 0 && pending === null && !regenerated;  // step 3
const tailGate     = emitted.length === 0 && !regenerated;                      // the tail check
```

The sentence gate is the literal reading of step 3's "`seq === 0` (nothing painted yet)": the lookahead's `pending` slot must also be empty, which is the only form under which §3.11.6 test 5 ("a **later** sentence … no extra request") is true. The tail gate deliberately omits `pending === null`, because at tail time the pending sentence is by definition still unpainted — and that omission is what makes §3.11.6 test 11 ("a single-sentence reply that trips `closing-moral` → one extra request") true. Writing one expression for both breaks exactly one of those two tests.

**`lintTail` receives `rawKept`, not every byte the model produced.** `rawKept` is the concatenation of the **raw** text of the sentences that survived `lintSentence` — the ones already emitted plus the one the lookahead is holding. This is what makes the final sentence `lintTail` derives internally (`splitSentences(text).at(-1)`) *be* the pending sentence. A sentence already stripped for a sentence-local violation must not get a second vote on the tail.

**`turnDone.lint` is the last lint result computed during the turn** — the tail result when one ran, otherwise the last sentence result, otherwise `{ violations: [], severity: 'none' }`. §3.11.4 already states this rule for the cancel path; it applies to **every** path, so there is one rule rather than two.

**`resetAttempt` (the regeneration and empty-re-request reset) clears the parser, the pending sentence, the accumulated text, and also `usage` and `ttftMs`** — so `turnDone` and the `MetricsRecord` describe the attempt that was actually delivered, not a discarded one. **`startedAt` is not reset:** `totalMs` spans the whole turn including the discarded attempt, because that is what the user waited.

The assistant history row is appended once, after the stream ends, as `emittedSentences.map(s => s.text).join('')` (already sanitized — the same characters the bubble painted), with `meta = { turnId, kind }`. When zero sentences were emitted, nothing is appended for the assistant except the §3.9.4 canned line.

**`turnDone` is emitted for every terminal outcome except a transport error.** §3.11.5 gives a `DeepSeekError` exactly `error` + a `MetricsRecord`; every other ending — normal completion, empty completion (§3.9.4), an all-stripped reply, `cancel()` and `send()`-while-busy (§3.11.4) — emits `turnDone`.

**`TurnRunner` writes the `MetricsRecord`**, through the injected `deps.metrics` port, once per turn at the terminal outcome. `sensitive` and `errorCode` exist only inside the turn, so no outer layer can re-derive them. §6.6's "`BrainService` records a `MetricsRecord` per turn" is satisfied by **wiring `metrics: store`** — `BrainService` must not fabricate those two fields itself.

Timing fields: `ttftMs` = `now()` at the first delta minus `now()` at request dispatch (`null` if no delta arrived); `totalMs` = `now()` at `turnDone` emission minus `now()` at `send()` (R10.7 — the field is **`totalMs`** everywhere, never `ms`).

`ctx` for every lint call in the turn: `{ recent: await history.recentAssistant(5), sensitiveTurn: isSensitive(text) }`, fetched once at `send()`.

**`deps.state()` is called exactly once per turn, in `send()`, and the same `StatePreamble` object is reused for the regeneration request** — so the two attempts differ by the nudge line and nothing else. Calling it twice would move `localTime`/`sinceLastChat` between attempts and make the regeneration un-diffable.

#### 3.11.3 Nudge

`LINT_NUDGE = '（上一条回复不像你会说的话，换个说法，别用助手腔。）'` is passed as `AssembleInput.nudge`, which places it as the last line of the latest user message. **It is never written to history** (R10.6/D13), so the next turn's prompt cannot see it and the prefix cannot drift.

#### 3.11.4 Cancel and interruption (R2 — sentence-granular truthful history)

`cancel()` and `send()`-while-busy share one path:

- Abort the `AbortController` (the client stops; the iterator throws `CancelledError`, which the runner swallows).
- Collect `shown` = every sentence for which `sentenceShown(turnId, seq)` has arrived, in `seq` order.
- If `shown.length > 0`: `history.append('assistant', shown.map(s=>s.text).join(''), { turnId, kind, interrupted: true })`.
- If `shown.length === 0`: append nothing (nothing was seen).
- Emit `turnDone` with `totalMs` measured and `lint` = the last computed result (or an empty `none` result).
- State → `idle`, then the new turn (if any) starts.

A sentence that was emitted but whose `playback:sentenceDone` never arrived is **omitted** — that is exactly what R2 buys, and spec §3.6's "displayed-so-far text" is amended to "sentences whose `sentenceDone` arrived, plus the `[interrupted]` marker".

**Three details that separate `cancel()` from `send()`-while-busy, pinned:**

- **A `send()` that supersedes an *uncommitted* turn does not commit that turn's user row; it transfers the text.** That is §3.11.1's "restart with `text + '\n' + text2` … and commit that concatenation at the new turn's commit point". Commit rule (d) — "the turn is cancelled" — belongs to `cancel()`, not to `send()`. Without this distinction §3.11.6 test 10's "exactly **one** user row" is false.
- **The superseded turn's `turnDone` is emitted synchronously inside `send()`, before the new turn's `state:thinking`.** Its history writes and its `MetricsRecord` are detached. This gives the interruption path one deterministic event order rather than a race between two turns' teardown and setup.
- **A `MetricsRecord` is written for cancel and for supersede too**, with **`errorCode: null`**. §3.11.2 says "once per turn at the terminal outcome" and both are terminal outcomes; a turn the user interrupted is exactly the turn whose latency is worth having.

The `interrupted: true` flag is what the history pane renders as a `[中断]` marker (§6.3).

#### 3.11.5 Errors

On `DeepSeekError`: emit `error {turnId, code, message}`, append **nothing** for the assistant, leave the user row in place (the composer restores the text, §6.2), state → `idle`, and record a `MetricsRecord` with `errorCode` set. `CancelledError` never produces an `error` event.

#### 3.11.6 Required tests (`turn.test.ts`, `FakeClient` + injected `now`/`sleep`)

1. `send` → `state:thinking` synchronously, then `state:speaking` with the first sentence, sentences in `seq` order, then `state:idle` after `turnShown`; history got exactly one user row and one assistant row.
2. A reply with no leading ACT sets `complianceMiss: true` on `turnDone`.
3. `send` during `speaking` after `sentenceShown(t,0)` only → history's assistant row is sentence 0's text with `interrupted: true`, and a new turn starts with a new `turnId`.
4. A first sentence that trips `assistant-leak` → exactly one extra request; `LINT_NUDGE` appears only in the last user message of the second request; `turnDone.regenerated === true`.
5. A **later** sentence that trips `assistant-leak` → no extra request, that sentence is never emitted, and the history row omits it.
6. A final sentence that trips `closing-moral` → never emitted (the assertion is on the emitted event list, proving the lookahead works).
7. `rate` after all retries → `error {code:'rate'}`, state `idle`, nothing appended for the assistant.
8. A stream that yields zero deltas → exactly one extra request, then one `sentence` equal to `{turnId, seq:0, text: <in cannedLines.empty>, emotion:'awkward'}`, `metrics.errorCode === 'empty'`, and **`turnDone.regenerated === false`**.
9. `turnDone.totalMs` is a number and the payload has no `ms` key (R10.7).
10. **Turn commit.** The assembled `messages` of the first request contain the user's text **exactly once** (in the last message) — i.e. `history.append('user', …)` had not run before `history.window()` was read. A `send()` during `thinking` produces exactly **one** user row, holding `text + '\n' + text2`, under the second `turnId`.
11. A single-sentence reply that trips `closing-moral` → one extra request (regenerated, because nothing was emitted), not a silent empty turn; a **third**-sentence tail failure after two painted sentences → stripped, no extra request.
12. `deps.state` is called exactly once across a turn that regenerates (`expect(stateSpy).toHaveBeenCalledTimes(1)`).
13. On a `DeepSeekError` no `turnDone` is emitted; on cancel, on an all-stripped reply and on the empty-completion path it is.

---

## 4. `@ds/memory`

Spec **§6** is the tier reference (C-7 — §5 is the sim, do not read that one). Phase 2 implements tier 1 (window) and tier 2 (running summary) only; `facts` is created empty for Phase 3.

`packages/memory/src/index.ts`:

```ts
export * from './db.ts';
export * from './history.ts';
export * from './summary.ts';
```

### 4.1 `src/db.ts` — open, migrate, fail loudly

```ts
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

export class MemoryOpenError extends Error {
  readonly code = 'memory-open';
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(`无法打开数据库：${path}\n${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'MemoryOpenError';
    this.path = path;
    this.cause = cause;
  }
}

export function openDb(path: string): DatabaseSync;   // throws MemoryOpenError, never a raw sqlite error
export function migrate(db: DatabaseSync): void;      // idempotent; called by openDb

/** The three reserved kv keys of §4.2, as constants so no call site spells one wrong. */
export const KV_SCHEMA_VERSION = 'schema_version';
export const KV_LAST_TRIM_ID = 'last_trim_id';
export const KV_FIRST_RUN_DONE = 'first_run_done';

/** The kv accessors. §4.2 lists the keys and §6.6 reads `first_run_done`; these are how. */
export function getKv(db: DatabaseSync, key: string): string | null;
export function setKv(db: DatabaseSync, key: string, value: string): void;
```

`openDb` sequence, exactly: `mkdirSync(dirname(path), {recursive:true})` → `new DatabaseSync(path)` → `PRAGMA journal_mode = WAL` → `PRAGMA foreign_keys = ON` → `migrate(db)`. Any throw in that sequence is wrapped in `MemoryOpenError` with the path.

> **`openDb` closes a partially-opened handle before it throws.** If the `DatabaseSync` was constructed and a later step (`PRAGMA` or `migrate`) fails, the handle is `close()`d — inside its own `try {} catch {}`, so a close failure never masks the real cause — and only then is `MemoryOpenError` thrown. This is what lets main's `dialog.showErrorBox` + `app.quit()` path exit without a locked WAL, and lets `db.test.ts` reopen the same path on the next line. §4.1 previously said nothing about the orphaned handle.

> **`migrate` throws a plain `Error`; `openDb` wraps it.** `MemoryOpenError(path, cause)` needs a path that `migrate(db)` does not have. So the newer-schema guard throws `new Error('这个数据库来自更新的版本…')` and `openDb` converts it under the rule above. Observable behaviour is unchanged: a caller of `openDb` still only ever sees `MemoryOpenError`. A direct `migrate()` caller (only the tests) sees the plain `Error`.

**The database file is `join(app.getPath('userData'), 'ds.sqlite')`** → `%APPDATA%\ds\ds.sqlite` (`app.setName('ds')` at `main/index.ts:12` is what makes `userData` be `%APPDATA%\ds`; the same directory holds `key.bin`, §6.5). `@ds/memory` never computes this path — main passes it in.

**Open-failure behaviour (spec §8):** `apps/desktop/src/main/index.ts` calls `openDb` inside `app.whenReady()`. On `MemoryOpenError` it shows a **blocking** `dialog.showErrorBox('小春打不开了', err.message)` and then `app.quit()`. The app never runs without persistence. A comment at the call site must say so.

> **That behaviour lives in its own module, `apps/desktop/src/main/fatal.ts` (owner T6), not inline in `index.ts`.**
> ```ts
> export const FATAL_TITLE = '小春打不开了';
> export function fatal(message: string): never;   // showErrorBox(FATAL_TITLE, message) then app.quit()
> ```
> Inlined in `index.ts` the rule is unfalsifiable — importing `index.ts` executes the whole startup graph, so no unit test can reach it. A four-line module with `fatal.test.ts` beside it makes "shows a blocking dialog, then quits" a real assertion instead of a claim.

### 4.2 Schema DDL — literal

```sql
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  turn_id     TEXT,
  kind        TEXT    NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','proactive','system')),
  interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0,1)),
  tokens      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ts      ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_messages_turn_id ON messages(turn_id);

CREATE TABLE IF NOT EXISTS summaries (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  content    TEXT    NOT NULL DEFAULT '',
  tokens     INTEGER NOT NULL DEFAULT 0,
  updated_ts INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO summaries (id, content, tokens, updated_ts) VALUES (1, '', 0, 0);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  text           TEXT    NOT NULL,
  importance     INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source_turn_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_ts ON facts(ts);

CREATE TABLE IF NOT EXISTS metrics (
  turn_id         TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  ttft_ms         INTEGER,
  total_ms        INTEGER NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_hit       INTEGER NOT NULL DEFAULT 0,
  cache_miss      INTEGER NOT NULL DEFAULT 0,
  completion      INTEGER NOT NULL DEFAULT 0,
  compliance_miss INTEGER NOT NULL DEFAULT 0 CHECK (compliance_miss IN (0,1)),
  regenerated     INTEGER NOT NULL DEFAULT 0 CHECK (regenerated IN (0,1)),
  sensitive       INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  lint            TEXT    NOT NULL DEFAULT '[]',
  error_code      TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
```

Reserved `kv` keys (the only ones Phase 2 writes):

| key | value | meaning |
|---|---|---|
| `schema_version` | `'1'` | migration guard |
| `last_trim_id` | decimal `messages.id` | `window()` returns rows with `id > last_trim_id` |
| `first_run_done` | `'1'` | set after `first_mes` has been shown once |

`migrate(db)` runs the DDL above inside one transaction, then `INSERT OR REPLACE INTO kv(key,value) VALUES('schema_version','1')`. A stored version **greater** than `SCHEMA_VERSION` throws (and `openDb` wraps it as `MemoryOpenError`). Forward migrations append `if (from < N) { … }` blocks; never rewrite the version-1 DDL.

The newer-schema message is, literally:

```ts
`这个数据库来自更新的版本（schema_version=${stored}，本版本支持 ${SCHEMA_VERSION}）`
```

Tests assert `.includes('这个数据库来自更新的版本')` only, so the parenthetical stays free to change without touching a test — but shipping it is what makes the dialog actionable instead of merely alarming.

`facts` is written by nothing in Phase 2. It exists so the Phase 3 change is additive.

**Phase 2 ships no FTS5 virtual table and no `messages_fts`.** `list({before, limit})` pagination is the only history query surface. Full-text search over history is Phase 3+ and is purely additive (a new virtual table plus triggers, no change to any table above). An implementer who "helpfully" adds FTS has broken the migration ladder.

**SQL parameter style: every statement uses positional `?` parameters.** Bare named parameters were verified to work on Node 24.17.0, but `?` removes the question entirely. The `:last_trim_id` spellings in §4.3's prose are descriptive, not literal SQL.

> **The internal raw-row shape is a `type` alias, never an `interface`.** `StatementSync.all()` is typed `Record<string, SQLOutputValue>[]` in `@types/node` **24.13.3**. An `interface` has no implicit index signature, so `rows as RawHistoryRow[]` fails with **TS2352** ("neither type sufficiently overlaps with the other"); a `type` alias gets the implicit index signature and compiles. Verified this session by running `tsc` with this package's exact compiler options: the `interface` form errors, the `type` form exits 0. Write `type RawHistoryRow = { … }` and do not "tidy" it into an `interface`.

`packages/memory/package.json` keeps `zod` per §1.3, but `@ds/memory` performs **no runtime validation** in Phase 2: `list()` constructs objects that satisfy `HistoryRowSchema` by construction, and `handleInvoke` (§2.7) validates them at the IPC boundary. That is deliberate, not an omission.

### 4.3 `src/history.ts` — `HistoryStore`

```ts
/** Strictly ABOVE planTrim's 24_000 trigger. See the box below — this number is load-bearing. */
export const HISTORY_WINDOW_SAFETY_TOKENS = 32_000;

export interface HistoryStoreOptions {
  db: DatabaseSync;
  summary: RunningSummary;      // stored on the instance as `summaryStore`, not `summary`
  summarize: Summarize;
  maxTokens?: number;     // default HISTORY_WINDOW_SAFETY_TOKENS (32_000)
  now?: () => number;     // default Date.now
}

export class HistoryStore implements HistoryPort, MetricsPort {
  constructor(opts: HistoryStoreOptions);

  // HistoryPort
  window(): Promise<ChatMessage[]>;
  summary(): Promise<string>;
  facts(): Promise<string[]>;                 // Phase 2: always []
  recentAssistant(n: number): Promise<string[]>;
  append(role: Role, content: string, meta?: MessageMeta): Promise<void>;
  onTrimNeeded(plan: TrimPlan): Promise<void>;

  // MetricsPort
  record(m: MetricsRecord): Promise<void>;

  // Chat-window surface
  list(opts: { before?: number; limit?: number }): HistoryRow[];
  deleteTurn(turnId: string): number;         // rows deleted
  countSince(ts: number): number;
  lastMessageTs(): number | null;
}
```

Every `Promise`-returning method is internally **synchronous** (`node:sqlite`'s `DatabaseSync` is sync) and simply returns an already-resolved promise. That asymmetry is deliberate: `HistoryPort` stays async so a future async store needs no interface change. Never introduce a worker thread for this.

> **Why `maxTokens` defaults to 32 000 and not 24 000.** With the safety net set to `planTrim`'s own trigger, `window()` truncates to ≤ 24 000 *before* `planTrim(window, 24_000)` ever sees it — so `plan.drop` is always empty, `onTrimNeeded` never fires, and the running summary can never refresh. §3.8.4's "`HistoryStore.window()` never trims on its own" only holds if the safety net sits **strictly above** the trigger. §4.3's required test 3 is unchanged in substance: it constructs the store with `maxTokens: 24_000` explicitly and still asserts ≤ 24 000.

> **The `RunningSummary` field is named `summaryStore`.** `summary` is already a method on `HistoryStore` (it is part of `HistoryPort`), so a field of that name cannot compile. Every internal reference is `this.summaryStore`.

Semantics:

- `window()` → `SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC`, mapped to `ChatMessage`, then truncated **from the oldest end** until the estimated total is ≤ `maxTokens` (a safety net; `planTrim` in `TurnRunner` is the real trimmer). Rows with `kind='system'` are included — the user saw them.
- `summary()` → `this.summaryStore.get()`.
- `recentAssistant(n)` → `SELECT content FROM messages WHERE role='assistant' AND id > ? ORDER BY id DESC LIMIT ?`, then **reversed** so the array is oldest-first (`LintContext.recent` is documented newest-last).
- `append(role, content, meta)` → one `INSERT` with `ts = now()`, `turn_id = meta?.turnId ?? null`, `kind = meta?.kind ?? 'chat'`, `interrupted = meta?.interrupted ? 1 : 0`, `tokens = estimateTokens(content)`.
- `onTrimNeeded(plan)` → **returns immediately when `plan.drop.length === 0`**, without calling `summarize` (a guard, not a behaviour change: §3.8.4 has `TurnRunner` call the port only when `drop.length > 0`, so the empty plan should never arrive — and if it does, summarising nothing would burn a `complete()` call and overwrite a good summary with a worse one). Otherwise `const next = await summarize(this.summaryStore.getSync(), plan.drop)` runs **outside** the transaction (it is a network call); then **one synchronous transaction** `BEGIN … COMMIT` does `this.summaryStore.setSync(capSummary(next))` and advances `last_trim_id`. Nothing inside the transaction may `await` — that is why `setSync` exists (§4.4). Dropped rows are **not deleted** — they stay for the history pane (X5); `last_trim_id` is what excludes them from the prompt window. If `summarize` throws, nothing is written and the turn proceeds with the untrimmed window — logged, not fatal, as **exactly one** line:
  ```ts
  console.warn('[memory] summarize failed; window left untrimmed:', message);
  ```
  One `console.warn`, prefix `[memory]`, asserted with `toHaveBeenCalledTimes(1)`. Not `console.error` (this is recoverable), and never more than one line per failure.
- **How `last_trim_id` advances.** `TrimPlan.drop` is `ChatMessage[]` and carries **no row ids**, so the new value is the `id` of the **`plan.drop.length`-th row with `id > last_trim_id`, in ascending `id` order** (`SELECT id FROM messages WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET ?` with offset `plan.drop.length - 1`). If that query returns no row, **nothing is written** — neither the summary nor the pointer. This is the one place the plan and the table are re-joined, and it is correct because `window()` produced `plan`'s input from exactly this ordering.
- `list({before, limit=50})` → `SELECT id, ts, role, content, turn_id, kind, interrupted FROM messages` + `WHERE id < ?` when `before` is given, `ORDER BY id DESC LIMIT ?`, mapped to `HistoryRow` (`interrupted` → boolean, `turn_id` → `turnId`).
- `deleteTurn(turnId)` → `DELETE FROM messages WHERE turn_id = ?`, returns `changes`.
- `countSince(ts)` is **inclusive**: `SELECT count(*) FROM messages WHERE ts >= ?`.

Required tests (`history.test.ts`, on a temp file from `mkdtempSync`):
1. `migrate` twice on the same file is a no-op and leaves `schema_version = '1'`.
2. `append` then `window()` returns the rows oldest-first with roles preserved.
3. `window()` respects the token budget: 100 × 1,000-token rows → the returned estimate is ≤ 24,000 and the newest row is present.
4. `onTrimNeeded` calls `summarize` with exactly `plan.drop`, stores the returned summary, advances `last_trim_id`, and `window()` no longer returns the dropped rows while `list()` still does.
5. `summarize` rejecting leaves `last_trim_id` and the summary unchanged.
6. `deleteTurn` removes both the user and the assistant row of that turn and returns 2.
7. `recentAssistant(5)` returns assistant rows only, oldest-first, capped at 5.
8. `record()` round-trips a `MetricsRecord`, `lint` stored as `JSON.stringify(m.lint.violations)`.

### 4.4 `src/summary.ts` — `RunningSummary`

```ts
export class RunningSummary implements RunningSummaryPort {
  constructor(db: DatabaseSync, now?: () => number);
  get(): Promise<string>;
  set(text: string): Promise<void>;   // delegates to setSync
  /** The synchronous write. onTrimNeeded's BEGIN…COMMIT must never await inside itself. */
  setSync(text: string): void;        // caps at SUMMARY_TOKEN_CAP, writes tokens + updated_ts
  getSync(): string;
  updatedAt(): number;
}

/** The §4.4 cap rule, exported so it is testable in isolation and reusable by onTrimNeeded. */
export function capSummary(text: string, maxTokens?: number): string;   // default SUMMARY_TOKEN_CAP

/** RE-EXPORTS, not fresh consts — the value is literally one binding (§3.8.2 owns it). */
export { SUMMARY_TOKEN_CAP, MAX_FACTS as SUMMARY_MAX_FACTS } from '@ds/brain';
```

`capSummary(text)` enforces the cap by **truncating on sentence boundaries** from the end until `estimateTokens(kept) <= 600` (never mid-sentence), and `setSync` then writes `UPDATE summaries SET content=?, tokens=?, updated_ts=? WHERE id=1`.

> **The terminator set is `[。！？!?]`, and the split is `const SENTENCE_BOUNDARY = /(?<=[。！？!?])/;`.** `…` and `\n` are deliberately **excluded**, even though §3.3's `SentenceSplitter` also breaks on them: the §4.4 summariser prompt forbids bullet points, so `\n` is not a boundary in its output, and a `…` inside a summary is a stylistic pause rather than a sentence end. This exact set is what reproduces §8.7's measured **2 000 → 600 tokens / 900 characters / ends on `。`** — widening it moves all three numbers.

**Degenerate case, pinned:** if the **first sentence alone** exceeds the cap, or the text contains **no sentence terminator at all**, the text is stored **whole** rather than cut mid-sentence. An over-cap summary is a bounded, visible cost; a summary sliced mid-clause is silent corruption of the model's memory.

> Earlier drafts showed `SUMMARY_TOKEN_CAP` / `SUMMARY_MAX_FACTS` as fresh `const`s while the same paragraph called them "re-exported from `@ds/brain`, single value". The re-export form above is the one that makes the prose true.

**When it refreshes:** only at a trim event — i.e. exactly when `TurnRunner` observed `planTrim(...).drop.length > 0` and called `onTrimNeeded`. There is no timer, no per-turn refresh, and no consolidation pass in Phase 2 (that is Phase 3, spec §6 tier 3). This is what keeps the cached prefix stable for the ≥ 70 % cache-hit target.

The `summarize` implementation lives in **main**, not here: `apps/desktop/src/main/summarizer.ts`

```ts
export function makeSummarizer(client: ChatClient, charName = '小春'): Summarize;

/** The literal system message below, and the 900 the call uses — named so the test asserts a
 *  name rather than re-typing 120 characters of Chinese. */
export const SUMMARY_SYSTEM: string;
export const SUMMARY_MAX_TOKENS = 900;
```

`charName` is the prefix on the assistant lines of the rendered transcript. The default keeps §4.4's original literal behaviour; **main passes `bundle.card.name`**, because P0 changes the persona and a hard-coded `小春：` would mislabel every assistant line the summariser reads. `client.complete()` is on the `ChatClient` **interface** (§3.9), so `createFakeClient()` (§6.7) satisfies this too.

It issues one **non-streaming** `deepseek-v4-flash` call via `client.complete()` with `maxTokens: 900` and this system message (literal):

```
把下面的聊天记录压缩成一段中文摘要，第三人称，只保留后面还用得上的事实和约定：人名、称呼、正在发生的事、答应过的事、明确说过的喜好和忌讳。不要写心情描写，不要写评价，不要分点，不超过三百字。
```
followed by one user message containing the old summary (if any) and the dropped messages rendered as `用户：…` / `${charName}：…` lines.

Required tests (`summary.test.ts`): `set()` on a 2,000-token string stores ≤ 600 estimated tokens (measured: 2 000 → 600, 900 characters, ending on `。`) and the stored text ends on a sentence terminator; `get()` after `set()` round-trips; `updatedAt()` advances; `capSummary` on a single terminator-free 2,000-token string returns it **unchanged**; `setSync` performs no `await` (asserted by calling it inside a `db.exec('BEGIN')` … `db.exec('COMMIT')` pair).

> **T5 also runs the `@ds/memory` half of §7.1's Node-type-stripping smoke**, as its own step, rather than leaving it all to T9. §7.1 assigns that smoke to **T9**, which merges eight tasks later; an R1 (erasable syntax) or C1 (`.ts` extension) violation introduced in `@ds/memory` would otherwise first surface there as a `node run.mjs` import failure with no obvious owner. The step costs one command and fails loudly in the task that caused it. T9's full smoke is unchanged and still runs.

---

## 5. Bubble (own window, R3)

Files: `apps/desktop/src/renderer/bubble.html` + `src/renderer/bubble/{main.ts,bridge.ts,reveal.ts,reveal.test.ts,bubble.ts,speech.ts,hint.ts,fps.ts}`, and `src/main/{bubble-window.ts,bubble-place.ts,bubble-place.test.ts}`.

### 5.1 `bubble/reveal.ts` — `RevealPlan` (R10.4)

```ts
export interface RevealStep { grapheme: string; delayMs: number; mouth: boolean }
export interface RevealOptions { hanziMs?: number; latinMs?: number; commaMs?: number; periodMs?: number }
export const REVEAL_DEFAULTS = { hanziMs: 70, latinMs: 35, commaMs: 150, periodMs: 300 } as const;

export const COMMA_PUNCT = '，、；：,;:';
export const SENTENCE_PUNCT = '。！？!?…';

export class RevealPlan {
  private readonly plan: RevealStep[];
  constructor(text: string, opts?: RevealOptions);
  steps(): readonly RevealStep[];
  totalMs(): number;    // sum of every delayMs
}
```

Exact semantics (R10.4 — do not re-derive):

1. Segmentation is **grapheme-cluster** based: `new Intl.Segmenter('zh', { granularity: 'grapheme' })`. This is where D1's grapheme awareness lives; `sanitizeForDisplay` no longer pretends to do it.
2. `delayMs` is the wait **before** painting that grapheme. A step's grapheme becomes visible after its own `delayMs` has elapsed.
3. Base cost: `latinMs` (35) when the grapheme matches `/^[\x20-\x7E]$/` (printable ASCII, so Latin letters, digits, ASCII punctuation and the space); `hanziMs` (70) otherwise (hanzi, kana, CJK punctuation, emoji).
4. Pause cost, **added to** the base: `+commaMs` when the grapheme is in `COMMA_PUNCT`; `+periodMs` when it is in `SENTENCE_PUNCT`.
5. `mouth` is `false` when the grapheme is in `COMMA_PUNCT` or `SENTENCE_PUNCT` or matches `/\s/`; `true` otherwise.
6. `totalMs()` is the plain sum. `……` is two `…` graphemes and therefore costs `2 × (70 + 300) = 740` — this is intended, and the linter caps `……` at one per reply anyway.

Required tests (`reveal.test.ts`, numeric with `toBe` — D11):

```ts
const T = '一二三四五六七八九十一二三四五六七八九十，。';   // 20 hanzi + 1 comma + 1 period
it('costs 20*70 + (70+150) + (70+300) ms', () => expect(new RevealPlan(T).totalMs()).toBe(1990));
it('closes the mouth on punctuation', () => {
  const s = new RevealPlan(T).steps();
  expect(s[20].mouth).toBe(false);   // ，
  expect(s[21].mouth).toBe(false);   // 。
  expect(s[0].mouth).toBe(true);
});
it('reveals Latin faster', () => expect(new RevealPlan('abc').totalMs()).toBe(105));
it('keeps a ZWJ emoji as one step', () => {
  const s = new RevealPlan('好👨‍👩‍👧').steps();
  expect(s).toHaveLength(2);
  expect(s[1].grapheme).toBe('👨‍👩‍👧');
  expect(s[1].delayMs).toBe(70);
});
```

### 5.2 `bubble/bubble.ts` and `bubble/speech.ts`

```ts
export interface BubbleOptions { maxWidth: number; maxHeight: number; side: Side; arrowOffset: number }

export class Bubble {
  constructor(root: HTMLElement);
  /** Applies the geometry main just computed. Called on every `bubble:place`. */
  place(o: BubbleOptions): void;
  show(): void;                       // enter animation, --dur-overlay / --ease-enter
  hide(): void;                       // exit animation, --dur-exit / --ease-exit (BUBBLE_EXIT_MS)
  setText(text: string): void;        // textContent only — never innerHTML
  clear(): void;
  /** Measured content box, reported to main as `bubble:size`. */
  measure(): { width: number; height: number };
  /** True when the text node is clipped by its max-height. `measure()` cannot report this. */
  overflowing(): boolean;
  /** The ADV name plate's text. Hidden when never set or set to ''. */
  setName(name: string): void;
  /** The blinking advance mark (--c-advance, --dur-blink). */
  setAwaiting(on: boolean): void;
  /**
   * Writes `data-emotion` on the band root. §5.8 requires the bubble to set it from
   * `SentenceEvent.emotion` on every `onSentence` and clear it to 'neutral' on `beginTurn()`,
   * but the surface had no method that could — leaving T0's nine [data-emotion] rules dead CSS.
   * `SpeechController` is the only caller.
   */
  setEmotion(e: Emotion): void;
  readonly visible: boolean;
  pinned: boolean;                    // true while the pointer is over the bubble; defers the TURN-level hide
}

/** Named export for what was an inline constructor parameter type. Same five members, nothing
 *  added; it exists so `speech.test.ts` can build a deps object without repeating the shape. */
export interface SpeechDeps {
  bubble: Bubble;
  hint: HintSurface;
  bridge: DsBridge | undefined;      // undefined in browser/Playwright mode
  now?: () => number;
  raf?: (cb: () => void, ms: number) => number;   // injectable timer, default setTimeout
}

export class SpeechController {
  constructor(deps: SpeechDeps);
  onState(p: { state: TurnState; turnId: string }): void;
  onSentence(ev: SentenceEvent): void;
  onTurnDone(p: { turnId: string }): void;
  onError(p: { code: ErrorCode; message: string }): void;
  /** Pointer over the bubble/hint DOM. Defers the turn-level hide; NEVER pauses the reveal. */
  setPinned(inside: boolean): void;
  /** Instantly finish the sentence being revealed and drain the queue's reveal timers. */
  complete(): void;
  /** Test hook used by Playwright via `window.__bubble.speak(...)`. Resolves on `playback:turnDone`. */
  speak(events: SentenceEvent[]): Promise<void>;
}

export const LINGER_MS = 3000;       // TURN-level only, see below
export const BUBBLE_EXIT_MS = 160;   // mirrors --dur-exit; jsdom has no transitionend
export const HINT_GAP = 8;           // mirrors --sp-2
```

**Constant placement, pinned** (the list above names five constants and, in a draft, no file for any of them — two modules then each declared a subset):

| Constant | Exported from | Why there |
|---|---|---|
| `BUBBLE_EXIT_MS = 160` | **`bubble/bubble.ts`** | it mirrors `--dur-exit`, and `bubble.ts` is the only module that animates it |
| `LINGER_MS = 3000` | **`bubble/speech.ts`** | turn-level timing is `SpeechController`'s |
| `HINT_GAP = 8` | **`bubble/speech.ts`** | mirrors `--sp-2`; the gap is between the band and the hint, which only `speech.ts` sequences |
| `MAX_LINES = 6` | **`bubble/speech.ts`** | |
| `MAX_HANZI_PER_LINE = 24` | **`bubble/speech.ts`** | |

No value changes; only the home does. `main/bubble-window.ts`'s `BUBBLE_LINGER_MS` (§5.4) must equal `LINGER_MS`, and its `BUBBLE_HIDE_DELAY_MS = 400` is a **different** number under a **different** name (§5.4's box, §8.6 row 5).

`bubble/main.ts` owns the DOM listeners (pointerenter/leave, click) and reports pointer state through `setPinned`; `SpeechController` re-arms the hide timer on leave. `beginTurn()` calls `hint.dismiss()` — that is the **only** use of the `hint` dependency, and it exists so a stale system hint never sits under a fresh reply.

Behaviour, pinned:

- `state === 'thinking'` for a new `turnId` → drop any queued sentences, `bubble.setText('')`, show the **three-dot breathing** indicator (a CSS-only `::after` animation on the bubble surface, no text), `bubble.show()`.
- `onSentence(ev)` → push onto a FIFO. The queue is drained one sentence at a time. For each: wait `ev.pause ?? 0` seconds; build `new RevealPlan(ev.text)`; step through it appending graphemes to the visible text; emit `speech:mouth {on}` **only when `step.mouth` differs from the last emitted value**; **the moment the last grapheme is painted, send `playback:sentenceDone {turnId, seq}` and start the next queued sentence immediately.**
- Text accumulates **within a turn**: sentence *k+1* is appended to what is already shown, not replacing it, until `bubble.overflowing()` reports the text node is clipped, at which point the oldest sentence is dropped from the DOM (the history pane keeps everything). Max 6 lines (C6).
- After the last sentence of a turn is shown and `brain:turnDone` for that `turnId` has arrived → send `playback:turnDone {turnId}`, emit `speech:mouth {on:false}`, and start the `LINGER_MS` linger before `bubble.hide()`.
- `complete()` → cancel the pending reveal timer, paint the remainder of the current `RevealPlan` at once, emit `speech:mouth {on:false}`, and continue the queue with no further waits.
- A click anywhere on the bubble → `complete()` **and** `chat:open {source:'bubble', focusComposer:true}` (C-12: clicking the bubble opens the chat; completing the reveal in the same gesture is the addendum's "click completes instantly").
- `onError` → drop the queue, `bubble.hide()`, and emit `speech:mouth {on:false}` **when the mouth is currently open**, so the pet's mouth cannot stick open after an aborted turn. The message itself goes to the **hint surface** via `hint:show` from main, never into the bubble (C10/C-10).
- **`onState({state:'idle'})` drops the queue** and stops the current reveal, then calls the **same `finishTurn()` the normal path calls**. This is what stops the bubble after `user:cancel`: §3.11.4 aborts the runner and §5.2 paints the queue, but the only signals that cross are `brain:turnDone` and `brain:state`. Rather than add a `playback:stop` channel to §2.3, `idle` is given this meaning — the simplest option, one existing channel, no new schema. An `idle` for a `turnId` the controller never saw is ignored.

  **What `finishTurn()` does, pinned** (a draft said `idle` "runs the normal hide path" without saying what it emits): it is guarded by an idempotent `finished` flag, so **at most one `playback:turnDone` is ever sent per turn** whichever path arrives first; the **already-painted text stays on screen** — nothing is cleared, because the user was reading it — and the band hides after a **full `LINGER_MS`**, not a shortened one. It also emits `speech:mouth {on:false}` if the mouth is open.
- `pointerenter`/`pointerleave` on the bubble or the hint element → `setPinned(true/false)` **and** `bubble:hover {inside}` to main.

**Linger is a turn-level rule, never a sentence-level one (AMENDS the earlier §5.2 wording).** The original text made every sentence wait `LINGER_MS` before `sentenceDone`, which adds 6 s of dead air to a 3-sentence reply and lets `pinned` stall the queue forever. Pinned instead:

- `playback:sentenceDone` fires at the last grapheme; the next sentence's own `ev.pause` (the `<|PAUSE n|>` beat) is the **only** inter-sentence gap.
- `LINGER_MS = 3000` applies **once per turn**, between `playback:turnDone` and `bubble.hide()`.
- **`bubble.pinned` defers only that turn-level auto-hide.** Hover never pauses the reveal — the text keeps painting under the pointer — and `pointerleave` re-arms a **full** `LINGER_MS`.

> **Hover defers main's window-level hide too (§5.2 ↔ §5.4, resolved).** Nothing previously said how the renderer's `bubble.pinned` interacts with main's separate hide timer. It had to be said, because the two run on different clocks: the renderer defers `bubble.hide()` for as long as the pointer is inside, while §5.4's trigger hides the **window** a flat `BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS` (3400 ms) after `playback:turnDone` — so a user hovering to finish reading would watch the window vanish out from under a band that was still painted. **Rule: `bubble:hover {inside:true}` cancels main's pending hide; `{inside:false}` re-arms the full `BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS`.** Main already receives `bubble:hover` for `setIgnoreMouseEvents` (§5.4 rule 4), so this costs one boolean and one timer re-arm in the handler it already has — no new channel, no new schema. The rejected alternative was to scope §5.2's pinning promise to the band only and record that the window may hide under a pinned band; it is rejected because the visible result is the bug, not the fix. §5.4 rule 4 is extended accordingly.

`MAX_LINES = 6`, `MAX_HANZI_PER_LINE = 24`.

> **`BUBBLE_MAX.width = 460` and the hanzi-per-line cap are now simultaneously satisfiable, at 24.** Measured: at the widest line the text box is `460 − 24 (shadow room) − 12 − 32 (padding) − 2 (border) = 390 px = 24 hanzi` at `--fs-bubble` 16px. The earlier 26 was unreachable, so one of the two constants was always dead. **24 wins** because `BUBBLE_MAX.width = 460` is fixed by R3 ("sized by content up to 460×320 DIP") and a ruling outranks a derived constant, while 24 is still inside the addendum's "24–28 hanzi per line" band. `max-width: calc(24 * 1em)` is kept on the text node so short lines are never clipped; `.content`'s 460 px cap wins on the widest lines. Widening `BUBBLE_MAX.width` to 486 to keep 26 was the alternative and is **rejected** — it would contradict R3.

**The bubble renderer imports `BUBBLE_MIN` / `BUBBLE_MAX` from `../../main/bubble-place`** (a pure module with no Electron import) rather than duplicating 120/44/460/320, and **clamps `bubble:size` renderer-side**: a hidden bubble measures 0×0 and the channel's schema requires `z.number().positive()`, so an unclamped report is rejected at the boundary.

**The three geometry custom properties — one owning element, named, because writer and consumer had drifted apart.** `Bubble.place()` sets `--bubble-max-w`, `--bubble-max-h` and `--arrow-offset` from the `bubble:place` payload. A draft wrote all three on the **band root** (`Bubble`'s own `root`) while the T7 layout consumes `max-width: var(--bubble-max-w)` on `#content`, the band's **parent** — and custom properties inherit **downwards only**, so the 460 px cap silently resolved to nothing and the band could grow past the window. Pinned:

| Token | Written on (owner) | Consumed by |
|---|---|---|
| `--bubble-max-w` | **`document.documentElement`** (`:root`) | `#content`'s `max-width`, and any hint-surface cap |
| `--bubble-max-h` | **`document.documentElement`** | `#content`'s `max-height` |
| `--arrow-offset` | **`document.documentElement`** | the band root's `[data-side]` anchor-notch pseudo-elements |

`place()` therefore writes `document.documentElement.style.setProperty(...)` for all three, and keeps writing `data-side` on the band root (that one is an attribute selector, not an inherited value, and its consumer *is* the band). `:root` is chosen over `#content` because every consumer — `#content`, the band, the hint, all descendants of `<html>` — inherits from it, and because the alternative requires `Bubble` to take a second element in its constructor for one call. The bubble window hosts exactly one `Bubble`, so writing outside its own root is unambiguous here. The jsdom assertion is on `document.documentElement.style.getPropertyValue('--bubble-max-w')`, not on the band root's.

### 5.3 `main/bubble-place.ts` — `placeBubble` (pure)

> **AMENDED, Task 10 fix round 1 (2026-08-29).** Everything from `HEAD_ANCHOR` down was rewritten
> when the controller's required placement fix landed (commit `02ad454`), and this section was left
> describing the retired geometry. It is now the shipped geometry. **`HEAD_ANCHOR` no longer exists**
> — it anchored every placement at 18 % of the pet window's height, i.e. her FACE, which is the
> defect `docs/evidence/phase2/desktop-chat-over-pet.png` and `task6-fake-brain-run.png` recorded.
> The band now sits over her LOWER THIRD and extends LEFT so she stands in its right third, which is
> what `task-0-direction.md` (FIRST VIEWPORT) and `apps/desktop/DESIGN.md` always said. `top` and
> `bottom` are no longer reachable placements: the notch lives on a vertical edge. The five numeric
> examples in §5.3.1 and the `placeBubble` row of §8.7 moved with it, and
> `apps/desktop/src/main/bubble-place.test.ts` test **G2** pins all five.

```ts
// D3 discipline: ONE definition. `SideSchema`/`Side` live in @ds/protocol (§2.2); this is a re-export,
// never a second `type Side = 'top' | 'right' | 'bottom' | 'left'`.
export type { Side } from '@ds/protocol';

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement { x: number; y: number; side: Side; arrowOffset: number }

export const BUBBLE_GAP = 12;          // addendum C6 offset(12) — the clearance the band leaves round the composer
export const BUBBLE_PADDING = 16;      // addendum C6 shift({padding:16})
export const BUBBLE_MAX: Size = { width: 460, height: 320 };   // R3
export const BUBBLE_MIN: Size = { width: 120, height: 44 };
export const ARROW_MARGIN = 18;

export const BAND_ANCHOR_Y = 0.72;          // the band's vertical CENTRE, as a fraction of pet.height
export const BAND_TOP_MAX_FRACTION = 0.55;  // hard floor for its TOP edge; yields to the work area
export const BAND_PET_FRACTION = 0.8;       // her horizontal centre inside the band, extending left

export function preferredSideFor(pet: Rect, workArea: Rect): Side;
export function placeBubble(
  pet: Rect, size: Size, workArea: Rect, preferredSide: Side, avoid?: Rect | null,
): Placement;
```

All four arguments and the result are in **DIP screen coordinates** — exactly what `BrowserWindow.getBounds()` and `screen.getDisplayMatching(...).workArea` return. `workArea` **must** be `screen.getDisplayMatching(petBounds).workArea`, never `screen.getPrimaryDisplay().workArea`; that single choice is what makes C14 ("bubble never crosses a monitor edge") true on mixed-DPI setups.

Algorithm, exactly:

1. `petCx = pet.x + pet.width/2`, `bandCy = pet.y + pet.height * BAND_ANCHOR_Y`, `topFloor = pet.y + pet.height * BAND_TOP_MAX_FRACTION`. `waL = workArea.x + PAD`, `waR = workArea.x + workArea.width - PAD`, `waT = workArea.y + PAD`, `waB = workArea.y + workArea.height - PAD`, `yMax = max(waT, waB - size.height)`.
2. **Row.** `y = clamp(max(bandCy - size.height/2, topFloor), waT, yMax)` — the band is centred on the anchor row, never starts above the 55 % floor, and never leaves the work area. The last clamp is what makes the floor *yield*: C14 is a contract, the floor is a composition rule, and a window too tall to fit between them is placed against the work area (the 468 DIP composer-with-history case lands at 36 % of the pet, pinned in `bubble-place.test.ts`).
3. **Column.** Candidate order is `[first, OPPOSITE[first]]` with `first = preferredSide === 'right' ? 'right' : 'left'` and `OPPOSITE = {left:'right', right:'left'}`. There are only two candidates: `top` and `bottom` are unreachable, and a `'top'`/`'bottom'` argument from a caller that predates this geometry reads as the default, `left`. Origins: `xFor('left') = petCx - size.width * BAND_PET_FRACTION`, `xFor('right') = petCx - size.width * (1 - BAND_PET_FRACTION)`. The band therefore **overlaps her body** — she stands at 80 % of its width on the left flip, 20 % on the right — and `BUBBLE_GAP` is not a gap to her.
4. A candidate **fits** when `x >= waL` and `x + size.width <= waR`. The first fitting candidate wins (this is `flip()`). Only the horizontal axis flips; the row is already inside the work area by step 2.
5. If neither fits (a band wider than the room either way), keep the preferred side and shift: `x = clamp(x, waL, max(waL, waR - size.width))`. The `max(...)` makes it left-aligned rather than producing a reversed range.
6. **`avoid`** (added in Task 10 fix round 1; the floor guard added in **fix round 2**). When `avoid` is non-null and `{x, y, ...size}` shares a pixel with it, the band steps out of its way on the vertical axis — the same flip-then-give-up discipline the horizontal axis uses. Below first: `y = avoid.y + avoid.height + BUBBLE_GAP` when `y + size.height <= waB`; otherwise above: `y = avoid.y - BUBBLE_GAP - size.height` when `y >= max(waT, topFloor)`. **When the dodge and the 55 % floor conflict, the FLOOR wins**: the band gives up the dodge, keeps step 2's `y`, and the two rects overlap. The floor is the controller's placement ruling (`02ad454` exists to satisfy it); the dodge is a courtesy, and a courtesy may not put the band on her face. Without that guard the composer with its history pane open — 468 DIP, always clamped against the work-area bottom by step 2's own deliberate exception, so there is never room below it — pushed every band above the composer and above the pet window itself (a 460×320 band landed at `y = 224`, i.e. −10 % of the pet). So the band keeps step 2's `y` and the two rects overlap in **two** cases now: when neither side of `avoid` has room inside the work area (**C14 outranks the dodge**), and when the only side with room is above the 55 % floor (**the floor outranks the dodge**). `bubble-place.test.ts` pins that these are the only cases in which they can overlap, and that the dodge never raises the band above `min(topFloor, step 2's y)`. `avoid` is only ever the VISIBLE composer's rect, and only the band ever passes it (§6.1).
7. `arrowOffset = clamp(bandCy - y, ARROW_MARGIN, max(ARROW_MARGIN, size.height - ARROW_MARGIN))` — the notch sits on the pet-facing **vertical** edge at the band's anchor row. There is no horizontal-tail case any more.
8. `x`, `y` and `arrowOffset` are `Math.round`ed last (Electron `setBounds` takes integers); the fit tests use the unrounded values.

`preferredSideFor(pet, workArea)` returns `'left'` whenever `pet.x + pet.width * BAND_PET_FRACTION - (workArea.x + BUBBLE_PADDING) >= BUBBLE_MIN.width`, else `'right'`. It is **LEFT at every pet position that has room for a minimum band** — deliberately not "the roomier half of the screen", which made the band flip sides halfway across the desktop for no reason the user could see. Main calls it on every placement, and `placeBubble` re-tests the fit against the actual band size, so this is a hint rather than the decision.

#### 5.3.1 Numeric examples (these are the required unit tests — C14)

**AMENDED, Task 10 fix round 1.** All five rows moved with the band geometry above; the old rects
described `HEAD_ANCHOR` and are unreachable (`side` can only be `left` or `right` now). These are the
values the shipped `placeBubble` returns, pinned by test **G2** in `bubble-place.test.ts` and by
§8.7's `placeBubble` row.

| # | Case | `pet` | `size` | `workArea` | `preferredSide` | **Expected** |
|---|---|---|---|---|---|---|
| A | fits on the preferred side | `{1476, 296, 420, 720}` | `{320, 120}` | `{0, 0, 1920, 1040}` | `left` | `{x:1430, y:754, side:'left', arrowOffset:60}` |
| B | flips left → right at the screen edge | `{24, 296, 420, 720}` | `{320, 120}` | `{0, 0, 1920, 1040}` | `left` | `{x:170, y:754, side:'right', arrowOffset:60}` |
| C | pet at the top of the screen — still her lower third, no top/bottom flip | `{1476, 0, 420, 720}` | `{320, 120}` | `{0, 0, 1920, 1040}` | `left` | `{x:1430, y:458, side:'left', arrowOffset:60}` |
| D | nothing fits → shift, and the work area wins over the 55 % floor | `{290, 0, 420, 600}` | `{460, 520}` | `{0, 0, 1000, 600}` | `left` | `{x:132, y:64, side:'left', arrowOffset:368}` |
| E | **mixed DPI**, pet on the secondary display | `{2900, 296, 420, 720}` | `{380, 160}` | `{1280, 0, 1920, 1040}` | `left` | `{x:2804, y:734, side:'left', arrowOffset:80}` |

Row B is the flip: `preferredSideFor` still says `left` (a minimum band fits there), but a 320-wide
band placed left of a pet at `x = 24` would start at `-22`, so `placeBubble` takes the right
candidate and she ends up in the band's LEFT third. Row D is the yield: a 520 DIP window does not
fit between the 55 % floor and a 600 px work area, so C14 places it against the work area instead.

Example E's display topology, spelled out because it is the case that breaks naive code: primary 1920×1080 at 150 % scaling reports DIP bounds `{0,0,1280,720}` / workArea `{0,0,1280,680}`; a secondary 1920×1080 at 100 % placed to its right reports bounds `{1280,0,1920,1080}` / workArea `{1280,0,1920,1040}`. Passing the **primary's** work area here would clamp `x` to at most `1280 - 16 - 380 = 884` and throw the bubble onto the other monitor. A sixth test asserts exactly that failure mode is avoided:

```ts
it('never leaves the display the pet is on (mixed DPI)', () => {
  const p = placeBubble({x:2900,y:296,width:420,height:720}, {width:380,height:160},
                        {x:1280,y:0,width:1920,height:1040}, 'left');
  expect(p.x).toBeGreaterThanOrEqual(1280 + 16);
  expect(p.x + 380).toBeLessThanOrEqual(1280 + 1920 - 16);
});
```

### 5.4 `main/bubble-window.ts` — lifecycle (R3)

```ts
export function createBubbleWindow(): BrowserWindow;
export function placeBubbleWindow(bubble: BrowserWindow, pet: BrowserWindow, size: Size): Placement;
export function setBubbleClickThrough(bubble: BrowserWindow, ignore: boolean): void;
export function showBubble(bubble: BrowserWindow): void;    // showInactive
export function hideBubble(bubble: BrowserWindow): void;

/** Rule 2's clamp, as its own pure function so it is testable without a BrowserWindow. */
export function clampBubbleSize(size: Size): Size;          // clamps into [BUBBLE_MIN, BUBBLE_MAX]
/** Rule 3's re-placement at the CURRENT size, for pet drag / dragEnd / display-metrics-changed. */
export function repositionBubble(bubble: BrowserWindow, pet: BrowserWindow): void;

/** Must equal SpeechController's LINGER_MS (§5.2). */
export const BUBBLE_LINGER_MS = 3000;
/** Grace for the renderer's exit animation before the WINDOW is hidden. */
export const BUBBLE_HIDE_DELAY_MS = 400;
```

> **Name collision, resolved.** A draft called this second constant `BUBBLE_EXIT_MS = 400` while the renderer's §5.2 constant is `BUBBLE_EXIT_MS = 160` (it mirrors `--dur-exit`). Two different numbers under one name in two modules is a trap, so the **main-process** one is renamed `BUBBLE_HIDE_DELAY_MS`. The renderer keeps `BUBBLE_EXIT_MS = 160`; main waits the longer 400 ms so the CSS exit has finished before the window disappears.

**Show/hide triggers** (§5.4 pinned "created hidden, appears when there is something to say" but named no trigger): the bubble **window** is shown when a turn starts (`brain:state` leaves `idle`) or a hint fires, and hidden `BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS` after `playback:turnDone`. Window visibility always loses to `VisibilityState` (rule 5 below).

**Two more hide triggers, because `playback:turnDone` does not always come:**

1. **`brain:state idle` for a turn that emitted zero sentences.** When every sentence was stripped (§3.11.2 step 4) the bubble has nothing to acknowledge and never sends `playback:turnDone`, so the sole trigger above never fires and the window stays up showing the thinking dots forever. `brain:state idle` is the second trigger, on the same `BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS` delay.
2. **`playback:turnDone` for the synthetic `'first-mes'` turn** (§6.6). That turn produces no `brain:state` at all, so its `playback:turnDone` is what takes the window back down — main consumes it for the hide even though T6 drops `'first-mes'` `playback:*` before it reaches any `TurnRunner`.

Window options — literal, and identical in spirit to the pet window so the two never fight:

```ts
new BrowserWindow({
  width: BUBBLE_MAX.width, height: BUBBLE_MAX.height,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',      // C2 — zero white frames
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,
  hasShadow: false,
  resizable: false,
  show: false,                       // C2 — showInactive on ready-to-show
  webPreferences: {
    preload: join(__dirname, '../preload/bubble.cjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    backgroundThrottling: false,
  },
});
win.setAlwaysOnTop(true, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
setBubbleClickThrough(win, true);    // setIgnoreMouseEvents(true, { forward: true })
```

Lifecycle rules:

1. Created once at startup, immediately after the pet window, and kept for the app's life. `ready-to-show` → **stays hidden** (it only appears when there is something to say).
2. `bubble:size` from the renderer → clamp to `[BUBBLE_MIN, BUBBLE_MAX]`, `placeBubble(pet.getBounds(), clamped, screen.getDisplayMatching(pet.getBounds()).workArea, preferredSideFor(...), avoidRect)` — `avoidRect` is the visible composer's bounds or `null` (§5.3 step 6, §6.1), `win.setBounds({...placement, ...clamped})`, then send `bubble:place {maxWidth, maxHeight, side, arrowOffset}` back so the renderer can draw the tail on the right edge. `maxWidth/maxHeight` are always `BUBBLE_MAX` — the renderer lays out inside them and reports what it actually needs.
3. Re-placed on **every** pet move: the existing `avatar:drag` handler in `main/index.ts` already calls `moveBy(win, dx, dy)`; add a `placeBubbleWindow(...)` call right after it, plus one on `display-metrics-changed` and on `avatar:dragEnd`.
4. `setIgnoreMouseEvents(true, {forward:true})` by default; `false` while `bubble:hover {inside:true}`. This is the same pattern as the pet's `avatar:hover` and reuses `setClickThrough`'s debounce discipline. **The pet window's hover predicate is not touched** — the bubble is a different window, which is precisely why R3 chose this shape (A57/A59 are dissolved, not patched). **The same handler also gates the hide timer** (§5.2's box): `{inside:true}` cancels a pending window hide, `{inside:false}` re-arms the full `BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS`. One channel, two effects, one handler.
5. Visibility: the bubble follows `VisibilityState.hidden`. `applyVisibility()` in `main/index.ts` gains `hidden ? hideBubble(bubble) : (speaking ? showBubble(bubble) : noop)` and sends `shell:visibility` to the bubble as well as the pet.
6. `showInactive()`, never `show()` — the bubble must never take focus (`focusable:false` makes that structural, this makes it explicit).
7. The pet window stays **420×720** and is not modified.

### 5.5 `bubble/hint.ts` — the system-hint surface (C10 / X6)

A second, independent layer inside the same bubble window, rendered below the bubble box with its own surface tokens so an error never looks like the character speaking.

```ts
export interface Hint { text: string; level: 'info' | 'warn' | 'error'; ttlMs: number }
export class HintSurface {
  constructor(root: HTMLElement);
  show(h: Hint): void;      // at most ONE visible; further hints queue
  dismiss(): void;
  readonly queueLength: number;   // capped at 3; the oldest queued hint is dropped beyond that
}
export const HINT_QUEUE_MAX = 3;
export const HINT_DEFAULT_TTL_MS = 6000;
```

**Main's side of the same number: `HINT_TTL_MS = 6000` in `apps/desktop/src/main/brain-service.ts`.** §2.3's `hint:show` schema requires a `ttlMs` on every send and §6.4 named no value for the main-process side, so main had a required field with no source. The two constants are deliberately separate bindings (main must not import from a renderer module) and deliberately equal; a T6 acceptance criterion greps both.

The band's left-edge treatment `--adv-cut: 14px` (§5.8) has one consumer: **`.bubble__rail`**, a skewed 3 px `--c-plate` rail on the band's left edge (`transform: skewX(var(--adv-skew))`, horizontal run `var(--adv-cut)`). §5.8 defined the token and named no consumer. The rail is the same technique §6.4 deviation 3 uses for the composer, and for the same reason: a `clip-path` on the band would also clip `--shadow-bubble`.

The hint element sits **below** the bubble at the bottom of the window content, separated by `HINT_GAP` (8 px, mirroring `--sp-2`), is `pointer-events: auto` (so it can be dismissed by clicking, which also fires `bubble:hover`), and uses `--c-surface-hint` with `--c-hint-text` (`level:'info'`) / `--c-warn-text` (`warn`) / `--c-danger-text` (`error`) — never the bubble's surface tokens. Task 0's direction contract suggests a strip *above* the band; **this contract wins** and the hint stays below (`flex-direction: column-reverse` on `#content` is the one-line swap if the controller ever prefers otherwise).

### 5.6 `bubble/fps.ts` and the single FPS writer (D7)

```ts
export function fpsFor(s: { hovering: boolean; speaking: boolean }): 30 | 60 {
  return s.hovering || s.speaking ? 60 : 30;
}
```

This function lives in the **pet** renderer's module graph (imported by `pet/main.ts`). `apps/desktop/src/renderer/pet/main.ts` keeps **one** piece of state, `const fpsState = { hovering: false, speaking: false }`, and **one** call site `stage.setFps(fpsFor(fpsState))`. The existing `new HoverTracker((inside) => { …; stage.setFps(inside ? 60 : 30); })` line is changed to set `fpsState.hovering = inside` and call the single writer; `brain:state` sets `fpsState.speaking = state !== 'idle'`. Two independent writers of `setFps` (A56/D7) must not survive this task.

A copy of `fpsFor` may not be added to the bubble renderer: the bubble has no Live2D ticker.

> **D7 is not softened.** A draft of T7's acceptance criteria explicitly permitted **two** `stage.setFps` call sites while `fps.ts`'s own comment claimed one. That is the rubric trap verbatim. The acceptance criterion is: `grep -c 'setFps' apps/desktop/src/renderer/pet/main.ts` returns **1**, and that one call is `stage.setFps(fpsFor(fpsState))`. Any brief that permits two is a defect.

> **Reaching 1 requires deleting the dormant `stage:setFps` renderer subscription.** `grep -c` counts matching **lines**, and `pet/main.ts` carries a second one on `main` — `bridge?.on(Channels.stageSetFps, ({ fps }) => stage.setFps(fps));` — which is both a second match and a second **writer**, i.e. the trap itself. Verified this session: `grep -rn 'stageSetFps' apps/desktop/src` matches **only** that renderer line, so **no file under `apps/desktop/src/main` ever sends the channel** and deleting the listener regresses nothing observable. **T7 deletes it.** `Channels.stageSetFps`, its schema and its `MAIN_TO_PET` membership all stay exactly as they are (§2.3, §2.5) — the channel remains available for a future main-side sender; only the dead subscription goes.

### 5.7 Pet renderer additions (T7)

`apps/desktop/src/renderer/pet/main.ts` gains exactly:

- `bridge.on(Channels.brainState, …)` → `fpsState.speaking`, and pose: `thinking` → `stage.setEmotion('think')` + `stage.playMotion(stage.config.motionMap.think)`; `idle` → `stage.setEmotion('neutral')`.
- `bridge.on(Channels.brainSentence, (ev) => { stage.setEmotion(ev.emotion); if (ev.motion && stage.config.motionMap[ev.motion]) stage.playMotion(stage.config.motionMap[ev.motion]); })`.
- `bridge.on(Channels.speechMouth, ({on}) => on ? stage.mouth.start() : stage.mouth.stop())`.
- `bridge.on(Channels.avatarListening, ({on}) => { if (on) stage.setEmotion('curious'); stage.mouth.stop(); })`.
- A double-click handler on the model: `dblclick` where `stage.hitTestClient(x,y) !== null` → `bridge.send(Channels.chatOpen, { source:'pet', focusComposer:true })`. **The existing single-tap reaction is unchanged** (C-12): a single click still plays a `tapMotions` motion and sends `avatar:tap`.
- Test hooks, extending the existing `__stage` object rather than replacing it: `mouth: () => stage.mouth.getParameter()`. **The `StageTestHook` interface gains `mouth(): number` too** — it is an *exported* interface that `apps/desktop/tests/stage.spec.ts` imports, so adding the property to the object literal alone fails `tsc -p tsconfig.renderer.json`.

`packages/stage` needs **no new methods**. R3 removed the need for `CompanionModel.hitAreaBounds` and a public view→client transform (A54/A55): the bubble is placed from the *window's* bounds in main, not from drawable vertices in the renderer. Do not add them.

Playwright assertion for the mouth (D8, non-flaky): poll `__stage.mouth()` every 50 ms for the reveal duration, collect ≥ 20 samples, and assert `Math.max(...samples) > 0.3` and that a sample taken 400 ms after completion is `< 0.05`. A single `page.evaluate` sample is forbidden — `TextMouthDriver` is a 4–7 Hz oscillator and would flake in a trough.

**Two harness-only affordances the bubble page carries, pinned so neither is mistaken for product behaviour:**

- **`body.browser`.** When the page runs with **no preload bridge** — the Playwright browser harness at `localhost:5174` — `bubble/main.ts` adds `browser` to `<body>`, and the stylesheet insets `#content` by `--sp-6`. That inset exists for exactly one reason: it gives the harness somewhere to move the pointer *off* the band so `pointerleave` can be proven to re-arm the linger. In the real window `#content` is flush and the class is never added.
- **The name plate's text comes from the public character file.** `bubble/main.ts` fetches `/characters/<id>/character.json` — the same `public/` copy the pet renderer reads, `?character=` param, default `haru` — and calls `bubble.setName(cfg.name)`. **On any failure the plate stays hidden**: no plate beats a wrong plate, and the bubble must never block its first paint on a fetch.

**No Playwright spec may import a Node builtin.** `apps/desktop/tsconfig.renderer.json` carries `"types": ["vite/client"]` — no node types — and its `include` carries `"tests"`, so an `import { writeFileSync } from 'node:fs'` in a spec fails `tsc -p tsconfig.renderer.json` with **TS2307**. Specs that need to hand data back (the mouth-sync samples) emit it with `console.log` and the run command captures it (`Tee-Object` into `docs/evidence/phase2/mouth-sync.txt`). This applies to every file under `apps/desktop/tests/`, including `tests/fake-bridge.ts`, which T8 and T10 both reuse. (`apps/desktop/tests-e2e/` is a different directory and a different rule — see §7.5.)

### 5.8 Design tokens the bubble and chat consume (names only)

Values are decided in Task 0 and written to `apps/desktop/src/renderer/shared/tokens.css` + `apps/desktop/DESIGN.md`. **Every name below must exist**, defined on `:root` for light and re-defined inside `@media (prefers-color-scheme: dark)` for dark (C12). No component may hard-code a colour, radius, duration or font size.

Colour roles:
```
--c-bg  --c-surface  --c-surface-2  --c-surface-hint  --c-border  --c-border-strong
--c-text  --c-text-2  --c-text-3
--c-accent  --c-accent-text  --c-accent-weak
--c-ok  --c-warn  --c-warn-text  --c-danger  --c-danger-text
--c-scrim  --c-focus-ring
--c-bubble-surface  --c-bubble-text  --c-bubble-border  --c-bubble-tail
--c-plate  --c-advance  --c-hint-text
```
`--c-bubble-surface` has alpha **0.92** exactly (C-4: C1 wins over C4's 0.85–0.92 range).

**The three tokens the ADV direction adds, and who consumes each** (this section predates `task-0-direction.md`, which R7 authorised):

| Token | Value | Consumer |
|---|---|---|
| `--c-plate` | defaults to `var(--c-accent)`; overridden by **nine `[data-emotion='<e>']` rules** in `tokens.css`, one per `EMOTIONS` member | T7's name plate fill ("state-as-material — emotion changes the plate tint and text weight, never a badge") |
| `--c-advance` | `#FFD166` dark / `#9A6A12` light (the light value is darkened so the mark clears 3:1 on the light band) | T7's blinking ▼ advance mark, used as `var(--c-advance, var(--c-warn))` so an older `tokens.css` degrades to the warn colour instead of rendering nothing |
| `--c-hint-text` | — | the `level:'info'` body colour on `--c-surface-hint` (§2.8, §5.5); `warn`/`error` keep `--c-warn-text`/`--c-danger-text` |

**Type and geometry tokens the direction adds:**
```
--fw-line: var(--fw-regular);   /* the band's body weight; three of the nine emotion rules raise it to --fw-medium */
--adv-skew: -8deg;              /* the plate's skew */
--adv-cut: 14px;                /* the band's left-edge run: tan(8°) x 100px = 14.05px at the 100px reference height.
                                   CONSUMER: `.bubble__rail` (§5.5) — a skewed 3px --c-plate rail, not a clip-path. */
--dur-blink: 1000ms;            /* the ▼ blinks at 1 Hz */
```

**`--font-sans` gains `"Segoe UI Variable Text"` immediately before `system-ui`** (R7's fallback names Segoe UI Variable; Chromium on Windows 11 resolves `system-ui` to plain Segoe UI, not the Variable family). Every other entry in the C5 stack stays byte-identical. This is the **only** permitted deviation from a C5 literal.

**Who writes `data-emotion`.** The bubble sets `data-emotion` on the **band root** from `SentenceEvent.emotion` on every `onSentence`, and clears it to `neutral` on `beginTurn()`. The nine `[data-emotion]` rules therefore key off exactly the `EMOTIONS` list (§2.1) — a token test asserts all nine selectors exist.

**The anchor notch uses `--c-bubble-tail`, not `--c-accent`.** The ADV form renders no triangle; `placeBubble` still returns `arrowOffset`, and T7 draws it as a 3 px `--c-bubble-tail` notch on the band's pet-facing edge at that offset. The token keeps its name, is asserted by the token test, and is documented honestly in `DESIGN.md`.

**`--c-accent` is authored in `tokens.css`, not read from `character.json`.** The direction contract calls the plate colour "the character's own accent (`haru: #E8A0B4`, from character.json)", but `characters/haru/character.json` has **no `accent` key** in Phase 2 and T3 owns that file. A per-character `accent` key is deferred to Phase 3 (when a second character ships); Phase 2 hard-codes Haru's accent as `--c-accent`. Recorded in `DESIGN.md`.

Radii (C5, fixed values, not negotiable):
```
--r-window: 8px;  --r-popover: 8px;  --r-bubble: 14px;  --r-control: 6px;  --r-tooltip: 4px;
```

Shadows (C5, fixed):
```
--shadow-popover: 0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12);   /* dark: .28 / .20 */
--shadow-bubble   --shadow-hint
```

Motion (C5, fixed):
```
--dur-feedback: 100ms;  --dur-state: 180ms;  --dur-overlay: 250ms;  --dur-exit: 160ms;
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
--ease-exit:  cubic-bezier(0.3, 0, 1, 1);
```
Only `transform` and `opacity` animate. Under `@media (prefers-reduced-motion: reduce)` every transition collapses to an ≤ 80 ms crossfade.

Type ramp (C5, fixed numbers; Task 0 picks the faces within them):
```
--font-sans: "MiSans VF","MiSans","HarmonyOS Sans SC","Noto Sans SC","Source Han Sans SC","Microsoft YaHei UI",system-ui,sans-serif;
--fw-regular: 400;  --fw-medium: 500;  --fw-semibold: 600;
--fs-caption: 12px;    --lh-caption: 18px;
--fs-body: 14px;       --lh-body: 22px;
--fs-bubble: 16px;     --lh-bubble: 26px;
--fs-bubble-lg: 18px;  --lh-bubble-lg: 28px;
--fs-title: 20px;      --lh-title: 28px;
```
CJK text rules applied wherever Chinese renders: `text-autospace: normal; line-break: strict; overflow-wrap: anywhere;`

Spacing: `--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px;`

Required token test (C12), `src/renderer/shared/tokens.test.ts`: parse `tokens.css`, resolve `--c-bubble-text` against `--c-bubble-surface` composited over `--c-bg` for **both** themes, and assert a WCAG contrast ratio ≥ 4.5:1. The same test asserts every name listed above is present in both blocks, and that all **nine** `[data-emotion='<e>']` rules exist, one per `EMOTIONS` member.

It runs in the **node** environment, not jsdom: every operation it performs is text parsing, and writing it with `node:fs` only is what lets T0 own it without touching `apps/desktop/vitest.config.ts` (which §1.4 assigns to T7). The same file passes unchanged once R6's `environmentMatchGlobs` puts `src/renderer/**` in jsdom.

Measured this session against T0's palette, and asserted with `toBeCloseTo(x, 2)` (D10) — **do not "fix" these numbers**: light band **14.7135** → `toBeCloseTo(14.714, 2)`, dark band **15.2548** → `toBeCloseTo(15.255, 2)`; every text pair ≥ 4.5:1, every UI pair ≥ 3:1, all nine plate tints ≥ 4.5:1 in both themes; `:root` carries **64** declarations and the dark block **29**.

---

## 6. Chat window and key window

### 6.1 Window options (C2) and sizes (C-9)

**The numbers live in `apps/desktop/src/renderer/shared/chat-metrics.ts`** — the single home, so the renderer (which measures rows) and main (which resizes the window) cannot drift:

```ts
export const CHAT_WIDTH = 360;
export const CHAT_ROW_H = 22;          // one composer line == --lh-body
export const CHAT_BASE_H = 48;         // 1 line + chrome (C-9: spec wins, 360x48)
export const CHAT_MAX_ROWS = 6;
export const CHAT_MAX_H = CHAT_BASE_H + CHAT_ROW_H * (CHAT_MAX_ROWS - 1);   // 158
export const CHAT_HISTORY_H = 420;     // additional height while the history pane is open
export const CHAT_GAP = 12;            // same gap constant as the bubble
```

`apps/desktop/src/main/chat-window.ts` **re-exports** them (`export { CHAT_WIDTH, … } from '../renderer/shared/chat-metrics';`) and re-declares none. Owner of `chat-metrics.ts` (+ its test): **T8**; owner of `chat-window.ts`: **T6**. Because T6 lands first, T6 creates `chat-metrics.ts` only if T8 has not yet — see §1.1; the file is listed there under T8, so T6 declares the constants in `chat-window.ts` and T8's first step converts them to the re-export. That conversion is in T8's Files table.

```ts
export function createChatWindow(): BrowserWindow;
export function openChat(win: BrowserWindow, pet: BrowserWindow, focusComposer: boolean): void;
export function closeChat(win: BrowserWindow): void;
/** Takes `pet` because a resize must re-place the window against the pet's display work area. */
export function resizeChat(win: BrowserWindow, pet: BrowserWindow, rows: number, historyOpen: boolean): void;

/**
 * The light-dismiss guard's memory (§6.1: `blur` closes the chat UNLESS the last `chat:composing`
 * said `{on:true}`). The `blur` listener is registered inside `createChatWindow`, so the last value
 * has to live in this module. `closeChat` and the window's `hide` both call `setChatComposing(false)`
 * — see §2.3's recovery rule; without that the guard is a one-way latch.
 */
export function setChatComposing(on: boolean): void;
export function isChatComposing(): boolean;
```

> **`resizeChat`'s signature is pinned at four arguments.** T6 produced `(win, pet, rows, historyOpen)` and T8 consumed `(win, rows, historyOpen)`; the four-argument form wins because the three-argument form cannot re-place the window and would let a grown chat cross a monitor edge — exactly what C14 forbids for the bubble. The `chat:resize` payload (§2.3) carries `rows` and `historyOpen`; main supplies `win` and `pet`.

```ts
new BrowserWindow({
  width: CHAT_WIDTH, height: CHAT_BASE_H,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',     // C2
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: true,                  // it must host the IME
  hasShadow: false,                 // the shadow is CSS (--shadow-popover), so corners stay CSS-only (C3)
  resizable: false,
  show: false,                      // C2: showInactive/show only on ready-to-show
  webPreferences: {
    preload: join(__dirname, '../preload/chat.cjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  },
});
```

`apps/desktop/src/main/key-window.ts`:

```ts
export const KEY_SIZE = { width: 440, height: 360 };
/** The union §6.1 used to spell inline, named so index.ts can type its helper. */
export type KeyWindowReason = 'first-run' | 'user' | ErrorCode;

export function createKeyWindow(): BrowserWindow;
/** 'user' covers the tray item, which is neither a first run nor an error. */
export function openKeyWindow(win: BrowserWindow, reason: KeyWindowReason): void;
/** Converts the key renderer's own window.close() into hide(), so the eager window survives. */
export function holdWindowOpen(win: BrowserWindow): void;
export function markQuitting(): void;   // released on 'before-quit'
```

**`holdWindowOpen` / `markQuitting` live here, in `key-window.ts`, and `src/main/window-glue.ts` does not exist.** This block and §1.1's (deleted) `window-glue.ts` row used to give the two functions two homes with no row resolving it, and T6 and T8 each followed a different sentence. **This block wins** (§8.6 row 11): T6 owns `key-window.ts`, needs the hold at **window-creation** time, and lands first; T8 imports both from `./key-window`. Owner: **T6**. T8 registers no `close` listener of its own, so there is exactly one `preventDefault` on that event.

**The key window closes itself with `window.close()`.** `KEY_TO_MAIN` contains only `chat:open`, so §6.4's "Esc closes" and "on success the window closes" have no channel and need none: the renderer calls `window.close()`, `holdWindowOpen(key)` converts it to `hide()`, and `markQuitting()` releases the hold on `before-quit`. Main also hides the key window when it receives `chat:open` with `source === 'key'`.

```ts
new BrowserWindow({
  width: 440, height: 360,
  backgroundColor: '#00000000',       // C2
  backgroundMaterial: 'mica',         // C4; silently ignored where unsupported
  show: false,                        // C2 + ready-to-show
  resizable: false,
  minimizable: false,
  maximizable: false,
  title: '小春 · API Key',
  webPreferences: { preload: join(__dirname, '../preload/key.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
});
```

Both windows: `win.once('ready-to-show', () => { /* do NOT show here */ })` — they are created hidden at startup and shown by `openChat` / `openKeyWindow`. Creating them eagerly is what makes C8's "opens ≤ 250 ms" reachable, and C2's zero-white-frame bar depends on `backgroundColor '#00000000'` + `show:false` being present on **every** new window.

Positioning: `openChat` calls **`placeBubble(petBounds, {width: CHAT_WIDTH, height: currentHeight}, workArea, preferredSideFor(petBounds, workArea))` verbatim**, with `workArea = screen.getDisplayMatching(pet.getBounds()).workArea` — one placement implementation for both surfaces, one set of tests, the same flip/shift discipline. The composer **never passes `avoid`**: it is the surface that keeps the band's anchor rect.

> **AMENDED, Task 10 fix round 1 (2026-08-29).** This paragraph used to pin the literal `'top'`, and the note below it recorded "the composer sits centred on her head … so no one fixes it back". Both are retired with `HEAD_ANCHOR` (§5.3): `'top'` is no longer a reachable side, and the composer over her face was the defect the controller ordered fixed (`desktop-chat-over-pet.png`). What survives from that note is the part that was always right — **there is exactly one placement implementation**, `placeBubble`, with `bubble-place.test.ts` behind it and C14's monitor-edge guarantee free; a second placement path for the chat window is still the rejected alternative (§8.6 row 16).
>
> **The two surfaces are one object in two states, but both windows can be on screen at once.** §6.2 rule 4 keeps the composer open for the whole reply (Escape cancels instead of closing while `brainState !== 'idle'`) and rule 6 needs it open to restore the text on `brain:error`. Two always-on-top windows on one rect therefore render two different texts into the same pixels — visible in `docs/evidence/phase2/app-placement.png`. The composer keeps the rect; **the BAND steps out of its way** through `placeBubble`'s `avoid` (§5.3 step 6), below it when the work area has room, above it when the work area does not but the 55 % floor still allows it, and not at all — the two rects overlap — when the only remaining room is above her face. Fix round 2: **the 55 % floor outranks the dodge**, exactly as C14 does. `brain-service.ts` supplies `avoid` from the chat window's bounds on every band placement and re-places the band on the chat window's `show`/`hide` and on `chat:resize`, so every path into and out of the composer state is covered without widening `openChat` / `resizeChat`. Hiding the band instead was rejected: it would make her whole reply invisible for as long as the composer is up.

Light dismiss: `win.on('blur', …)` closes the chat **unless** the last `chat:composing` said `{on:true}` (an IME candidate window steals focus). `Esc` in the renderer sends `chat:close`.

### 6.2 Composer behaviour

`apps/desktop/src/renderer/chat/Composer.tsx`:

```tsx
/** The three signal shapes are NAMED exports, not inline types: App.tsx and Composer.test.tsx
 *  both construct these values and would otherwise re-type the shapes in three places. */
export type SendResult =
  | { ok: true; turnId: string }
  | { ok: false; code: ErrorCode; message: string };
/** `n` is monotonic so a second event with the SAME turnId still fires the effect. */
export interface TurnDoneSignal { turnId: string; n: number }
/** `turnId` is `string | null`, never optional — see the note below. */
export interface TurnErrorSignal { turnId: string | null; code: ErrorCode; message: string; n: number }

export interface ComposerProps {
  onSend(text: string): Promise<SendResult>;
  onCancel(): void;
  onComposingChange(on: boolean): void;
  onCompleteSpeech(): void;
  onRowsChange(rows: number): void;
  /** rule 4: Escape -> chat:close. */
  onClose(): void;
  /** rule 8: the history toggle is in the composer's Tab order, so the composer owns it. */
  onToggleHistory(): void;
  historyOpen: boolean;
  /** rule 6: the composer clears/restores `pending` from these. */
  turnDone: TurnDoneSignal | null;
  turnError: TurnErrorSignal | null;
  brainState: TurnState;
  disabled?: boolean;
}
export function Composer(props: ComposerProps): JSX.Element;
```

> **`turnError.turnId` is `string | null`, normalised once.** `brain:error`'s wire schema has `turnId: z.string().optional()` (§2.3), so a payload can carry `undefined`. Rather than let every consumer compare against two absent-ish values, **`App.tsx` normalises once with `p.turnId ?? null`** and the prop type is `string | null`. Behaviour is identical to the optional form — an absent `turnId` still restores the pending text (rule 6) — but there is one absent value in the renderer instead of two.

The five added props exist because rules 4, 6 and 8 below are unexpressible without them: the original prop list gave the composer no way to close the window, no way to see `brain:turnDone` / `brain:error`, and no handle on the history toggle it must reach with `Tab`.

The two React roots:

```tsx
// src/renderer/chat/App.tsx
export function App({ bridge }: { bridge: DsInvokeBridge }): JSX.Element;   // from ./bridge
// src/renderer/key/App.tsx
export interface KeyAppProps { bridge: DsKeyBridge; onRequestClose(): void }  // DsKeyBridge, §2.6
export function App({ bridge, onRequestClose }: KeyAppProps): JSX.Element;
```

Both take the bridge as a **prop**, never off `window`, so both are testable in jsdom without a preload.

Rules, each one a test:

1. **IME (R6).** `onKeyDown`: `if (e.nativeEvent.isComposing || e.keyCode === 229) return;` **before** any other branch. A `compositionstart` sets local `composing = true` and calls `onComposingChange(true)`; `compositionend` clears it on the **next** macrotask (`setTimeout(…, 0)`) so the trailing `keydown` that some IMEs deliver after `compositionend` is still swallowed.
2. `Enter` without `Shift` and not composing, with non-empty trimmed text → send. With **empty** text → `onCompleteSpeech()` (this is the Phase 2 home of the addendum's "Enter completes the reveal"; **Space is deliberately not bound** — both surfaces that can receive keys treat Space as text. Recorded deviation).
3. `Shift+Enter` → newline (default textarea behaviour; do not `preventDefault`).
4. `Escape` → `chat:close`; if `brainState !== 'idle'`, `Escape` first calls `onCancel()` (`user:cancel`) and does not close.
5. Auto-grow: `rows = min(CHAT_MAX_ROWS, textarea.value.split('\n').length + wrapped-line overflow)`, measured by setting `height:auto` then reading `scrollHeight / CHAT_ROW_H`. `onRowsChange(rows)` drives `resizeChat` in main.
6. **Restore on failure (spec §8).** On send: clear the textarea, stash `pending = {text, turnId}` once `onSend` resolves `ok`. Clear `pending` on the first `brain:sentence`… — the chat window does not receive `brain:sentence`, so instead: clear `pending` on `brain:turnDone` for that `turnId`; on `brain:error` for that `turnId` (or with no `turnId`), **restore `pending.text` into the textarea, select it, and focus**. If `onSend` resolves `{ok:false}`, restore immediately.
7. A thin state line above the composer bound to `brainState`: `idle` → nothing; `thinking` → `她在想…`; `speaking` → `她在说…`. `--fs-caption`, `--c-text-3`.
8. Fully keyboard operable: the textarea is the initial focus target; `Tab` reaches the history toggle and the send button; a visible `--c-focus-ring` outline on every focusable element. **The textarea carries `autoFocus`** — §2.3's `chat:opened { focusComposer }` only covers the *re-open* path, so without it rule 8 is false on first paint.

Required jsdom tests (`Composer.test.tsx`, R6 — this replaces the dropped Playwright IME test):

```tsx
it('does not send while the IME is composing', async () => {
  render(<Composer {...p} />);
  const ta = screen.getByRole('textbox');
  fireEvent.compositionStart(ta);
  fireEvent.change(ta, { target: { value: 'ni hao' } });
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  expect(onSend).not.toHaveBeenCalled();
});
it('sends on Enter once composition ends', async () => { /* compositionEnd, tick, Enter -> onSend called once */ });
it('inserts a newline on Shift+Enter and does not send', () => { /* … */ });
it('caps auto-grow at 6 rows', () => { /* … */ });
it('completes the reveal when Enter is pressed on an empty composer', () => { /* onCompleteSpeech called, onSend not */ });
it('restores the text when the turn errors', async () => { /* … */ });
```

`new KeyboardEvent('keydown', { isComposing: true })` **is** constructor-settable (unlike the read-only property on a synthetic `compositionstart`), which is exactly why R6 moved this test to jsdom. An optional CDP `Input.imeSetComposition` Playwright smoke may be added if it works within 30 minutes; otherwise record that it was not done.

### 6.3 History pane

`apps/desktop/src/renderer/chat/History.tsx`:

```tsx
export interface HistoryProps {
  list(opts: { before?: number; limit?: number }): Promise<{ rows: HistoryRow[]; nextBefore: number | null }>;
  remove(turnId: string): Promise<void>;
  open: boolean;
  /** Injected clock. §6.3's required day-grouping test asserts 今天/昨天 against it. */
  now?: () => number;
}
```

- Toggled by a chevron labelled `历史`; opening it sends `chat:resize {rows, historyOpen:true}`, and main grows the window by `CHAT_HISTORY_H` via `resizeChat(win, pet, rows, true)`.
- Rows newest-at-the-bottom, grouped by local day with headers `今天` / `昨天` / `8月27日` (`Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric' })`).
- `role === 'user'` right-aligned with `--c-accent-weak`; `role === 'assistant'` left-aligned with `--c-surface-2`.
- `kind === 'proactive'` gets a small `主动` chip; `kind === 'system'` renders in `--c-text-3` italic with no bubble shape; `interrupted === true` appends a `[中断]` chip (R2's marker).
- **The row's meta line splits in two, and only one half hides.** `.msg__marks` holds the `主动` and `[中断]` chips and is **always visible** — they are row *content*, part of what the row says. `.msg__acts` holds the per-turn actions `复制` (writes `content` to the clipboard) and `删除` (calls `remove(turnId)` and optimistically removes both rows of that turn), and is revealed on `:hover` / `:focus-within`. Without the split, §1.8's `history-interrupted.png` would photograph an `opacity: 0` chip and prove nothing — which is the concrete reason the rule is here rather than in a stylesheet.
- Paging: `IntersectionObserver` on the top sentinel → `list({ before: nextBefore, limit: 50 })`. **No virtualization library** — 50-row pages with plain DOM are the Phase 2 scope; do not add one.
- Empty state: `还没聊过。说点什么吧。` in `--c-text-3`.

Required jsdom tests: day grouping picks `今天`/`昨天` correctly against an injected clock; a `system` row renders with the system style and no bubble; an `interrupted` row shows `[中断]`; `删除` calls `remove` with the row's `turnId`.

### 6.4 Key window flow

`apps/desktop/src/renderer/key/App.tsx`:

- One masked input (`type="password"`, `spellCheck={false}`, `autoComplete="off"`), paste-friendly, with a 显示/隐藏 toggle.
- `测试连接` → `invoke('key:test', { apiKey })`; renders `可用 ✓` on success, or the mapped Chinese reason on failure (table below).
- `保存` → `invoke('key:set', { apiKey })`, then `invoke('key:test', {})`; on success the window closes and sends `chat:open { source:'key', focusComposer:true }`.
- `清除` → `invoke('key:clear', {})`.
- The **one-line disclosure**, always visible under the input, verbatim:

  `对话内容会发送到 DeepSeek（服务器在中国境内）处理，回复由 AI 生成。`

  There is **no privacy-note link** in Phase 2 (deferred — a link to a page that does not exist is the defect the preflight found). One line, nothing else.
- Focus trap: `Tab`/`Shift+Tab` cycle within the window; `Esc` closes only when a key is already stored; the input takes focus on `ready-to-show`.
- `key:status` from main drives the header: `已保存` / `还没设置` / `开发环境的临时 Key`.

Error-code → user-facing Chinese copy: **the one and only copy of this table is `ERROR_HINTS` in `@ds/protocol` (§2.8).** The key renderer imports it; main imports it for `hint:show` and `openKeyWindow`. **There is no renderer-local `ERROR_COPY` / `ERROR_OPENS_KEY_WINDOW` / `src/renderer/shared/error-copy.ts`** — an earlier T8 brief proposed one and it is deleted (D4: one policy table). The single cross-consumer test in `packages/protocol/src/channels.test.ts` (§2.8) covers every claim below.

The table restated here for reading only — if it ever disagrees with §2.8, §2.8 wins:

| `ErrorCode` | `text` | `level` | `opensKeyWindow` |
|---|---|---|---|
| `auth` | `API Key 无效，重新填一下` | `error` | `true` |
| `balance` | `DeepSeek 余额不足了` | `error` | `true` |
| `rate` | `DeepSeek 有点忙，稍后再试` | `warn` | `false` |
| `server` | `DeepSeek 那边出问题了，等一下再聊` | `warn` | `false` |
| `network` | `网络不太好，等一下再聊` | `warn` | `false` |
| `timeout` | `等太久了，先歇一会儿` | `warn` | `false` |
| `empty` | `''` *(no hint — the canned line is spoken instead, §3.9.4)* | `info` | `false` |
| `no-key` | `还没填 API Key` | `error` | `true` |

The Phase 2 copy references **no 设置 window** — settings is Phase 4 and only the key window exists (C-10's fix).

> **C-10 is a rule about pointing at a settings surface, not a ban on the substring 设置.** §6.4's own `key:status` header copy is **`还没设置`**, which contains 设置 — so a blanket substring assertion over the key renderer is false the moment the window renders, and an earlier T8 draft made exactly that claim. Scoped correctly:
> - **Renderer-level rule:** no shipped copy may point at a settings surface. The forbidden strings are `打开设置`, `设置窗口`, `设置界面`, `去设置`, `设置里`; the check is `grep -rn --exclude='*.test.*' "打开设置\|设置窗口\|设置界面\|去设置\|设置里" apps/desktop/src/renderer packages/protocol/src` → no matches. `还没设置` is expected and permitted, and is the only 设置 line in `renderer/key` or `renderer/chat`.
> - **The strict substring rule stays exactly where §2.8 put it — on `ERROR_HINTS` alone**, asserted once by `expect(JSON.stringify(ERROR_HINTS)).not.toContain('设置')` in T6's `channels.test.ts`. That table is the copy that *routes* the user somewhere, which is what C-10 is about.
>
> The privacy-note link is separately dropped (`grep -rn "privacy\|隐私" apps/desktop/src/renderer/key` → no matches).

**Task-0 direction deviations, recorded (this contract's numbers win over the direction contract):**

1. The key window is **440×360** (§6.1), not the direction's 520-wide band.
2. Composer type is `--fs-body` / `--lh-body` (14/22), not the direction's 16/24, because `CHAT_ROW_H = 22` and `CHAT_BASE_H = 48` are pinned by C-9.
3. The direction's "left edge cut at 8°" is rendered as a **skewed 3 px accent rail** (`.composer__rail`), because a `clip-path` on the band would also clip `--shadow-popover`. The name plate keeps the literal 8° skew (`--adv-skew`).
4. The name plate's `13/16` type is not on the C5 ramp; the plate uses `--fs-caption` / `--lh-caption` (12/18) with `letter-spacing: .04em`.

### 6.5 `main/key-store.ts` and the dev-key guard (D5)

```ts
export type KeySource = 'store' | 'dev-env' | 'none';

/** The three safeStorage methods this module touches, so tests inject an object, not a mock of
 *  the whole Electron namespace. */
export type SafeStoragePort = Pick<Electron.SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
export interface KeyStoreOptions {
  file?: string;
  safeStorage?: SafeStoragePort;
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** The literals §6.5 pins in prose, given names so the unit test asserts against a name. */
export const DEV_KEY_ENV = 'DS_DEV_DEEPSEEK_KEY';
export const MIN_KEY_LENGTH = 8;
export const SAFE_STORAGE_UNAVAILABLE = '这台机器上没法安全保存 Key，先检查一下登录凭据服务。';

export class KeyStore {
  constructor(opts?: KeyStoreOptions);
  get(): string | null;          // stored key, else the dev key, else null
  hasStored(): boolean;
  source(): KeySource;
  set(apiKey: string): void;     // throws when safeStorage is unavailable
  clear(): void;
  onChange(cb: (s: { present: boolean; source: KeySource }) => void): () => void;
}
```

File: `join(app.getPath('userData'), 'key.bin')` → `%APPDATA%\ds\key.bin` (verified: `app.setName('ds')` at `main/index.ts:12` makes `userData` be `%APPDATA%\ds`). Written with `safeStorage.encryptString`, `0o600` where the platform honours it.

If `safeStorage.isEncryptionAvailable()` is `false`, `set()` throws and `key:set` returns `{ok:false, message: SAFE_STORAGE_UNAVAILABLE}` — the literal above. The key is **never** written in plaintext as a fallback.

**Dev guard (D5), the only env path that exists:**

```ts
const devKey =
  !isPackaged && typeof env.DS_DEV_DEEPSEEK_KEY === 'string' && env.DS_DEV_DEEPSEEK_KEY.length >= 8
    ? env.DS_DEV_DEEPSEEK_KEY
    : null;
```

It is held **in memory for that run only**, never encrypted to `key.bin`, never returned by `hasStored()`, and `source()` reports `'dev-env'` so the key window can say so. The env var is `DS_DEV_DEEPSEEK_KEY` — **not** `DEEPSEEK_API_KEY` (that name stays reserved for the test/eval gate, so a developer running the app never silently poisons the first-run flow, X9).

`onChange` is what makes `key:status` have a producer (R9): `BrainService` subscribes and sends `key:status` to the key and chat windows on every `set`/`clear`, plus once on the key window's `ready-to-show`, plus after every `key:test` (carrying `lastTest`).

**Key rotation (A22's gap):** `BrainService` holds `client: ChatClient | null` and rebuilds it inside `onChange` via **`BrainService.rebuildClient()`**. A `TurnRunner` is constructed with the current client; on a key change the runner is disposed and re-created. No turn in flight survives a key change (it is cancelled first).

> **`rebuildClient()` is the single client-construction site, and that is where the `DS_FAKE_BRAIN` choice is made.** §6.7 said "`index.ts` picks it over `DeepSeekClient`" while §6.5 said `BrainService` holds the client and rebuilds it on rotation — which cannot both be true without a second construction site, and two sites is how a fake client survives a key rotation in dev or, worse, does not. Pinned: **`rebuildClient()` calls `useFakeBrain(app.isPackaged, process.env)` and constructs either `createFakeClient()` or `new DeepSeekClient({apiKey})`**, and emits §6.7's one log line. `index.ts` still imports `useFakeBrain`, but only to decide whether to open the first-run key window (a fake brain needs no key).

### 6.6 `main/brain-service.ts`

```ts
export interface BrainServiceDeps {
  pet: BrowserWindow; bubble: BrowserWindow; chat: BrowserWindow; key: BrowserWindow;
  store: HistoryStore; keyStore: KeyStore; bundle: CharacterBundle;
  /** The raw handle, for the `kv` table only (§4.1's getKv/setKv). §4.3 exposes no kv accessor. */
  db: DatabaseSync;
  /** index.ts owns show/hide because bubble visibility must lose to VisibilityState (§5.4 rule 5). */
  setBubbleVisible(on: boolean): void;
  openKeyWindow(reason: 'first-run' | 'user' | ErrorCode): void;
}
export class BrainService {
  constructor(deps: BrainServiceDeps);
  start(): void;       // registers every IPC handler
  dispose(): void;
  /** The live client — rebuilt on key rotation (§6.5); the summarizer closure needs the current one. */
  currentClient(): ChatClient | null;
  /** Pushes `key:status` now; called from the key window's `ready-to-show` (§6.5). */
  refreshKeyStatus(): void;
  /** Re-places the bubble; called from the existing `avatar:drag` handler (§5.4 rule 3). */
  reposition(): void;
}
```

The database is opened by `index.ts` at `join(app.getPath('userData'), 'ds.sqlite')` (§4.1) and the same handle is passed both to `HistoryStore` and to `BrainServiceDeps.db`. `BrainService` uses it **only** for `getKv(db, KV_FIRST_RUN_DONE)` / `setKv(db, KV_FIRST_RUN_DONE, '1')` — adding `kvGet`/`kvSet` to `HistoryStore` was the alternative and is rejected: it would widen a port that models *history*, for one boolean that is app state.

Responsibilities, each one pinned:

- Builds `staticSystem = renderStaticSystem(bundle.card, Object.keys(bundle.motionMap))` **once** at startup and caches it (byte stability is the cache-hit contract).
- `state()` returns a Phase-2 stub with **every** `StatePreamble` field populated (A16's fix — the v1 literal omitted `localTime`/`weekday` and would not typecheck):
  ```ts
  const fmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const wd = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
  () => ({ localTime: fmt.format(now), weekday: wd.format(now),
           mood: 0.1, energy: 70, affection: 50,
           sinceLastChat: humanizeGap(now - (store.lastMessageTs() ?? now)) });
  ```
  `humanizeGap` → `刚刚` (< 5 min), `${n}分钟` (< 60 min), `${n}小时` (< 24 h), `${n}天`. `mood`/`energy`/`affection` are constants in Phase 2; `@ds/sim` replaces them in Phase 3 without touching this signature.
- Forwards `TurnRunner` events to windows exactly per the channel table (§2.3), converting `sentence` → `brain:sentence` on **both** the pet and the bubble.
- Routes `error` to `hint:show` with the §6.4 copy (`ttlMs: HINT_TTL_MS`, §5.5) and calls `openKeyWindow(code)` for `auth` / `balance` / `no-key`.
- **Wraps `TurnRunner.send` in the `user:text` handler and maps an unexpected throw to `{ok:false, code:'server', message}`.** §2.4 defines the failure arm for `user:text` but named no producer other than "no key", so an exception out of `send()` would surface to the renderer as a bare `invoke` rejection — and §6.2 rule 6 ("restore the composer on `{ok:false}`") would have nothing to act on, silently eating the user's text. One `try`/`catch`, one mapping, and the contract's own two-arm union stays true.
- Relays `speech:mouth` bubble→pet and `speech:complete` chat→bubble.
- Emits `avatar:listening {on}` to the pet whenever `chat:composing` changes (R9's pinned producer). Debounced 250 ms on the falling edge so a pause between characters does not flicker the pose.
- Wires `metrics: store` into `TurnRunnerDeps` so the runner writes the `MetricsRecord` (§3.11.2). `BrainService` must **not** re-derive `sensitive` or `errorCode` — they exist only inside the turn.
- Builds the summarizer as `makeSummarizer(this.currentClient()!, bundle.card.name)` (§4.4), re-reading the client on each call so key rotation is picked up.
- `humanizeGap` lives in its own module, `apps/desktop/src/main/humanize.ts`, so it is unit-testable without constructing a `BrainService`.
- **First run — the exact broadcast set, pinned, because §6.6 and §5.2 were otherwise mutually exclusive.** If `kv.first_run_done` is unset, then after the bubble window is ready `BrainService` does exactly this, in this order:
  1. `setBubbleVisible(true)` — the window is created hidden and no `brain:state` will raise it (see below), so the first message needs an explicit show. It still loses to `VisibilityState` (§5.4 rule 5), which is why it goes through the injected `setBubbleVisible` rather than touching the window.
  2. `brain:sentence { turnId:'first-mes', seq:0, text: sanitizeForDisplay(bundle.card.first_mes), emotion:'happy' }` — to the pet **and** the bubble, per `MAIN_TO_PET` / `MAIN_TO_BUBBLE`.
  3. `brain:turnDone` for `turnId:'first-mes'` (`usage: null`, `ttftMs: null`, `totalMs: 0`, `complianceMiss: false`, `regenerated: false`, `lint: {violations: [], severity: 'none'}`).
  4. append the line with `kind:'system'` and set `first_run_done = '1'`.

  **No `brain:state` is sent for `'first-mes'` — not `thinking`, and above all not a trailing `idle`.** §5.2 gives `onState({state:'idle'})` the meaning "drop the queue and finish the turn", so an `idle` for `'first-mes'` arriving after the sentence would cancel the reveal the app was created to show. §5.2's "an `idle` for a `turnId` the controller never saw is ignored" does **not** save this case: the controller *has* seen `'first-mes'` — it just received a sentence for it. Sending no state at all is the simplest resolution and needs no new rule in either section. The `speaking` pose the pet would have taken from `brain:state` is not missed: `brain:sentence` already carries the emotion, and §5.7's `brainSentence` handler sets it.

  The bubble window comes back down on the **`playback:turnDone`** the bubble sends when the reveal finishes (§5.4's second hide trigger list). That event is consumed by main's hide path only — **`playback:*` carrying `turnId === 'first-mes'` is dropped before it reaches any `TurnRunner`**, because no runner ever issued that id and forwarding its `turnShown` would settle the next real turn early (§3.11.1: a `turnShown` arriving before the model turn settles is *remembered*, so an unfiltered one would land on the wrong turn).
- Tray gains two items in `main/tray.ts` — `createTray({ toggleVisible, toggleDebug, openChat, openKey, quit })` with `{ label: '打开对话', click: actions.openChat }` and `{ label: '设置 API Key', click: actions.openKey }` inserted before the separator. This is a **breaking signature change**, so `apps/desktop/src/main/tray.test.ts`'s shared `actions` literal must gain `openChat`/`openKey` stubs or `tsc -p tsconfig.json` fails. Both `tray.ts` and `tray.test.ts` are in T6's file list (§1.1).
- Global hotkey `Ctrl+Shift+Space` → `openChat(chat, pet, true)`.

### 6.7 `main/fake-client.ts` — the `DS_FAKE_BRAIN` switch

Without this, T6 cannot be verified end-to-end at all: every path it wires needs a `ChatClient`, and a real key is not a T6 precondition.

```ts
export const FAKE_BRAIN_ENV = 'DS_FAKE_BRAIN';
/** True ONLY when `!isPackaged && env.DS_FAKE_BRAIN === '1'`. Same guard shape as D5's dev key. */
export function useFakeBrain(isPackaged: boolean, env?: NodeJS.ProcessEnv): boolean;
/** A scripted ChatClient: stream() yields tagged deltas in small chunks, complete() and testKey() resolve. */
export function createFakeClient(): ChatClient;
```

It implements the **whole** `ChatClient` interface (§3.9), `complete()` included. It is never reachable in a packaged build — `useFakeBrain` returns `false` whenever `isPackaged` — and it is unit-tested for exactly that (`useFakeBrain(true, {DS_FAKE_BRAIN:'1'}) === false`). `index.ts` picks it over `DeepSeekClient` when `useFakeBrain(app.isPackaged, process.env)`, and logs one line saying so.

`DS_FAKE_BRAIN` is a **third** distinct environment variable, alongside `DS_DEV_DEEPSEEK_KEY` (the dev app key, D5) and `DEEPSEEK_API_KEY` (the test/eval gate). None of the three ever stands in for another.

---

## 7. Eval harness (`eval/`)

### 7.1 CLI, module split and scripts

```
node eval/run.mjs [options]

  --dry                 replay eval/recorded/replies.zh.json, no network, no key required
  --fixture <path>      default: eval/fixtures/prompts.zh.json
  --character <path>    default: characters/haru/character.json
  --runs <n>            default: 3
  --limit <n>           only the first n prompts (smoke runs)
  --model <id>          default: deepseek-v4-flash
  --judge <id>          default: deepseek-v4-pro
  --no-judge            lint + shape metrics only, skip the judge pass
  --concurrency <n>     default: 4
  --out <dir>           default: eval/out
  --seed <n>            default: 1   (chunk sizes in --dry; NOT fixture shuffling)
  --ablation            P5/E-1 only: four raw deepseek-v4-flash calls, needs DEEPSEEK_API_KEY
```

**Two flag rules that were undefined:**

- **`--limit <n>` skips `validateFixture`.** A truncated slice cannot satisfy R8's six category counts by construction, so validating it would make `--limit` unusable for the smoke runs it exists for. Every **full** run is still validated, and `--limit` is never used for a reported baseline.
- **`--ablation --dry` is a usage error → exit `2`.** §7.1 requires `DEEPSEEK_API_KEY` for the ablation and `--dry` promises never to open a socket; refusing the combination is simpler and more honest than silently ignoring one of the two flags.

**Module split.** `run.mjs` is a thin entry point over `eval/lib/{args,fixture,shape,aggregate,recorded,judge,turn,ablation,report}.mjs`, with co-located `eval/lib/*.test.mjs`. One 900-line `run.mjs` is not reviewable, and none of the pure logic (shape metrics, aggregation, fixture validation) would otherwise be testable.

**`eval/package.json` scripts:**

```jsonc
{
  "eval": "node run.mjs",
  "eval:dry": "node run.mjs --dry",
  "session": "node session.mjs",          // T10's 20-turn continuous-session probe
  "session:dry": "node session.mjs --dry",
  "test": "node --test lib/*.test.mjs"    // node:test, NOT vitest (§1.5)
}
```

`"test"` uses the Node built-in runner because §1.5 keeps `eval` out of the vitest projects. Since that puts the suite outside `pnpm test`, the root gains `"test:eval": "pnpm --filter @ds/eval test"` (§1.5, owner **T9**) and T10's precondition gate and final sweep both run `pnpm test && pnpm test:eval`.

**`--dry` is the recorded-responses mode.** Replies come from `eval/recorded/replies.zh.json` and are streamed in **seeded 1–7-character chunks** — that is what `--seed` seeds, and it exercises `StreamParser`'s chunk-safety as a side effect. No `usage` frame is emitted, so `cacheHitPct` reports `skipped` in dry runs. `--dry` never reads the key and never opens a socket.

**`eval/recorded/judgements.json` shape, pinned** (§1.1 names the file and §7.1 says `--dry` replays it; the shape was otherwise undefined):

```jsonc
{
  "version": 1,
  "default":   { /* the seven universal axes, the answer used when a prompt has no override */ },
  "overrides": { "<promptId>": { /* that prompt's category-specific axis */ } }
}
```

**A `--dry` turn whose axis has no recorded judgement is marked `judgeError: true` — never silently passed.** A missing judgement is missing evidence, and a dry run that quietly scores it as a pass would report a green bar for a turn nobody judged. `golden.test.mjs` gates that every axis every fixture prompt declares has a recorded judgement, so the `judgeError` path should never fire in a healthy repo — it exists so that when the fixture and the corpus drift, the report says so.

**The fixture is not shuffled.** `--seed` is accepted, used as above, and recorded in the report as `"shuffled": false`. Shuffling is deferred because `LintContext.recent`, `question-streak`, `opener-repeat` and `consecutiveQuestionPairs` are all order-dependent — a stable order is what makes two runs comparable.

**`LintContext.recent` inside the harness** = the previous up-to-5 **sanitized** replies of the *same run*, in fixture order; empty at the start of every run.

**`EVAL_STATE` is a fixed literal**, so the assembled prefix is byte-stable and X1's cache-hit number means something:

```js
export const EVAL_STATE = { localTime: '21:14', weekday: '周三', mood: 0.1, energy: 70, affection: 50, sinceLastChat: '3小时' };
```

**The judge pass uses its own `fetch`, not `DeepSeekClient`.** `deepseek-v4-pro` must keep thinking **ON**, while `DeepSeekClient` hard-codes `thinking:{"type":"disabled"}` (§3.9.1). Judge body: `{model, messages, stream:false, temperature:0, max_tokens:800}` with **no `thinking` key**.

**Concurrency shape:** `--concurrency` bounds parallel **runs** during the model pass (each run walks the fixture sequentially so `recent` is well defined) and parallel **turns** during the judge pass.

**`--ablation` hosts P5/E-1**: four raw `deepseek-v4-flash` calls (system vs first-user placement × with/without the marker line), requires `DEEPSEEK_API_KEY`, writes `eval/out/<stamp>-ablation.{json,md}`. It is an **experiment, not a gate** — it exits 0 whenever all four calls succeed. It locates the `【PERSONA_LOAD】` block by string search, never by position, so P1's exact wrapping cannot break it.

`eval/out/.gitignore` must be force-added (`git add -f`): the repo-root `.gitignore` already ignores `out/`.

**Gating.** Without `--dry`, the script requires `process.env.DEEPSEEK_API_KEY`; if it is missing it prints `DEEPSEEK_API_KEY 没设置。加 --dry 跑离线检查，或者设置环境变量后重跑。` and exits with code **2**. `--dry` never reads the key and never opens a socket. Exit codes: `0` all thresholds met, `1` at least one threshold missed (the report is still written), `2` a usage/config error.

`run.mjs` imports `@ds/brain` and `@ds/memory` as **bare specifiers** (resolved through `eval/node_modules/@ds/*` symlinks created by pnpm from `eval/package.json`). This works only because of the C1 extension rule and R1's erasable-TS rule; if either is violated, `node eval/run.mjs` fails at import time. **T9**'s first smoke step is literally `node -e "import('@ds/brain').then(m => console.log(Object.keys(m).length))"` run from `eval/`; T10 re-runs it in its precondition gate. **T5 additionally runs the `@ds/memory` half of this smoke inside T5** (§4.4), so a violation introduced there fails eight tasks earlier, in the task that caused it, instead of surfacing here with no owner.

Per turn the script: builds `assemblePrompt(...)` with the real `renderStaticSystem` output and a synthetic `StatePreamble`; streams through `StreamParser`; sanitizes with `sanitizeForDisplay`; lints with `lintReply(raw, {recent, sensitiveTurn: isSensitive(prompt.text)})`; records `usage`. The judge pass then scores the sanitized reply.

### 7.2 Fixture format (`eval/fixtures/prompts.zh.json`)

```jsonc
{
  "version": 1,
  "prompts": [
    {
      "id": "bland-01",
      "category": "bland",              // bland | adversarial | sensitive | flawed | memory | humour
      "text": "嗯",
      "priorTurns": [                    // optional; replayed as history before `text`
        { "role": "user", "content": "今天面试完了" },
        { "role": "assistant", "content": "怎么样，还顺利吗？" }
      ],
      "sensitive": false,                // overrides isSensitive() when present
      "axes": ["initiative"],            // §7.3 underscore keys; ONLY the category-specific axis
      "note": "bland turn — she should introduce something (A13)"
    }
  ]
}
```

`axes` uses the **§7.3 underscore keys** (`initiative`, not `in-character`) and lists **only the category-specific axis**. The seven universal axes — `in_character`, `assistant_speak`, `narrates_user`, `closing_moral`, `rhetorical_tail`, `emoji_discipline`, `nativeness` — always apply and are never listed per prompt. An earlier hyphenated example in this section was a typo.

Size: **46 prompts × 3 runs = 138 turns.** That is R8's mix — **8 bland · 8 adversarial · 6 sensitive · 6 flawed claims · 6 memory probes · 6 humour/「别闹了」** = 40 — **plus P2's 6-prompt `valid` control set**, which P2 requires in order to measure false disagreement against correct statements. `validateFixture` still hard-asserts the six R8 counts; the fixture's own `mix` block declares any extra category, so T10 can add `trait` probes without touching harness code. `memory` prompts carry `priorTurns` containing the fact being probed; `humour` prompts carry a `priorTurns` pair whose last user line is `别闹了` for half of them (A17).

### 7.3 `eval/judge.md` — axes and thresholds (R8)

`judge.md` is a versioned prompt file (front matter `version: 1`). It instructs `deepseek-v4-pro` (thinking **on**) to return **only** a JSON object with one key per axis. One axis per criterion this phase claims:

| Axis key | Criterion | Scale | Phase 2 threshold |
|---|---|---|---|
| `in_character` | A9 | 0 / 1 / 2 | mean ≥ 1.8, and **≥ 90 %** of turns score 2 |
| `assistant_speak` | A4 | boolean (true = leaked) | **0** occurrences |
| `narrates_user` | A3 | boolean | **0** occurrences |
| `closing_moral` | A5 | boolean | **0** occurrences |
| `rhetorical_tail` | A5 / A2 | boolean | **0** occurrences |
| `initiative` | A13 | boolean, bland turns only | **≥ 70 %** true |
| `refusal_language` | A15 | boolean, sensitive turns only | **0** occurrences of policy language |
| `sycophancy_pushback` | A16 | boolean, flawed-claim turns only | **≥ 50 %** push back |
| `humour_stops` | A17 | boolean, 别闹了 turns only | **100 %** stop |
| `emoji_discipline` | A18 | boolean per reply | **≤ 25 %** of replies `true` |
| `emoji_discipline_sensitive` | A18 | count of sensitive turns with `emoji_discipline === true` | **0** |
| `memory_use` | A19 | boolean, memory-probe turns only | **≥ 80 %** correct recall |
| `nativeness` | A19 | 0 / 1 / 2 | mean ≥ 1.8 |
| `false_disagreement` | **P2** | boolean, `valid` turns only — `true` = she argued with a correct statement | **≤ 20 %** |
| `trait_hit` | E-3 hand-off | boolean, `trait` turns only | **≥ 80 %**; Phase 2 ships **zero** `trait` prompts, so it reports `SKIP (n=0)` |
| `judge_error_rate` | harness health | fraction of turns whose judge answer failed to parse/validate after one retry | **≤ 0.05**; skipped under `--no-judge` |

`emoji_discipline` is deliberately **two** gate rows: a global rate and a hard zero on sensitive turns. `trait_hit` ships as an axis with no prompts because the E-3 probes depend on card content T3/T10 own — authoring them in T9 would re-create the v1 "one file written by two tasks" defect. T10 confirms the threshold when it adds the prompts.

Shape metrics are computed **locally**, not by the judge, and their gates are literal:

| Shape gate | Threshold | Source |
|---|---|---|
| `shortReplyPct` | **≥ 0.90** | A1: ≤ 60 hanzi and ≤ 3 sentences |
| `questionRatePct` | **≤ 0.30** | A2 |
| `consecutiveQuestionPairs` | **≤ 0** | A2: never two questions in a row |
| `ellipsisReplyPct` | **≤ 0.20** | A6 |
| `multiEllipsisCount` | **≤ 0** | A6: at most one `……` per reply |
| `repetitionMaxPct` | **< 0.20** | A7: 4-gram overlap |
| `complianceMissPct` | **< 0.10** | ACT compliance |
| `cacheHitPct` | **≥ 0.70** | X1, turns 3+ of each run; `null`/skipped when no `usage` (i.e. always under `--dry`) |

Opener-repeat, affect-rate and lint-severity counts are **reported, not gated**.

**Honesty clauses that must appear in the T10 brief and in `eval/README.md`:** A8 (3-persona attribution) is **out of Phase 2** — only one persona exists (moved to Phase 3). A3/A4/A5/A9/A10/A15/A16 are **directional at n = 138**, not the addendum's 200/500-turn denominators; the full-denominator run is the Phase 4 nightly job (X12). The tuning loop is bounded to **3 iterations**; whatever the numbers are after the third, they are reported as they are.

### 7.4 Report format

Two files per run, named `eval/out/<YYYY-MM-DD>-<HHmm>.json` and `.md`.

**Top-level keys, exactly and in this order: `version`, `startedAt`, `config`, `turns`, `axes`, `shape`, `shapeGates`, `informational`, `worst`, `pass`.** T10 reads every one of them **by name** (there is no `axes.<key>.value`), and `aggregate(turns, { noJudge })` returns `{ axes, shape, shapeGates, informational, worst, pass }` — so a draft of this section that named neither `informational` nor `worst` described a report the harness does not produce and the consumer cannot read.

```jsonc
// <stamp>.json
{
  "version": 1,
  "startedAt": "2026-08-29T14:03:11.000Z",
  "config": { "model": "deepseek-v4-flash", "judge": "deepseek-v4-pro", "runs": 3, "fixture": "…", "judgeVersion": 1, "cardTokens": 673, "staticSystemTokens": 994, "dry": false },
  "turns": [
    { "promptId": "bland-01", "run": 0, "reply": "…", "raw": "…",
      "lint": { "severity": "none", "violations": [] },
      "usage": { "promptTokens": 812, "cacheHit": 768, "cacheMiss": 44, "completionTokens": 31 },
      "ttftMs": 640, "totalMs": 1810, "complianceMiss": false, "regenerated": false,
      "shape": { "hanzi": 18, "sentences": 2, "endsWithQuestion": false, "emojiCount": 0 },
      "judge": { "in_character": 2, "assistant_speak": false, "initiative": true, "nativeness": 2 } }
  ],
  "axes": { "in_character": { "mean": 1.91, "pct2": 0.93, "threshold": 0.90, "pass": true }, "…": {} },
  "shape": { "shortReplyPct": 0.94, "questionRatePct": 0.22, "cacheHitPct": 0.78, "complianceMissPct": 0.03 },
  "shapeGates": { "shortReplyPct": { "value": 0.94, "cmp": ">=", "threshold": 0.90, "pass": true }, "…": {} },
  "informational": { "prompts": 46, "turns": 138, "lintNone": 131, "lintStrip": 5, "lintRegenerate": 2,
                     "lintRuleCounts": {}, "openerRepeatCount": 0, "affectRateCount": 1, "judgeErrors": 0,
                     "emojiJudgeDisagreements": 0, "meanHanzi": 21, "medianTtftMs": 640,
                     "meanTotalMs": 1810, "meanEstimatedPromptTokens": 812 },
  "worst": { "assistant_speak": [ { "promptId": "adversarial-01", "run": 0, "reply": "作为一个AI助手，我……" } ] },
  "pass": true
}
```

- **`informational`** carries exactly `prompts`, `turns`, `lintNone`, `lintStrip`, `lintRegenerate`, `lintRuleCounts`, `openerRepeatCount`, `affectRateCount`, `judgeErrors`, `emojiJudgeDisagreements`, `meanHanzi`, `medianTtftMs`, `meanTotalMs`, `meanEstimatedPromptTokens` — **reported, not gated**. A bad number here is quoted in the tuning log and in T10's shortfall table; it never triggers a card edit and never fails the run.
- **`worst`** maps a **failing** axis key to **up to three** `{promptId, run, reply}` records. It is the only place T10's remedy table may take a quoted phrase from, and it is absent for axes that passed.

Additions to the shape above, pinned so two tasks cannot disagree about the schema:

- `config` gains `character`, `limit`, `concurrency`, `seed`, `shuffled` (always `false`), `noJudge`.
- **`config` carries BOTH token numbers: `cardTokens` 673 and `staticSystemTokens` 994.** §3.7.4 split the budget in two, so one number no longer describes the prompt: `cardTokens` is the 700-capped **persona** figure and `staticSystemTokens` is the 1100-capped **whole-block** figure that actually sets the size of the cached prefix. The `.md` prints both rows. (An earlier draft of the example above showed `"cardTokens": 612`, which was never a measured value of the shipped card — the measured figure is **673**, §3.7.4 and §8.7. Nothing may copy 612 into a fixture or an assertion.)
- Each turn record gains `category`, `indexInRun`, `sensitive`, `axes`, `estimatedPromptTokens`, `judgeError`.
- `regenerated` is **always `false`** in a harness turn: the harness measures **raw** model output and never regenerates. The shipped `TurnRunner` strips and regenerates on top, so live quality is **≥** these numbers. Say so in the `.md`.
- `report.shape` stays the plain-number map shown above; the pass/threshold detail lives in a sibling `report.shapeGates`.
- The `<YYYY-MM-DD>-<HHmm>` stamp is derived from `startedAt` in **UTC**.

The `.md` sibling is a one-page summary: a table of every axis with `value / threshold / PASS|FAIL`, the shape table, the three worst replies per failing axis quoted in full, and a footer naming the fixture size and the honesty clauses from §7.3. `eval/out/` is gitignored except for reports the controller explicitly commits.

### 7.5 Session probe and the Electron e2e lane (T10)

The fixture run measures 138 **independent** prompts. R4's first-sentence bar and X1's cache-hit bar both need **one growing prefix**, which is a different measurement — hence a second entry point.

| Artefact | Owner | What it is |
|---|---|---|
| `eval/session.mjs` (+ the `session` / `session:dry` scripts, §7.1) | T10 | the 20-turn continuous-session probe → `session-20-turns.{json,md}` |
| `scripts/phase2-stats.mjs` + `scripts/phase2-stats.test.mjs` | T10 | the pure statistics the probe uses. They live in `scripts/` because §1.5 keeps `eval` out of the vitest projects while `scripts` already is one (`scripts/vitest.config.mjs`, project name `scripts`) |
| `apps/desktop/playwright.electron.config.ts` + `apps/desktop/tests-e2e/` + the `test:e2e:electron` script | T10 | the Electron lane. The Phase 1 `playwright.config.ts` drives the **browser** harness at `localhost:5174` and **is not touched** |
| `scripts/capture-region.ps1`, `scripts/sample-resources.ps1` | T10 | DPI-aware composited screen capture, and Electron process-tree CPU/RSS sampling. Both are PowerShell (§1.7) |
| `docs/evidence/phase2/deferred.md` | T10 | the Phase 2 deferral ledger, linked from `README.md` |

**Two named session metrics, distinguished on purpose:**

- **`firstSentenceMs`** — the moment `StreamParser` closes the first sentence. This is R4's bar: **≤ 1.2 s p50**.
- **`firstEmitMs`** — the moment `TurnRunner` would hand sentence 0 to the bubble, i.e. when sentence *1* closes or the stream ends, because §3.11.2 holds sentence *k* until sentence *k+1* closes. **`firstEmitMs` carries no threshold**; it is recorded so the controller can see, in milliseconds, what the one-sentence lookahead costs.

**Paint latency needs no new hook.** The e2e measures "first grapheme painted ≤ 100 ms" inside the bubble renderer by listening to `brain:sentence` through the already-allow-listed `window.dsBubble.on` and timing the first `MutationObserver` callback that makes `document.body.innerText` non-empty. No `window.__bubble` addition is required.

**Surfaces, pinned — these were named as artefacts but never given an interface:**

```js
// scripts/phase2-stats.mjs  (in the `scripts` vitest project, so it has a .test.mjs beside it)
export function percentile(values, p);        // nearest rank; throws `percentile: empty sample`
export function cacheHitRatio(turns, fromTurn = 3);
export function verdict(value, threshold, dir /* 'max' | 'min' */);
export function renderSessionMarkdown(report);
```

```
node eval/session.mjs [--dry] [--turns n] [--fixture p] [--character p] [--out dir]
  writes eval/out/session-<YYYY-MM-DD>-<HHmm>.json and .md
  exit 0 = both bars met, or --dry;  1 = a bar missed;  2 = usage/config error   (same ladder as run.mjs)
```

```powershell
scripts/capture-region.ps1  -BoundsFile <path> -Out <path>
#   BoundsFile is JSON {x, y, width, height, scaleFactor, pad} in Electron DIP — Electron speaks
#   DIP and GDI speaks pixels, so the scaleFactor has to cross the boundary as data.
scripts/sample-resources.ps1 -Out <path> -Label <string> -Seconds <int> -PathLike <glob>
```

```ts
// apps/desktop/tests-e2e/app.ts — the Electron launch/capture helpers
export { DESKTOP, REPO, EVIDENCE, RESULTS, MAIN };          // paths
export type { Bounds, LaunchOptions };
export { launchApp, windowByUrl, isVisible, setTheme, unionBounds, captureRegion, sampleResources, median };
```

**`apps/desktop/tests-e2e/**` stays outside every tsconfig program**, exactly like the Phase 1 `apps/desktop/tests/` directory does *not* (that one is in `tsconfig.renderer.json`). The reason is concrete: `apps/desktop/tsconfig.json` is `"lib": ["ES2022"]` with no `"DOM"`, and these specs call `page.evaluate(() => document…)`; adding the directory would fail `tsc` on `document` / `window` / `MutationObserver`. Playwright transpiles the specs itself. What **is** added to that program's `include` is the single file `playwright.electron.config.ts` (owner **T10**, §1.1) — a config, not a spec, and one that must not rot silently.

---

## 8. Decisions log

Every ruling in `rulings.md` that this contract implements, with the section that implements it. The plan header may cite this table verbatim.

### 8.1 R-rulings

| Ruling | Implemented in | Note |
|---|---|---|
| **R1** erasable TS in brain/memory/protocol; `eval/` is a workspace package | §1.2, §1.4, §3.3, §3.4, §7.1 | TS 5.9.3 verified ⇒ `erasableSyntaxOnly` is used and the `pnpm lint:erasable` fallback is **not** created. Extended by **C1** (§0): `.ts` extensions are mandatory in those three packages, verified by execution. |
| **R2** `playback:sentenceDone` / `playback:turnDone`; sentence-granular truthful history | §2.3, §3.11.4, §6.3 | `interrupted` flag on the row, `[中断]` chip in the history pane. |
| **R3** the bubble gets its own `BubbleWindow` | §5.3, §5.4 | Dissolves A54/A55/A57/A58/A59: no `hitAreaBounds`, no public view→client transform, no change to the pet's hover predicate, pet window stays 420×720. |
| **R4** stream, don't buffer; sentence-local lint; regenerate only on sentence 0; strip later | §3.11.2 | Implemented with a **one-sentence lookahead** so a failing final sentence is stripped before it is ever painted. |
| **R5** `externalizeDeps.exclude` + placeholder html in Task 6 | §1.6 | Placeholders for `bubble.html`, `chat.html`, `key.html`. |
| **R6** vitest config; IME test as a jsdom unit test | §1.5, §6.2 | `new KeyboardEvent('keydown', {isComposing:true})`; Playwright IME test dropped; CDP smoke optional. |
| **R7** Task 0 design first; C5 literal values fixed | §5.8 | Radii/shadows/durations/ramp are reproduced here as fixed; Task 0 owns palette, faces, motion character, `NOTICE`. |
| **R8** honest eval bar | §7.2, §7.3 | R8's mix (40) **+ P2's 6-prompt `valid` control set** = 46 × 3 = **138 turns**; one axis per claimed criterion; numeric thresholds; A8 → Phase 3; 3-iteration cap. |
| **R9** one channel table with per-window allow-lists | §2.3, §2.4, §2.5 | `avatar:listening` ← main from `chat:composing` (§6.6); `key:status` ← `KeyStore.onChange` (§6.5). `RENDERER_TO_MAIN`/`MAIN_TO_RENDERER` deleted. |
| **R10.1** `repetition` → `regenerate`, one table | §3.6.1 | `RULE_SEVERITY`, asserted complete against `LintRuleSchema.options`. |
| **R10.2** full `HistoryPort` signatures | §3.10 | plus `facts()` and `recentAssistant(n)`, which close A8's "where does `recent` come from". |
| **R10.3** `kind ∈ 'chat'\|'proactive'\|'system'` | §2.2, §3.10, §4.2 | enforced by a SQL `CHECK` and a zod enum. |
| **R10.4** `RevealPlan` timing + `Intl.Segmenter` | §5.1 | `toBe(1990)`, `mouth:false` on punctuation, delay **before** the grapheme. |
| **R10.5** retries only before the first delta | §3.9.3 | table row + test 4. |
| **R10.6** lint nudge not persisted | §3.8.2, §3.11.3 | `nudge` is an `assemblePrompt` input, never a history append. |
| **R10.7** `totalMs` | §2.3, §3.11.2, §3.11.6 | test 9 asserts no `ms` key survives. |
| **R10.8** `estimateTokens` | §3.8.1 | `toBe(3)` both ways, formula written out. |
| **R10.9** persona/card creation lives in Task 3 only | §3.7.1 | `characters/haru/character.json` gains `card` + `cannedLines` in Task 3; Task 10 **modifies content only**, never creates a persona file. `persona.json` does not exist. |

### 8.2 C.2 contradictions

| Id | Resolution | Implemented in |
|---|---|---|
| **C-1** | → R4 (stream) | §3.11.2 |
| **C-2** | addendum layout wins; no pair #1 | §3.8.3 |
| **C-3** | → R7 (C5 values fixed) | §5.8 |
| **C-4** | bubble surface alpha **0.92**; grayscale AA accepted, recorded in **T7** | §5.8 |
| **C-5** | spec §5 wins — Chinese phrases, never raw numbers | §3.7.5, §3.8.3 (test 3) |
| **C-6** | the "No Tailwind deviation" note is dropped; still plain CSS + tokens | §5.8 |
| **C-7** | memory tiers are spec **§6** | §4 header |
| **C-8** | the card lives in `character.json` under `card` | §3.7.1 |
| **C-9** | chat window **360×48**, grows to 6 lines | §6.1 |
| **C-10** | `API Key 无效，重新填一下`; no 设置 reference in Phase 2 | §6.4 |
| **C-11**, **C-13** | recorded, no action (temperature 0.7 is in §3.9.1; A14 stays Phase 3) | — |
| **C-12** | single tap = reaction; double-click = open chat; bubble click = open chat + complete | §5.2, §5.7 |
| **C-14** | gated integration test in Task 4 (`DEEPSEEK_API_KEY`): one real streamed turn asserts ACT compliance; a second asserts `prompt_cache_hit_tokens > 0` | §3.9.5 (add as tests 8–9, `describe.skipIf(!process.env.DEEPSEEK_API_KEY)`) |

### 8.3 D rubric traps

| Id | Resolution | Implemented in |
|---|---|---|
| **D1** | grapheme segmentation moved to `RevealPlan`; the sanitizer no-op is deleted | §3.5, §5.1 |
| **D2** | the empty `import type { } from './types'` is deleted | §3.6 (the import list is real) |
| **D3** | `EMOTIONS`/`EmotionSchema` defined once in `@ds/protocol`; identity test per consumer | §2.1 |
| **D4** | one severity table | §3.6.1 |
| **D5** | dev key only when `!app.isPackaged` **and** `DS_DEV_DEEPSEEK_KEY` is set; memory-only | §6.5 |
| **D6** | strip, never keep-and-mark | §3.11.2 step 4 |
| **D7** | one `fpsFor` policy, one `setFps` writer | §5.6 |
| **D8** | deterministic mouth assertions (unit test on steps; polled Playwright samples) | §5.1, §5.7 |
| **D9** | → R6 | §6.2 |
| **D10 / D11** | numeric `toBe` assertions | §3.8.1, §5.1 |
| **D12** | → R8, 3-iteration cap, thresholds written numerically | §7.3 |
| **D13** | nudge not persisted | §3.11.3 |
| **D14** | per-window allow-lists; protocol test asserts the pet cannot send `key:*`/`history:*`/`user:*` | §2.5, §2.7 |

### 8.4 Gaps this contract closes that no ruling named

These were `undefined` in the preflight and had no ruling; each is decided here so no implementer invents one.

| Preflight id | Decision | §  |
|---|---|---|
| A8 | `LintContext.recent` comes from `HistoryPort.recentAssistant(5)`, oldest-first | §3.6, §3.10 |
| A10 | `sanitizeForDisplay` is called **exactly once**, in `TurnRunner` at emission; the bubble and the history store both receive the already-sanitized text; the linter sees the raw text | §3.11.2 |
| A13 | `planTrim` is called by `TurnRunner.send()`, never inside `HistoryStore.window()` | §3.8.4 |
| A15 | `persona.test.ts` reads the real `character.json` through `fileURLToPath(new URL('../../../characters/haru/character.json', import.meta.url))` | §3.7.4 |
| A16 | the `state()` stub carries all six `StatePreamble` fields | §6.6 |
| A17 | `HistoryPort.append` types; `@ds/memory` depends on `@ds/brain` | §3.10, §1.3 |
| A18 | `turnDone` carries `lint` **and** `totalMs`; the IPC schema carries both | §2.3 |
| A22 | the client is rebuilt on key change; in-flight turns are cancelled | §6.5 |
| A25 | `BrainService` calls `store.record(...)` per turn | §6.6 |
| A27 | `HistoryRow` has a zod schema; `kind` vocabulary enumerated | §2.2, §6.3 |
| A29 | `avatar:listening` producer = main, from `chat:composing`, 250 ms falling-edge debounce | §6.6 |
| A30 / A31 | `chat:open` (renderer→main, with `source` + `focusComposer`) and `chat:opened` (main→chat) are distinct channels; `chat:composing` is registered with a schema | §2.3 |
| A32 / A33 | preload globals named per window; `key:status` producer pinned | §2.6, §6.5 |
| A34 / A35 | Task 6 creates all three placeholder pages, so its own verification is self-contained | §1.6 |
| A36 | the bundle path in main is `app.isPackaged ? join(process.resourcesPath, 'characters', id, 'character.json') : join(__dirname, '../../../../characters', id, 'character.json')`; the renderer keeps using the `public/characters` copy | §6.6 |
| A40 / A59 | one line-length number: **24 hanzi** (`MAX_HANZI_PER_LINE = 24`), and the bubble has its own window so 460 px is legal | §5.2, §5.3 |
| A46 / A47 | `InvokeRequest` / `InvokeResponse` maps + `handleInvoke` helper | §2.4, §2.7 |
| A48 / D14 | eight per-window allow-lists | §2.5 |
| A49 | `tray.ts` is in the file list and gains two callbacks | §6.6 |
| A50 | `@ds/brain`, `@ds/memory` added to `externalizeDeps.exclude` | §1.6 |
| A55 | no new `@ds/stage` public API is needed at all | §5.7 |
| A62 / A63 | vitest jsdom wiring + a strict `tsconfig.ui.json` for all React/bubble code | §1.4, §1.5 |
| A65 | fake bridge injected with `page.addInitScript`; IME proven in jsdom | §2.6, §6.2 |
| A66 | Floating UI is **not** a dependency | §1.3 |
| A71 | `packages/memory/tsconfig.json` content given | §1.4 |
| spec §8 | composer restore-on-failure; empty completion → one retry then a canned line; SQLite open failure → blocking dialog + quit | §6.2, §3.9.4, §4.1 |

> **The A40/A59 row above said 26 until this fold-back, and that was the single most expensive stale number in the file.** §5.2 pins `MAX_HANZI_PER_LINE = 24`, §5.2's boxed justification derives 24 from `BUBBLE_MAX.width = 460`, and §8.6 row 3 explicitly *rejects* 26 — while this row and §8.7's era carried 26. Task 0 followed 26 and Task 7 followed 24, which is exactly the split a decisions log exists to prevent. **24 everywhere.** The rejected alternative (widen `BUBBLE_MAX.width` to 486 so 26 fits) contradicts R3 and stays rejected.

### 8.5 Deviations recorded here (no ruling covers them; the controller should confirm)

1. **`bubble:place` is two channels.** The task list described it as one channel with two directions; a channel has exactly one schema, so it is `bubble:place` (main→bubble, geometry) and `bubble:size` (bubble→main, measurement). Same information, two names.
2. **`bubble:hover` added.** R3 requires the bubble window to manage its own click-through; that needs a channel, and none was listed.
3. **`speech:mouth` and `speech:complete` added.** The mouth lives in the pet window while the reveal lives in the bubble window, and the bubble is `focusable:false`. These two relays are the minimum wiring that keeps A22's mouth sync and the addendum's "click/Enter completes" true across the window split. `speech:mouth` fires on transitions only (≈ 4 messages per sentence), not per grapheme.
4. **Space does not complete the reveal.** Both key-receiving surfaces treat Space as text. Enter on an **empty** composer completes instead. The addendum's "click/Enter/Space" is honoured as "click/Enter".
5. **`post_history_instructions` is placed in the latest user message**, not in the static system block — that is what "post-history" means, and the latest user message is already the dynamic slot, so the cached prefix is unaffected.
6. **`DS_DEV_DEEPSEEK_KEY`, not `DEEPSEEK_API_KEY`, is the dev app key.** `DEEPSEEK_API_KEY` stays reserved for the gated tests and the eval harness, so running the app in dev never bypasses the first-run flow the same variable is supposed to let you test (X9).
7. **`environmentMatchGlobs` is deprecated in vitest 3** but present and honoured; the per-file `// @vitest-environment jsdom` fallback is recorded in §1.5 so a future removal is a mechanical change.
8. **The band geometry replaced the head anchor** (Task 10, commit `02ad454`, on the controller's required-fix instruction). `HEAD_ANCHOR` is gone; `BAND_ANCHOR_Y = 0.72`, `BAND_TOP_MAX_FRACTION = 0.55` and `BAND_PET_FRACTION = 0.80` replace it, `top`/`bottom` are unreachable, and `preferredSideFor` prefers `left` at every pet position that has room instead of "the roomier half". §5.3, §5.3.1, §6.1, §8.6 row 16 and §8.7 were amended to match in fix round 1; `docs/evidence/phase2/deferred.md` records the same change as its eighth deviation. The two files are T6's — T10 edited them as integration owner because the controller required the fix.
9. **`placeBubble` takes a fifth argument, `avoid`** (Task 10 fix round 1). The composer stays open through her reply (§6.2 rules 4 and 6), so the band and the composer are on screen together and cannot share the band's rect. The band dodges; the composer never does. Default `null` reproduces the pre-fix geometry exactly, which is what every `placeBubble` call outside `bubble-window.ts` still gets.

### 8.6 Conflicts resolved while folding the task briefs back in

Each row is a place where two briefs, or a brief and this file, disagreed. The **simplest** option was taken; the rejected option is named so the controller can override with one edit.

| # | Conflict | Resolution (§) | Rejected alternative |
|---|---|---|---|
| 1 | `renderStaticSystem(card, motionKeys)` vs P3's `(card, mode)` | third parameter, appended and defaulted: `(card, motionKeys, mode = 'character')` — every existing call site still compiles (§3.7.3) | two functions, or reordering the parameters |
| 2 | `cardTokens(card)` (T3) vs `cardTokens(card, motionKeys)` (T9) | **split the budget**: `cardTokens(card)` ≤ 700 on the persona sections, `staticSystemTokens(card, mk, mode?)` ≤ 1100 on the whole block (§3.7.4) | one budget at 1100 — would require cutting ~43 % of the P0 card, deleting the traits P0 exists for |
| 3 | `BUBBLE_MAX.width = 460` vs `MAX_HANZI_PER_LINE = 26` | **24 hanzi** (§5.2); 460 is fixed by R3 and 24 is inside the addendum's 24–28 band | widening `BUBBLE_MAX.width` to 486 — contradicts R3 |
| 4 | Nothing stopped the bubble after `user:cancel` | **`onState('idle')` drops the queue** (§5.2) — one existing channel, no new schema | adding a `playback:stop` / `speech:abort` channel to §2.3 |
| 5 | `BUBBLE_EXIT_MS = 400` (T6, main) vs `BUBBLE_EXIT_MS = 160` (T7, renderer) | renderer keeps `BUBBLE_EXIT_MS = 160` (mirrors `--dur-exit`); main's is renamed **`BUBBLE_HIDE_DELAY_MS = 400`** (§5.4) | one shared constant — the two numbers measure different things |
| 6 | `resizeChat(win, rows, historyOpen)` (T8) vs `(win, pet, rows, historyOpen)` (T6) | **four arguments** (§6.1); without `pet` a grown chat can cross a monitor edge | three arguments plus a module-level pet reference |
| 7 | `ERROR_HINTS` (T6, `@ds/protocol`) vs `ERROR_COPY` + `error-copy.ts` (T8, renderer) | `ERROR_HINTS` only (§2.8); §6.4's table is a reading aid and `src/renderer/shared/error-copy.ts` is **not created** (D4) | two tables kept in sync by review |
| 8 | `ports.ts` owned by T4 (task-4 addition 17) vs T1 (task-5 CA-1) | **T1** (§1.1) — the only owner that keeps Lanes A and C independent | T4, which would serialise Lane C behind Lane A |
| 9 | `tsconfig.ui.json` / `tsconfig.renderer.json` / `typecheck` claimed by T0 **and** T7 | **T0** (§1.4 ownership table); T7 verifies and does not re-apply | T7, which would leave T0's `tokens.test.ts` in no program |
| 10 | Hint strip above the band (Task 0 direction) vs below (§5.5) | **below** (§5.5) — this contract outranks the direction contract | `flex-direction: column-reverse`, a one-line swap if overridden |
| 11 | `holdWindowOpen` / `markQuitting` in `main/window-glue.ts` (§1.1's tree, T8) vs in `main/key-window.ts` (§6.1's export block, T6) | **`key-window.ts`, owner T6** (§6.1, §1.1); `window-glue.ts` is deleted from the tree and must not exist. T6 lands first, needs the hold at eager-creation time, and already owns `key-window.ts` and `main/index.ts`; T8 imports both | a T8-owned `window-glue.ts` — would leave T6 unable to create the key window safely, or force T6 to write a file it does not own |
| 12 | `ports.ts` (T1) importing `TrimPlan` from `prompt.ts` (T3) — **TS2307 in a T1-only tree**, so T1 could not ship §3.10 verbatim | **`TrimPlan` moves to `types.ts` (T1); `prompt.ts` re-exports it** (§3.1, §3.8.4, §3.10). One definition, no ownership move, every existing call site still compiles | moving the `ports.ts` row to T3 (serialises Lane C behind Lane B, contradicts row 8) · a second local `TrimPlan` in `ports.ts` (a D3-class duplicate) |
| 13 | `--bubble-max-w` / `--bubble-max-h` written on the **band root** by `place()` but consumed on `#content`, the band's **parent** — custom properties inherit downwards only, so the 460 px cap silently vanished | **all three geometry tokens are written on `document.documentElement`** (§5.2); every consumer inherits, and `data-side` stays an attribute on the band | writing them on `#content` — needs a second element in `Bubble`'s constructor for one call site |
| 14 | §5.2's `bubble.pinned` (renderer, defers indefinitely on hover) vs §5.4's flat 3400 ms window hide — the window could vanish under a pinned band | **main defers too**: `bubble:hover {inside:true}` cancels the pending hide, `{inside:false}` re-arms the full delay (§5.2, §5.4 rule 4). Reuses the handler main already has | scoping the pinning promise to the band only and documenting that the window may hide under it — the visible result is the bug |
| 15 | §6.6's synthetic first message vs §5.2's `onState('idle')` "drop the queue" — mutually exclusive if `'first-mes'` ever emits a state | **`'first-mes'` emits `brain:sentence` + `brain:turnDone` and NO `brain:state` at all** (§6.6); the window is raised by `setBubbleVisible(true)` and lowered from the `playback:turnDone` path | sending `brain:state idle` and special-casing `'first-mes'` inside `SpeechController` — a rule in two sections instead of none |
| 16 | §6.1's `openChat` prose (`CHAT_GAP` above the pet's top edge, left-aligned) vs its own "reuse `placeBubble(…, 'top')` verbatim" | **the reuse instruction** (§6.1); it is the one with `bubble-place.test.ts` behind it and it inherits C14's monitor-edge guarantee. The prose sentence is deleted. **Amended in fix round 1:** the literal side `'top'` went with `HEAD_ANCHOR` (§8.5 deviation 8) — `openChat` now passes `preferredSideFor(petBounds, workArea)`. The resolution itself is unchanged: still one implementation | keeping the prose and writing a second placement path for the chat window — two implementations, two test suites, one of them untested |
| 17 | `key:status.lastTest` had no lifecycle: a stale `可用 ✓` survived `key:clear` | **a key change nulls it** — every `key:status` from `KeyStore.onChange` carries `lastTest: null`; only a completed `key:test` sets it (§2.3) | carrying `lastTest` inside `onChange`'s payload — widens `KeyStore` for a value it does not own |
| 18 | `chat:composing` was a one-way latch: a hide or focus loss mid-IME left light-dismiss armed forever | **cleared from both ends** — renderer sends `{on:false}` on textarea `blur`; main calls `setChatComposing(false)` in `closeChat` and on the window's `hide` (§2.3, §6.1) | a timeout on the latch — picks an arbitrary duration and still fails a long composition |
| 19 | §1.7 pinned `git commit -m … -m …` as the only form while tasks 0, 1 and 2 used a heredoc | **both permitted; the heredoc is preferred for multi-line CJK bodies** (§1.7 rule 2) | declaring three shipped tasks defective over a quoting style |
| 20 | `Claude-Session` said "the session URL from the environment block" without saying whose — tasks 9/10 hard-coded the controller's, tasks 3–8 left a placeholder | **always the executing session's own URL** (§1.7 rule 2); a brief's literal is a shape, not a value | letting the controller's URL sign an implementer's commit |

### 8.7 Numbers verified this session — do not "re-derive" or "fix" them

Every value below was measured, not estimated. A brief that changes one is wrong until it shows a new measurement.

| Area | Values | § |
|---|---|---|
| Repo test baseline on `main` (HEAD **`ba2b3ef`**) | **23 files / 206 tests** — protocol 16, stage **53**, desktop **133**, scripts 4. Re-measured this session with `npx vitest run`. Both `preflight.md`'s "10 files / 40 tests" **and** the earlier `2135c00` / "23 files / 198 tests" figure are stale; briefs express **deltas against 206** | §0, §1.5 |
| Token budgets | `cardTokens` **673**/700 · `staticSystemTokens` **994**/1100 · plain **block** **184** (`PLAIN_RULES` alone is **66**) · `HARD_RULES` 203 · `tagGrammar(['nod','shake','think','wave'])` 119 | §3.7.4 |
| Line length | `MAX_HANZI_PER_LINE` = **24** — `460 − 24 − 12 − 32 − 2 = 390 px = 24 hanzi` at `--fs-bubble` 16px. **Never 26** (§8.4, §8.6 row 3) | §5.2 |
| `estimateTokens` | `'你好世界'` → **3**, `'hello world'` → **3**, `''` → **0** | §3.8.1 |
| `planTrim` | **8400** dropped tokens / **14** dropped / **46** kept | §3.8.4 |
| `RevealPlan` | **1990** ms for the 20-hanzi string, **105** ms for `'abc'`, **2** steps for the ZWJ cluster | §5.1 |
| `placeBubble` | A `1430/754/left/60` · B `170/754/right/60` · C `1430/458/left/60` · D `132/64/left/368` · E `2804/734/left/80` — **re-measured in Task 10 fix round 1** against the band geometry (§8.5 deviation 8); the pre-fix `1144/366` · `456/366` · `1526/142/bottom` · `270/16/top` · `2508/346` row described `HEAD_ANCHOR` and is unreachable. Pinned by test G2 | §5.3.1 |
| Contrast | light band **14.7135** (`toBeCloseTo(14.714, 2)`), dark **15.2548** (`15.255`); `:root` **64** declarations, dark **29** | §5.8 |
| Summary cap | 2 000 → **600** tokens, **900** characters, ends on `。` | §4.4 |
| `node:sqlite` behaviour | `journal_mode` returns lowercase `'wal'`; `sqlite_sequence` appears with `AUTOINCREMENT`; opening a directory throws `unable to open database file` | §4.1, §4.2 |
| Lint | T2's **60** assertions are hand-traced against the literal implementations in §3.6.2 | §3.6.3 |
| Evidence manifest | **39** named files — 19 inherited by T10 (2 T0 + 3 T3 + 5 T7 + 7 T8 + 2 T9) + 20 of T10's own. The gate is a **manifest** gate, not a count; "20-file" was stale from the moment it was written | §1.8 |
| `tsconfig.renderer.json` | `"types": ["vite/client"]` (line 4, added in `39cbf05`) — **not** `[]`; the `include` array is **line 18**. Node types are still absent, which is the conclusion that matters | §0, §1.4 |
| `@types/node` behaviour | a raw-row **`interface`** fails `as` with **TS2352** against `Record<string, SQLOutputValue>[]`; a **`type` alias** compiles. `undici-types` 7.18.2's `BodyInit` excludes `ReadableStream`, so `new Response(stream)` does not typecheck | §4.2, §3.9.5 |

**Rubric traps confirmed NOT reintroduced** (re-verify before claiming a task done): D1 (no `Intl.Segmenter` round-trip in `sanitize.ts`), D2 (no empty type-only import), D3 (`EMOTIONS` defined once in `@ds/protocol`, identity test in both consumers), D5 (`DS_DEV_DEEPSEEK_KEY`, unpackaged-only, never persisted, unit-tested), D6 (strip, never keep), D8 (mouth polled over 20 samples), D9 (IME proved by a constructor-set `isComposing` jsdom event), D10/D11 (numeric `toBe` everywhere), D12 (tuning bounded to three logged iterations), D13 (nudge never persisted, asserted).

**Traps that WERE reintroduced by drafts and are closed above:** **D4** — T8's `ERROR_COPY` duplicating `ERROR_HINTS` (§2.8, §6.4, row 7 of §8.6); **D14** — an unauthenticated `onFrom` / `handleInvoke(channel, cb)` that would let any renderer invoke `key:set` or `history:delete` (§2.7); **D7** — an acceptance criterion permitting two `stage.setFps` call sites (§5.6).
