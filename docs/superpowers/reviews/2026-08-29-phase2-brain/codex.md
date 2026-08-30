# Codex whole-branch review (gpt-5.6-sol via codex exec, read-only, 2026-08-30)

NOTE: the Codex output was truncated by the transport after major #5; majors 6-8, moderates 1-9 and the minor were lost and are being re-requested (codex-2.md). Findings below are verbatim.

# Phase 2 whole-branch review

**VERDICT: block | major: 8 | moderate: 9 | minor: 1**

The requested `codex.md` was not created: the repository is explicitly read-only, and the sandbox rejects filesystem writes. No files were changed. The complete intended report follows.

## Major findings

### 1. A completed stream is treated as settled before playback is acknowledged

**Location:** [turn.ts:144](D:/ds/packages/brain/src/turn.ts:144), [turn.ts:395](D:/ds/packages/brain/src/turn.ts:395)

**Exact code:**

```ts
if (previous !== null && !previous.settled) {
```

```ts
turn.settled = true;
await this.commitUser(turn);
...
await this.deps.history.append('assistant', text, ...);
```

**Failure:** DeepSeek finishes streaming while the bubble is still revealing sentence two. `settleNormal()` marks the turn settled and stores every emitted sentence. If the user sends another message before `playback:turnDone`, `send()` does not retire the previous turn because it is already settled. The new `thinking` state clears the old bubble queue, but history contains the unseen remainder as an ordinary, uninterrupted assistant response.

This violates sentence-granular truthful history in R2. The current happy-path test only checks history after `turnShown()` and has no send-after-stream/before-playback case.

**Fix:** Separate `streamFinished` from `playbackFinished`. A superseding send must retire any unacknowledged turn, even after network completion, and persist only acknowledged sentence sequence numbers with `interrupted:true`. Persist the full normal assistant row only after `playback:turnDone`.

**Confidence:** High.

---

### 2. Hidden playback continues and acknowledges text the user cannot see

**Location:** [main.ts:101](D:/ds/apps/desktop/src/renderer/bubble/main.ts:101), [bubble-window.ts:37](D:/ds/apps/desktop/src/main/bubble-window.ts:37), [speech.ts:227](D:/ds/apps/desktop/src/renderer/bubble/speech.ts:227), [brain-service.ts:473](D:/ds/apps/desktop/src/main/brain-service.ts:473)

**Exact code:**

```ts
bridge?.on(Channels.shellVisibility, ({ hidden }) => {
  if (!hidden) return;
  hint.dismiss();
  bubble.hide();
});
```

```ts
backgroundThrottling: false,
```

```ts
this.bridge?.send(Channels.playbackSentenceDone, { turnId: ev.turnId, seq: ev.seq });
```

**Failure:** Lock/fullscreen/user-hide occurs during reveal. The native window and DOM band hide, but `SpeechController` timers continue because background throttling is disabled. It sends sentence and turn acknowledgements while invisible, so the entire reply is recorded as shown. A short hide also leaves the DOM band hidden after visibility returns because the `hidden:false` branch does nothing. A long hide can complete the reply and dismiss the native bubble before unlock.

The first-run message has the same problem: it is persisted and `KV_FIRST_RUN_DONE` is set immediately under the assertion “The user saw it,” even if visibility prevented display.

**Fix:** Give `SpeechController` an explicit visibility state. On hide, pause reveal without acknowledging new text, or retire the turn as interrupted. On show, restore the band and resume with adjusted deadlines. Set the first-run completion KV only after visible playback acknowledgement.

**Confidence:** High.

---

### 3. Chat and key windows bypass the shell visibility verdict

**Location:** [index.ts:271](D:/ds/apps/desktop/src/main/index.ts:271), [index.ts:286](D:/ds/apps/desktop/src/main/index.ts:286), [index.ts:291](D:/ds/apps/desktop/src/main/index.ts:291), [brain-service.ts:375](D:/ds/apps/desktop/src/main/brain-service.ts:375), [chat-window.ts:106](D:/ds/apps/desktop/src/main/chat-window.ts:106)

**Exact code:**

```ts
openChat(chatWin, petWin, focusComposer);
```

```ts
openChat: () => openChat(chatWin, petWin, true),
```

