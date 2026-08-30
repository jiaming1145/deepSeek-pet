# Fix lane EVAL+DOCS — report

Worktree: `D:\ds\.claude\worktrees\wf_d4736852-369-4` · branch `worktree-wf_d4736852-369-4` · base `16bf16a` (main).
Setup: `git submodule update --init --recursive`, `pnpm install --frozen-lockfile`, `pnpm fetch-sdk` (exit 0; `vendor/core` and `characters/haru/model` were absent).
Baseline before any change: `pnpm test:eval` 46/46, `pnpm test` 55 files / 611 passed / 2 skipped.
No key read, no `DEEPSEEK_API_KEY` set, no API contact; everything offline / `--dry`. No subagents. `--no-verify` never used.

## Commits (worktree branch only, oldest first)

| SHA | Message |
|---|---|
| `ac5f192` | fix(eval): judge on raw output, gate A9 zero-flips, A18 per-reply emoji, markdown lint (I-12/I-13/M-19/M-20/M-21) |
| `8c98783` | docs(evidence): regenerate the dry eval report with the new gates; normalise e2e base64 buffers (I-12/M-22) |
| `df67899` | docs(evidence): honest ledger, contract amendments A-9..A-16, evidence README notes (I-14/M-18/M-21/M-23/M-24/M-26/M-28) |
| `3dc3f23` | chore(hooks): version the key-leak pre-commit hook and install it via prepare (M-27) |

## Final checks (run after the last commit)

| Check | Result |
|---|---|
| `pnpm test:eval` | `ℹ tests 58 · pass 58 · fail 0` (was 46; +12 tests) |
| `pnpm test` | `Test Files 55 passed (55) · Tests 611 passed | 2 skipped (613)` — unchanged, no `packages/**`/`apps/**` source touched |
| `pnpm typecheck` | all packages `Done` |
| `npx vitest run --project @ds/eval` | **does not exist** — `eval` is deliberately not a vitest project (contract §1.5); `pnpm test:eval` is the gate |
| `node run.mjs --dry` | `138 轮，总判定 PASS`, 17 axis rows + 10 shape rows |

## Per finding

### I-12 — judge saw the sanitized reply while the footer claimed raw
- **Changed:** `eval/lib/judge.mjs` new `judgeInput(turn)` → `turn.raw` (tags already stripped by `StreamParser`, pre-`sanitizeForDisplay`); `eval/run.mjs:144` `buildJudgeUser(prompt, judgeInput(t), …)`. New gated shape row `markdownLintCount` (`lintRuleCounts.markdown`, `≤ 0`) in `eval/lib/aggregate.mjs` (`SHAPE_SPECS` + `shape`). Footer rewritten in `eval/lib/report.mjs` (判官看 raw / lint 看 raw / 形状指标看 sanitize 后); `eval/README.md` "它不做什么" section rewritten to the same three-line statement; `docs/evidence/phase2/eval-report.md` regenerated (footer now carries the new sentence); `deferred.md` "What each pass reads" bullet; root README one sentence.
- **Tests:** `judge.test.mjs` "judgeInput hands the judge the raw reply"; `aggregate.test.mjs` "A4: a markdown lint hit on the raw output fails the markdownLintCount gate"; `report.test.mjs` asserts the new footer sentences and the absence of the old ones. Red first (`fail 9` before implementation), then green.
- **Verify:** `pnpm test:eval` → 58/58; `--dry` → PASS, `markdownLintCount = 0` on the recorded corpus.
- **Decision recorded:** judge on `raw` AND gate `markdownLintCount`, both as the brief ruled. Shape metrics stay on `reply` (what the user sees) — stated explicitly in the footer/README so no one reads "raw" as "everything".
- Commit `ac5f192` (code) · `8c98783` (evidence) · `df67899` (ledger/README).

