# Final review — main process + preload (Phase 2, `phase1-stage..main`)

Lens: `apps/desktop/src/main/**`, `apps/desktop/src/preload/**`. Read-only. Baseline check run:
`npx vitest run src/main` in `apps/desktop` → 13 files / 164 tests pass. Placement probed with
`node --experimental-strip-types` against `bubble-place.ts` (six extreme geometries, below).

## Findings

### F1 (important) — quit mid-reply loses the interrupted assistant row and the metrics row: `db.close()` runs before `TurnRunner.retire()` reaches its second write
- `apps/desktop/src/main/index.ts:334-353`
  ```ts
  app.on('before-quit', () => {
    …
    brain?.dispose();          // → this.runner?.cancel()
    …
    db?.close();
    db = null;
  });
  ```
- `packages/brain/src/turn.ts:184-190` `cancel()` → `this.detach(this.retire(turn, true, true))`; `turn.ts:420-434`:
  ```ts
  if (commitUser) await this.commitUser(turn);     // user row: written synchronously inside append(), THEN the await yields
  const shown = …;
  if (shown.length > 0) {
    await this.deps.history.append('assistant', …, { interrupted: true });   // runs in a microtask
  }
  await this.record(turn, totalMs, null);                                     // runs in a microtask
  ```
- `packages/memory/src/history.ts:109-124` — `append()` does the INSERT synchronously and returns `Promise.resolve()`, so the first write survives, but everything after the first `await` in `retire()` executes only after the `before-quit` handler's synchronous body has finished — by which time `db.close()` has already run. The INSERT for the `[中断]` assistant row and the `metrics` row throw `ERR_INVALID_STATE` ("database is not open") and are swallowed by `detach()` (`turn.ts:211-215`, `console.error('[turn] background failure')`).
- Why it is wrong: R2 / contracts §3.11.4 make the sentence-granular interrupted row the "truthful history" of what she said. The user saw those sentences.
- Failure scenario: user sends a message, she is two sentences in, user picks 退出 from the tray. Next launch: the history pane shows the user's line with no reply at all (not even a `[中断]` chip), and `metrics` has no row for the turn.
- Fix: do not close the database in `before-quit`. Move `db.close()` to `app.on('will-quit')`, which fires after the windows are gone and after pending microtasks have drained; or make `dispose()` return the retire promise, `preventDefault()` the first `before-quit`, await it, then `app.quit()` again. The two writes are synchronous once they run, so no extra flush is needed.
- Confidence: confirmed-by-reading (microtask ordering is unambiguous; not executed).

### F2 (important) — the chat can be opened while `VisibilityState` says hidden, and the reply is then invisible
- `apps/desktop/src/main/chat-window.ts:252-264` `openChat()` has no visibility check:
  ```ts
  export function openChat(win, pet, focusComposer) {
    if (win.isDestroyed()) return;
    place(win, pet);
    win.show();
    win.focus();
  ```
- Reachable while hidden from `index.ts:286` (tray 打开对话), `index.ts:291` (`Control+Shift+Space` global hotkey), `index.ts:271-275` (`chat:open` from the key window, which the verdict does not close).
- `index.ts:97-101` `applyBubbleVisibility()` correctly refuses to show the bubble while `visibility.verdict.hidden`; `MAIN_TO_CHAT` (`packages/protocol/src/index.ts:324-327`) deliberately does not carry `brain:sentence`. So a turn started from a chat opened in this state streams into a hidden pet and a hidden bubble; the chat window receives only `brain:state` / `brain:turnDone`.
- Failure scenario: user hides her with the tray toggle (`user` flag) to focus, later presses Ctrl+Shift+Space, types a question, Enter. The composer shows thinking → speaking → idle and the turn is committed to history, but not one character of the reply is ever shown. When she is un-hidden later, `bubbleWanted` may still be true and the bubble reappears with a band whose reveal finished long ago (the bubble renderer keeps running under `backgroundThrottling:false`). Same with the `fullscreen` flag: the hotkey works over a fullscreen game (the pet is hidden; the chat window is alwaysOnTop and appears).
- Fix: in `index.ts`, route the three open paths through one `requestChat(focus)` that (a) for `reason === 'user'` clears the flag and calls `apply()` first — what `second-instance` already does at `index.ts:106-109` — and (b) for `locked`/`suspended`/`fullscreen` refuses (log + no-op). Forwarding `brain:sentence` to the chat instead would contradict §2.5 and the design.
- Confidence: confirmed-by-reading.

