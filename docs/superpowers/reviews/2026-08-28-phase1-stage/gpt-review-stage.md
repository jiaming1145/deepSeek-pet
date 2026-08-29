# GPT adversarial review — packages/stage (job j2-k3vi, gpt-5.6, effort high, 2026-08-29)

Files reviewed: packages/stage/src/{companion-model,stage,view,mouth,character,ticker,textures}.ts, characters/haru/character.json.

VERDICT: block | major:5 minor:3

## Major

1. **`textures.ts loadTexture`: exceptions inside `img.onload` are not caught by the Promise executor.** Concrete case: cross-origin texture — character.json loads via CORS but `Image` has no `crossOrigin`, so `texImage2D` throws `SecurityError`; the Promise stays pending forever, the created `WebGLTexture` leaks, and `CompanionModel.load` never reaches its failure cleanup. → Set `img.crossOrigin = 'anonymous'` before `src`; wrap the whole onload upload path in try/catch; if a texture was created, unbind + delete before rejecting; restore pixel-store state in the same finally.

2. **`CompanionModel.startMotion` stores the finished callback on the shared preloaded `ACubismMotion`, not on the queue entry.** Force-restarting the same motion while its previous entry fades out overwrites the first callback (lost) and the second can fire for both entries; a restart with no callback can erase the pending one. → Don't mutate the shared motion's handler per playback. Associate `onFinished` with the handle returned by `startMotionPriority` and detect completion via the manager's handle-specific completion API; invoke each closure exactly once; defer invocation until outside the manager update so callbacks can't re-enter/dispose during `updateMotion`.

3. **`CompanionModel.release` is not idempotent** though callable independently of `Live2DStage.dispose`. Twice, or `model.release()` then `stage.dispose()`, calls `scheduler.release` and `CubismUserModel.release` twice (the latter treated elsewhere as non-idempotent; can dereference released managers/renderer). → Private `released` flag set before cleanup begins; return on subsequent calls.

4. **Disposal never releases/clears preloaded motions and expressions.** `CubismUserModel` does not own these maps; motions started with `autoDelete=false`. A retained disposed stage keeps all curve data; repeated character replacement accumulates. → After manager shutdown, release each unique motion/expression via the Framework's motion disposer/release, clear both maps; part of the idempotent release path; must work after partial setup failure.

5. **`Ticker.start` loop: a throwing frame callback exits the loop with `running` still true** (e.g. a custom `MouthDriver` throwing from `update`). Ticker permanently wedged — `start()` is a no-op. → Catch callback failures, set `running=false` and `raf=0` before propagating/reporting.

## Minor

6. **`Live2DStage.resize`/`frame`: `setWidth(2)` permanently mutates the model matrix in the portrait fit-by-width branch; the non-fit branch never restores the `setupFromLayout` baseline.** A wider-than-tall native canvas without a Layout Width, resized portrait→landscape, stays at portrait scale (too small). → Snapshot the post-`setupFromLayout` matrix and restore before applying fit on every fit-state change; don't use `setHeight(2)` as a generic reset (discards model3 Layout width/height).

7. **`beginFrameProcess`/`endFrameProcess` not paired with try/finally** in `frame`. A throw after begin leaves the offscreen manager mid-frame and stale render textures unreleased. → try/finally: call `endFrameProcess` + `releaseStaleRenderTextures` when begin succeeded.

8. **`Ticker` synchronous `stop(); start()` from inside the frame callback creates two rAF pumps** (start schedules one; the old loop schedules another after the callback returns; only one ID tracked). Trigger: a motion-finished callback re-entering stage lifecycle. → Monotonic generation token captured per loop; increment on stop/start; a loop schedules its successor only if its generation is current.

## Tests GPT wants

- `loadTexture` rejects, deletes the texture, settles when `texImage2D` throws `SecurityError`; `crossOrigin` assigned before `src`.
- Restart the same `ACubismMotion` before its previous entry finishes; both `onFinished` callbacks fire once each for their own handle.
- `CompanionModel.release` twice; `model.release` then `Live2DStage.dispose` — both harmless.
- Dispose a retained model after loading motions/expressions; release methods run once; maps emptied.
- Non-square native canvas, no Layout Width; resize portrait then landscape; matrix returns to post-layout baseline.
- Ticker callback throws → `running` cleared; later `start` creates one working pump.
- `stop` then `start` synchronously from a callback → one current-generation pump.
- `model.tick`/`MouthDriver` throws after `beginFrameProcess` → `endFrameProcess` still runs.

Notes: an exception in an async DOM event handler is not converted to a Promise rejection automatically — hence #1. For #2, wrapping the shared handler doesn't fix ownership; completion must be keyed by queue-entry handle (smaller change than distinct motion objects per playback).