### I-13 — A9 zero-flip half not gated
- **Changed:** `eval/lib/aggregate.mjs` new axis row `in_character_flips` (`countMax 0`, `n` = judged turns with an `in_character` score, `count` = score-0 turns, `worst` = first three), placed after the `AXIS_SPECS` loop next to `emoji_discipline_sensitive`; label in `AXIS_LABELS`. Skipped under `--no-judge` / no judged turns.
- **Test:** `aggregate.test.mjs` "A9: thirteen in_character=0 turns among 138 …" — 125×2 + 13×0: asserts `in_character.pass === true` (the pair still clears) and `in_character_flips.pass === false`, `count 13`, `r.pass false`; plus single-flip and skip cases.
- **Verify:** `pnpm test:eval` 58/58; regenerated `eval-report.md` row `| in_character_flips | 138 | 0 次 | ≤ 0 | PASS |`.
- Contract amendment A-12; rulings FR-2. Commit `ac5f192`.

### M-20 — A18 per-reply gate
- **Changed:** `SHAPE_SPECS.emojiMultiCount` (`≤ 0`, count of turns with `shape.emojiCount > 1`).
- **Test:** "A18: a reply with two emoji fails the per-reply gate (M-20)".
- **Verify:** 58/58; report row `| emojiMultiCount | 0 | ≤ 0 | PASS |`. Amendment A-13. Commit `ac5f192`.

### M-19 — `trait_hit` 【判定条件】 never rendered
- **Changed:** `eval/lib/judge.mjs` `buildJudgeUser` renders `【判定条件】\n<condition>\n\n` between 【对话】 and 【这一条要评的项目】 when `prompt.condition` is a non-empty string. `eval/lib/fixture.mjs` `validateFixture`: `condition` must be a non-empty string when present, and a prompt whose `axes` include `trait_hit` **must** carry one (the rubric answers `false` without it, so a probe without a condition fails by construction — rejecting it at load time is the honest option). `eval/README.md` fixture section documents the field.
- **Tests:** `judge.test.mjs` golden string for the rendered block (exact equality) and the absent case; new `eval/lib/fixture.test.mjs` (5 tests: skeleton validates, string condition ok, non-string rejected, empty rejected, `trait_hit` without condition rejected).
- **Verify:** 58/58; the shipped fixture still validates (`validateFixture` in `golden.test.mjs`). Amendment A-15. Commit `ac5f192`.

### M-21 — A10 called "directional" with zero probes
- **Changed:** `eval/lib/report.mjs` footer: A10 gets its own line ("没有测 … 样本是零 … 挪到 Phase 3"), removed from the directional list; `eval/README.md` honesty section likewise; `docs/evidence/phase2/eval-report.md` regenerated; `deferred.md`: A10 removed from the denominator sentence, own bullet, and a "Deferred by ruling" row (Phase 3, with A8). Root README: "A10 … has no probe at all and is deferred with it".
- **Contract clause change proposed and applied as amendment A-14** (§7.3 honesty clause: "A8 and A10 are out of Phase 2 (Phase 3). A3/A4/A5/A9/A15/A16 are directional at n = 138 …"); rulings FR-2 amends R8's wording.
- **Verify:** `report.test.mjs` asserts `!md.includes('A9/A10/A15')` and `md.includes('没有测')`; `grep -n "A10" eval/README.md docs/evidence/phase2/deferred.md docs/evidence/phase2/eval-report.md` shows only the not-measured wording. Commits `ac5f192`, `8c98783`, `df67899`.

### M-22 — `e2e-report.json` base64 buffers still held worktree paths
- **Changed:** decoded every `stdout[].buffer` (5 buffers; 3 matched `D:\ds\.claude\worktrees\wf_fd945927-780-1`), replaced with `D:\ds`, re-encoded, wrote back with the original 2-space formatting. Script: scratchpad `normalise-e2e.mjs` (not committed — a one-off). `docs/evidence/phase2/README.md` `e2e-report.json` row now states the file is path-normalised per A-5 (plain text in 16bf16a, base64 buffers in this wave) and is otherwise the run record.
- **Verify:** `node normalise-e2e.mjs e2e-report.json --check` → `buffers with worktree paths: 0; plain-text "worktrees" occurrences: 0` (exit 0). `git diff --stat` = 3 lines changed (the three buffers). Timings/stats untouched.
- **Decision:** normalise rather than re-run the Electron lane — re-running from `D:\ds` is not possible from a worktree without touching the shared checkout, and a re-run would overwrite the stats the README quotes. Commit `8c98783`.

