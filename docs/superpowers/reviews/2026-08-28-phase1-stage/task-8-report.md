# Task 8 report — fullscreen/lock hiding, FPS policy, renderer debug-panel toggle

Branch `main`, worked directly on it. Baseline before starting: `pnpm install` (no churn),
`pnpm exec electron --version` → `v43.4.1`, `node -e "console.log(require('koffi').version)"` → `2.16.3`,
`pnpm test` → 30 passed, `pnpm --filter @ds/desktop typecheck` → clean.

---

## 1. What I implemented

### `apps/desktop/src/main/foreground.ts` (new)

- `shouldHideForForeground(fg, display, selfHwnd, fgHwnd, shellHwnds)` — **byte-identical to the brief's
  pure function**, so the brief's test passes unchanged.
- `startForegroundWatch(win, onChange, intervalMs = 2000)` — loads user32 through koffi lazily,
  polls `GetForegroundWindow` / `GetWindowRect`, converts the rect to DIP, matches it against
  `screen.getDisplayMatching(...).bounds`, and calls `onChange` only on *transitions*.
- koffi failure → one `console.warn`, `startForegroundWatch` returns a no-op stop function, hiding is
  disabled forever (never hide). Verified for real, see §3.6.

### `apps/desktop/src/main/index.ts` (wiring, Step 3)

Integrated into the file **as it exists after Task 7** (single-instance `else` block, `app://` protocol,
`savePetPosition` on `avatar:dragEnd` + `before-quit`) rather than the brief's older snippet:

- `showPet(visible)` replaced by `applyVisibility(reason)` (index.ts:31–39). Three independent flags —
  `userHidden` / `fullscreenHidden` / `systemHidden` (index.ts:22–24) — are OR-ed, so leaving fullscreen
  while the screen is still locked does not reveal her. Uses `showInactive()`, never `show()`.
- `stopForeground = startForegroundWatch(...)` right after `startCursorPolling` (index.ts:53–56).
- `powerMonitor` `lock-screen` / `suspend` / `unlock-screen` / `resume` (index.ts:60–79).
- Tray `toggleVisible` → `userHidden = !userHidden; applyVisibility('user')` (index.ts:89–92);
  `second-instance` → `applyVisibility('none')` (index.ts:44–47).
- `stopForeground?.()` in `before-quit` (index.ts:115).

### Renderer (Step 3b — the Task 7 handoff)

`apps/desktop/src/renderer/pet/debug-panel.ts` gained three small helpers:
`createDebugToggle(root, stage)` (lazy mount on first use, `classList.toggle('show')` afterwards),
`overDebugPanel(root, x, y)`, `inDebugPanel(root, target)`.

`apps/desktop/src/renderer/pet/main.ts`:
- `bridge?.on(Channels.debugToggle, () => toggleDebugPanel())`; `if (DEBUG) toggleDebugPanel()` replaces the
  old direct `mountDebugPanel(...)` so the startup mount and the tray toggle share one mounted-flag
  (otherwise the first tray toggle after a `DS_DEBUG=1` start would have re-mounted and appeared to do nothing).
- `hover.sample(hit !== null || overPanel(x, y), …)` in **both** the DOM `mousemove` handler and the
  `gaze:cursor` handler — this is the fix that makes the panel clickable at all.
- `mousedown`: early `return` when `e.target` is inside `#debug`, before a drag can start.
- `mouseup`: early `return` **after** the `avatar:dragEnd` terminator has been sent (see §4).

### FPS policy (spec §4.6)

