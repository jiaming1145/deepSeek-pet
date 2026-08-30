# Phase 2 evidence sheet — 对话 (brain · 对话框 · 输入)

Every claim Phase 2 makes, with the file that backs it — **and every claim it cannot make**. The
naming scheme is `contracts.md` §1.8's manifest plus Task 10's own `app-*` shipping-app captures.
Honesty clauses and everything deliberately not built: [`deferred.md`](deferred.md). What could not
be measured, and the exact commands that will measure it: [`not-measured.md`](not-measured.md).

> **Read this first.** The owner's DeepSeek account returns HTTP 402 *Insufficient Balance* for
> every chat completion (verified 2026-08-29; the key authenticates — a bad key returns 401). Every
> live-API number in Phase 2 is therefore **NOT MEASURED**: no judged eval report, no first-sentence
> latency, no prompt-cache figure, no paint latency, and **zero** of the three permitted persona
> tuning iterations. Nothing is estimated and no offline number is substituted for a live one.
> Task 9's committed `eval-report.{json,md}` is a `--dry` run (`config.dry === true`), so it is not
> a live baseline either.

## Headline numbers

| Claim | Number | Bar | Source |
|---|---|---|---|
| eval, overall verdict over 46 prompts × 3 runs = 138 turns | **NOT MEASURED** | every one of 24 gates | [`eval-report-final.md`](eval-report-final.md) |
| in-character (A9) | **NOT MEASURED** | mean ≥ 1.8 and ≥ 90 % | [`not-measured.md`](not-measured.md) |
| first sentence closes, p50 | **NOT MEASURED** | ≤ 1200 ms (R4) | [`session-20-turns.md`](session-20-turns.md) |
| first grapheme painted, p50 | **NOT MEASURED** | ≤ 100 ms (addendum §0) | [`app-20-turns.md`](app-20-turns.md) |
| prompt-cache hit, turns 3+ (session) | **NOT MEASURED** | ≥ 70 % (X1) | [`metrics-cache-hit.txt`](metrics-cache-hit.txt) |
| prompt-cache hit, turns 3–20 (in app) | **NOT MEASURED** | ≥ 70 % (X1) | [`app-20-turns.md`](app-20-turns.md) |
| tuning iterations | 0 of 3 | ≤ 3 (R8) | [`tuning-log.md`](tuning-log.md) |
| cold-profile first message, virgin `--user-data-dir` | 391 · 456 · 462 · 476 ms (round 1) · 688–721 ms over eight more launches (fix round 1) | ≤ 3 s | [`app-first-message-cold.png`](app-first-message-cold.png), `e2e-report.json` |
| band / composer top edge vs the pet window | 68.6 % | ≥ 55 % of the pet's height | [`app-placement.png`](app-placement.png), `bubble-place.test.ts` |
| band rect vs composer rect, both visible | no shared pixel, light and dark and mid-reply | disjoint | [`app-placement.png`](app-placement.png), [`app-desktop.png`](app-desktop.png), [`app-inapp-checks.md`](app-inapp-checks.md) |
| idle CPU / working set (whole Electron tree, 7 processes) | 1.27 % / **750.3 MB** | ≤ 4 % / ≤ 250 MB | [`resources.md`](resources.md) — CPU passes, **memory misses by 3×** |
| speaking CPU / working set | 3.36 % / 742.2 MB | ≤ 4 % / ≤ 250 MB | [`resources.md`](resources.md) |
| card budget | 673 / 700 tokens | ≤ 700 (A21) | [`task-3-card-tokens.txt`](task-3-card-tokens.txt) |
| in-app checks Task 6 could not run | 6 PASS, 1 UNTESTABLE | — | [`app-inapp-checks.md`](app-inapp-checks.md) |
| offline Electron end-to-end lane | 4 passed, 0 unexpected, 1 skipped (the gated real-API test) | — | [`e2e-report.json`](e2e-report.json) |

`resources.md` carries **four** rows, not two: fix round 1 re-ran the Electron lane to re-photograph
the placement fix, and every run appends its own `idle` / `speaking` sample. The second pair
corroborates the first rather than replacing it — idle **1.25 %** / 748.2 MB, speaking **2.48 %** /
747.0 MB — and the headline rows above are still the original pair. Neither number was re-rolled to
get a friendlier one: the memory bar is missed by ~3× in both.

## The light/dark sheet

Two rows on purpose. The browser-harness row is deterministic and good for pixel review; the
shipping-app row is the evidence that the built binary does it.