```ts
win.show();
win.focus();
```

**Failure:** While `fullscreen`, `locked`, `suspended`, or `user` visibility is active, the global shortcut, tray action, `chat:open`, or automatic key-error path can directly show and focus an always-on-top window. For example, an authentication failure during a fullscreen app opens the key window over it even though the visibility controller says all pet surfaces are hidden.

**Fix:** Route every focusable-window show through a visibility-aware controller. Lock/suspend/fullscreen must block opening. Decide explicitly whether a user tray action may clear only the `user` flag; it must not override system flags.

**Confidence:** High.

---

### 4. Asynchronous summarization can advance the trim pointer over the wrong rows

**Location:** [history.ts:132](D:/ds/packages/memory/src/history.ts:132), [history.ts:137](D:/ds/packages/memory/src/history.ts:137), [history.ts:151](D:/ds/packages/memory/src/history.ts:151)

**Exact code:**

```ts
next = await this.summarize(this.summaryStore.getSync(), plan.drop);
```

```ts
.get(this.lastTrimId(), plan.drop.length - 1)
```

**Failure:** Two turns can start overlapping trims because a superseded turn’s summarization is not aborted. If trim B finishes before trim A, B advances `last_trim_id`; A then resolves its old plan relative to the new pointer and skips another `plan.drop.length` rows. A also overwrites B’s newer summary with a summary generated from stale input. Deleting rows during the network wait creates the same offset mismatch.

The transaction protects summary/pointer agreement within one completion, but does not protect the plan’s identity across the preceding await.

**Fix:** Serialize trims and capture the base trim ID plus the exact row IDs before the network call. After summarization, update only if the base pointer and prefix row IDs still match; otherwise discard and replan. Never derive a stale plan’s endpoint using a fresh pointer plus an offset.

**Confidence:** High.

---

### 5. Non-streaming DeepSeek response bodies have no idle timeout

