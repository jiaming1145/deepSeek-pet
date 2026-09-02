# actions/ — the action layer for the VRM pet (standalone spike)

`ActionController.js` turns the vocabulary in `docs/ACTION_VOCABULARY.md` into motion on a loaded
three-vrm VRM: clip actions through an `AnimationMixer` (crossfades, loop policies, segment
sequences), procedural actions computed every frame (two-bone IK, springs, look-at), and the nine
`@ds/protocol` emotions as smooth expression blends. Lanes are data, not a dependency on the pet's
arbiter. Evidence: `evidence/sheet_actions.png`, `evidence/sheet_emotions.png`, `shots/report.json`;
honest notes in `REPORT.md`.

## Run

```
cd D:\ds\apps\desktop
npx electron ../../spikes/vrm/actions/main.js              # interactive window (keys on the HUD)
npx electron ../../spikes/vrm/actions/main.js --capture    # every action at 20/50/80 % + every emotion -> shots/, report.json
python ../../spikes/vrm/actions/make_sheet.py              # -> evidence/sheet_actions.png, sheet_emotions.png
```

`lab.html?vrm=<url>` loads another model (the owner's generated VRM later). Dependencies are the
ones in `apps/desktop/node_modules` (three 0.185.1, @pixiv/three-vrm 3.5.5, three-vrm-animation
3.5.5); the import map also maps `three/examples/jsm/` so the shared loaders in
`../anim/retarget/index.js` resolve to the **same** three instance as the VRM (VERIFY.md gap 2).

Keys: `1-9` emotions (neutral happy sad angry think surprised awkward question curious) ·
`I` idle `W` walk `H` hop `S` sit `Z` sleep `K` wake `X` stretch `U` stumble `R` reach->mouse
`N` inspect->mouse `V` wave `E` eat `D` drink `C` celebrate `T` tail_react `L` cycle look pattern
`Space` stop `G` HUD · mouse = cursor for the `follow / cursorLock / away / edge` gaze patterns.

## API

```js
import { ActionController, ACTIONS, EMOTIONS, LOOK_PATTERNS, EMOTION_RECIPES, WAVE } from './ActionController.js';

const ac = new ActionController(vrm, {
  library,          // { quaternius: Map<name, AnimationClip>, vrma: Map<file, clip>, mixamo: Map<file, clip> } retargeted to `vrm`
  manifest,         // anim/ACTION_CLIPS.json (optional; see "upgrade path")
  scene,            // where the look-at target and props live (default vrm.scene.parent)
  updateVRM: true,  // call vrm.update(dt) at the end of update(); set false if the host does it
  emotionRecipes,   // optional overrides / additions to EMOTION_RECIPES
});

ac.start(name, opts)      // -> { name, duration|null, source }   duration null = open-ended
ac.stop()                 // body -> idle (sit plays Sitting_Exit first); ac.stop('gaze') resets the look pattern
ac.update(dt)             // once per frame, before renderer.render
ac.setEmotion(name, weight = 1)          // exclusive, ~250 ms crossfade; { additive: true } keeps the others
ac.setEmotionWeights({ happy: .5, curious: .5 })
ac.setCursor(nx, ny)      // -1..1 window coords, feeds the cursor-driven look patterns
ac.current / ac.lanesInUse / ac.snapshot() / ac.lastIK / ac.props
ActionController.lanesOf('eat')          // ['body', 'expression']  (data for the arbiter)
```

`opts` per action: `reach` / `inspect` need `target` (THREE.Vector3, world; `side: 'left'|'right'`
overrides the nearer-arm pick; `duration` in seconds, reach is open-ended by default) · `eat`
`{ prop: 'food'|'bowl', bites, hand }` · `drink` `{ prop: 'drink', sips }` · `sit` `{ seatHeight }`
(pins the normalized hips y to a sensed edge) · `stumble` `{ impulse: [x,y,z] }` · `tail_react`
`{ sign, strength, duration }` · `look` `{ pattern, target }` · any action `{ clip: 'quaternius:Name', loop }`
to force a library clip.

`update(dt)` runs a fixed stack: `resetNormalizedPose` → clip machine + mixer → breathing (damped
0.4x under an action, slow 1.4x while asleep) → procedural layers → gaze (neck 35 % + head 65 % of
the head share, eyes via `vrm.lookAt.target` for the rest) → emotion head posture → expression blend
(recipes + blink + visemes) → root offset/scale → `vrm.update(dt)`.

## Clip vs procedural (on the stock library: Quaternius CC0 + the three-vrm test .vrma)

| action | lanes | realised as | detail |
|---|---|---|---|
| idle | body | **clip** | `Idle_Loop` LoopRepeat; always the base under procedural actions |
| walk | body, gaze | clip | `Walk_Loop` LoopRepeat, in place (the window moves in the pet); gaze `none` |
| hop | body | clip + procedural | `Jump_Start` 0.1→1.0 s @1.4x, 0.42 s **flight hold** (root arc 0.20 m + 6 % stretch + leg tuck), `Jump_Land` @1.35x with a landing squash. Jump_Start's frame 0 is a stray landing pose, hence the 0.1 s start |
| sit | body, gaze | clip + procedural | `Sitting_Enter` once → `Sitting_Idle_Loop`; `stop()` plays `Sitting_Exit`; `seatHeight` pins the hips |
| sleep | body, expression, gaze | clip + procedural | no sleep clip in Quaternius: `Death01` from 0.4 s at 0.6x, clamped and held; blink 1, `relaxed` 0.6, slow breath |
| wake | body, expression | clip | `Death01` played **backwards** 2.4→0.4 s (1.38 s ≤ 1.5 s budget) + squint-open + head roll |
| stretch | body | **procedural** | both arms up (absolute pose, slerped over the clip by an envelope), spine/neck extension, 9 Hz tremble at the hold, 12 mm rise |
| stumble | body, expression | procedural | damped spring on the root from an impulse; hips/spine lean against the velocity, knee bend, arms flung; emotion `surprised`; auto → `recover` |
| recover | body, expression | clip | `Jump_Land` second half (0.5→1.267 s = 0.77 s ≤ 1.2 s), crouch-to-stand |
| reach(target) | body | procedural | two-bone analytic IK on the **nearer arm** (target x in model space), pole below/behind, fingers opened; IK error ≤ 0.3 mm in range (`report.json`) |
| inspect(target) | body, gaze | procedural | reach + spine yaw/pitch lean toward the target + gaze lock (head share 1.0); restores the previous gaze pattern when done |
| wave | body | procedural | right arm built from world directions (`WAVE` tunables): upper arm out/forward, forearm up swinging ±22° about the view axis at 2.4 Hz, −90° forearm twist so the palm faces the viewer, open fingers |
| eat(prop) | body, expression | procedural | apple prop parented to the normalized right-hand bone; hand IK cycles hold → mouth (bite: `aa` pulse) → hold (chew: `aa` 4.5 Hz); wrist turned toward the face |
| drink(prop) | body, expression | procedural | cup prop; IK to the mouth, head tips back 10° during the sip, `ou` viseme |
| celebrate | body, expression | clip + procedural | `Dance_Loop` × 3 reps, emotion `happy`, alternating spring impulses every 0.35 s (tail wag) |
| tail_react | body | procedural | Verlet impulse on spring joints named `*tail*` (fallback: all spring joints — the stock model has no tail, so the hair flares) + a decaying 4.5 Hz hip wiggle; overlay, does not interrupt the body action |
| look(pattern) | gaze | procedural | `follow wander cursorLock away down up edge none` (+ `point`): target on a plane 1.2 m in front, head share per pattern (0 / 0.5 / 0.6 / 0.75 / 0.85 / 1.0), neck 35 % + head 65 %, eyes take the rest |

**Upgrade path (data, no code):** actions whose `ACTION_CLIPS.json` status is `owner` (sleep, wake,
stretch, wave, eat, drink, recover) switch to their manifest **primary** clip as soon as the owner
drops the file into `anim/vrma/` or `anim/mixamo/` — `lab.js` tries to load every ref in the
manifest and skips the missing ones (`lab.info().library.missing`). `source` in `start()`'s return
value says which path was taken. Eat/drink keep their prop + chew layer on top ("A+P").

## Emotions

`setEmotion` blends the nine names into VRM expressions with per-expression exponential smoothing
(τ = 90 ms, ≈ 250 ms to settle). Recipes (`EMOTION_RECIPES`, overridable): `happy`=happy; `sad`=sad +
lookDown; `angry`=angry; `think`=relaxed .35 + lookUp .7 + lookLeft .4 + head tilt; `surprised`=
surprised + oh .25; `awkward`=happy .35 + sad .3 + lookDown/lookRight + ih; `question`=surprised .45
+ blinkLeft .6 + lookUp + oh; `curious`=surprised .4 + happy .3 + lookUp + ih. Each recipe also
carries a small head posture (pitch/yaw/roll in degrees). Custom names (`focused`, `shy`,
`confused`, `shocked`) are already in the recipes and are skipped when the model lacks them, so the
Whale-chan face kit plugs in without code. Blink and the chew/sip visemes compose on top.

## Gotchas found while building (worth keeping)

1. **three's `PropertyMixer.apply()` skips `setValue` when the blended value did not change since the
   previous frame.** With three-vrm's `resetNormalizedPose()` every frame, a clamped `LoopOnce`
   clip (hop flight hold, sleep hold, the first frames of wake) writes nothing and the model snaps to
   T-pose. `ActionController._forceApply()` re-applies every active binding after `mixer.update`.
   The first capture showed exactly this bug (hop 50 %, sleep 80 %, wake 20 % as T-poses).
2. Procedural arm actions set **absolute** quaternions in normalized space (T-pose = identity) and
   slerp from whatever the clip left, instead of multiplying deltas — a delta on top of an idle clip
   that already holds the arms down lands somewhere else on every clip.
3. Props go on the **normalized** hand bone (identity rest, bone along ±X), not the raw one, so the
   offset is model-independent.
4. Never crossfade a clip out into "nothing": the mixer blends toward the value captured at bind
   time (the T-pose). Procedural actions therefore keep a looping base clip running underneath.

## What still looks wrong on the sheet (see REPORT.md for the full list)

- `sit` floats at the clip's chair height (no seat); `sleep` is a slowed death fall, the lying body is
  small and partly outside the 640-wide window; `wake` is that fall in reverse.
- `stumble` reads only at 20 %; by 50 % the body is back to idle with a surprised face.
- `reach` still reads as "raise hand": the wrist does not aim at the target.
- The Quaternius idle keeps the fingers curled, so the whole character stands with fists; only wave /
  reach / inspect open the hand.
- The stock model has no tail: `tail_react` shows as hair flare + hip wiggle.