| Surface | Browser harness (T7/T8) | Shipping app (T10) |
|---|---|---|
| Design tokens | `tokens-sheet-light.png` · `tokens-sheet-dark.png` | — |
| Speech band | `sheet-band-light.png` · `sheet-band-dark.png` | `app-band-light.png` · `app-band-dark.png` |
| Composer | `sheet-composer-light.png` · `sheet-composer-dark.png` | `app-chat-light.png` · `app-chat-dark.png` |
| Key window | `sheet-key-light.png` · `sheet-key-dark.png` | `app-key-light.png` · `app-key-dark.png` |
| History pane | `chat-history-light.png` · `chat-history-dark.png` | — |
| Interruption marker `[中断]` | `history-interrupted.png` | `app-history-interrupted.png` |
| Hint surface (error, not in her voice) | `hint-error.png` | — |
| On the real desktop | `desktop-first-message.png` · `desktop-reply.png` | `app-desktop.png` · `app-first-message-cold.png` · `app-placement.png` |

## The placement fix (controller ruling, 2026-08-29)

`desktop-chat-over-pet.png` and `task6-fake-brain-run.png` are **the defect**, kept on purpose:
the composer and the placeholder band opened across her FACE, because `placeBubble` was anchored at
`HEAD_ANCHOR = {x: 0.5, y: 0.18}` and `chat-window.ts` asked for side `'top'` on top of that.
`app-first-message-cold.png`, `app-placement.png` and `app-desktop.png` are the same surfaces after
the fix: the band over her lower third, extending left from her body with her standing in its right
third, her face clear, and the composer on the band's own rect. `task-0-direction.md`'s FIRST
VIEWPORT and the direction-contract comment inside `bubble.html` are what the fix restores.

## Every file in the §1.8 manifest, plus Task 10's own

`docs/evidence/phase2/` holds the §1.8 **39-file manifest** (19 inherited + 20 produced here, with
3 of the 20 replaced by NOT MEASURED placeholders and 3 extra Task 10 captures added) **plus the
per-task working evidence T0–T8 left behind**. No hard total is given: it drifts with every file a
later task adds, and §8.7 is explicit that the gate is a manifest gate, not a count. Both groups are
listed below — the manifest first, the working evidence after it.