### M-23 — stale cold-profile row
- **Changed:** `deferred.md` shortfall row → `382 ms (light) / 720 ms (dark)` from the committed `e2e-report.json`, with the note that the 391–476 / 688–721 figures came from earlier runs whose report was overwritten. Evidence README headline row and the `app-first-message-cold.png` manifest row aligned to the same numbers.
- **Verify:** `e2e-report.json` stdout lines `first message … 382 ms` (light) / `720 ms` (dark) are the only surviving artefact; `grep -n "391" docs/evidence/phase2/deferred.md` → only inside the "came from overwritten runs" clause. Commit `df67899`.

### M-24 — `task-3-static-system.txt` "is CRLF" — **NOT A BUG**
- **Reproduction attempted:** `git show HEAD:docs/evidence/phase2/task-3-static-system.txt` → blob **4502 bytes, 0 CR**; working copy in this worktree 4502 bytes, 0 CR; `Buffer.equals(renderStaticSystem(card, motionKeys), file)` → **true** (probe `probe-m24.mjs`, run from the `eval` package so `@ds/brain` resolves). `.gitattributes` `docs/evidence/** -text` prevents conversion on checkout; `git log` shows the file last touched in `65655a7` (T3), consistent with "byte-identical to T3's".
- **Why the reviewer saw 2170 / 56 `\r` / 2114:** those are UTF-16 string lengths of a CRLF-materialised copy (2114 + 56 CR = 2170), i.e. the reviewer's checkout had `core.autocrlf` applied to the file — the exact gotcha `task-3-report.md` §"Gotchas" 1 records, and the reason `d739fa7` added the `-text` attribute. The committed artefact is exactly what the README claims.
- **Action taken:** no regeneration. Added one sentence to the README manifest row so the next reader compares against `git show HEAD:…` rather than a possibly-converted working copy. Commit `df67899`.

### M-18 — dark captures are `emulateMedia`
- **Changed:** `docs/evidence/phase2/README.md` "The light/dark sheet" gains a paragraph: every `app-*-dark.png` is `page.emulateMedia({ colorScheme: 'dark' })`, main never touches `nativeTheme`, T10 recorded `themeSource='dark'` did not flip `matchMedia`; the shots prove the stylesheet, not Windows dark mode; `nativeTheme` handling carried to Phase 4 settings. `deferred.md` row added.
- **Verify:** read-only doc change; `grep -n emulateMedia docs/evidence/phase2/README.md` → 1 hit. Commit `df67899`.

