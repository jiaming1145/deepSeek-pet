# GPT review 2 — follow-up on invoke.ts, app-protocol.ts, index.ts, db.ts, history.ts, bubble-window.ts, visibility-state.ts, chat-window.ts (gpt-5.6-sol, xhigh, 2026-08-30)

VERDICT: block | major:6 minor:2   (IDs G2-n; overlap with final-review.md noted per item)

## Major

- **G2-1** `app-protocol.ts rendererUrl / allowedPetOrigins / isAllowedPetUrl` — `ELECTRON_RENDERER_URL` is trusted in packaged builds and permits non-HTTP schemes. With `ELECTRON_RENDERER_URL=file:///trusted`, `originKey` reduces every local file URL to `file://`, so navigation to `file:///other/attacker.html` passes `isAllowedPetUrl`, retains the preload, and is accepted by `isFromWindow`. → Ignore `ELECTRON_RENDERER_URL` whenever `app.isPackaged`; in dev accept only explicit HTTP/HTTPS loopback dev origins; never `file:` as an origin key. *(Extends M-9.)*
- **G2-2** `index.ts before-quit; history.ts onTrimNeeded` — dispose-before-close confirmed: `before-quit` calls `brain?.dispose()` without awaiting a drain, then `db?.close()`; `onTrimNeeded` can be suspended at `await this.summarize(...)` and later calls `this.db.prepare(...)` on the closed db. → Disposal aborts and awaits active TurnRunner AND summarisation work; `before-quit` prevents the first quit, bounded async shutdown, close db after drain, `app.quit()` under a re-entry guard; a closing fence in `HistoryStore` so no continuation touches the db after close. *(= I-9 / G-8, plus the summariser continuation.)*
- **G2-3** `history.ts onTrimNeeded` — concurrent trims advance `last_trim_id` past never-summarised rows: two calls summarise the same prefix while `last_trim_id` is 0; the first commits id 10, the second then queries `OFFSET 9` relative to the new pointer and commits id 20 with a summary of rows 1–10 only. → Snapshot expected `last_trim_id` + exact cutoff row id before the await; serialise trim commits; inside the transaction commit only if the snapshot still matches, else return without writing; coordinate `history:delete` through the same revision. *(Extends I-10.)*
- **G2-4** `index.ts onFromAny chatOpen, tray.openChat, globalShortcut` — chat does not follow the visibility verdict; tray/hotkey/`chat:open` show and focus the always-on-top chat while fullscreen/locked/suspended/user-hidden. → One visibility-aware `requestChat()`; refuse while hidden, or clear only the user flag and still refuse for fullscreen/locked/suspended. *(= I-7.)*
- **G2-5** `bubble-window.ts hideBubble; index.ts applyBubbleVisibility` — hover/click-through not reset when the bubble hides; a later `bubbleWanted` replay shows the transparent window with `ignoreMouseEvents` still false. → Every bubble hide forces `setBubbleClickThrough(bubble, true)` even when already not visible; on show, send a window-local cursor sample so the renderer recomputes its real DOM hit and re-emits hover. *(Extends M-8.)*
- **G2-6** `bubble-window.ts createBubbleWindow; chat-window.ts createChatWindow` — `void win.loadURL(...)` discards the rejection; a missing packaged page or dead dev server leaves an unusable bubble or a transparent focusable chat window; chat has no `render-process-gone` recovery. → Observe each load promise; route non-deliberate main-frame failures through the startup/recovery policy (ignore ERR_ABORTED only during destruction/intentional navigation/shutdown); hide the chat on `render-process-gone` and reload deliberately or report via `fatal()`.

## Minor

- **G2-7** `db.ts migrate; history.ts lastTrimId` — unchecked `Number()` on persisted metadata: `schema_version='garbage'` → NaN bypasses the newer-schema check and is overwritten with 1; negative/non-numeric `last_trim_id` accepted. → Validate as canonical non-negative safe integers at open; malformed → `MemoryOpenError`.
- **G2-8** `app-protocol.ts serveRenderer` — HEAD and `Range` are accepted but `net.fetch(pathToFileURL(...))` always issues a plain GET (full body for Range, full read for HEAD). → Preserve HEAD/validated Range or implement bounded range responses. *(No consumer needs ranges today — Phase 4 packaging carry.)*

## Tests GPT asked for
- Auth matrix for every invoke channel (intended window ok; other windows, same-webContents subframe, navigated main frame, `app://local.evil` rejected).
- Origin table: case, trailing slash, explicit/default port, userinfo, `app://local.evil`, malformed, packaged override, `file:///a` vs `file:///b`.
- Protocol containment: encoded dot segments, encoded slashes/backslashes, drive/UNC-like paths, malformed encoding; HEAD/Range/status/MIME.
- Quit with a deferred summariser pending → no db access after close, no unhandled rejection.
- Two `onTrimNeeded` resolving in reverse order → `last_trim_id` advances once, no rows skipped; delete/mutate the dropped prefix during summarisation → stale trim does not commit.
- Every visibility flag × chat-open source → chat cannot show while hidden.
- Bubble hover inside → hide before leave → show with cursor outside/inside → both click-through states resynchronised.
- Reject bubble.html/chat.html loads; crash the chat renderer while visible → observed, no blank focusable window.
- Malformed `schema_version` / `last_trim_id` → deterministic open failure.

## Confirmed clean
- `handleInvoke` authenticates before parsing/executing; a subframe or another window cannot spoof the sender; request AND response schemas validated. (Per-channel allow-lists were certified by the Claude main-process lens.)
- Production `app://local` origin comparison sound: `app://local.evil` ≠ `app://local`; userinfo rejected; explicit ports rejected; trailing paths ignored; decoded+normalised containment blocks ordinary/encoded/backslash traversal; MIME from file.
- `bubbleWanted` replay correct: `bubbleWanted && !verdict.hidden`, applied after creation and on both edges; opening chat does not clear it.
- `VisibilityState` ORs independent flags with deterministic reason precedence; summary + `last_trim_id` transactionally paired; `openDb` closes a partially opened db on failure.
