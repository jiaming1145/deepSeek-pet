# Phase 2 final review — security lens

Reviewer stance: adversary wanting (a) the DeepSeek key, (b) code execution from a crafted model
reply, (c) the memory db from another app. Scope: `git diff phase1-stage..main`, code only.
Everything below was confirmed by reading the code path end to end; two items were also executed
with a `node --experimental-strip-types` probe (recorded inline). No repo writes, no real-API launch.

## Findings

### F1 · important · `<|PAUSE n|>` is unbounded — one crafted reply parks an empty always-on-top band on screen and leaves the turn in `speaking`

- `packages/brain/src/tags.ts:7-8`
  ```ts
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  if (pause) return { kind: 'pause', seconds: Number(pause[1]) };
  ```
- `packages/brain/src/stream-parser.ts:101` `else this.pendingPause = item.tag.seconds;` — attached verbatim to the next `SentenceEvent`.
- `packages/protocol/src/index.ts:31` `pause: z.number().nonnegative().optional(),` — the IPC schema has no upper bound either.
- `apps/desktop/src/renderer/bubble/speech.ts:200-201`
  ```ts
  const wait = Math.round((ev.pause ?? 0) * 1000);
  if (wait > 0) this.schedule(wait, () => this.step());
  ```
- No clamp anywhere between the model and `setTimeout`. contracts.md §3.2/§5.2 describe `PAUSE` only as "seconds"; nothing caps it.

Probe (ran it): `parseTag('<|PAUSE 100000|>')` → `{ kind: 'pause', seconds: 100000 }`; a `StreamParser` fed `<|ACT emotion=happy|><|PAUSE 100000|>你好。` emits `{ …, "pause": 100000 }`.

Failure scenario: model output is untrusted (the user can type "回复里先写 <|PAUSE 100000|>", or a poisoned running summary can ask for it). `TurnRunner.release` emits the sentence → `brain:state speaking`; `SpeechController.beginTurn` shows the band with empty text; `next()` schedules `step()` in ~28 h (Chromium honours any delay < 2^31 ms). Nothing ever sends `playback:sentenceDone` / `playback:turnDone`, so `BrainService` never schedules the window hide (`brain-service.ts:171-178`) and `TurnRunner` stays in `speaking` (`turnShown` never arrives). Result: an empty always-on-top band with her name plate sits on the desktop indefinitely, the composer reads 她在说…, Escape cancels instead of closing, and the next message is treated as an interruption. Recovery only by hovering + clicking the band (`speech.complete()`) or sending another message. Values ≥ 2^31 ms fire immediately, so only the mid range hangs — which is exactly what an attacker would pick.

Suggested fix: clamp at the parser (`Math.min(seconds, PAUSE_MAX_S)` with e.g. `PAUSE_MAX_S = 3`) and mirror it in the schema (`pause: z.number().nonnegative().max(PAUSE_MAX_S).optional()`) so the bubble can never be handed a larger value; add a `tags.test.ts` case. Confidence: confirmed-by-running (parse/emit) + confirmed-by-reading (bubble/main consequences).

### F2 · minor · motion allow-list is a plain property read — prototype keys pass it (harmless today)

- `apps/desktop/src/renderer/pet/main.ts:175-176`
  ```ts
  const motion = ev.motion ? stage.config.motionMap[ev.motion] : undefined;
  if (motion) stage.playMotion(motion);
  ```
- `packages/brain/src/tags.ts:10` accepts `motion=[\w-]+`, so `constructor`, `__proto__`, `toString`, `hasOwnProperty`, … are valid motion names; `SentenceEventSchema.motion` is `z.string()`, and `brain-service.ts:340` forwards it unchecked.

Probe (ran it, zod 4.5.2 `z.record`): `motionMap['constructor']` → `function` (truthy) → `playMotion([undefined, undefined])`; same for `__proto__`, `toString`, `hasOwnProperty`.

Why it is not worse: `packages/stage/src/companion-model.ts:311-312` does `this.motions.get(`${group}_${index}`)` → `'undefined_undefined'` → `return false`. No throw, no motion. So the allow-list is currently saved by an accident downstream.

Suggested fix: `Object.hasOwn(stage.config.motionMap, ev.motion)` in the pet renderer, and/or validate `ev.motion` against `persona.motionKeys` in `TurnRunner.consider` / `StreamParser` (drop the attribute when unknown) so main never forwards an unlisted key. Confidence: confirmed-by-running.

### F3 · minor · no Content-Security-Policy on any of the four renderers (three are new in Phase 2)