**Location:** [deepseek.ts:264](D:/ds/packages/brain/src/deepseek.ts:264), [deepseek.ts:285](D:/ds/packages/brain/src/deep
...[truncated 16708 chars]

Stderr tail:
2026-08-30T05:11:30.743753Z ERROR codex_models_manager::cache: failed to load models cache: missing field `base_instructions` at line 98 column 5
2026-08-30T05:12:01.043108Z ERROR codex_core::tools::router: error=`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Item -LiteralPath 'docs/superpowers/plans/2026-08-29-phase2-contracts.md','.superpowers/sdd/2026-08-29-phase2-brain/rulings.md' | Select-Object FullName,Length"` rejected: blocked by policy
2026-08-30T05:12:12.942581Z ERROR codex_core::tools::router: error=`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Item -LiteralPath 'docs/superpowers/plans/2026-08-29-phase2-contracts.md' | Select-Object FullName,Length"` rejected: blocked by policy
2026-08-30T05:12:23.837826Z ERROR codex_core::tools::router: error=Exit code: 1
Wall time: 0.2 seconds
Output:
1:# Phase 2 interface contract (`contracts.md`)
2:
3:Single source of truth for every interface Phase 2 tasks share. **Authors copy from this file. Nothing here is a suggestion; nothing missing from here may be invented — if a name or a value is genuinely absent, stop and ask the controller.**
4:
5:Precedence this file implements: `rulings.md` (binding) → `docs/superpowers/specs/2026-08-29-exquisite-bar.md` (addendum) → `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` (spec). The v1 plan `docs/superpowers/plans/2026-08-29-phase2-brain.md` is a draft; where its literal code survives it is reproduced here **with the rulings applied**, and this file wins.
6:
7:Environment verified in this session (do not re-derive):
8:
9:| Fact | Value | How verified |
10:|---|---|---|
11:| Node | v24.17.0 | `node -v` |
12:| TypeScript | 5.9.3 (≥ 5.8 → `erasableSyntaxOnly` available; **no fallback needed**) | `npx tsc --version` |
13:| vitest | 3.2.7 | lockfile |
14:| zod | 4.5.2 (range `^4.0.0`) | lockfile |
15:| electron | 43.4.1 · electron-vite 5.0.0 · vite 7.3.6 · @playwright/test 1.62.1 | lockfile |
16:| `@types/node` | 24.13.3 at workspace root (resolves for new packages with `"types": ["node"]`) | lockfile + preflight |
17:| `node:sqlite` | builtin, `DatabaseSync` present, `isBuiltin` true → rollup externalizes it automatically | preflight |
18:| Node type-stripping of `.ts` under `node_modules` | **refused** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — but a pnpm workspace *symlink* resolves to the real path first, so it works | ran it |
19:| Node type-stripping + **extensionless** relative import | **fails** (`ERR_MODULE_NOT_FOUND`) | ran it |
20:| Node type-stripping + `'./types.js'` specifier | **fails** | ran it |
21:| Node type-stripping + `'./types.ts'` specifier | **works** | ran it |
22:| `tsc` with `erasableSyntaxOnly` + `allowImportingTsExtensions` + `verbatimModuleSyntax` | clean | ran it |
23:| `environmentMatchGlobs` in vitest 3.2.7 | present in the type surface (deprecated, still honoured) | read `vitest` d.ts |
24:| **Repo-wide test baseline 
...[truncated 61304 chars]


---

# Codex review 2 (re-run j8-kjd6, terse mode, findings not already known) — IDs CX-5..CX-13

- **CX-5 [major]** `packages/memory/src/history.ts:84-88,146-152` — safety truncation corrupts trim correspondence. `return Promise.resolve(msgs.slice(start));` At 36k tokens `window()` omits ids 1–7; `plan.drop` represents ids 8–22, but `onTrimNeeded` advances by its LENGTH from id 0 to id 15: ids 1–7 vanish unsummarised and 16–22 are duplicated. Fix: preserve stable row ids through planning and commit the exact cutoff (or remove pre-planning truncation). *(Same root as I-10/G2-3: carry ids in TrimPlan.)*
- **CX-6 [major]** `bubble-window.ts:80-83; brain-service.ts:171-178` — bubble crash strands active playback: `render-process-gone` only resets click-through; no reload or terminalisation, so the bubble is absent and runner/pet stay in `speaking`. Fix: on renderer loss force-interrupt the active turn, restore idle, reset bubble state, then reload/recreate and resynchronise.
- **CX-7 [moderate]** `key-window.ts:50` — `void win.loadURL(rendererUrl('key'))` unobserved; a missing/rejected key.html leaves the only key-entry window blank, tray reopen cannot recover. Fix: observe loadURL, visible fatal/recovery path, reload/recreate after render-process-gone. *(G2-6 for the key window.)*
- **CX-8 [moderate]** `packages/brain/src/deepseek.ts:100` — malformed SSE frame logs 120 chars of upstream payload (may contain generated text derived from private conversation). Fix: log only length/type, never payload bytes.
- **CX-9 [moderate]** `apps/desktop/src/renderer/chat/History.tsx:69-73` — `if (!open || startedRef.current) return;` history never refreshes after the first opening; later turns are stale until reload. Fix: fetch/reconcile the newest page on every closed→open transition or after each completed turn.
- **CX-10 [moderate]** `apps/desktop/src/renderer/pet/main.ts:179-182` — listening pose latched: `{on:false}` only stops the mouth, never restores neutral/thinking/current sentence emotion; pet can stay `curious` indefinitely. Fix: track the underlying pose and recompute on both listening edges.
- **CX-11 [moderate]** `eval/lib/judge.mjs:73-87; eval/lib/ablation.mjs:64-79` — judge/ablation fetch has no timeout; a stalled connection or body blocks the whole eval. Fix: bounded abort signal + size/idle-limited reader.
- **CX-12 [minor]** `eval/lib/fixture.mjs:25; eval/lib/aggregate.mjs:73-74` — unknown/misspelled axes pass validation and are sent to the judge but aggregation only iterates `AXIS_SPECS`, so the requirement contributes nothing. Fix: reject unknown/duplicate axes; validate category→axis coverage.
- **CX-13 [minor]** `eval/run.mjs:89,102; eval/lib/recorded.mjs:18-31` — one mutable PRNG shared across concurrent dry runs; same seed → different chunk boundaries under different scheduling. Fix: PRNG per run seeded from (global seed, run index).
