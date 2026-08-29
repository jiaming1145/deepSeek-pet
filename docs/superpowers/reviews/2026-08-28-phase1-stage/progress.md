# SDD ledger — plan: docs/superpowers/plans/2026-08-28-phase1-stage.md

Spec: docs/superpowers/specs/2026-08-28-live2d-companion-design.md (read; binding authority)
Branch: main (Ruling: Jiaming's standing orders mandate a single `main` branch and commit-as-you-go, so no worktree/feature branch — cost if wrong: history on main has WIP commits, all reversible)

## Pre-flight scan (2026-08-28)

| Pair / task | Produces vs consumes | Finding | Ruling |
|---|---|---|---|
| T1 protocol ↔ T6/T7 | Channels/Schemas/parseEvent, RENDERER_TO_MAIN/MAIN_TO_RENDERER | T7 adds `debug:toggle` to protocol; consistent | none |
| T2 character.json ↔ T3 schema | haru: string/null emotion targets, motionMap tuples; hiyori: MotionRef targets; scale/offsetY | union schema covers both | none |
| T2 fetch-sdk ↔ T4 CompanionModel | files under characters/<id>/model/; model3.json refs siblings relative to model dir | **Defect:** T4 fetched siblings from character dir → 404 | Ruling: T4 `load()` roots all fetches at `<characterUrl>/<dirname(modelJson)>/` — plan edited — cost if wrong: none, pure path fix |
| T2 scripts test ↔ T1 vitest | `scripts/sdk-layout.test.mjs` outside packages/apps globs | would not be collected | Ruling: root `vitest.config.ts` with `projects: ['packages/*','apps/*','scripts']`; T2 adds `scripts/vitest.config.mjs` — plan edited |
| T3 tsconfig ↔ T2 | includes `vendor/core/live2dcubismcore.d.ts` (from fetch-sdk) | T2 precedes T3 | none |
| T4 ↔ T5 | `Priority`, `CompanionModel.{load,tick,draw,hitAny,setGaze,setExpression,startMotion,expressionNames,motionGroups,hitAreaNames}`, `setRenderTargetSize`, `release` | names match; `CubismWebGLOffscreenManager.initialize` signature unverified (plan flags it) | none — review loop net |
| T3 ViewTransform ↔ T5 hitTestClient | toView math vs tests (400x800 → (-0.5,1); 800x400 → x=-1) | consistent | none |
| T6 vitest ↔ Playwright | default vitest include would collect `tests/stage.spec.ts` | would fail | Ruling: `apps/desktop/vitest.config.ts` include `src/**/*.test.ts` — plan edited |
| T6 renderer ↔ T7 preload | `window.ds.send/on`, channel allowlists | consistent | none |
| T7 electron.vite.config | `externalizeDepsPlugin()` would externalize `@ds/protocol`/`zod` → sandboxed preload cannot require them; main cannot load TS | **Defect** | Ruling: main uses `externalizeDepsPlugin({exclude:['@ds/protocol','@ds/stage','zod']})`, preload bundles everything, koffi external — plan edited — cost if wrong: bundle size only |
| T7 index.ts | "placeholder" toggleDebug replaced in-step with `debug:toggle` channel | self-consistent | none; implementer must also mount the debug panel on demand in the renderer |
| T7 `app.setName` | userData dir naming | conditional in plan | Ruling: set `app.setName('ds')` unconditionally before `whenReady` |
| T8 foreground ↔ T7 | `sendToPet`, `Channels.shellVisibility`, `userHidden` | consistent; koffi marshalling flagged in plan | none |
| Global | Electron 43.4.1 pin, gitignores, WebGL2, credit line | all tasks agree | none |

Rubric conflicts: none (no assert-nothing tests, no verbatim duplicated logic mandated).

## Task log
Task 1: implemented (BASE e96f054 → 9f85776, DONE_WITH_CONCERNS: 'scripts' vitest project omitted until Task 2 — pre-authorized). implementer=a34261855ada1d351 (haiku). Review dispatched (sonnet) on review-e96f054..9f85776.diff
Task 1: minor (deferred): NOTICE references LICENSE but no LICENSE file exists yet (MIT per spec §11) — add in final fix wave
Task 1: complete (commits e96f054..9f85776, review clean; trailers verified by controller)
Task 2: BASE 9f85776, dispatching implementer (sonnet)
Task 2: implemented (BASE 9f85776 → f31597f, DONE). implementer=a3228661e84ef1847 (sonnet). Review dispatched (sonnet)
Task 2: minor (deferred): fetch-sdk.mjs asserts Core version but not that any Haru/Hiyori files were extracted — add a per-model file-count check
Task 2: complete (commits 9f85776..f31597f, review clean; ⚠️ fetched-file contents verified by controller listing)
Task 3: BASE f31597f, dispatching implementer (haiku)
Task 3: implemented (BASE f31597f → 4413620, DONE). implementer=a3ebdc9118740f6ac (haiku). Review dispatched (sonnet)
Task 3: review ❌ (1 Important, plan-mandated: ViewTransform.toView used 2/max(w,h); sample math reduces to 2/height in both orientations → landscape x compressed). Ruling: reviewer is right — fix toView to s = 2/h and change the landscape test to expect x≈-2 (=-ratio); constraint "±ratio horizontally" stands; plan edited — cost if wrong: hit-test/gaze x-scale off by ratio on landscape (Task 6 Playwright + manual hover would expose it)
Task 3: minor (deferred): view.ts stores unused `ratio` field; no test for malformed character id; TextMouthDriver phase unwrap subtracts one lap per call (bounded, harmless)
Task 3: fix round 1/5 (1 Important + 1 folded Minor addressed pending re-review; commits 4413620..5b7278f). Scoped re-review dispatched (sonnet)
Task 3: minor (deferred): view.ts comment says "±2 for landscape" — should say ±ratio
Task 3: complete (commits f31597f..5b7278f, fix round 1 clean; trailers verified by controller)
Task 4: BASE 5b7278f, dispatching implementer (opus)
Task 4: implemented (BASE 5b7278f → d35aaa3, DONE_WITH_CONCERNS: stage tsconfig adds useDefineForClassFields:false + strictFunctionTypes:false for vendored Framework; carry to Task 6 tsconfig.renderer). implementer=a208229aa183006e9 (opus). Review dispatched (opus)
Task 4: Ruling: vendored Framework source requires useDefineForClassFields:false + strictFunctionTypes:false wherever it is compiled — added to Task 6's tsconfig.renderer.json in the plan — cost if wrong: renderer typecheck fails loudly, no runtime risk
Task 4: review ❌ (2 Important: startMotion leaks reservation on missing motion → idle never restarts; release() never deletes WebGL textures). Fix round 1 dispatched to implementer.
Task 4: minor (deferred): load() partial failure leaks allocations (folded into fix round as try/catch release); `_updating=false` no-op; redundant saveParameters; loadTexture leaves UNPACK_PREMULTIPLY_ALPHA_WEBGL set globally; fetchBuffer error lacks "model asset" prefix; no img.crossOrigin; strictFunctionTypes:false now covers our own stage code (durable fix: alias to Framework dist d.ts); tsconfig comment says "three relaxations"
Task 4: fix round 1/5 (2 Important + 1 folded Minor pending re-review; commits d35aaa3..59c6f71). Scoped re-review dispatched (sonnet)
Task 4: minor (deferred): CubismUserModel.release() is not idempotent (Framework); Live2DStage.dispose must guard against double release
Task 4: complete (commits 5b7278f..59c6f71, fix round 1 clean; trailers verified by controller)
Task 5: BASE 59c6f71, dispatching implementer (opus)
Task 5: implemented (BASE 59c6f71 → 2d601fa, DONE_WITH_CONCERNS: brief's projection.scale replaced by scaleRelative (CubismMatrix44.scale assigns); hitTestClient rewritten as exact inverse of frame()). implementer=ab2cded6575dff74f (opus). Review dispatched (opus)
Task 5: review ❌ (1 Important: create() registers gl with CubismWebGLOffscreenManager before fallible load → context leaked on failure). Reviewer upheld both brief deviations (scaleRelative; hitTestClient = inverse of frame()). Fix round 1 dispatched (folding minors: start-after-dispose guard, toDevice NaN guard, clearDepth order).
Task 5: minor (deferred): context loss is silent (no warn/restore path); resize() viewMatrix.scale(1,1) resets scale but not translation (use loadIdentity when pan arrives); stale class-header comment re ViewTransform.toView (now only gaze uses it); framework warnings go to console.log
Task 5: fix round 1/5 (1 Important + 3 folded Minors pending re-review; commits 2d601fa..980f3af). Scoped re-review dispatched (sonnet)
Task 5: complete (commits 59c6f71..980f3af, fix round 1 clean; trailers verified by controller)
Task 6: BASE 980f3af, dispatching implementer (opus)
Task 6: implemented (BASE 980f3af → 7745794, DONE; e2e 1/1, unit 22/22; evidence browser-haru.png viewed by controller — Haru full body rendered). implementer=adcab04091363ed48 (opus). Review dispatched (opus)
Task 6: Ruling: pnpm 10 blocks electron's postinstall (no binary) — Task 7 Step 1 adds `onlyBuiltDependencies: [electron]` to pnpm-workspace.yaml and re-runs pnpm install — cost if wrong: none, standard pnpm 10 mechanism
Task 6: Ruling: pinned versions electron-vite 5.0.0, vite 7.3.6 (electron-vite peer ^5||^6||^7 — do not float to 8), @playwright/test 1.62.1
Task 6: review: spec ✅ but 6 Important plan-mandated findings (hover needs own clock; hover must sample gaze:cursor; drag release fires tap; drag can stick when button released off-window; hash assertion vacuous vs idle motion; tapMotions uses only first group / throws on {}). Ruling: all six are genuine defects in the plan's code — fix in Task 6 fix round 1, not deferred to Task 7 — cost if wrong: none, all are renderer-local
Task 6: minor (deferred): dbg-hit lookup on every mousemove; pixels() inline in main.ts; test hook typed unknown + spec redeclares Hook; debug-panel innerHTML unescaped model names; ?character unvalidated in dev; fixed 1500ms waits; hover default/boundary untested; apps/desktop lacks vitest devDep; F05 orphaned/F06 reused; ?test=1 implies DEBUG
Task 7: Ruling: dispatched in parallel with Task 6 fix round in an isolated worktree (user asked for speed; file sets disjoint). Task 7 must NOT edit apps/desktop/src/renderer/**; it adds the `debug:toggle` channel to @ds/protocol and sends it from the tray, and the renderer handler moves to Task 8 — cost if wrong: a merge conflict I resolve, or the tray debug item is inert until Task 8
Task 7: BASE 4dfd419 (main), dispatching implementer (opus, worktree)
Task 6: fix round 1/5 (6 Important pending re-review; commits 7745794..fa62a5a). Scoped re-review dispatched (sonnet)
Task 6: minor (deferred): expression pixel test margin is tight (worst single-sample ratio 1.34 vs 1.4 threshold, median-of-3 mitigates) — watch for flake; hover.cancel() unused; press.moved accumulates path length not net displacement
Task 6: complete (commits 980f3af..fa62a5a, fix round 1 clean; trailers verified by controller)
Task 7: implemented (BASE fa62a5a → 926dbc6 on branch worktree-agent-a61ee11f7064327ed, DONE_WITH_CONCERNS: 4 brief bugs fixed at runtime — preload required workspace pkg, tray GUID threw, 'moved' never fires, file:// fetch in built app; 30/30 tests; 3 desktop screenshots viewed by controller: hover shot shows Haru transparent over Explorer, hit: Body). implementer=a61ee11f7064327ed (opus, worktree). Review dispatched (opus)
Task 7: review ❌ (2 Important: tray GUID removed instead of a valid UUID gated on app.isPackaged; missing tray icon silent). Ruling: brief's `registerIpc()` export is not needed (index.ts wires via onFromPet) — interface dropped, not a defect. Fix round 1 dispatched.
Task 7: minor (deferred): clampToDisplays only tests window centre (plan-mandated); throws on empty displays; default size 400x700 ≠ PET_SIZE 420x720; cursor dedupe on screen coords not window-local; serveRenderer lacks 404 Response (folded into fix round); onFromPet doesn't verify sender; IPC boundary untested; app:// handler registered in dev too
Task 7: fix round 1/5 (2 Important + 1 folded Minor pending re-review; commits 926dbc6..fca6c23 on worktree branch; fresh implementer sonnet since worktree agent not resumable). Scoped re-review dispatched (sonnet)
Task 7: minor (deferred): app:// 404 catch swallows all fetch errors without logging
Task 7: complete (commits fa62a5a..fca6c23 merged into main as c2922d1; worktree removed; fix round 1 clean)
Task 8: BASE c2922d1, dispatching implementer (opus)
Task 8: implemented (BASE c2922d1 → 77a2942, DONE_WITH_CONCERNS: unlock-screen/resume not observed (nobody at machine); GetWindowRect physical px vs DIP bounds fixed via screenToDipRect; multi-monitor hide semantics open). implementer=a5872d49ef42b579a (opus). Review dispatched (opus)
Task 8: review ✅ quality Approved; spec ❌ only on undisclosed `.gitignore:+.gptmcp/`. 1 Important (plan-mandated): systemHidden conflates lock+suspend → `resume` un-hides + restarts ticker while lock screen still up (masked by foreground watch; unmasked when koffi fails). Ruling: fix — split into lockHidden/suspendHidden (brief's single-flag snippet is the source; cost if wrong: none, superset behaviour). Ruling: keep `.gptmcp/` in .gitignore (benign agent scratch), disclose in report §4. Fix round 1 also folds Minors #2 (clearInterval when pet destroyed), #3 (derive `reason` from flags inside applyVisibility), #6 (pause cursor polling while hidden), and a pure visibility-state module with a lock→suspend→resume→unlock test.
Task 8: minor (deferred): startForegroundWatch not injectable (toDip + transition-only emission untested; tolerance boundary ±2/±3 untested); unlock restore is delivered by the foreground poll not the unlock handler (correct by inspection, ≤2 s lag); ~6.5 MB PNG evidence (downscale later); multi-monitor hide semantics open
Task 8: fix round 1/5 (BASE ae68e0e; resuming implementer a5872d49ef42b579a)
Task 8: fix round 1 — original implementer not resumable (no transcript); fresh implementer a2c331605a75e1196 (sonnet) dispatched
Task 8: fix round 1 done (ae68e0e → f4ce45e, 40/40, DONE). Scoped re-review + whole-branch final review dispatched in parallel (acceleration ruling: user asked to accelerate; fix diff is small state logic)
Phase 1 final review: workflow wf_9345059c-206 (re-review + 4 lenses → verify → synth → final-review.md) + GPT reviews j1-7psd (main/preload/renderer) and j2-k3vi (stage). LICENSE (MIT) committed.
Phase 1 final review: GPT j1 (main) VERDICT block major:6 minor:2 → gpt-review-main.md; GPT j2 (stage) VERDICT block major:5 minor:3 → gpt-review-stage.md; follow-up GPT j3-irqd dispatched (cursor/tray/window-state/protocol/bridge/debug-panel/preload). All GPT findings merge into the single fix wave with final-review.md.
Phase 1 final review complete: final-review.md — confirmed 5 Important (C1 no initial shell:visibility resync; C2 ready-to-show bypasses applyVisibility; C3 spec §9 tap + frame-budget arms missing; C4 4K evidence PNGs leak private desktop content; C5 gaze speed fps-coupled, no GazeDriver), 30 minors ledgered in final-review.md §2, 2 refuted (§3). GPT reviews: 15 major + 8 minor across gpt-review-{main,stage,main-2}.md.
Ruling: the single fix wave runs as 4 lanes (owner-disjoint files): A main/preload/protocol (opus, worktree, a5cc2a30ee83dd77f), B packages/stage (opus, worktree, a1d2cbcdf7c572151), D evidence re-crop (sonnet, on main, afd2133cd31b25436), C renderer/tests/evidence-fps after A+B merge — because the user asked to accelerate and the lanes cannot conflict; cost if wrong: a merge conflict I resolve by hand.
Ruling: C4 history — re-crop now; recommend `git filter-repo --path docs/evidence/phase1 --invert-paths` (or BFG) before the FIRST push; not executed without the owner's go-ahead (history rewrite).
Fix wave Lane D: complete (2ac16de) — 6 PNGs re-cropped, no 3840x2160 left, docs/evidence/phase1 = 1.7M, plan evidence rule added; controller viewed desktop-debug-click.png: clean.
Fix wave Lane B: implemented (dbab82e → 55e1eaf, 9 commits, 79/79) merged into main as 37dbc5e; Ruling: GazeDriver tau=0.0543 s (derived from spec §4.3's 250 ms settle at ≤1% error) supersedes the brief's 0.08 s — cost if wrong: one constant. Concerns carried to Lane C: crossOrigin browser confirmation; CubismEyeBlink unseeded (pixel gate may race a blink). Scoped re-review dispatched (opus) on review-dbab82e..55e1eaf.diff
Fix wave Lane A: implemented (dbab82e → 1f8248e, 7 commits, 139/139) merged into main as a74bd8c; main now 178/178, typecheck clean. Rulings: A5 zoomed veto conditioned on !taskbarReserved (accepted — cannot cause a wrong hide); .gitignore `**/` prefix (accepted). Owed manual checks (F1 hide-before-paint, IsZoomed real user32) handed to Lane C. Scoped re-review dispatched (opus, ae0684a4e1c61eab3) on review-dbab82e..1f8248e.diff.
Fix wave Lane C: dispatched on main (opus, a8790dd63877caa5d) — PressTracker, Playwright tap/seed cases, Task-Manager frame-budget evidence, debug-panel escaping, config ride-alongs, plus the three manual confirmations.
Outage: session usage limit hit ~10:00; Lane C implementer + both scoped re-reviewers terminated (no commits lost — main clean at ba12bd4); re-dispatched under low-priority mode: Lane C a09d19328a911e424, re-review A a3f04b9de1f0df24d, re-review B a1930477563fe4430. Plan-v2 workflow wf_1d69206d-bd6 lost 2 author agents (tasks 0/4/7/9 files missing at last check) — resume with resumeFromRunId once it reports.
Fix wave Lane A re-review: Needs fixes (1 Critical: per-drag clamp blocks monitor seams; 4 Minor) → fixed by controller directly (clampDrag union/grabbable clamp + tests; will-redirect; isFromPet try/catch; ERR_ABORTED skip; IsZoomed int). Lane B re-review: B1–B8 fixed; 1 Important (_initialized after release) + 4 Minor → fixed by controller in 093575b. Ruling: controller applied both fix rounds directly (small, owner-disjoint from the running Lane C) — cost if wrong: re-review of two small commits.
Controller fix round (093575b, 6c22ac7): scoped re-review Approved (sonnet a5f989e9a701c58eb), 10/10 fixed, no regressions. GPT closure check dispatched on merged main-process + stage.
GPT closure check j4-svmm: earlier findings closed; 3 Major + 2 Minor new → gpt-review-closure.md; Ruling: fix round 2 runs after Lane C lands (item 1 touches renderer hover.ts) — one dispatch covering all five, then scoped re-review, then tag.
Fix wave Lane C: complete (cc68781, 62a0791, 69e6883, 2135c00, 0e6db9e on main; tree clean) — agent died at the report step (session limit) after finishing; controller verified: task-8-report §3.5.5 CPU 0.58 % idle mean / 1.54 % hover (budget ≤ 4 %), §3.5.6 hide-before-paint PASS, foreground-maximized-visible + foreground-fullscreen-hidden captures; controller viewed fps-cpu-idle.png and visibility-hide-before-paint.png (clean, claim legible). No fixwave-lane-C-report.md — the commits + task-8-report rows are the record.
Fix round 2 (GPT closure items 1–5) started by controller.
Fix round 2 (GPT closure items 1–5) committed by controller: 39cbf05; 204/204, typecheck clean. Scoped re-review dispatched.
Fix round 2 re-review: Approved (5/5); minor (setCursorPaused before send) fixed in 681d943. Awaiting Lane C scoped review, then tag phase1-stage.
Fix wave Lane C scoped review: Approved (6 Minor). Fixed now: #2 off-model press taps on release; #1 ?test=1 hook dev-only; #4 PNG run labelled; #6 comment. Deferred: #3 tests typechecked under the relaxed renderer tsconfig; #5 foreground-fullscreen-hidden.png has no landmark (log line in §3.5.7 is the proof).
PHASE 1 COMPLETE: final review + GPT reviews closed through fix rounds; tag phase1-stage. Workspace archived to .superpowers/archive/ (gitignored); review records committed under docs/superpowers/reviews/2026-08-28-phase1-stage/.
