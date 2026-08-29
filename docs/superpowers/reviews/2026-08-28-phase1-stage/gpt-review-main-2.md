# GPT adversarial review — remaining main/preload/renderer files (job j3-irqd, gpt-5.6, effort high, 2026-08-29)

Files: apps/desktop/src/main/{cursor,tray,window-state,visibility-state}.ts, packages/protocol/src/index.ts, apps/desktop/src/renderer/pet/{bridge,debug-panel}.ts, apps/desktop/src/preload/pet.ts. (GPT was told not to repeat gpt-review-main.md's findings.)

VERDICT: block | major:4 minor:3

## Major

1. **Preload API exposed to every top-level document in the pet webContents** (`preload/pet.ts exposeInMainWorld`). After navigation to untrusted content, that page can invoke all six renderer→main channels: `avatar:hover` (toggle native click-through), `avatar:drag` (move the window), `avatar:dragEnd` (persist a malicious position), etc. → Keep the allow-list but enforce document identity in main: block unexpected `will-navigate`, deny window creation, reject IPC unless `event.sender === pet.webContents`, `event.senderFrame === mainFrame`, frame URL = exact allowed origin; reset click-through on navigation / render-process-gone. (Same fix as gpt-review-main.md #2/#3 — one implementation covers both.)

2. **`Schemas[avatar:drag]` accepts Infinity and arbitrarily large deltas.** `moveBy` can push values outside Electron's native coordinate range → `setPosition` throws, or the pet moves/persists far outside every display. Still dangerous after sender verification (renderer bugs are boundary inputs). → Require finite deltas with a magnitude bound; clamp the resulting window position in main against the current virtual desktop/work areas (a per-message bound alone is bypassable by repetition). Make `gaze:cursor` coordinates finite (no small fixed range — valid window-local gaze coords can be far outside the window).

3. **`window-state.ts clampToDisplays` returns a remembered position unchanged whenever only the window centre is on a display** → up to ~half of the pet can be inaccessible after monitor removal/topology change. Formula also fails when a work area is smaller than the pet: `nearest.right - pos.w < nearest.x` places the top/left off-screen. → Require the current `PET_SIZE` (drop the optional 400×700 defaults); pick the target work area by greatest intersection or nearest distance; clamp every remembered position even when the centre is on-screen; if the pet is larger than an axis, anchor at the work-area origin (or deliberately resize) rather than computing a max below the min.

4. **`tray.ts createTray` builds an invisible tray when `tray.png` is missing** and claims the menu stays reachable — it doesn't: an empty tray image gives no target. With the taskbar-less pet hidden, the process has no show/quit control. → Treat an empty packaged icon as a startup failure or provide a guaranteed non-empty fallback icon before constructing `Tray`; add a packaging assertion that the resource exists and decodes; never continue with an empty `NativeImage`.

## Minor

5. **`cursor.ts startCursorPolling` dedupes on global cursor coords before reading the window position.** If the window moves while the cursor is stationary, window-local coords change but no `gaze:cursor` is sent until the cursor moves; same stale state on resume after a hidden-window move or for a replacement renderer. → Compute window-local coords before dedup and dedupe that pair; on resume / `stageReady` invalidate the cache and sample immediately. (Conversion is correct: `screen.getCursorScreenPoint()` and `BrowserWindow.getPosition()` are both DIP — do not multiply by scale factor.)

6. **`window-state.ts loadWindowState` accepts non-finite numbers** (`1e400` → Infinity from JSON.parse). → Accept x/y only when `Number.isFinite`.

7. **`debug-panel.ts mountDebugPanel` inserts expression/motion-group names into innerHTML unescaped and serialises `group:index` split on ':'** — a valid group name containing ':' selects the wrong group / NaN index; names with quotes/markup corrupt the DOM. → Build with `createElement`/`textContent`; carry group/index via closures or properties.

## Tests GPT wants

- IPC: navigate (or attempt) the pet webContents to a foreign origin → every renderer→main channel rejected; window cannot be moved or made interactive.
- Protocol/main: reject `avatar:drag` Infinity/-Infinity/Number.MAX_VALUE/over-bound deltas; repeated accepted deltas cannot persist a position outside the allowed work areas.
- Window-state: clamp a 420×720 pet whose centre is barely on-screen but left/top edges off; clamp against work areas narrower/shorter than the pet; initial placement uses 420×720 and preserves the 24 px bottom-right inset when it fits; JSON `1e400` rejected.
- Tray: mock `createFromPath` → empty NativeImage → startup uses a non-empty fallback or fails deliberately.
- Cursor: stationary global cursor + window moves → new local gaze position emitted; unpausing emits an immediate sample.
- Debug panel: names containing `<`, `&`, quotes, `:` → labels stay text; clicks invoke the exact original name/index.

## GPT's open question

- Does `ipc.ts sendToPet` guard destroyed webContents and catch `webContents.send` failures during navigation / render-process-gone? If not, cursor.ts's `isDestroyed` check is insufficient and that send path needs a lifecycle guard. (Fix wave: verify and guard.)
