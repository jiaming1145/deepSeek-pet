# GPT closure check after the fix wave (job j4-svmm, gpt-5.6, effort high, 2026-08-29)

Files: apps/desktop/src/main/{index,pet-window,ipc,foreground,window-state,visibility-state}.ts, packages/stage/src/{companion-model,motion-callbacks}.ts. VERDICT: block | major:3 minor:2.

Closed (cited): ready-to-show owner; IPC identity + will-navigate/will-redirect/window.open; click-through reset on navigation + render-process-gone; stageReady resend + cursor recheck; loadURL observed (ERR_ABORTED skip judged acceptable); fullscreen/maximized via containment + IsZoomed veto + DIP conversion; first poll immediate; clampToDisplays always clamps; Number.isFinite load; finished callbacks by handle; generation token; idempotent release; motions/expressions freed; _initialized-before-super.release ordering sound.
Not verifiable (files not attached): app-protocol authority, protocol bounds, tray fallback, cursor dedupe, textures cleanup, ticker, ViewportFit restore, begin/end pairing — all covered by the Claude scoped re-reviews.

## Fix round 2 items

1. **Major — click-through not resynchronised across hide/show.** If `avatar:hover inside=true` made the window interactive and the pet is then hidden (fullscreen/lock/user), the renderer's leave event may never reach main; `showInactive` restores the window with `ignoreMouseEvents=false` → transparent pixels intercept clicks. Conversely, after forcing click-through on hide, the renderer's `HoverTracker` still caches `inside=true` and never re-emits → pet stays click-through while the cursor sits on her. → On hide: force native click-through. On show: resample the cursor (`cursorPolling.recheck()`) AND make the renderer reset its hover cache on `shell:visibility {hidden:false}` so the next sample re-emits the true hit. Tests: hide while inside=true → `setIgnoreMouseEvents(true,{forward:true})`; show with a stationary cursor over the avatar → renderer emits `inside:true` again.

2. **Major — no display-topology reconciliation while running.** `clampDrag` runs only on `avatar:drag`; `clampToDisplays` only at startup. Unplugging the monitor under her (incl. between the last drag and `dragEnd`) leaves her on a removed display; `dragEnd` persists that; tray show cannot bring her back. → `screen.on('display-removed')` and `screen.on('display-metrics-changed')` → re-read position + work areas, apply `clampDrag` (MIN_GRABBABLE), `setPosition` if changed, persist; remove listeners on shutdown. Test: fake screen emits display-removed with the pet fully on the removed area → moved into a remaining area and saved.

3. **Major — `hitTest`/`hitAny`/`setExpression` unguarded after `release()`.** `_initialized` is cleared but these public methods still reach `CubismUserModel.isHit` / the null expression manager → crash on a late pointer or expression reset. → Guard every public method that touches Framework state: hit tests return false/null; mutators no-op. Test: release() then hitTest/hitAny/setExpression(null) → no throw.

4. **Minor — `isFromPet` try/catch too broad.** It also swallows `isAllowedPetUrl` errors, turning a configuration bug into "untrusted sender". → Catch only the frame getters (`mainFrame`, `senderFrame.url`), snapshot them, run `isAllowedPetUrl` outside the catch (it must itself return false on malformed URLs).

5. **Minor — released `CompanionModel` retains `this.gl`** (context + canvas graph). → After deleting textures set `gl = null` (type `| null`); clear the settings reference if the Framework supports it.

## GPT's suggested tests
- Hide while hovered, move cursor while hidden, show → native ignoreMouseEvents reconciled without an extra mouse move.
- Hide/show with the cursor stationary over the avatar → interactive again (HoverTracker cache reset).
- Remove the display under the pet after the last drag, before dragEnd → ≥ MIN_GRABBABLE px moved into a remaining area and persisted.
- release(); hitTest(); hitAny(); setExpression(null) → no dereference.
- Disposed `senderFrame.url` getter throws → false; unexpected authorization throw → not swallowed.
- Retained released CompanionModel → gl cleared.