| File | Owner | What it proves |
|---|---|---|
| `tokens-sheet-light.png`, `tokens-sheet-dark.png` | T0 | the token specimen board, both themes (C12) |
| `task-3-card-tokens.txt` | T3 → regenerated by T10 | `cardTokens 673 ≤ 700` and `staticSystemTokens 994 ≤ 1100`; unchanged, because no tuning edit was made (A21) |
| `task-3-static-system.txt` | T3 → regenerated by T10 | the exact bytes of the character-mode system block — the cached prefix; byte-identical to T3's |
| `task-3-static-system-plain.txt` | T3 | the plain-mode block (P3's second cache lineage), 184 tokens, card-independent |
| `sheet-band-light.png`, `sheet-band-dark.png` | T7 | the ADV band, both themes (C15) |
| `hint-error.png` | T7 | a failure reason on the hint surface, never in her dialogue (C10, X6) |
| `desktop-first-message.png`, `desktop-reply.png` | T7 | the real app painting `first_mes` and mid-reveal — **under the old, face-covering placement** |
| `sheet-composer-light.png`, `sheet-composer-dark.png` | T8 | the composer, both themes (C8, C15) |
| `sheet-key-light.png`, `sheet-key-dark.png` | T8 | the key window with the masked field and the disclosure line (X9, C15) |
| `chat-history-light.png`, `chat-history-dark.png` | T8 | the history pane, both themes (X5) |
| `history-interrupted.png` | T8 | a `[中断]` row in the browser harness (R2's truthful-history marker) |
| `eval-report.json`, `eval-report.md` | T9 | the harness, the fixture and the 24 gate rows — over the **`--dry` recorded corpus**, not live output |
| `eval-report-final.md` | T10 | **NOT MEASURED**: no post-tuning judged run exists. No `.json` sibling was written. |
| `tuning-log.md` | T10 | **0 of 3** permitted tuning iterations, and why (R8) |
| `session-20-turns.md` | T10 | **NOT MEASURED**: R4's first-sentence bar and X1's session cache-hit bar. No `.json` sibling. |
| `metrics-cache-hit.txt` | T10 | **NOT MEASURED**: the per-turn `cache_hit / prompt_tokens` readout (forward-referenced by T5) |
| `app-20-turns.md` | T10 | **NOT MEASURED**: cache hit and paint latency inside the shipping app. No `.json` sibling. |
| `not-measured.md` | T10 | the 402 verification and the exact command list that produces all six files above |
| `app-band-light.png`, `app-band-dark.png` | T10 | the real band on a genuine first run, both themes |
| `app-chat-light.png`, `app-chat-dark.png` | T10 | the real composer with text, both themes |
| `app-key-light.png`, `app-key-dark.png` | T10 | the real key window, masked field + disclosure line, both themes |
| `app-first-message-cold.png` | T10 | the cold-profile first message on the desktop: virgin user-data dir, band up in 391–476 ms, over her lower third |
| `app-placement.png` | T10 | the composer on the band's anchor rect over her lower third — the controller's placement ruling — with the band stepped clear below it, in the running app |
| `app-desktop.png` | T10 | pet + **speaking** band + the open composer composited on the desktop, mouth open, DPI-aware capture (offline echo brain). Before fix round 1 the composer had to be closed for this shot, because it covered the band |
| `app-history-interrupted.png` | T10 | the `[中断]` row in the running app after `Escape` mid-reply, keeping only the sentence whose `playback:sentenceDone` arrived (R2) |
| `app-inapp-checks.md` | T10 | the seven in-app checks: hover pin, drag follow, display reconciliation (UNTESTABLE, 1 monitor), pointerleave re-arm, band/composer disjointness, Escape mid-reply, abandoned IME |
| `resources.md` | T10 | idle and speaking CPU / working set for the whole Electron process tree |
| `e2e-report.json` | T10 | the Playwright run record for the Electron lane: 4 expected, 0 unexpected, 1 skipped — the skip is the `20 real turns` test, gated on `DEEPSEEK_API_KEY` |
| `deferred.md` | T10 | the deferral ledger, the honesty clauses and the shortfall table |
| `README.md` | T10 | this sheet |

Also in the directory, and not part of the manifest: T0's `bubble-corner-*.png`,
`bubble-glyphs-300.png`, `misans-licence.txt`; T7's `bubble-thinking.png`, `mouth-sync.txt`,
`desktop-bubble-dragged.png`, `desktop-hint-no-key.png`; T8's `sheet-composer-typing-*.png`,
`desktop-chat-restore.png`; T9's `eval-dry-run.png`; T6's `task6-*.{txt,png}`; and the
`task-N-{typecheck,vitest,...}.txt` transcripts T1–T5 left behind.
`desktop-chat-over-pet.png` and `task6-fake-brain-run.png` are kept as the *before* half of the
placement fix.

## Rename note — 「小春」 is a placeholder

The owner has **not** confirmed the persona's name. The single source of truth is
`characters/haru/character.json` (`name` and `card.name`), and the band's name plate reads it at
runtime (`renderer/bubble/main.ts` fetches `character.json` and calls `bubble.setName`). Every
other occurrence in the shipping tree is a hard-coded copy and must be changed by hand on a rename:

| File | Line | Occurrence |
|---|---|---|
| `characters/haru/character.json` | 3 | `"name": "小春"` — **the source of truth** |
| `characters/haru/character.json` | 17 | `card.name` |
| `apps/desktop/src/main/fatal.ts` | 3 | `FATAL_TITLE = '小春打不开了'` |
| `apps/desktop/src/main/fatal.test.ts` | 25, 27, 28 | pins `FATAL_TITLE` and the dialog text |
| `apps/desktop/src/main/key-window.ts` | 41 | window title `'小春 · API Key'` |
| `apps/desktop/src/main/summarizer.ts` | 15 (comment), 17 | `makeSummarizer(client, charName = '小春')` default |
| `apps/desktop/src/renderer/chat.html` | 6 | page title, `小春 · 对话` |
| `apps/desktop/src/renderer/key.html` | 6 | page title, `小春 · API Key` |
| `apps/desktop/src/renderer/shared/tokens.css` | 2 | header comment |
| `apps/desktop/src/renderer/tokens-sheet.html` | 3, 147, 166, 178 | the token specimen board's heading, plate and key-window mock |
| `apps/desktop/src/renderer/bubble/bubble.test.ts` | 88, 89 | `setName('小春')` test literal |
| `apps/desktop/DESIGN.md` | 2, 126 | front-matter `name:` and the H1 |
| `apps/desktop/.impeccable/design.json` | 4, 43 | `title` and the band mock's plate |

`docs/superpowers/plans/*.md` also carry the name, in quoted code blocks: those are historical
records of what was planned and are not renamed.