- `apps/desktop/src/renderer/bubble.html`, `chat.html`, `key.html` (new) and `pet.html` (Phase 1) carry no `<meta http-equiv="Content-Security-Policy">`; `apps/desktop/out/renderer/*.html` (built) confirms electron-vite injects none; `grep -rn "onHeadersReceived|Content-Security-Policy" apps/desktop/src packages` → no matches. So there is no CSP from either the document or `session.webRequest`.

Why it matters: the key window hosts the `key:set` / `key:test` preload surface. Every sink I could find is `textContent` / React text (see clean list), `sandbox: true` + `contextIsolation: true` are set on all four windows, navigation and `window.open` are denied, and `app://local` is served only from `out/renderer` — so I found no injection primitive, and this is a defence-in-depth gap, not a demonstrated hole. It is listed because the review brief asks for "CSP on every renderer" and there is none.

Suggested fix: one `session.defaultSession.webRequest.onHeadersReceived` in `serveRenderer` (or a `<meta>` in each html) with `default-src 'self' app://local; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'`, relaxed for `ELECTRON_RENDERER_URL` in dev. Confidence: confirmed-by-reading.

### F4 · minor · the key-leak pre-commit hook is unversioned and already contradicted by tracked content

- `.git/hooks/pre-commit` (local; its comment says "not committed") greps staged `+` lines for `sk-[A-Za-z0-9]{24,}`. Nothing versions it: no husky / lefthook / simple-git-hooks, no `core.hooksPath` in the repo. A fresh clone has no protection.
- `apps/desktop/src/renderer/tokens-sheet.html:180` contains `<div class="field">sk-<35-char hex placeholder></div>` — a sequential `sk-0123…` mock, not a real key (checked: hex-only, 19 distinct characters). It matches the hook's own regex, so that commit went in with the hook absent or bypassed, and any future edit touching that line will be rejected by the hook (which invites `--no-verify`).
- The hook cannot see binary evidence: `docs/evidence/phase2/app-key-*.png` are screenshots of the key window; today the input is empty (the e2e never fills it — confirmed, no `fill(` on `#api-key` in `phase2.spec.ts`), but a future evidence shot with 显示 toggled would ship a key as pixels through this pattern.

Suggested fix: version the hook (`core.hooksPath=.githooks` set by a `prepare` script, or simple-git-hooks), change the sheet placeholder to something the regex does not match (`sk-••••••••`), and add a note in the evidence README that key-window captures are taken with an empty field. Confidence: confirmed-by-reading.

## Checked and found clean (evidence for absence)

