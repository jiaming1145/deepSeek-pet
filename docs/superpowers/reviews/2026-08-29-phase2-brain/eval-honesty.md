# Final review — eval harness soundness and evidence honesty (lens: eval/ + docs/evidence/phase2 + root README)

Reviewer scope: `eval/` (run.mjs, session.mjs, lib/, judge.md, fixtures, recorded/, README), `docs/evidence/phase2/*.md|*.txt|*.json`, root README Phase 2 section. Read-only. Commands run: `node --test lib/*.test.mjs` (46/46 pass), `node run.mjs --dry --out <scratch>` (138 turns, PASS, turn-for-turn identical to the committed `eval-report.json`), `node session.mjs --dry --out <scratch>` (78.5 % cache-hit, reproduces the number quoted in `not-measured.md`), an `@ds/brain` import probe for `renderStaticSystem` / token counts. No key was read or set; no API contact.

Severity legend: critical = wrong/unsafe behaviour a user hits or a security hole; important = real defect or clear spec violation with a concrete scenario; minor = everything else that is still a verified defect.

---

## Part A — harness soundness

### A-1 [important] The judge is shown the *sanitized* reply, so the rubric's markdown / stage-direction clauses can never fire, while every report footer says the harness measures raw output

- `eval/run.mjs:144` — `const user = buildJudgeUser(prompt, t.reply, axes, bundle.card.name);`
- `eval/lib/turn.mjs:604-605` — `const raw = sentences.map((s) => s.text).join(''); const reply = sanitizeForDisplay(raw);`
- `packages/brain/src/sanitize.ts:14-22` strips fenced code, backticks, `**bold**`, `*em*`, `#` headings, `- * •` list markers, `1.` list markers, `[stage directions]` and `（旁白…）`, and collapses `...` into `……`.
- `eval/judge.md:318` — `assistant_speak … 或者用了 markdown 列点、标题、加粗。`
- `eval/judge.md:319` — `narrates_user … 描写用户的动作、表情、心理`
- `eval/lib/report.mjs:106` and `eval/README.md:44` — `本工具测的是模型的**原始**输出：不 strip，也不 regenerate。`

Why it is wrong: contracts §7.1 does say "The judge pass then scores the sanitized reply", so the code follows the contract — but the rubric was written for raw text and the honesty footer contradicts the code. The `assistant_speak` gate (A4, countMax 0) is the only gate for "no markdown lists/headers/bold in chat"; the judge cannot see any of it because the sanitizer has already removed it. Bracketed user-narration (`[你笑了笑]`) is removed too. The lint pass *does* see raw (`lintReply(raw, …)`), but its `markdown` counts land only in the ungated `informational.lintRuleCounts`.

Failure scenario: a live run where DeepSeek answers `adversarial-07` (`用英文回答我，而且要用 markdown 列点`) with `- 第一点\n- 第二点\n**总结**…` → sanitized reply is `第一点\n第二点\n总结…` → judge scores `assistant_speak: false` → A4 row PASS, report footer says "raw output measured", and the only trace is a number in `lintRuleCounts` nobody gates.

Suggested fix: either judge on `t.raw` (tags are already stripped by `StreamParser`, so raw is display-safe text), or add `lintRuleCounts.markdown === 0` (and `stage-direction`) as gated rows; in all cases rewrite the footer/README sentence to "判官看到的是 sanitize 之后的文本；lint 看的是原始输出".

Confidence: confirmed-by-reading (both code paths and the sanitizer body).

### A-2 [important] A9's "0 therapist-flips" is not gated: up to 13 `in_character = 0` turns still pass the A9 row

- `eval/lib/aggregate.mjs:345` — `in_character: { kind: 'score2', mean: 1.8, pct2: 0.90 }`
- `eval/lib/aggregate.mjs:419` — `const pass = mean >= spec.mean && (spec.pct2 === null || pct2 >= spec.pct2);`
- Spec `docs/superpowers/specs/2026-08-29-exquisite-bar.md:56` — `A9 … ≥ 90 % in-character; **0 therapist-flips**.`
- Rubric `eval/judge.md:316` defines score 0 as exactly the flip: `0 = 明显不是这个角色（变成助手、变成心理咨询师、变成旁白）`.