No code change was needed and none was made: the renderer already sets 30 idle / 60 hovered locally in the
`HoverTracker` callback, and main never sends `stage:setFps` (verified by grep — the only
`Channels.stageSetFps` producer is nothing in `src/main`). Hidden → `shell:visibility {hidden:true}` →
`stage.stop()` (the ticker's `cancelAnimationFrame`), which now fires for fullscreen and lock too, not just
the tray. I added a clarifying comment above that handler, no behaviour change.

---

## 2. Deviations from the brief

**D1 — DPI conversion of the Win32 rect (`foreground.ts:66–75`, used at :98). This is a correctness fix, not
a style change: without it the feature never fires on this machine.**
Electron's main process is per-monitor DPI aware, so `GetWindowRect` returns **physical** pixels, while
`Display.bounds` is in **DIP**. Measured with a throwaway Electron probe on the test machine
(3840×2160 monitor at 150 %):

```
display.bounds (DIP) = {"x":0,"y":0,"width":2560,"height":1440} scaleFactor = 1.5
screenToDipRect(null, {0,0,3840,2160}) = {"x":0,"y":0,"width":2560,"height":1440}
dipToScreenRect(null, display.bounds)  = {"x":0,"y":0,"width":3840,"height":2160}
```

A fullscreen window's raw rect is `3840×2160`, the display bounds are `2560×1440` — the brief's ±1/±2
comparison would never have matched and Haru would never have hidden. `toDip()` runs the rect through
`screen.screenToDipRect(null, rect)` first; the conversion is exact at 1.5×, so the tight tolerance still
holds. The pure function and its tests are untouched.
(Corollary: the *same* koffi calls from a plain, DPI-unaware `node` process return virtualised coordinates —
2000×1254 vs 3000×1881 for the same window — which is why this had to be measured inside Electron.)

**D2 — koffi marshalling: the brief's snippet was correct; only three details changed.**
I probed koffi 2.16.3 against the real `user32.dll` before writing the file
(`node_modules/.pnpm/koffi@2.16.3/node_modules/koffi/doc/output.md` is the authority, not the 43-line README):

```
sizeof RECT 16
fg = 263926 typeof number          <- uintptr_t comes back as a Number, not a BigInt
GetWindowRect ok = true typeof boolean rect = { left: 747, top: 424, right: 2000, bottom: 1254 }
bad hwnd ok = false
```

- `_Out_ RECT* rect` with a plain JS object **works exactly as the brief wrote it** (doc/output.md,
  "POSIX struct example"); `_Inout_` is only needed for structs with a `cbSize` member. No change.
- The struct is registered as `DS_RECT` (`foreground.ts:52`) rather than `RECT` — `koffi.struct()` throws
  if a type name is registered twice, so the name is namespaced to this module.
- `uintptr_t` returns `number` (koffi promotes to BigInt only past `Number.MAX_SAFE_INTEGER`), so every
  handle goes through `toHwnd()` (`foreground.ts:36`) instead of a bare `BigInt(x)` — same result, but it is
  explicit about accepting both.
- The brief's dangling `void RECT;` line was dropped (the type only needs to be registered, not held).

**D3 — `selfHwnd` buffer width (`foreground.ts:87`).** `readBigUInt64LE(0)` throws on a 4-byte buffer, so it
falls back to `readUInt32LE`. Confirmed 8 bytes on this x64 build (`hex = ae030e0000000000`), but the guard
costs nothing.

**D4 — per-poll try/catch (`foreground.ts:106–113`).** An FFI throw inside a 0.5 Hz interval would otherwise
be an endless error stream. On the first failure it warns once, clears the interval, and — importantly —
calls `onChange(false)` if she was hidden, so a broken watch can never leave her permanently invisible.

**D5 — `applyVisibility` reason widened to include `'user'` (`index.ts:31`).** The brief's signature omitted
it, but Task 7's `showPet` already sent `reason: 'user'` for the tray path and the protocol enum has it;
dropping it would have been a silent regression in the payload.

**D6 — `mouseup` early-return placed after the drag terminator, not at the top of the handler.** The brief
says "`return` early when `e.target` is inside `#debug`". Returning at the very top would swallow the
`avatar:dragEnd` for a drag that started on Haru and ended over the panel, leaving main's drag state
unterminated. The return is placed after `avatar:dragEnd` is sent, so only the tap is suppressed.

**D7 — added one log line in `applyVisibility` (`index.ts:34`).** `[shell] hide/show reason=… user=… fullscreen=… system=…`.
Needed as the evidence channel for the lock/unlock check (the lock screen cannot be screenshotted), and it
matches the file's existing `[tray]` / `[pet]` logging style.

**D8 — did NOT create the `phase1-stage` tag** (Step 5), per instruction; the controller tags after review.

---

## 3. Verification

### 3.1 `pnpm test` — 35/35

```
 RUN  v3.2.7 D:/ds

 ✓  @ds/stage  src/mouth.test.ts (3 tests) 4ms
 ✓  scripts  sdk-layout.test.mjs (4 tests) 4ms
 ✓  @ds/stage  src/view.test.ts (4 tests) 3ms
 ✓  desktop  src/main/window-state.test.ts (6 tests) 12ms
 ✓  desktop  src/renderer/pet/hover.test.ts (4 tests) 3ms
 ✓  @ds/stage  src/ticker.test.ts (2 tests) 2ms
 ✓  desktop  src/main/foreground.test.ts (5 tests) 2ms
 ✓  @ds/stage  src/character.test.ts (3 tests) 5ms
 ✓  @ds/protocol  src/index.test.ts (4 tests) 4ms

 Test Files  9 passed (9)
      Tests  35 passed (35)
```

TDD was followed: the test file was written first and failed with
`Error: Cannot find module './foreground' imported from 'D:/ds/apps/desktop/src/main/foreground.test.ts'`
(`Test Files 1 failed | 8 passed (9)`), then went green after `foreground.ts` was added.

### 3.2 `pnpm --filter @ds/desktop typecheck` — clean

```
> @ds/desktop@0.1.0 typecheck D:\ds\apps\desktop
> tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
```
(no output = both projects clean)

### 3.3 Build sanity — koffi stays external

`pnpm --filter @ds/desktop build` then `grep -n koffi apps/desktop/out/main/index.cjs`:

```
5703:    const koffi = require("koffi");
5704:    const user32 = koffi.load("user32.dll");
5705:    koffi.struct("DS_RECT", { left: "long", top: "long", right: "long", bottom: "long" });
5713:    console.warn("[foreground] koffi unavailable, fullscreen hiding disabled:", err);
```

The lazy `require` survives rollup untouched (Task 7 had already listed `koffi` in
`electron.vite.config.ts`'s `rollupOptions.external`), so the graceful-degradation `try/catch` is real in the
built artifact, not just in source.

### 3.4 Playwright e2e — still green (no renderer regression)

```
Running 1 test using 1 worker
  ✓  1 tests\stage.spec.ts:61:1 › Haru renders, expressions change pixels, hit-test finds the body (7.5s)
  1 passed (10.0s)
```
It regenerates `docs/evidence/phase1/browser-haru.png`; I `git checkout`-ed that file so Task 6's committed
evidence is not churned by this task.

### 3.5 Manual checklist on the real desktop

Run as `DS_DEBUG=1 pnpm dev` (Electron 43.4.1, 3840×2160 @ 150 %).
**Capture technique:** `Graphics.CopyFromScreen` cannot see the pet window (Task 7's finding —
`WS_EX_NOREDIRECTIONBITMAP`), so every screenshot is a `desktopCapturer` composed-desktop capture from a
throwaway Electron script. Mouse input is real `mouse_event` input with absolute normalized coordinates.

| # | Check | Result |
|---|---|---|
| 1 | Browser video fullscreen (Edge F11) hides her | **PASS** |
| 2 | Leaving fullscreen brings her back | **PASS** |
| 3 | Maximized window does NOT hide her | **PASS** |
| 4a | Lock → hidden (`lock-screen` fires) | **PASS** (see §3.5.4) |
| 4b | Unlock → back, gaze works | **NOT OBSERVED** — machine stayed locked; see §3.5.4 |
| 5 | Tray → 调试面板 toggles the panel | **PASS** |
| 6 | Every panel button clickable anywhere on the panel | **PASS** |
| 7 | Panel click neither drags nor plays a tap motion | **PASS** |
| 9 | Frame budget: CPU with the cursor away (30 fps) vs on her (60 fps) | **PASS** — 0.73 % vs 1.54 %, see §3.5.5 (added by Lane C, 2026-08-29) |
| 10 | Hide from the tray *before* first paint stays hidden through `ready-to-show` | **PASS** — see §3.5.6 (added by Lane C) |
| 8 | koffi failure degrades to "never hide" | **PASS** (see §3.6) |

**#1/#2 — fullscreen.** Big Buck Bunny playing on youtube.com in Edge, F11. Foreground rect read back as
`(0,0)-(3840,2160) size=3840x2160`, exactly the display. Within the 2 s poll:

```
[shell] hide reason=fullscreen user=false fullscreen=true system=false
[shell] show  reason=none       user=false fullscreen=false system=false
```

`docs/evidence/phase1/desktop-fullscreen-hidden.png` — the full 3840×2160 desktop: the YouTube watch page
fills the entire screen (no browser chrome, no taskbar), the video is playing, and **Haru is absent** from the
region she occupies (physical x 3174–3804, y 1044–1764 — that area shows YouTube's recommended-videos
sidebar). I viewed the PNG to confirm. Exiting fullscreen brought her back with the debug panel intact,
confirmed on a follow-up capture. The same pair was reproduced a second time with a fullscreen VS Code
window, giving 3 hide→show cycles in the log.

**#3 — maximized.** A maximized window measured at `(-11,-11)-(3851,2099)`, i.e. `3862x2110` physical
(`≈2575x1407` DIP vs the display's `2560x1440`): the invisible resize border overhangs and the taskbar strip
is left free, so it falls outside the ±1/±2 tolerance. Capture shows Haru still on screen over the maximized
window with the taskbar visible, and **zero `[shell]` lines were emitted** during the whole maximized period.

**#5/#6/#7 — debug panel.** Sequence, all with real mouse input:
- Clicked **`happy`** at physical (3315,1131) — a point on the panel that is **not** over Haru's silhouette,
  i.e. exactly the case Task 7 reported as unclickable. Her mouth changed from a small closed smile to a wide
  open smile → the click reached the button. `docs/evidence/phase1/desktop-debug-click.png`.
- Moved to **`neutral`** at (3552,1169) and read the panel's own hit readout: **`hit: Head`** — this button
  physically overlaps the `Head` hit area, the confounding case. Clicked it: the expression went back to
  neutral, the window did not move a single pixel (panel and model at identical coordinates before/after),
  and `grep -c "\[pet\] tap" dev.log` stayed at **0** for the entire session.
- Tray → 调试面板 → panel disappeared (`[tray] debug:toggle` logged, capture shows Haru with no overlay);
  tray → 调试面板 again → panel reappeared. `docs/evidence/phase1/desktop-debug-toggle.png` is the
  full desktop with the panel toggled back **on**.

Note on the brief's "panel somewhere NOT overlapping Haru if the layout allows": the layout does **not**
allow it — `#debug` is `position: fixed; top: 8px; left: 8px` inside the 420×720 pet window and Haru is drawn
in that same window, so their relative position is fixed and the panel's lower-right rows always sit over her
head. That is why check #7 is meaningful and why I verified both an overlapping and a non-overlapping button.

**#4 — lock/unlock.** See §3.5.4 below.

### 3.5.4 Lock / unlock

Locked with `rundll32.exe user32.dll,LockWorkStation` (equivalent to `Win+L`). The lock half fired
immediately and correctly:

```
[power] lock-screen
[shell] hide reason=locked user=false fullscreen=false system=true
[shell] hide reason=fullscreen user=false fullscreen=true system=true
```

Both reasons end up set, which is right: `lock-screen` sets `systemHidden`, and ~2 s later the foreground
watch independently sees the lock screen (LogonUI, a window that does cover the whole display) and sets
`fullscreenHidden`. She is hidden either way.

**The unlock half is NOT verified.** Nobody was at the machine; I polled the log for `unlock-screen` for
27 minutes and it never arrived, and I obviously cannot enter the user's password. I did not fake it and I
did not quietly drop the check. What I can say:

- `unlock-screen` is registered on the same `powerMonitor` object, in the same `whenReady` block, three lines
  below the `lock-screen` handler that demonstrably works (index.ts:70–74 vs :60–64), with the mirror-image
  body. Confidence that it fires: high; but that is **read-the-code confidence, not measured**.
- The recovery path it depends on *is* measured: three fullscreen hide→show cycles show
  `applyVisibility` bringing her back with `showInactive()` and the renderer resuming (§3.5 #1/#2), and a
  probe against the live lock screen (below) confirms the foreground watch will clear `fullscreenHidden`
  on its own within one 2 s poll once the desktop returns.
- **Consequence to re-check when someone is at the machine:** on unlock she reappears after up to ~2 s, not
  instantly, because `unlock-screen` only clears `systemHidden` while `fullscreenHidden` waits for the next
  foreground poll.

While locked I also ran the post-edit `startForegroundWatch` against the real lock screen through a probe
(same esbuild technique as §3.6, but with koffi working and the built file placed inside
`apps/desktop/node_modules/` so `require('koffi')` resolves):

```
poll 0: fgHwnd=198922 shell=65844 physical={"x":0,"y":0,"width":3840,"height":2160} dip={"x":0,"y":0,"width":2560,"height":1440} bounds={"x":0,"y":0,"width":2560,"height":1440}
poll 1..3: identical
RESULT loop survived 4 polls, onChange calls = [true]
```

This is the strongest single confirmation of D1: the physical rect `3840x2160` converts to exactly the
`2560x1440` display bounds, the decision comes out `true`, and it fires **once** across four polls
(transition-only, not per-poll). It also confirms the per-poll `GetShellWindow()` re-read (§5) works.

### 3.5.5 Frame budget — the check Task 8 Step 4 #3 never performed (added by Lane C, 2026-08-29)

> Note (controller, after Lane C's scoped review): the committed `fps-cpu-idle.png` / `fps-cpu-hover.png` show a **separate fourth run** (10 s mean 0.58 % idle / 0.96 % hover); the table below tabulates three other runs. All four sit under the ≤ 4 % budget. `foreground-fullscreen-hidden.png` is a flat crop with no landmark — the `[shell] hide reason=fullscreen` log line in §3.5.7 is the actual proof of the fullscreen hide.

Addendum §0 budget: **≤ 4 % CPU idle**. Measured against the **built** app (`pnpm --filter @ds/desktop
build`, then `electron out/main/index.cjs`) on the same 3840×2160 @150 % desktop, 20 logical processors.

`Get-Counter '\Process(electron*)\% Processor Time' -SampleInterval 1 -MaxSamples 10`, summed over the
four `electron.exe` instances and divided by 20, so the figure is directly comparable to Task Manager's
CPU column (percentage of the whole machine, not of one core).

The hover half is not asserted from where the cursor was told to go: main clears `WS_EX_TRANSPARENT` on
the pet window exactly while it judges the cursor to be on her, so the style bit was read back before and
after each run as the precondition.

| sample | cursor away (30 fps) | cursor on her (60 fps) |
|---|---|---|
| 1 | 1.078 % | 1.007 % |
| 2 | 0.693 % | 1.688 % |
| 3 | 0.537 % | 1.768 % |
| 4 | 0.459 % | 1.846 % |
| 5 | 0.778 % | 1.232 % |
| 6 | 0.922 % | 1.853 % |
| 7 | 0.771 % | 1.308 % |
| 8 | 0.692 % | 1.688 % |
| 9 | 0.616 % | 1.713 % |
| 10 | 0.777 % | 1.324 % |
| **mean** | **0.73 %** | **1.54 %** |
| min / max | 0.46 % / 1.08 % | 1.01 % / 1.85 % |
| `WS_EX_TRANSPARENT` | set (not hovered) | cleared (hovered), still cleared after the run |

**Verdict: PASS with a wide margin** — 0.73 % idle against a 4 % budget, and the hover/idle ratio is
**2.11×**, which is what a 30 → 60 fps switch should cost once the fixed main/GPU-process overhead is
included. A second independent run earlier the same session gave 0.78 % / 1.17 % and a third 1.00 % /
1.22 %; the runs whose ratio is below 2× are the ones where the machine was busier, not ones where the
fps switch failed (hover was style-bit-verified in all three).

**Evidence:** `docs/evidence/phase1/fps-cpu-idle.png` and `fps-cpu-hover.png` — a live per-PID CPU
readout for the pet's own process tree, captured next to her, each frame stating its own hover state and
fps target.

**Deviation from the brief — no `fps-taskmanager-*.png`.** Task Manager could not be made to show the
pet's own row on this host, for two independent reasons: (i) Task Manager auto-elevates on Windows 11,
and the agent shell runs at medium integrity, so UIPI silently discards every injected click and wheel
event aimed at it — verified by clicking "Details" with a non-elevated window in the foreground and
observing no tab change and no foreground change; the tab therefore cannot be switched, the list cannot
be scrolled, and the filter box cannot be typed into; and (ii) the pet is created with
`skipTaskbar: true`, which Electron implements via `ITaskbarList::DeleteTab`, so it never appears in Task
Manager's default **Apps** list at all — clearing `WS_EX_TOOLWINDOW` (a no-op: Electron never set it) and
then forcing `WS_EX_APPWINDOW` both failed to produce a taskbar button, and its `electron.exe` rows live
far down the unscrollable **Background processes** list. Task Manager also renders per-app CPU at this
magnitude as a flat `0%`, so it could not have resolved the 30/60 split even if it had been reachable.
The HUD captures above carry the same claim with better resolution and no leaked app inventory.

### 3.5.6 Hide from the tray before first paint (F1 manual, added by Lane C, 2026-08-29)

The window between the tray icon appearing and `ready-to-show` is real but ~1 s wide, which is not
reliably hittable by hand. It was widened without touching a line of app code: the built renderer was
served from a local static server that holds **only** `/pet.html` for 25 s
(`ELECTRON_RENDERER_URL=http://localhost:5188`), so `ready-to-show` cannot fire until then. Everything
under test — the tray, `visibility`, `createPetWindow`'s `onReadyToShow` — is the shipped code path.

```
t0        = 11:23:08.643   electron out/main/index.cjs launched
t0+1.0 s  ds tray icon present in the notification area; the 'ds pet' window does not exist yet
t0+2.8 s  tray right-click -> 显示/隐藏
t0+25.5 s /pet.html released by the server -> renderer paints -> ready-to-show fires
t0+41 s   polling ends
```

`IsWindowVisible('ds pet')` was polled every 500 ms for the whole 41 s: **never true**. Main's log:

```
[shell] hide reason=user fullscreen=false locked=false suspended=false user=true   <- the tray click
[shell] hide reason=user fullscreen=false locked=false suspended=false user=true   <- ready-to-show -> applyVisibility()
[pet] stage ready { character: 'haru', ... }                                       <- visibility.resend()
[shell] show reason=none fullscreen=false locked=false suspended=false user=false  <- second 显示/隐藏
```

The second line is the fix: `ready-to-show` now asks the visibility owner instead of calling
`showInactive()`, so the hide that landed 22 s earlier survives it. A second 显示/隐藏 showed her.

**Evidence:** `docs/evidence/phase1/visibility-hide-before-paint.png` (tray menu open, her spot empty)
and `visibility-second-press-shows.png` (same crop, she is there). A plain always-on-top panel was parked
where she lives so the "empty" frame shows a neutral surface rather than the operator's desktop.

### 3.5.7 Fullscreen vs maximized against the real `IsZoomed` (A5 manual, added by Lane C, 2026-08-29)

Driven with our own Electron window rather than the operator's applications, so the same code path is
exercised without touching their session.

| phase | foreground window bounds (DIP) | expected | observed |
|---|---|---|---|
| maximized | `(-7,-7) 2576×1408` — taskbar still reserved, `IsZoomed` true | stays visible | **visible** (`foreground-maximized-visible.png`) |
| borderless fullscreen | `(0,0) 2560×1440` — exactly the display | hides within one 2 s poll | **hidden** (`foreground-fullscreen-hidden.png`, `[shell] hide reason=fullscreen`) |
| exited fullscreen | back to windowed | reappears | **visible** (`[shell] show reason=none`) |

**The koffi `IsZoomed` declaration is not blocked and does not throw.** `loadWin32()` registers all five
`user32` bindings in one go, so a bad `bool __stdcall IsZoomed(uintptr_t hwnd)` signature would throw at
registration and degrade the whole watch to "never hide" — the fullscreen hide above could not have
happened. No `[foreground]` warning appeared in the main-process console during any run.

### 3.6 koffi failure degradation — verified, not assumed

I did not want to claim this from reading the `try/catch`. A probe transpiles the **real**
`src/main/foreground.ts` with esbuild, patches `Module._resolveFilename` so `require('koffi')` throws, and
runs `startForegroundWatch` under Electron for 7 poll intervals:

```
  [captured warn] [foreground] koffi unavailable, fullscreen hiding disabled: Error: SIMULATED: Cannot find module 'koffi'
RESULT warns=1 onChangeCalls=0 stopIsFunction=true
pure fn still works: true
```

Exactly one warning, `onChange` never fires (so she is never hidden), `stop()` is callable, no crash.

---

## 4. Files changed

| File | Change |
|---|---|
| `apps/desktop/src/main/foreground.ts` | new — FFI + pure decision |
| `apps/desktop/src/main/foreground.test.ts` | new — the brief's 5 tests, verbatim |
| `apps/desktop/src/main/index.ts` | wiring only: `applyVisibility`, foreground watch, `powerMonitor`, teardown |
| `apps/desktop/src/renderer/pet/debug-panel.ts` | +`createDebugToggle`, `overDebugPanel`, `inDebugPanel` |
| `apps/desktop/src/renderer/pet/main.ts` | `debug:toggle` handler, panel-aware hover sampling, drag/tap guards |
| `docs/evidence/phase1/desktop-fullscreen-hidden.png` | new evidence |
| `docs/evidence/phase1/desktop-debug-toggle.png` | new evidence |
| `docs/evidence/phase1/desktop-debug-click.png` | new evidence (panel button click taking effect) |

No new dependencies. `pnpm-lock.yaml` and `pnpm-workspace.yaml` untouched.

---

## 5. Self-review findings

- The pure `shouldHideForForeground` is character-for-character the brief's; every adaptation is in the FFI
  plumbing or the DIP conversion around it, as the brief permitted.
- **D1 (DPI) was found by measurement, not by reading.** Had I trusted the brief's snippet, `pnpm test` would
  still have been 35/35 and the feature would have been 100 % dead on any scaled display — which is most
  Windows laptops. This is the single most important finding of the task.
- `applyVisibility` is the only writer of window visibility now; `showPet` is gone, so there is no second
  path that could disagree with the three flags.
- **Self-review caught one bug in my own first draft:** I had hoisted `shellHwnds` out of the poll loop
  (the brief does the same). `GetShellWindow()` returns a *new* Progman handle after an Explorer restart, so
  a cached value would stop matching and a plain click on the desktop — whose window genuinely covers the
  display — would have hidden her. The handles are now re-read each poll (`foreground.ts:99–101`); two extra
  FFI calls every 2 s. Re-verified afterwards with the live probe in §3.5.4 (`onChange calls = [true]`,
  `shell=65844` read successfully on every poll), plus `pnpm test` 35/35 and typecheck.
- While the screen is locked, both `systemHidden` and `fullscreenHidden` end up true (the lock screen is a
  foreground window covering the display). `unlock-screen` clears only `systemHidden`, so the actual
  reappearance waits for the next foreground poll (≤ 2 s). Correct, but it means the `[shell] show` line
  trails `[power] unlock-screen` by up to 2 s rather than being simultaneous.
- Cosmetic wart, deliberately left: when `applyVisibility('none')` runs while another flag is still set, it
  logs/sends `hidden: true, reason: 'none'`. The enum allows it and the renderer only reads `hidden`, so I
  did not invent a new reason value for it.
- `mountDebugPanel` is now only reachable through `createDebugToggle`, so the startup mount and the tray
  toggle can never disagree about whether the panel exists. The Playwright test's direct
  `classList.remove('show')` (stage.spec.ts:86) still composes correctly — the next toggle re-adds the class.
- `overDebugPanel` guards on `.show` before `getBoundingClientRect()`, so a `display: none` panel (which
  reports an all-zero rect) can never be reported as "under the cursor" at the origin.
- I ran the Playwright e2e as an extra regression gate because I touched the renderer's composition root,
  and restored the evidence PNG it regenerates so `git status` stays honest.
- `git status` clean apart from the intended files; nothing from `public/`, `.cache/`, `.superpowers/`,
  `out/`, or `node_modules/`.

## 6. Concerns

0. **`unlock-screen` / `resume` are not measured** (§3.5.4). The lock half is proven; the unlock half needs
   a human at the keyboard. This is the one item on the brief's checklist I could not close, and it should
   be re-run by whoever next has the machine unlocked — it takes 20 seconds: `Win+L`, unlock, confirm she
   comes back and the gaze follows the cursor. I chose to report this rather than assert it.
1. Electron and the vite dev server were killed at the end as instructed (verified: 0 processes left), so the
   `unlock-screen` event will not be captured later either — the check has to be re-run deliberately.
2. **Multi-monitor is untested.** Only one display on this machine. Two behaviours are unverified there:
   `screen.screenToDipRect(null, rect)` picking the right monitor's scale factor for a rect on a secondary
   display, and the policy itself — the brief's design hides her when *any* display is covered by a
   fullscreen window, even if she is sitting on a different, uncovered monitor. That is the brief's
   `getDisplayMatching(fg)` semantics and I kept it, but on a dual-monitor desk it will read as a bug
   ("a fullscreen game on monitor 2 hides the pet on monitor 1"). Worth a Phase 4 decision.
3. **`suspend` / `resume` are not exercised.** Same handler shape as lock/unlock and registered identically,
   but I did not suspend the machine, so they are "likely correct (read the code)", not verified.
4. The 2 s poll means the hide can lag a fullscreen transition by up to 2 s (the brief's interval). Measured
   worst case matched that. Fine for the spec's "within ~2 s", but it is visible.
5. `docs/evidence/phase1/desktop-fullscreen-hidden.png` is 3.7 MB (a full 4K photographic frame). The other
   two are ~1.4 MB. If repo size matters, these could be downscaled later.

---

## Fix round 1

Second pass on `main` (HEAD `ae68e0e` at start), driven by a code-review of the original Task 8 work.
Files touched this round: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/foreground.ts`,
`apps/desktop/src/main/cursor.ts`, plus new `apps/desktop/src/main/visibility-state.ts` and
`apps/desktop/src/main/visibility-state.test.ts`. No other files were touched (per instruction),
and `packages/protocol` was **not** changed — the `shell:visibility` enum already had exactly the
five reason values the fix needed.

TDD order followed: wrote `visibility-state.test.ts` first, ran `pnpm test` and confirmed the
single expected failure (`Cannot find module './visibility-state'`, 1 failed / 9 passed, 35 tests
green), then implemented `visibility-state.ts`, then the three surgical edits, then re-ran the full
suite and typecheck.

### 1. `systemHidden` conflated lock and suspend (IMPORTANT)

**Problem:** a single `systemHidden` boolean was set by both `lock-screen`/`suspend` and cleared by
both `unlock-screen`/`resume`. On the real Windows sequence `lock-screen -> suspend -> resume ->
(still locked) -> unlock-screen`, the `resume` handler cleared `systemHidden` while the lock screen
was still showing, which called `applyVisibility` -> `showInactive()` and sent `hidden:false` to the
renderer, restarting its ticker behind the lock screen.

**Fix:** new pure module `apps/desktop/src/main/visibility-state.ts` — a `VisibilityState` class
holding four independent boolean flags (`fullscreen`, `locked`, `suspended`, `user`) with
`set(flag, value)`, `get(flag)`, and getters `hidden` (OR of all four) and `reason` (derived, see
finding 3). `index.ts:65-84` now calls `visibility.set('locked', ...)` from `lock-screen`/
`unlock-screen` and `visibility.set('suspended', ...)` from `suspend`/`resume` — four independent
handlers instead of two that both touched one flag. `index.ts:25` replaces the old
`userHidden`/`fullscreenHidden`/`systemHidden` trio with the single `visibility` instance.

Verified by `visibility-state.test.ts`, test 1 (`lock -> suspend -> resume -> unlock keeps hidden
true until unlock`): asserts `hidden` stays `true` through `locked=true`, `suspended=true`,
`suspended=false` (resume), and only flips to `false` after `locked=false` (unlock) — i.e. the
exact bug sequence from the brief, now passing.

### 2. `foreground.ts` poll leaves the interval armed on a destroyed window (MINOR)

**Fix:** `apps/desktop/src/main/foreground.ts:91-95` — the `if (win.isDestroyed())` branch inside
the `setInterval` callback now calls `clearInterval(timer)` before returning, instead of returning
with the interval still armed. Diff:
```
-    if (win.isDestroyed()) return;
+    if (win.isDestroyed()) {
+      // The window is gone; an armed interval holding a dead BrowserWindow forever is a leak.
+      clearInterval(timer);
+      return;
+    }
```
No new test: this path only triggers on window teardown ordering that the existing pure-function
tests can't exercise without an Electron `BrowserWindow`, matching the "MINOR" weight in the
brief. Confirmed by reading — `timer` is captured in the closure via the standard
`setInterval`/`clearInterval` idiom already used everywhere else in this file (the existing catch
block and the returned stop function both do the same thing).

### 3. `reason` passed as a parameter could disagree with the flags (MINOR)

**Fix:** `applyVisibility()` (`index.ts:34-44`) no longer takes a `reason` parameter at all — every
call site (`index.ts:51`, `:60`, `:68`, `:73`, `:78`, `:83`, `:96`) was changed from
`applyVisibility('someReason')` to `applyVisibility()`. The reason is now read from
`visibility.reason` (`visibility-state.ts:41-46`), computed with fixed precedence
`user > locked > suspended > fullscreen > none` (`none` only when no flag is set). This structurally
eliminates the two bugs named in the brief: fullscreen clearing while locked can no longer emit
`reason:'fullscreen'` (there is no longer a call site that could pass it), and unlocking while
still fullscreen can no longer emit `reason:'none'` with `hidden:true` (reason and hidden are always
read from the same object at the same instant).

Verified by `visibility-state.test.ts`:
- test 3 (`fullscreen clearing while locked yields hidden:true reason:locked`) — the brief's exact
  named case.
- test 4 (`all flags clear yields hidden:false reason:none`).
- test 5 (`precedence is user > locked > suspended > fullscreen`) — walks the full precedence chain.

`packages/protocol/src/index.ts` was read to confirm the enum (`'fullscreen' | 'locked' |
'suspended' | 'user' | 'none'`, `index.ts:27` in that package) already covers every value
`VisibilityState.reason` can produce — it was not modified.

### 4. Cursor polling kept running (and IPC-ing) into the hidden window (MINOR)

**Fix:** `apps/desktop/src/main/cursor.ts` — `startCursorPolling` now returns a `CursorPolling`
handle (`{ stop, setPaused }`, `cursor.ts:5-9`) instead of a bare stop function; the poll loop
(`cursor.ts:16`) checks a `paused` flag first: `if (paused || win.isDestroyed() ||
!win.isVisible()) return;`. `index.ts:18` changed `stopCursor: (() => void) | null` to
`cursorPolling: CursorPolling | null`; `applyVisibility()` (`index.ts:42`) calls
`cursorPolling?.setPaused(hidden)` on every visibility change, and `before-quit` (`index.ts:119`)
calls `cursorPolling?.stop()` instead of `stopCursor?.()`.

Note for the record: the pre-existing `!win.isVisible()` guard already suppressed the `gaze:cursor`
*send* once `pet.hide()` had been called (Electron's `isVisible()` flips immediately), so the prior
behaviour was not literally sending IPC into a hidden window — but the 30 Hz interval kept firing
and calling `screen.getCursorScreenPoint()` regardless, and the pause is now driven directly by the
app's own `hidden` verdict rather than as a side effect of `BrowserWindow.hide()`, which is the more
correct dependency (`applyVisibility` is the single owner of both facts, so they can't drift).
No new automated test: this is wall-clock/Electron-window behavior with no meaningful pure-function
surface to unit test, same category as finding 2.

### 5. Test coverage — `visibility-state.ts` / `visibility-state.test.ts`

Built as instructed: a class (`VisibilityState`) with `set(flag, value)` and getters `hidden` /
`reason`, plus a `get(flag)` accessor (needed by the tray toggle at `index.ts:95`, which must read
the current `user` flag to invert it) and a `describe()` helper (used for the `[shell]` log line at
`index.ts:38`, replacing the old three-boolean log format). Five tests in
`apps/desktop/src/main/visibility-state.test.ts`, covering all four cases the brief asked for plus
one precedence walk:
1. `lock -> suspend -> resume -> unlock keeps hidden true until unlock` (brief's (a)).
2. `user-hidden survives unlock and resume` (brief's (b)).
3. `fullscreen clearing while locked yields hidden:true reason:locked` (brief's (c)).
4. `all flags clear yields hidden:false reason:none` (brief's (d)).
5. `precedence is user > locked > suspended > fullscreen` (extra: exercises every rung of the
   precedence order, not just the two adjacent-flag cases above).

`index.ts` uses the module exclusively — there is no longer any boolean visibility state held
outside `VisibilityState`.

### 6. Disclosure gap — `.gptmcp/` in `.gitignore`

Confirmed via `git check-ignore -v` that `.gitignore:23` (`.gptmcp/`) was already present at HEAD
(added in the Task 8 commit `77a2942`, unchanged this round). The original report's §4 "Files
changed" table omitted it. Recording it here since instructed to keep the line (no `.gitignore`
edit was made this round) and add it to a table:

| File | Change |
|---|---|
| `.gitignore` | Task 8 commit (`77a2942`) added `.gptmcp/` (gpt-collab MCP session state, agent scratch — same category as the pre-existing `.superpowers/` line). Omitted from Task 8's own §4 table; disclosed here. |

### Files changed this round

| File | Change |
|---|---|
| `apps/desktop/src/main/visibility-state.ts` | new — pure flag/reason state (finding 1, 3, 5) |
| `apps/desktop/src/main/visibility-state.test.ts` | new — 5 tests (finding 5) |
| `apps/desktop/src/main/index.ts` | `VisibilityState` wiring; split lock/suspend; `applyVisibility()` takes no `reason` param; pauses cursor polling (findings 1, 3, 4) |
| `apps/desktop/src/main/foreground.ts` | `clearInterval` on destroyed-window branch (finding 2) |
| `apps/desktop/src/main/cursor.ts` | `startCursorPolling` returns `{ stop, setPaused }`; poll skips while paused (finding 4) |
| `.gitignore` | no change this round; disclosed per finding 6 |

### Verification

`pnpm test`

Before the fix (test-first): `Test Files  1 failed | 8 passed (9)` /
`Tests  35 passed (35)` — failure was exactly the expected
`Cannot find module './visibility-state' imported from '.../visibility-state.test.ts'`.

After implementation:
```
 Test Files  10 passed (10)
      Tests  40 passed (40)
```
(9 pre-existing files x their prior counts, unchanged, + `visibility-state.test.ts` (5 tests) = 40;
`foreground.test.ts` still 5/5 unchanged, confirming finding 2's edit didn't touch the pure
function's behavior.)

`pnpm -r --if-present typecheck`
```
Scope: 3 of 4 workspace projects
packages/protocol typecheck$ tsc -p tsconfig.json
packages/protocol typecheck: Done
packages/stage typecheck$ tsc -p tsconfig.json
packages/stage typecheck: Done
apps/desktop typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.renderer.json
apps/desktop typecheck: Done
```
Clean across all three projects (main + renderer tsconfigs for desktop).

As an extra regression gate (not required by the brief, but touched `index.ts`/`cursor.ts` which
feed the bundled main process): `pnpm --filter @ds/desktop build` — succeeded,
`out/main/index.cjs` still contains the lazy `require("koffi")` (4 matches via `grep -c koffi`),
confirming the koffi-external/graceful-degradation path from Task 8 §3.3 survived this round's
edits to `index.ts` untouched.

**Desktop screenshots were not re-run.** This round is pure state-machine/wiring logic
(flag combination, reason derivation, an interval leak fix, a pause flag) with no visual or pixel
surface; the existing `docs/evidence/phase1/desktop-fullscreen-hidden.png` and friends from the
original Task 8 pass remain the visual evidence and were not touched.

### Concerns carried forward / new

- The original report's concern #0 (`unlock-screen`/`resume` not measured on real hardware) and #3
  (`suspend`/`resume` not exercised) still apply — this round is a refactor of the *logic* those
  events feed into, verified by unit test, not a new manual hardware pass. The unit tests now prove
  the state machine is correct *given* that Electron fires these four `powerMonitor` events as
  documented; whether they fire on this machine in this exact order is still unverified by a human
  at the keyboard.
- `visibility.describe()`'s log format (`fullscreen=... locked=... suspended=... user=...`) differs
  from the original report's D7 log format (`user=... fullscreen=... system=...`) since
  `systemHidden` no longer exists as one value — flagged here so nobody goes looking for the old
  three-field format in logs later.
- No behavior change to the FPS policy (spec section 4.6) itself; only *when* the cursor poll runs
  changed (paused while hidden). The renderer-side 30/60 Hz hover logic from the original Task 8
  pass is untouched.
- Multi-monitor and real suspend/resume hardware verification remain open items from the original
  report; out of scope for this round per the brief's file list.