### I-14 — A22 narrowing recorded nowhere authoritative
- **Changed:** (1) `rulings.md` (shared `D:\ds\.superpowers\sdd\2026-08-29-phase2-brain\rulings.md`, untracked/gitignored, append-only) — new section "Final-review rulings" with **FR-1** (A22 narrowed to "IME session open"; Phase 3 focus+keystroke producer that does not arm the light-dismiss guard), FR-2 (R8 amendments), FR-3 (tracked contract is the only authority). (2) Tracked contract Amendments **A-9** (the §6.6 note copied and expanded) and **A-10** (the untracked copy's §1.5 fix-round-1 vitest amendment). (3) `deferred.md` "Deferred by ruling" row "A22 — the listening pose while the user types" → Phase 3 behaviour engine. (4) Banner prepended to the untracked `D:\ds\.superpowers\sdd\2026-08-29-phase2-brain\contracts.md`: "SUPERSEDED — see the tracked contract …".
- **Note on location:** `rulings.md` and the untracked `contracts.md` live only under `D:\ds\.superpowers\` (gitignored, no worktree copy). Both writes succeeded (`tail rulings.md` shows FR-1..FR-3; `head -1 contracts.md` shows the banner). They are not commits; the integrator does not need to copy them.
- Commit `df67899` (tracked contract + ledger).

### M-28 — A12 distinct greetings
- **Changed:** `deferred.md` row "A12 — distinct greetings …" → Phase 3 with the proactive scheduler / D4 night state; states that only `first_mes` exists and no probe measures a variant. Commit `df67899`.

### Phase 3 carry list → `deferred.md` rows (each with its finding ID)
Added rows: A22 producer (I-14), A12 (M-28), A10 (M-21), CSP (M-26 → Phase 4 packaging, with the header value from the finding), `nativeTheme` (M-18 → Phase 4 settings), lazy key window (carry 7), bubble-inside-pet-window (carry 7), `metrics` retention (carry 8). The `trait` row gained the M-19 `condition` note. M-19/M-20 are fixed in this wave, M-27 is fixed in this wave, M-5 belongs to the BRAIN lane — none of those three got a carry row. Commit `df67899`.

### M-27 — key hook unversioned
- **Changed:** `.githooks/pre-commit` (POSIX sh, mode `100755` in the tree, LF pinned by a new `.gitattributes` line `.githooks/** text eol=lf` — without it `core.autocrlf=true` would materialise a CRLF shell script on Windows clones). Logic copied from `.git/hooks/pre-commit` and extended to print the offending path(s): iterates `git diff --cached --name-only --diff-filter=ACMR`, greps each path's staged `+` lines for `sk-[A-Za-z0-9]{20,}` (the brief's regex; the old local hook used `{24,}`), exits 1 with the list. Root `package.json` `"prepare": "git config core.hooksPath .githooks"`. README "Secrets" section (three sentences).
- **Verify (all ran):** `pnpm install --frozen-lockfile` → `git config core.hooksPath` = `.githooks`. Staged `hook-probe.tmp` containing `sk-` + 24 × `x` → `git commit` printed `pre-commit: refusing to commit content that looks like an API key (sk-...) in:` / `  hook-probe.tmp`, **exit 1**, no commit created; then `git reset -- hook-probe.tmp` and deleted it (`git status` clean of it). The four real commits afterwards passed through the same hook. `git ls-tree HEAD .githooks/pre-commit` → `100755`; blob has 0 CR.
- **Side effect handled:** `core.hooksPath` is stored in the **shared** `.git/config` (worktrees share it), and `D:\ds` main has no `.githooks/` until this lane is integrated — leaving it set would silently disable the main checkout's local hook for every other lane. I therefore ran `git config --unset core.hooksPath` after verification; the integrator's `pnpm install` on main re-arms it. Recorded here so nobody thinks `prepare` failed.
- `tokens-sheet.html:180` placeholder: untouched (RENDERER lane); the hook only inspects staged additions, so the existing line does not trip it.
- Commit `3dc3f23`.

## Amendments applied (tracked `docs/superpowers/plans/2026-08-29-phase2-contracts.md`, "Amendments" section, appended after A-8 in order)

- **A-9** — §2.3/§6.6 `avatar:listening` = "IME session open" (A22 narrowing), Phase 3 producer, ruling FR-1. (I-14)
- **A-10** — §1.5 `vitest.config.ts`: drop `environmentMatchGlobs`, `// @vitest-environment jsdom` docblocks, merge order a145f03 → f3cb834. (untracked-copy divergence)
- **A-11** — §7.1 judge scores `raw` via `judgeInput`; new shape gate `markdownLintCount ≤ 0`; honesty wording. (I-12)
- **A-12** — §7.3 `in_character_flips` countMax 0; R8 "≥ 90 % and 0 flips". (I-13)
- **A-13** — §7.3 `emojiMultiCount ≤ 0`; A18 is three rows. (M-20)
- **A-14** — §7.3 honesty clause: A10 out of the directional list, not measured, Phase 3 with A8. (M-21)
- **A-15** — §7.2 optional `condition`; required for `trait_hit`; rendered as 【判定条件】. (M-19)
- **A-16** — versioned `.githooks/pre-commit` + `prepare`; 27 gate rows = 17 axes + 10 shape. (M-27)

The section ends after A-16 with a blank line before `## 0.1 …`; the integrator can append A-17… for the other lanes.

## Decisions made without asking
1. Judge on `raw` **and** gate `markdownLintCount` (brief's ruling, both halves).
2. `validateFixture` rejects a `trait_hit` prompt without `condition` (stricter than "optional") — the rubric makes such a probe fail by construction, so failing at load is the honest failure.
3. M-22 normalised in place rather than re-running the Electron lane (see above).
4. M-24 recorded NOT A BUG with byte evidence; README sentence added instead of regenerating an already-exact file.
5. `.gitattributes` gained `.githooks/** text eol=lf` (not in the brief; needed for the hook to run on autocrlf clones).
6. `core.hooksPath` unset in the shared `.git/config` after verification (see M-27).
7. Gate-count wording updated from 24 → 27 in root README, evidence README, deferred.md and eval/README so the numbers agree with the regenerated report.

## Files touched (worktree-relative)
`eval/run.mjs`, `eval/lib/{aggregate,judge,fixture,report}.mjs`, `eval/lib/{aggregate,judge,report}.test.mjs`, `eval/lib/fixture.test.mjs` (new), `eval/README.md`, `docs/evidence/phase2/{eval-report.json,eval-report.md,e2e-report.json,README.md,deferred.md}`, `docs/superpowers/plans/2026-08-29-phase2-contracts.md`, `README.md`, `package.json`, `.gitattributes`, `.githooks/pre-commit` (new). Outside git (shared, gitignored): `D:\ds\.superpowers\sdd\2026-08-29-phase2-brain\rulings.md` (appended), `…\contracts.md` (banner prepended).

## Fix round 1

Branch `worktree-wf_d4736852-369-4`, three commits on top of `8f54bd6`'s predecessor `3dc3f23`: `71117be fix(eval)`, `c77ff21 docs(evidence)`, `8f54bd6 chore(hooks)`. Checks run after the last commit (all verified by running them):

- `pnpm test:eval` → `tests 74 / pass 74 / fail 0` (13 tests added this round: 6 tagged CX-11/CX-13, 7 for CX-12).
- `pnpm --filter @ds/eval eval:dry` → `138 轮，总判定 PASS` (written to `eval/out/2026-08-30-0719.{json,md}`, gitignored; `docs/evidence/phase2/eval-report.*` NOT regenerated — see decision 3).
- `pnpm test` → `Test Files 55 passed (55) · Tests 611 passed | 2 skipped (613)`.
- `pnpm -r --if-present typecheck` → brain / stage / memory / desktop all `Done`.

### CX-11 (Important) — stalled judge / ablation hangs the run
- **How fixed.** New `eval/lib/bounded-fetch.mjs`: `boundedFetch(fetchImpl, url, init, {timeoutMs, idleMs, maxBytes})` passes `signal: AbortSignal.timeout(timeoutMs)` into the fetch, races the fetch promise against that same signal (`raceSignal`, so a `fetchImpl` that ignores the signal or never settles is still cut off), then reads the body through `readBoundedBody` — chunk-by-chunk with a per-chunk idle deadline (`AbortSignal.any([signal, AbortSignal.timeout(idleMs)])`) and a byte cap. Defaults 120 s / 30 s / 256 KiB. `judgeOnce` (`eval/lib/judge.mjs:85-105`) now goes through it and throws plain `Error`s, which `judgeTurn` (`:107-121`) already converts to `{ ok:false, message }` → `run.mjs:152-153` sets `judgeError`. `runAblation` (`eval/lib/ablation.mjs:60-93`) wraps the same call in try/catch and returns `{ ok:false, message: '<arm>: …' }`. `run.mjs:29` adds `JUDGE_TIMEOUT_MS = 120_000` and passes it at `:150`.
- **Tests.** `eval/lib/judge.test.mjs` — "judgeTurn fails … when fetchImpl never resolves (CX-11)" (30 ms deadline, two attempts, asserts `ok:false`, `/timeout|abort/i`, and < 2 s wall clock), "passes an AbortSignal to fetch and cuts off a fetch that ignores it", "rejects a body that never finishes streaming (idle cap)", "rejects an oversized body", and a positive-path test using a real `Response`. `eval/lib/recorded.test.mjs` — "runAblation surfaces a stalled arm as { ok:false } instead of hanging". All green.
- **Commit** `71117be`.

### CX-12 (Important) — unknown / duplicate axes and no category coverage check
- **How fixed.** `eval/lib/fixture.mjs:11-33` exports `OPTIONAL_AXES` (= `AXIS_SPECS` keys minus `UNIVERSAL_AXES`) and `CATEGORY_AXES` (`bland→initiative`, `sensitive→refusal_language`, `flawed→sycophancy_pushback`, `memory→memory_use` all `'all'`; `humour→humour_stops` `'some'`; `adversarial` none). `validateFixture` (`:46-56`) now rejects, per prompt: an axis that re-lists a universal axis (would be judged twice), an axis not in `OPTIONAL_AXES` (names the prompt, the bad axis and the allowed list), a duplicate within the prompt, and a missing `'all'`-coverage axis for the prompt's category; and, fixture-wide (`:80-86`), a `'some'` category with no prompt carrying its axis. The shipped `prompts.zh.json` passes unchanged.
- **Tests.** `eval/lib/fixture.test.mjs` — unknown/misspelled axis (`false_disagreemnt`), duplicate axis, re-listed universal axis, `OPTIONAL_AXES`/`CATEGORY_AXES` consistency, `bland-3` without `initiative`, humour with no `humour_stops` anywhere, and the positive case (3 of 6 humour prompts carrying it). The `fixtureWith` skeleton now builds R8 prompts with their coverage axes. Plus `golden.test.mjs` "the shipped fixture satisfies R8 and its own mix" still passes.
- **Commit** `71117be`.

### CX-13 (Important) — one mutable PRNG shared across concurrent dry runs
- **How fixed.** `eval/lib/recorded.mjs:15-18` adds `runSeed(seed, runIndex)` (two multiplicative hashes xor'd); `RecordedClient` takes `runIndex` (default 0) and seeds `mulberry32(runSeed(seed, runIndex))`. `eval/run.mjs:87-104` replaces the single shared client with `clientFor(runIndex)`: in `--dry` a fresh `RecordedClient` per run (the `has()` pre-check uses a throwaway probe instance); live keeps one `DeepSeekClient`. `turn.mjs` is unchanged (`ctx.client.streamFor(prompt.id)` now hits the per-run client).
- **Test.** `eval/lib/recorded.test.mjs` "seed=1: concurrency 1 and 4 yield identical chunk boundaries for every run (CX-13)": mirrors `run.mjs` (one client per run inside `pool`, yields to the event loop between prompts so interleaving actually happens), 4 runs × 3 replies, `deepEqual` of every chunk-size list plus a coverage check; also `runSeed` distinctness and byte-stability across constructions.
- **Commit** `71117be`. `eval/README.md` gained one sentence each for CX-13 and CX-11.

### G2-8 (Important) — missing `deferred.md` row
- **How fixed.** `docs/evidence/phase2/deferred.md:36` (last row of "Deferred by ruling"): `app://local` `serveRenderer` answers HEAD / `Range:` with the plain GET body; no consumer needs ranges today; Phase 4 packaging, with the concrete fix named (empty body for HEAD, `206` + `Content-Range` for a single range). `grep -c G2-8 deferred.md` → 1.
- **Commit** `c77ff21`.

### Minor — `.githooks/pre-commit` word-splits paths with spaces
- **How fixed.** `.githooks/pre-commit:21` → `printf '%s\n' "$offenders" | sed 's/^/  /' >&2`.
- **Verification (ran it).** Scratch repo with `core.hooksPath` pointing at a copy of the hook, staged `a b.txt` containing `sk-` + 24 `x`: output `pre-commit: refusing to commit content that looks like an API key (sk-...) in:` / `  a b.txt` (one line), `exit=1`; after unstaging that file the clean commit returned `exit=0`. The three commits of this round also went through the hook in the worktree itself.
- **Commit** `8f54bd6`.

### Decisions made without asking (round 1)
1. Judge deadline 120 s (thinking stays ON for the judge), idle 30 s, body 256 KiB; the ablation arms use the helper's defaults. All overridable through `judgeTurn`/`runAblation` options.
2. Category coverage is `'all'` per prompt for bland/sensitive/flawed/memory but `'some'` for humour, because contract §7.3 / §8 fixture text says `humour_stops` is judged on the 「别闹了」 half only (the shipped fixture has 3 of 6). A per-prompt rule there would have contradicted the contract.
3. `docs/evidence/phase2/eval-report.{json,md}` were NOT regenerated: CX-13 changes only where the recorded text is split before `StreamParser`, which affects no reported number (verified by re-running `eval:dry`: 138 turns, PASS, same gates). Regenerating would only churn timestamps.
4. Re-listing a universal axis in a prompt is treated as an error (not just a duplicate), since `axesFor` would otherwise request it twice from the judge.