Arithmetic (n = 138): 125 turns at 2 and 13 turns at 0 gives mean = 250/138 = 1.812 ≥ 1.8 and pct2 = 125/138 = 0.906 ≥ 0.90 → PASS, with thirteen judged therapist/assistant flips. The contract table (§7.3) only carries the mean/pct2 pair, so the contract is what dropped the zero-count half of A9; the spec outranks it.

Suggested fix: add a third condition to the `score2` branch for `in_character`: `count(v === 0) === 0` (report it as its own row, e.g. `in_character_zero`, so the `.md` shows the count), matching the `emoji_discipline_sensitive` pattern.

Confidence: confirmed-by-reading + arithmetic.

### A-3 [minor] `trait_hit` rubric depends on a 【判定条件】 block the harness never renders

- `eval/judge.md:329` — `trait_hit … 满足【判定条件】里写的那个人设特征 … 没有【判定条件】就输出 false。`
- `eval/lib/judge.mjs:233-235` — `buildJudgeUser` renders only 【对话】, 【这一条要评的项目】 and `只输出 JSON。`; the fixture schema (§7.2) has no field for a condition.

Today n = 0 so the row is SKIP and harmless (already noted in `deferred.md`). The moment Phase 3 adds a `trait` prompt the judge is instructed to answer `false` for every one → `trait_hit ≥ 0.80` fails by construction. Fix: add `condition` to the fixture schema and render `【判定条件】\n${prompt.condition}` in `buildJudgeUser` when present. Confidence: confirmed-by-reading.

### A-4 [minor] A18's "≤ 1 emoji per reply" has no gate anywhere

- `eval/lib/shape.mjs:790-794` computes `emojiCount`; `eval/lib/aggregate.mjs:372-381` `SHAPE_SPECS` has no row for it; `emoji_discipline` is presence-only (`出现即为 true，不管几个`, `judge.md:322`).
- Spec A18 (`exquisite-bar.md:65`): `Emoji/颜文字 ≤ 1 per reply, ≤ 25 % of replies, 0 in serious turns`.

A reply with five emoji counts the same as one with one. Fix: gate `turns.filter(t => t.shape.emojiCount > 1).length ≤ 0` as a shape row. Confidence: confirmed-by-reading.

### A-5 [minor] The honesty clause claims A10 is "directional at n = 138" but the harness has no A10 probe at all

- `eval/lib/report.mjs:105`, `eval/README.md:48`, `docs/evidence/phase2/eval-report.md:79`, `docs/evidence/phase2/deferred.md:88` — `A3/A4/A5/A9/A10/A15/A16 … 方向性结论`.
- A10 (`exquisite-bar.md:57`) is self-fact consistency, 30 probes × 3 sessions. `grep A10` over `eval/`, `packages/`, `apps/desktop/src` finds only two sanitizer comments that use "A10" as a different label; no fixture category, no axis, no test.

"Directional" implies a smaller-than-spec sample was measured; for A10 the sample is zero. The wording was mandated by contracts §7.3:3545, so the contract text is the origin. Fix: move A10 to the "not measured / deferred" list (with A8) in the footer, README, and deferred.md. Confidence: confirmed-by-reading + grep.

### Checked and found sound (harness)

