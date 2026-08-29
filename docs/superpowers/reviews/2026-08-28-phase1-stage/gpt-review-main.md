# GPT adversarial review — main/preload/renderer (job j1-7psd, gpt-5.6, effort high, 2026-08-29)

Files reviewed: apps/desktop/src/main/{index,foreground,pet-window,ipc,app-protocol}.ts, apps/desktop/src/preload/pet.ts, apps/desktop/src/renderer/pet/{main,hover}.ts. NOT reviewed: cursor.ts, packages/protocol schemas (GPT asked for them).

VERDICT: block | major:6 minor:2

## Major

1. **pet-window.ts `createPetWindow` ready-to-show handler bypasses VisibilityState.** If the user hides the pet, the screen locks, suspend occurs, or fullscreen is detected between window creation and `ready-to-show`, `applyVisibility()` hides and records the flag, then `ready-to-show` calls `showInactive()` and makes it visible while `hidden` is still true. → Remove the direct `showInactive()` from `createPetWindow`; register `ready-to-show` in index.ts and call `applyVisibility()` so every show is derived from the flags. Guard against destruction.

2. **IPC boundary authenticates only "sender belongs to some BrowserWindow"** (`ipc.ts onFromPet`, index.ts registrations). Does not verify the expected pet webContents, the main frame, or the allowed `app://local` / dev origin. Electron applies the preload on later top-level navigations; no `will-navigate` / `setWindowOpenHandler` policy exists, so a navigated page keeps the ds preload surface. → Pass the pet window into `onFromPet`; reject unless `event.sender === pet.webContents`, `event.senderFrame === pet.webContents.mainFrame`, and the frame URL has the exact allowed origin. Deny unexpected top-level navigation (`will-navigate`) and windows (`setWindowOpenHandler`). Keep the preload allow-list.

3. **Click-through state not resynchronised across renderer reload/crash** (`pet-window.ts setClickThrough`, renderer `HoverTracker` init). If the old renderer emitted `inside=true` (main: ignoreMouseEvents=false) and the renderer reloads/crashes with the cursor outside the avatar, the new tracker starts with `emitted=false` and never emits false → the transparent 420×720 window permanently eats clicks. → Reset to click-through on `did-start-navigation` and `render-process-gone`; keep cursor polling alive so a real hit can switch it back. If a crash should hide the pet, model renderer health as a visibility reason (never call hide outside `applyVisibility()`).

4. **`shell:visibility` is a lossy one-shot notification.** If lock/suspend/fullscreen/user-hide happens while `Live2DStage.create()` is still running, `applyVisibility()` sends before the renderer's listener exists. Window stays hidden but `stage.start()` renders forever because `stageReady` does not replay visibility. → Treat `stageReady` as a sync point: resend the current visibility verdict (and cursor-paused state). One reconciliation function invoked on both native `ready-to-show` and renderer `stageReady`.

5. **`win.loadURL()` result discarded** (`createPetWindow`). A failed app-scheme load / missing renderer build / dev server down rejects asynchronously and bypasses the startup catch; process stays resident in tray with a `show:false` window that never works, plus an unhandled rejection. → Observe the load promise; on main-frame load failure log, destroy the partial window, stop pollers/watchers, quit or show deliberate recovery. Don't await load before registering IPC listeners.

6. **`shouldHideForForeground` geometry test can't distinguish fullscreen from maximized.** With an auto-hidden taskbar, a custom-framed maximized window equals the display (or is short by the 1–2 DIP activation strip) and passes the tolerance → pet wrongly hides. Conversely a spanning/slightly overhanging borderless fullscreen window fails the equality test. → Query Win32 maximized state (`IsZoomed` / `GetWindowPlacement`) and reject maximized windows first; then test whether the foreground rect **contains** the display bounds within tolerance rather than equal width/height. Include `Display.workArea` in the pure policy inputs.

## Minor

7. **First foreground poll only after `intervalMs`**; every transition stale up to 2 s (pet floats over a game for up to 2 s; stale fullscreen=true keeps the pet hidden after unlock/resume until next tick). → Extract one poll function; run it immediately on start and on resume/unlock; then arm the interval.

8. **`app://local` handler doesn't verify the URL authority** (`app-protocol.ts serveRenderer`): `app://anything/pet.html` is served as privileged secure content under an attacker-chosen origin, defeating the single-origin boundary. → Parse the URL in a guarded block; reject unless protocol/hostname/port/credentials exactly match `app://local`; GET/HEAD only; malformed → controlled 400. (The existing normalised-path containment is adequate against `..` traversal.)

## Tests GPT wants

- Hide via each VisibilityState reason before ready-to-show; emit ready-to-show; assert `showInactive` not called while hidden.
- Hide before the renderer installs `shell:visibility`; emit `stageReady`; assert verdict resent and stage stopped.
- Set click-through false via `avatar:hover inside=true`; simulate `did-start-navigation` and `render-process-gone`; assert `setIgnoreMouseEvents(true,{forward:true})` restored.
- Valid renderer→main event from another BrowserWindow, a subframe, `app://other`, and an HTTPS navigation in the pet webContents → all rejected.
- Reject unexpected top-level navigation and `window.open`; allow exact production PET_URL and configured dev origin.
- Force `loadURL` to reject → partial window, cursor poller, foreground watcher, tray cleaned up.
- Classify: exact fullscreen → hidden; auto-hide-taskbar maximized → visible; ordinary maximized → visible; spanning rect containing a display → hidden.
- Poll once immediately at startup and after resume/unlock.
- `app://other/pet.html`, credentialed/port URLs, malformed percent-encoding, encoded `..` / encoded backslash → only exact `app://local` contained files served.

## GPT's open questions (unanswered — cursor.ts and protocol schemas were not attached)

- cursor.ts destroyed-webContents checks, coordinate conversion, whether `setPaused(false)` samples immediately.
- @ds/protocol numeric finiteness/bounds for `avatar:drag dx/dy` and cursor coordinates.

Highest-risk interaction per GPT: findings 1+3+4 together — a visibility transition lost during renderer startup, `ready-to-show` overriding hidden state, and a reload leaving a transparent always-on-top window consuming clicks.