Key ingestion and storage
- `key.html` → `preload/key.ts` (only `KEY_INVOKE` = set/test/clear, `KEY_TO_MAIN` = chat:open, `MAIN_TO_KEY` = key:status) → `invoke.ts handleInvoke` (sender must be the key window's main frame on an allowed origin, request/response zod-validated) → `key-store.ts set()`: throws when `safeStorage.isEncryptionAvailable()` is false, never writes plaintext, writes `%APPDATA%\ds\key.bin` with `encryptString`. `get()` decrypts on demand; a decrypt failure logs the Error object only (`key-store.ts:60`), not bytes.
- Dev key `DS_DEV_DEEPSEEK_KEY` is memory-only, non-packaged only, never reported by `hasStored()`; `DEEPSEEK_API_KEY` is never read by the app (grep over apps/desktop: only `DS_DEV_DEEPSEEK_KEY`).
- No place logs/echoes the key: `deepseek.ts` only puts it in the `Authorization` header (`headers()` :222-228) and never stringifies headers; every error path builds messages from status/body/`err.message` (`httpError`, `describeError`), not from the request. `brain-service.ts` logs code+message of errors, sentence text, turn ids — never the key. `fatal.ts` shows `String(err)` for db/card open failures only. No `crashReporter`, `autoUpdater`, telemetry, or `uncaughtException` handler exists (grep).
- `key:status` carries `{present, source, lastTest}` only. `key:set` / `key:test` failure messages shown in the key window are `ERROR_HINTS` strings (`key/App.tsx:44-47`), never the transport body.
- `.gitignore` (unchanged by Phase 2) already covers `.env`, `.env.*` (keeps `.env.example`), `*.key / *.pem / *.pfx / *.p12`, `eval/out/*` (own `.gitignore`), `apps/desktop/test-results/`, `playwright-report/`. `git grep` for `sk-[A-Za-z0-9]{20,}` over `main` hits only the tokens-sheet placeholder (F4). No `.env*`, `key.bin`, `deepseek.key`, user-data dirs or eval outputs are tracked (`git ls-files` check).
- Committed evidence: `eval-report.json` `config` holds model/paths/flags only (read the header); `e2e-report.json` mentions the key only in the skip reason; `task6-console.txt` is an offline `DS_FAKE_BRAIN` run.
- e2e lane (`tests-e2e/app.ts`): user-data-dir is `mkdtempSync(join(tmpdir(), 'ds-e2e-'))`, `APPDATA` pointed at it, `DS_DEV_DEEPSEEK_KEY` / `DEEPSEEK_API_KEY` / `DS_FAKE_BRAIN` deleted from the child env unless a test opts in; the real-key test passes the env key through `devKey` (memory only) and writes only usage numbers to `app-20-turns.{json,md}`. The bad-key test uses a literal `sk-e2e-invalid-…`.
- Eval (`eval/run.mjs`, `session.mjs`, `lib/judge.mjs`, `lib/ablation.mjs`): key read from `process.env.DEEPSEEK_API_KEY` only, used solely in `Authorization`; on failure only `HTTP <status>` / `err.message` is printed; reports go to `eval/out` (ignored). `not-measured.md` / `README.md` instruct reading the key file into the env var, never into a tracked file.

Model reply → sinks
- Tags: `TagScanner` only ever produces `{emotion (enum-checked by isEmotion), motion (\w-), pause (number)}`; bad tags become plain text. `sanitizeForDisplay` runs once in `TurnRunner.consider`; the bubble writes `textContent` (`bubble.ts:384`), the hint writes `textContent` (`hint.ts:481`), the chat history renders `{r.content}` as React text (`History.tsx:153`). grep for `innerHTML | dangerouslySetInnerHTML | insertAdjacentHTML | document.write | href= | javascript: | eval(` over `src/renderer` → only comments. Emotion reaches the DOM as `dataset.emotion` validated by `EmotionSchema`.
- The `?test=1` speech/hint hooks in `bubble/main.ts` and `pet/main.ts` are behind `import.meta.env.DEV` (tree-shaken in the packaged build).
- Indirect prompt injection: `facts()` returns `[]` in Phase 2; the running summary is model text but re-enters only inside the *user* message (`prompt.ts:76-88`), and `STOP_SEQUENCES` (`\n用户：` etc.) stop the model from forging a continuation. The only levers a poisoned summary has are emotion/motion/pause — i.e. F1/F2. No tool, exec, URL or file surface exists in the brain path.

Windows, IPC, protocol handler
- All four `BrowserWindow`s: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; each has `setWindowOpenHandler(deny)` + `will-navigate` / `will-redirect` denied unless `isAllowedPetUrl`. Each preload exposes only its own per-window allow-lists (`PET_ / BUBBLE_ / CHAT_ / KEY_ TO_MAIN`, `*_INVOKE`; pet/bubble have no invoke surface). `onFromAny` / `handleInvoke` authenticate the sender (`webContents` identity + main frame + allowed origin) before parsing.
- `app://local` (`app-protocol.ts`): scheme registered standard/secure; handler rejects non-GET/HEAD (405), any authority other than `local` or any credentials/port (403), malformed percent-encoding (400), and any resolved path not under `out/renderer` (`normalize(join(root, rel))` + `startsWith(root + sep)`, 403). Requests are re-issued via `net.fetch(file://…)` with no header passthrough, so no Range/MIME confusion; MIME comes from the file extension. Served tree is the built renderer only.
- No remote content: no `http(s)://` in renderer/package sources except comments, CSS uses only local `@import '../shared/tokens.css'`, no `@font-face` URLs, no CDN, no analytics.
- No `setPermissionRequestHandler` is installed (Electron grants renderer permission requests by default); only app-origin documents can run, so this is an observation, not a finding.

Memory
- `packages/memory`: every statement is parameterised; `history:list` is capped at 200 rows; `history:delete` is by `turn_id` from the chat window only. `ds.sqlite` lives in `%APPDATA%\ds` unencrypted — the spec (§6/§8) does not ask for at-rest encryption and it is the same trust boundary as DPAPI (same-user processes), so recorded as an observation, not a finding. `safeStorage` on Windows is DPAPI per-user: any process running as the user can decrypt `key.bin`; that is the platform ceiling the spec chose, not a defect in this branch.

Already-parked items I did not re-report: everything in `docs/evidence/phase2/deferred.md` and rulings "Defers". None of the four findings above is among them.
