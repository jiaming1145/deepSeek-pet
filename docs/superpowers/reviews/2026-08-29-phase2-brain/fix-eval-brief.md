# Fix lane EVAL+DOCS — Phase 2 final-review fixes in `eval/`, `docs/evidence/phase2`, the tracked contract, `deferred.md`, README, and the versioned key hook

You own: `eval/**`, `docs/**`, `README.md`, `.githooks/**`, root `package.json` `prepare` script, `.superpowers/sdd/2026-08-29-phase2-brain/rulings.md` (append-only). Do not edit `packages/**` or `apps/**` source (other lanes).

Source of truth: `final-review.md` (IDs I-n / M-n), `eval-honesty.md`, `spec-coverage.md`, `security.md` in this directory — read each entry (file:line, reproduction, proposed fix) before acting.

## Findings to fix (all of them)

Eval harness
- I-12 judge sees `sanitizeForDisplay(raw)` while the reports claim raw output is measured (`eval/run.mjs:144`, `eval/lib/turn.mjs:72-75`, `eval/lib/judge.mjs:32-33`, `eval/lib/report.mjs:107`). Ruling: judge on `t.raw` with protocol tags already stripped (that is what the user would have seen if the sanitizer did not exist — the point of the rubric's markdown/stage-direction clauses), AND add a gated row `lintRuleCounts.markdown === 0`. Rewrite the honesty footer, `eval/README.md:41`, `docs/evidence/phase2/eval-report.md:81` to say exactly what is judged and what is linted. Re-run `pnpm test:eval` (dry, offline) and regenerate `docs/evidence/phase2/eval-report.{json,md}` from the recorded fixtures with the new pipeline; the report must still say `dry: true` and must not be presented as live.
- I-13 A9 zero-flip term: add a countMax-0 row `in_character_flips` (`eval/lib/aggregate.mjs`, pattern of `emoji_discipline_sensitive` at :106-110) so 13 in_character=0 turns fail A9; unit test with the probe from the finding (125×2 + 13×0 → fail).
- M-20 A18 per-reply gate: `turns.filter(t => t.shape.emojiCount > 1).length === 0` as a shape gate.
- M-19 `trait_hit`: add optional `condition` to the fixture schema and render `【判定条件】` in `buildJudgeUser` when present; golden test.
- M-21 A10: there is no A10 probe — move A10 to the not-measured list in `eval/lib/report.mjs:105`, `eval/README.md:48`, `docs/evidence/phase2/eval-report.md:79`, `deferred.md:88`; propose the contract §7.3 clause change.

Evidence honesty
- M-22 `e2e-report.json` base64 `stdout[].buffer` entries still decode to worktree paths (:95): normalise them too (decode → replace → re-encode) and state in `docs/evidence/phase2/README.md` that the file was path-normalised per A-5 and is otherwise the run record. Verify by decoding every buffer afterwards (0 hits).
- M-23 `deferred.md:287` cold-profile row → `382 (light) / 720 (dark) ms` from `e2e-report.json`, note the earlier figures came from overwritten runs.
- M-24 regenerate `docs/evidence/phase2/task-3-static-system.txt` with LF from node (`renderStaticSystem` bytes, Task 3 Step 9's one-liner is in `task-3-report.md`), or soften the README wording to "content-identical" — prefer regenerating.
- M-18 README note: all `app-*-dark.png` are `page.emulateMedia` captures proving the stylesheet, not Windows dark mode; `nativeTheme` handling is carried to Phase 4 (settings).

Contract / rulings / deferrals
- I-14 A22 listening pose narrowed to "IME session open": record it as a ruling in `rulings.md` (append) and as a tracked amendment; add a `deferred.md` row: Phase 3 behaviour engine adds the focus+keystroke producer that does not arm the light-dismiss guard. Reconcile the §6.6 divergence: the tracked `docs/superpowers/plans/2026-08-29-phase2-contracts.md` is the authority; copy the §6.6 note and the §1.5 amendment from the untracked `.superpowers/sdd/2026-08-29-phase2-brain/contracts.md` into the tracked Amendments section (as A-9…), then add a one-line banner at the top of the untracked copy: "superseded — see the tracked contract".
- M-28 A12 distinct greetings: `deferred.md` row (Phase 3, proactive / D4 night state).
- Phase 3 carry list from `final-review.md` → make sure every item has a `deferred.md` row with its finding ID (M-26 CSP → Phase 4 packaging; lazy key window; metrics retention; bubble-inside-pet-window).

Key hook (M-27)
- Version the hook: `.githooks/pre-commit` (POSIX sh; rejects staged additions matching `sk-[A-Za-z0-9]{20,}`, prints the offending path, exits 1; also rejects any staged file under `docs/evidence/**` that decodes … no — keep it to the regex, PNGs are out of scope) and root `package.json` `"prepare": "git config core.hooksPath .githooks"`. Verify: `pnpm install --frozen-lockfile` sets `core.hooksPath`; a staged temp file with a fake key is rejected (use `sk-` + 24 `x`, never a real-looking key); then unstage and delete the temp file. Copy the existing `.git/hooks/pre-commit` logic; the tracked placeholder in `tokens-sheet.html` is being changed by the RENDERER lane so the hook no longer contradicts it. README section "Secrets" (three lines).

## Rules
- Every regenerated evidence file must have the cwd banner `D:\ds\…` (A-5) — NOT your worktree path. If a command records cwd, run it from your worktree and normalise, and say so in the README.
- Never read `~/.ds/deepseek.key`, never set `DEEPSEEK_API_KEY`; everything here is offline/dry.
- Tests: `pnpm test:eval` and `npx vitest run --project @ds/eval` (if it exists) green; `pnpm test` green at the end.
- Commits: `fix(eval): … (I-n/M-n)`, `docs(evidence): …`, `chore(hooks): …`.
- Report: `<worktree>/.superpowers/sdd/2026-08-29-phase2-brain/final-review/fix-eval-report.md` — per finding: what changed, file:line, verification command + actual result line, commit; "## Amendments applied" listing the exact A-n entries you wrote into the tracked contract (you are the ONLY lane that edits contracts.md; the integrator will append the OTHER lanes' proposed amendments after you — leave the section well-formed).

## Added after launch — Codex review 2 (`codex.md`, IDs CX-n). ALSO assigned to this lane.
- CX-11 [moderate] `eval/lib/judge.mjs:73-87`, `eval/lib/ablation.mjs:64-79` — bounded `AbortSignal.timeout` on every fetch plus a size/idle-limited body reader; a stalled judge must fail that turn with `judgeError`, not hang the run. Test with a never-resolving fetchImpl.
- CX-12 [minor] reject unknown/duplicate axes in `fixture.mjs` validation; validate category→axis coverage; golden test.
- CX-13 [minor] one PRNG per run seeded from (global seed, run index) in `run.mjs`/`recorded.mjs` so concurrency cannot change chunk boundaries; test: same seed, concurrency 1 vs 4 → identical chunking.
- G2-8 (deferral only): add a `deferred.md` row — `app://local` handler does not preserve HEAD/Range (`app-protocol.ts serveRenderer`), no consumer needs ranges today, Phase 4 packaging.