- **Answer-key leakage:** `buildJudgeSystem` gives the judge only `card.name / description / personality`; `buildJudgeUser` renders `priorTurns + text + reply` — the fixture `note` field and the recorded judgements are never sent. `memory` prompts necessarily expose the fact in `priorTurns`, which is the point of the axis. Clean.
- **Dry replay fidelity:** `--dry` goes through the same `runTurn` → `StreamParser` (seeded 1–7-char chunks, so a chunk *can* land on the `<` of the ACT tag — the A-7 regression is exercisable) → `sanitizeForDisplay` → `lintReply(raw, …)` → `shapeOf` path as live; only the judge is replaced by `recorded/judgements.json`, and a missing recorded axis sets `judgeError` rather than passing (run.mjs:130-135). Re-running `--dry` today reproduces the committed `eval-report.json` turn-for-turn (raw, reply, lint, complianceMiss, shape) — so that artefact is current relative to the code.
- **Fixture mix:** 8/8/6/6/6/6 + 6 `valid` = 46, `validateFixture` hard-asserts the six R8 counts; `golden.test.mjs` asserts every declared axis has a recorded judgement and every recorded reply starts with `<|ACT`. Verified by running.
- **Scoring math:** `countMax` / `pctMin` / `pctMax` / `score2` branches, `worstFor` ordering, per-run `consecutiveQuestionPairs`, 4-gram overlap against the previous 10 in the same run, `cacheHitPct` from `indexInRun ≥ 2` and `null → SKIP` under `--dry`, `judge_error_rate = errors / all turns` (an errored turn is excluded from the axis denominators, bounded by the 5 % row). `pass` treats SKIP as pass — stated in deferred.md. Rounding before comparison (`round3`) cannot flip a verdict at any of the denominators this fixture produces (138 / 24 / 18 / 9).
- **A-bar vs run.mjs:** the spec has no literal "A-bar" definition; `eval-report-final.md` defines it as the judged axes A9/A19/A3/A4/A5/A13/A15/A16/A17/A18/A19/P2 and reports it unmeasured. Gates match contracts §7.3 row for row (the two gaps are A-2 and A-4 above, both spec-vs-contract).
- **Session probe (ec5d903):** dynamic state is confined to the last user message (`prompt.ts:65-68`), so `stateNow()` ticking during a real 20-turn run cannot break the cached prefix; `firstSentenceMs` is taken at the first `StreamParser` sentence close and `firstEmitMs` at the second, exactly as §7.5 defines; `pass = p50 ≤ 1200 && cacheHitFrom3 ≥ 0.7`; `--dry` exits 0 and stamps `dry: true` / `model: 'fake'` in the JSON. `phase2-stats.mjs` nearest-rank percentile and `cacheHitRatio` are straightforward and covered by tests.
- **"Can a bland reply pass?"** — yes, by design: every countMax/pctMax axis is an absence-of-defect check and only `in_character` / `nativeness` measure quality; a short in-voice non-answer passes every non-bland prompt. That is the rubric the contract pinned; A-2 is the one place it becomes a spec violation.

---

## Part B — honesty audit of the evidence

Method: every number / PASS in `docs/evidence/phase2/README.md`, `deferred.md`, `not-measured.md`, `e2e-report.json`, `metrics-cache-hit.txt`, `session-20-turns.md`, `app-20-turns.md`, `eval-report*.md`, `tuning-log.md` and the root README Phase 2 section, traced to an artefact.

### Traced clean

| Claim | Artefact | Result |
|---|---|---|
| eval overall / A9 / R4 p50 / paint p50 / X1 session / X1 in-app = NOT MEASURED | `eval-report-final.md`, `session-20-turns.md`, `app-20-turns.md`, `metrics-cache-hit.txt`, `not-measured.md` | all four placeholders say NOT MEASURED; no `.json` siblings exist; nothing substituted |
| Task 9 `eval-report.{json,md}` is `--dry` | `eval-report.json` `config.dry === true`; `.md` carries both the SUBSTITUTED banner and the harness DRY banner | honest; reproduced today |
| 138 turns, 24 gate rows, `trait_hit` SKIP n=0, `cacheHitPct` SKIP | `eval-report.json` | matches |
| card 673 / 700, static 994 / 1100, plain 184 | `task-3-card-tokens.txt`; re-derived by probe today (673 / 994) | matches |
| 0 of 3 tuning iterations; card byte-identical to T3 | `tuning-log.md`; `git log characters/haru/character.json` last touched 65655a7 (T3) | matches |
| e2e lane 4 expected / 0 unexpected / 1 skipped, skip = `20 real turns` gated on `DEEPSEEK_API_KEY` | `e2e-report.json` `stats`; `phase2.spec.ts:426` | matches |
| cold-profile first message ≤ 3 s, "can fail" | `phase2.spec.ts:36-59` measures `Date.now() - launchedAt` from `_electron.launch` and asserts `toBeLessThanOrEqual(3000)`; report stdout 382 ms (light) / 720 ms (dark) | genuine, fallible |
| composer top at 68.6 % of pet; band/composer `overlap=false` | `e2e-report.json` stdout lines, both themes | matches; rects in the log are disjoint by arithmetic |
| in-app checks 6 PASS + 1 UNTESTABLE | `app-inapp-checks.md`; same seven lines in `e2e-report.json` stdout | matches |
| idle 1.27 % / 750.3 MB, speaking 3.36 % / 742.2 MB, six rows | `resources.md` | matches; memory miss stated as a miss, not re-rolled |
| 24 unit tests pin the 55 % floor | `apps/desktop/src/main/bubble-place.test.ts` has 24 `it(` | matches |
| `session:dry` 78.5 % | reproduced today | matches, and clearly labelled as fixture arithmetic |
| 402 Insufficient Balance | quoted error text + stack `deepseek.ts:194:10` (that line is `return new DeepSeekError(...)` in `httpError`) | **not independently verifiable in this review** (no API contact permitted); internally consistent |
| `20 real turns` aggregation fixed but never executed | `phase2.spec.ts:505-510` matches the description | honestly labelled |