### F3 (minor, plausible) — `bubblePinned` is not reset when the bubble window is hidden from main
- `apps/desktop/src/main/brain-service.ts:196-206` sets `this.bubblePinned = inside` only from the renderer's `bubble:hover`; `scheduleBubbleHide()` (`:423-435`) arms nothing while pinned and `hideOwed` stays true.
- `index.ts:97-101` `applyBubbleVisibility()` → `hideBubble()` (verdict hidden) does not tell the service. If Chromium does not deliver `pointerleave` to a window hidden under the cursor, the renderer never sends `{inside:false}`; on the next show the window is non-click-through (`setBubbleClickThrough(bubble, false)` still in force) and never auto-hides until the pointer crosses it again.
- Windows normally delivers `WM_MOUSELEAVE` when a tracked window is hidden, so this probably self-heals — hence plausible. The belt-and-braces fix is cheap: have the verdict-hide path call a `service.bubbleHidden()` that resets `bubblePinned = false` and `setBubbleClickThrough(bubble, true)` (the pet window already does exactly this on hide via `setClickThrough` in `visibility.apply()`).
- Confidence: plausible.

### F4 (minor) — `ELECTRON_RENDERER_URL` and `DS_DEBUG` are honoured in a packaged build
- `apps/desktop/src/main/app-protocol.ts:155-159` `rendererUrl()` and `:188-199` `allowedPetOrigins()` read `process.env.ELECTRON_RENDERER_URL` with no `app.isPackaged` gate; `pet-window.ts:74-75` likewise (`DS_DEBUG`, `ELECTRON_RENDERER_URL`).
- Effect: a packaged app launched with `ELECTRON_RENDERER_URL=http://host` loads that page into all four windows and whitelists that origin for every IPC allow-list, including `key:set`/`key:test`/`history:*`. Contrast `useFakeBrain()` and `KeyStore`'s `DS_DEV_DEEPSEEK_KEY`, both gated on `!isPackaged` (`fake-client.ts:188`, `key-store.ts:46`).
- Threat is low (whoever controls the process environment already runs code as the user), and the `?test=1` renderer hooks are genuinely dead in production (`import.meta.env.DEV` is a compile-time constant — `renderer/pet/main.ts:12`, `renderer/bubble/main.ts:16`). But these two env reads are the one dev surface that is not gated. `?debug=1` is not a secret: the same panel is on the tray (`debug:toggle`).
- Fix: `const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL` in one place (`app-protocol.ts`), consumed by `rendererUrl`, `allowedPetOrigins`, `isAllowedPetUrl` and `pet-window.ts`.
- Confidence: confirmed-by-reading.

### F5 (minor) — the bubble window is shown before it is placed
- `brain-service.ts:325-329` on `state:'thinking'` → `this.deps.setBubbleVisible(true)` → `showBubble()` (`bubble-window.ts:140-142`) at whatever bounds the window last had. `reposition()` (`brain-service.ts:237-247`) returns early when `!bubble.isVisible()`, so a pet drag or a chat open that happened while the bubble was hidden never moved it. The correct rect only arrives after the renderer's `bubble:size` round-trip (`:180-189`).
- Scenario: reply ends, bubble hides; user drags her across the screen; user asks the next question → the thinking band flashes at the old position (or under the composer that just opened, since `avoid` was never applied) for one round-trip, then jumps.
- Fix: call `repositionBubble(bubble, pet, this.composerRect())` (without the `isVisible()` guard for this call) before `setBubbleVisible(true)` in the `thinking` arm, in `reportError` and in `maybeFirstMessage`.
- Confidence: confirmed-by-reading (logic); the visibility of the flash is timing-dependent, likely one frame.

## Checked and found clean