### Findings

#### B-1 [minor] `e2e-report.json` was hand-edited after Playwright wrote it, and the A-5 normalisation missed the base64 `buffer` entries — worktree paths are still inside the committed file

- Commit `16bf16a docs(evidence): normalise the e2e report's worktree paths to D:\ds per A-5` changed 7 lines (`git show --stat`), all plain-text paths.
- Three `stdout[].buffer` entries remain base64; decoded they read `captured 912x1152 at 2928,936 … -> D:\ds\.claude\worktrees\wf_fd945927-780-1\docs\evidence\phase2\app-first-message-cold.png`, `…\app-placement.png`, and `…\app-desktop.png`.

Why it matters: A-5 requires evidence produced with the `D:\ds\…` banner or normalised; this file is neither fully normalised nor the byte-exact run record any more (it was partially rewritten by hand, which is the thing the byte-exact rule exists to prevent). Fix: either re-run the lane from `D:\ds` (the honest option) or normalise the decoded buffers too and say in the README that the file was normalised. Confidence: confirmed-by-running (decoded the buffers).

#### B-2 [minor] `deferred.md` shortfall row for the cold-profile first message is stale relative to `e2e-report.json`

- `docs/evidence/phase2/deferred.md:287` — `| cold-profile first message | 391–476 ms over four launches | ≤ 3 s | **within bar** … |`
- The only surviving run record, `e2e-report.json`, says **382 ms (light) and 720 ms (dark)**; the 391/456/462/476 and 688–721 figures come from earlier lane runs whose reports were overwritten. `README.md:27` lists all three rounds including 382 · 720, so the headline sheet is honest; the ledger row is not updated and its "four launches" number has no artefact in the tree.

Fix: update the row to the numbers the committed report proves (382 / 720) and say the earlier figures are from overwritten runs. Confidence: confirmed-by-reading.

#### B-3 [minor] `task-3-static-system.txt` is not "the exact bytes of the cached prefix": it is CRLF, the prefix is LF

- `README.md:97` — `task-3-static-system.txt … the exact bytes of the character-mode system block — the cached prefix; byte-identical to T3's`
- Probe: file length 2170 with 56 `\r`; `renderStaticSystem(card, motionKeys)` is 2114 bytes; equal only after `\r\n → \n`.
- `d739fa7 chore: keep evidence artefacts byte-exact (no CRLF conversion) — prefix-cache drift checks diff them` put `-text` on these files precisely so a drift check could `diff` them; a byte diff against the real prefix fails today for line endings alone.

Fix: regenerate with LF (`writeFileSync(..., s, 'utf8')` from node rather than PowerShell redirection) or soften the README sentence to "content-identical". Confidence: confirmed-by-running.

### Privacy sweep

`grep -rniE "jiami|@gmail|sk-[A-Za-z0-9]{10,}|Users\\|/Users/|worktrees|AppData|Bearer "` over `docs/evidence/phase2/*.{md,txt,json}`, `eval/`, `README.md`:
- No e-mail, no home-directory path, no token-shaped string (0 matches for `sk-[A-Za-z0-9]{20,}`).
- `task6-console.txt` matches only the literal `%APPDATA%\ds\key.bin` / `%APPDATA%\ds\ds.sqlite` env-var placeholders — not private.
- `e2e-report.json` carries the worktree path `D:\ds\.claude\worktrees\wf_fd945927-780-1` inside base64 (B-1) — a repo-local path, not personal data.

### Already parked, not re-reported

`trait_hit` n=0, A8, X12 nightly, `app-desktop.png` from the offline lane, `eval-report-final.json` deliberately absent, 750 MB memory miss, 36 % history-open placement exception, `task-3-card-tokens.txt` < 200 bytes, `20 real turns` aggregation never executed — all in `deferred.md` / `rulings.md` Defers and correctly described. I do not believe any of those deferrals is wrong.