- IPC privilege. Every renderer→main channel is registered with `onFromPet`/`onFromAny` and every invoke with `handleInvoke`; all go through `isFromWindow` (`ipc.ts:48-65`): `event.sender === win.webContents` AND `senderFrame === mainFrame` AND `isAllowedPetUrl(frame.url)`. `key:set/test/clear` are `[key]`-only (`brain-service.ts:106-132`), `user:text`/`history:*` are `[chat]`-only, `playback:*`/`bubble:*`/`speech:mouth` are `[bubble]`-only. The preload allow-lists (`preload/*.ts`) match `packages/protocol/src/index.ts:300-339`; `PET_INVOKE`/`BUBBLE_INVOKE` are empty. A renderer cannot invoke another window's channel: the main-side window list, not the preload, is the gate. One hardening nit, not a finding: `chat:open`'s `source` field is trusted as sent (`index.ts:273` hides the key window on `source === 'key'`) although `from` is available — all senders are first-party pages.
- Key window spoofing. Not possible via IPC: `isFromWindow` requires the key window's own webContents and main frame. Navigation, redirect and `window.open` are denied on the key window (`key-window.ts:161-171`).
- safeStorage. `KeyStore.set` throws `SAFE_STORAGE_UNAVAILABLE` when encryption is unavailable (`key-store.ts:73`) — no plaintext fallback anywhere. File is `%APPDATA%\ds\key.bin` (`app.setName('ds')`, `index.ts:30`), written with `mode: 0o600` (a no-op on NTFS; `%APPDATA%` is user-ACL'd). Decrypt failure is caught and falls through to "no key" (`:57-62`). `DS_DEV_DEEPSEEK_KEY` is never persisted and is gated on `!isPackaged`. Nothing logs a key; `DeepSeekError` messages carry status/body, not the header (`deepseek.ts:224` is the only `apiKey` use).
- Navigation / window-open guards. All four windows: `setWindowOpenHandler(deny)`, `will-navigate`, `will-redirect` → `isAllowedPetUrl` (`pet-window.ts:107-126`, `bubble-window.ts:65-84`, `chat-window.ts:218-228`, `key-window.ts:161-171`). `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false` on all four.
- Click-through reset paths. Pet: forced click-through on every verdict hide (`visibility-state.ts:121`), on main-frame navigation and on `render-process-gone` (`pet-window.ts:119-125`); `avatar:hover` re-enables. Bubble: same on navigation/crash (`bubble-window.ts:77-83`); the only gap is F3.
- Single visibility owner. Every `show()/hide()/showInactive()` caller in `src/main` was grepped: pet only via `visibility.apply()`; bubble only via `showBubble/hideBubble` from `applyBubbleVisibility()`; chat via `openChat/closeChat/chat:close`; key via `openKeyWindow` and `holdWindowOpen`. No second owner of the pet or the bubble.
- bubbleWanted replay (aa0e9df). `applyBubbleVisibility()` is the only show path and is `(bubbleWanted && !verdict.hidden)`; it re-runs on `setBubbleVisible`, on every verdict send, and once after window creation. It cannot show while hidden; it does not stay hidden after a chat opens (the chat `show` only calls `reposition`). The hide timer clears `bubbleWanted` even while the shell is hidden, so a stale band does not come back after unlock in the common case (F2 describes the exception).
- Placement (`bubble-place.ts` after edad411). Probe results: tiny 300×200 work area → top-left aligned, overflows (band larger than the area; unavoidable); negative-origin secondary (`x=-1920`) → inside, `right` side chosen correctly; pet hanging off the left → flips right, inside; pet hanging off right+bottom → band clamped to the work area above the visible head (the documented "C14 outranks the 55 % floor" case in `deferred.md`); 4K@250 % (1536×864 DIP) with the history-open composer → inside, top at 0.55, no overlap. `yMax = max(waT, waB-h)` and `clamp(x, waL, max(waL, waR-w))` keep every clamp non-reversed. `screen.getDisplayMatching(petBounds)` is used for both surfaces.
- Shutdown ordering. Listener removal → `markQuitting()` → save position → `brain.dispose()` → windows destroyed → `db.close()`. Order is right except for F1. `dispose()` unregisters exactly the invoke handlers, the `OWNED_SEND_CHANNELS`, and the chat show/hide listeners.
- Dev/test hooks. `?test=1` surfaces are `import.meta.env.DEV`-gated (compile-time). `DS_FAKE_BRAIN` gated on `!isPackaged`. Only F4 remains.
- Working set (750 MB). Four BrowserWindows, all created eagerly at startup (`index.ts:140-171`): pet (Live2D/WebGL, `backgroundThrottling:false`), bubble (`backgroundThrottling:false`, alive while hidden by design so reveal timers run), chat (React), key (React). Each is its own renderer process (measured: 4 renderers + main + GPU + utility). Avoidable: the key window — it is opened on first run, from the tray and on auth errors only; C8's ≤250 ms bar is about the chat, so creating it lazily in `openKeyWindow()` removes one renderer for the whole session at no user-visible cost. Debatable: the chat could also be lazy (first open pays one load), and the bubble could be rendered inside the pet window (the Phase 3/4 architecture question already noted in `deferred.md`). Not avoidable in this design: pet, GPU process. `backgroundThrottling:false` on two windows costs CPU (within bar), not memory.
