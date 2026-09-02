# VRM runtime spike - unify pass (2026-09-01)

**Repo** D:\ds, **dir** `spikes/vrm/`. **Task** close VERIFY.md gap 2 / next-step 4: one runtime, one three
instance, the shared `anim/retarget/` loaders instead of the spike's private `lib/` copy, real clips with
crossfades instead of the procedural wave, a head-turn look-at layer, and a walk-across-the-window demo.
All proven on the stock `VRM1_Constraint_Twist_Sample.vrm` (pixiv) + Quaternius CC0 clips; Whale-chan's
GLB does not exist yet.

Evidence: `evidence/sheet_motion.png` (8 rows x 5), `evidence/sheet_face.png`, raw 960x1350 RGBA captures
in `shots/`, numbers in `shots/report.json`. Every number below is copied from those files or from a
command's output in this session. Everything marked **verified** was run or viewed here.

## Verdict (short)

Done and verified. The page imports `./anim/retarget/index.js` and nothing else for clips; the import map
routes `three`, `three/addons/` and `three/examples/jsm/` to the one copy in `apps/desktop/node_modules`
(`THREE.REVISION` 185 reported by the page), and `lib/` is deleted with the unit tests re-pointed at the
shared loader (5/5 pass). Nine Quaternius clips retarget in 56 ms at startup (52/52 bones mapped, only
`root` unmapped, by design). Idle / walk / sit / jump / "wave" (Interact) all play through one
`AnimationMixer` with crossfades (a logged midpoint has Idle 0.542 / Walk 0.458). The head turns: measured
head direction lands within 0.5 deg of the clamped target in all four directions while the idle clip plays.
The walk-across demo moves the root at the clip's own planted-foot speed (0.989 m/s, measured from the clip),
turning +-90 deg to face travel, and the side-view frames show a real stride. Still 60.0 fps vsync-locked,
idle and walking, ~26 % of one core for all Electron processes.

Two things I got wrong on the way and fixed, both worth carrying into the real pet (details below):
`resetNormalizedPose()` every frame silently breaks three's `AnimationMixer` for constant-valued tracks,
and an additive head-turn is not a look-at when the clip already poses the head.

## What changed (files, all inside `spikes/vrm/`)

| file | change |
|---|---|
| `index.html` | import map + `three/examples/jsm/` mapping; imports `loadQuaterniusAnimations`, `loadVRMAnimation`, `loadMixamoAnimation`, `attachLookAtProxy` from `./anim/retarget/index.js`; clip library + `play()` crossfade API + one-shot chaining on the mixer's `finished` event; action vocabulary (`idle walk sit stand jump wave`); head-turn layer; walk-across demo with clip-speed measurement; pose snapshot/restore around the mixer; probes for `--eval` (`head`, `clipState`, `mixerWeights`, `walkState`, `clipSpeed`, `trackInfo`, `knee`, `probe`); procedural wave removed |
| `main.js` | capture script extended (clip shots, crossfade midpoint, sit/jump/Interact, head-turn shots with logged angles, walk-across frames polled from `walkState()`, 4 s walking perf window); new `--eval <file>` mode; renderer console forwarding |
| `test/mixamo.test.mjs`, `test/resolve-three.mjs` | tests import `convertMixamoAsset` from `../anim/retarget/loadMixamoAnimation.js`; the Node resolve hook now also maps `three/examples/jsm/` and `@pixiv/three-vrm*` to `apps/desktop/node_modules` |
| `lib/` | **deleted** (`loadMixamoAnimation.js`, `mixamoVRMRigMap.js`); nothing references it (`grep -rn "lib/"` over index.html/main.js/test: no hits) |
| `make_sheet.py`, `evidence/sheet_motion.png`, `evidence/sheet_face.png` | new rows: clips, crossfade, head-turn (with an eyes-only comparison tile), walk-across |
| `README.md` | rewritten for the unified runtime; frame order and the mixer gotcha documented |

Not touched: `anim/` (no loader lacked an export; nothing added there), `models/`, `clips/`. Files that
appeared in `spikes/vrm/` from another agent during this session and were left alone: `actions/`,
`face_check.html`, `face_check_main.js`, and a modification to `anim/OWNER_CARD_mixamo.md`.

## 1. One three instance, shared loaders - verified

- `index.html` import map: `three`, `three/addons/`, `three/examples/jsm/` -> `../../apps/desktop/node_modules/three/...`;
  `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` -> the apps/desktop copies. `@pixiv/three-vrm-core` is NOT
  mapped on purpose: both pixiv modules bundle it (grepping `from "..."` in both `.module.js` files prints
  only `from "three"`), no file in `anim/retarget/` imports it, and mapping it would pull a second copy of
  the core classes. `lab.info().threeRevision` = `"185"`.
- Startup log (`ready {...}`): `clips: [quaternius:Idle_Loop, Interact, Jump_Land, Jump_Loop, Jump_Start, Sitting_Enter, Sitting_Exit, Sitting_Idle_Loop, Walk_Loop]`,
  `clipLoad.quaternius: { ms: 56, tracks: 53, retarget: { mapped: 52, unmapped: ["root"], droppedTranslation: 51, droppedScale: 52, hipsPositionScale: 0.9906 } }`.
- VRMA through `loadVRMAnimation`: `{ duration: 3, tracks: 3 }`; Mixamo through `loadMixamoAnimation`:
  `{ duration: 18.2, tracks: 53 }` (SambaDancing). `attachLookAtProxy(vrm)` is called once after load.
- Unit tests: `node --import ./test/register.mjs --test test/mixamo.test.mjs` -> `tests 5, pass 5, fail 0`
  (after deleting `lib/`). The adapter maps the shared loader's `clip.userData.retarget` stats
  (`mapped` is now a count of rotation tracks, `unmapped` a list of node names) onto the old assertions;
  the maths assertions (rest-rotation bake-out, hips scale 0.01, VRM0 x/z flip, input not mutated) are
  unchanged and pass against the shared code.

## 2. Clip route with crossfades - verified

Sheet rows 1, 3-5. `Idle_Loop` is the default state (weight shift, relaxed arms, fisted hands - the
Quaternius rig closes the fingers, which removes the T-pose "paddle hands" of the first pass).
`Walk_Loop` in place: three stride phases, foot lifted at t=0.55. Crossfade midpoint walk->idle with a 0.8 s
fade, shot at 0.38 s: `mixerWeights = { Idle_Loop: 0.542, Walk_Loop: 0.458 }` and the tile is a genuine
in-between (one foot still trailing). Sit: `Sitting_Enter` mid-crouch, then `Sitting_Idle_Loop` seated at
chair height (knees 81 deg, hips y 0.536 vs 0.908 standing; `lab.knee()` samples in the probe log) with
hands on the thighs - there is no chair, she sits on air, as ACTION_CLIPS.json warns. Jump:
`Jump_Start` -> `Jump_Land` -> `Idle_Loop` chained on `finished`; `report.json clips.shots.jump` shows
`Jump_Land` running with `queued: Idle_Loop`. Honest note: Jump_Start spreads the arms wide (sky-dive
pose) - that is the clip, the anim builder's own preview of Jump_Loop shows the same.

"Wave": Quaternius Standard has no Wave clip (`quaternius_clip_inventory` in ACTION_CLIPS.json; the
real wave is the owner's VRoid `VRMA_02` or Mixamo `wave.fbx`). Per the task I used `Interact`
(2 s, one-shot, then crossfade back to idle; `afterWave.name = quaternius:Idle_Loop`). Viewed: t=0.8 s
raises the right hand to shoulder height, palm open - reads as a small greeting; t=1.2 s is a reach
forward. It is a reach, not a wave; it just looks better than the procedural salute it replaces.

Procedural layers on top of clips, verified in the same captures: breathing (additive spine/chest/neck
rotation), blink and visemes (face sheet row 1), expressions (row 2), spring bones (`springAfter` x
samples move by 4-7 cm after the nudge and settle), hop (squash/stretch on the root while Idle_Loop
plays), IK reach (hand error 0.0002 m on the three reachable targets, 0.2001 m on the clamped
out-of-range one - measured inside the frame, after IK, before the pose restore).

## 3. Head-turn look-at - verified, closed-loop

`headTurn(dt)` runs after the clip and the other layers, before `vrm.update`. Each frame it measures the
head's forward axis and the hips' forward axis in the model root's frame (so it stays right while the model
walks sideways), clamps the target yaw to +-40 deg **from the body's own facing** and pitch to +22/-28,
smooths the residual (tau 120 ms), splits it head 60 / neck 25 / upper chest 15 %, then applies one
correction step on the head bone so the head's forward axis lands on the target even though the chain
rotations are not exactly additive. The eyes still track through `vrm.lookAt`.

`report.json head` (Idle_Loop playing; the clip itself stands with the body yawed -13.3 deg and the head
pitched -11..-15 deg - `clipHead*` columns):

| dir | target yaw / pitch | measured head yaw / pitch | clip head yaw / pitch (before the layer) |
|---|---|---|---|
| left | -43.6 / 4.2 | **-43.5 / 3.8** | -1.9 / -14.9 |
| right | 26.7 / 4.3 | **26.5 / 4.7** | -2.1 / -10.9 |
| up | 0 / 22 | **0.2 / 22.5** | -1.9 / -14.6 |
| down | -0.4 / -28 | **-0.5 / -28.1** | -2.1 / -11.1 |
| left, layer off | - | -2.1 / -13.5 | (eyes only) |

Left/right are asymmetric on purpose: the clamp is relative to the body, and Idle_Loop stands turned
-13 deg, so "left" may go to -43 and "right" only to +27. Viewed (`sheet_face.png` row 3 and
`sheet_motion.png` row 2): the head visibly turns with the jaw line and far cheek appearing on left/right,
the chin lifts on up, the hair falls forward on down; the eyes-only tile beside them shows the difference.
While walking (probe2 log): targets +-38 deg -> measured +-37.8.

First version was additive (rotate head by the target angle) and was wrong in two ways I could measure:
with the clip's -11 deg head pitch, "up" only reached +10 deg world pitch, and the capture's "up" shot
had a -27.6 deg yaw because a stray mouse event overrode the scripted look (Chromium synthesises
`mousemove` after layout changes when the cursor sits over the window). Fixed by the closed-loop version
above and by `lab.look(x, y)` locking out real mouse moves until `lab.look(null)`.

## 4. Walk across the window - verified

`lab.walk()`: turns to +90 deg (facing +X = screen right), walks to x = +0.447 m (visible half-width
0.747 m at the model's depth minus a 0.30 m margin), turns to -90, walks to -0.447, turns to +90, walks
back to 0, turns to face the camera, crossfades to Idle_Loop. Turn rate 90 deg / 0.35 s. Root speed is
measured from the clip, not guessed: `clipSpeed('quaternius:Walk_Loop')` samples both feet over one loop on
a scratch mixer and takes the median backward velocity of the planted foot ->
`{ speed: 0.989 m/s, plantedSamples: 48, strideM: 1.319 }`. The task's "three frames" are five in the
sheet (row 6): -> right edge (x 0.264, yaw 90), turning at the edge (x 0.447, yaw 12.9 mid-turn),
<- to the left edge (x -0.18, yaw -90), -> back to centre (x -0.134, yaw 90), turning to face the camera
(x 0, yaw 81.4, Idle_Loop fading in at weight 0.19). Viewed: true side views with the hair trailing
behind the direction of travel and a full stride; the mid-turn frames are 3/4 views. Foot slide cannot
be judged from stills; the speed match is by construction only.

## 5. The mixer gotcha (found, fixed, documented)

Symptom: `Sitting_Idle_Loop` rendered as a standing figure with seated hands and hair flung upward, while
the anim builder's preview showed it seated. Probe (`lab.knee()` over time): the action was at weight 1.0
and the clip's own knee track is a constant 81.2 deg (`lab.trackInfo`), yet the bones read 0 deg and hips
alternated 0.908 / 0.536 between frames. Cause: three's `PropertyMixer.apply()` only calls `setValue`
when the blended value differs from the value it wrote last time; my frame loop called
`humanoid.resetNormalizedPose()` before every `mixer.update`, so constant tracks were written once and
then wiped every frame. Idle/Walk only worked because every key differs. Fix in `index.html`: no reset
while a clip plays; instead `mixer.update -> savePose()` (all 54 humanoid normalized bones, rotation +
position) `-> layers -> render -> restorePose()`, so the bones always hold exactly what the mixer last
wrote. After the fix the same probe reads knees 86.9 / 81.2 / 79.5 deg and hips 0.536 at every sample,
through the `Sitting_Enter -> Sitting_Idle_Loop` crossfade as well. Side effect handled: probes that
used to read bones between frames (`ikError`, `head`) now report values measured inside the frame.

## Measurements (`shots/report.json perf`, last run)

- Idle (Idle_Loop clip + blink + look + head-turn + HUD), 5.9 s: **60.13 fps**, avg 16.67 ms, p95 16.8, max 16.9.
- Walking across (root motion + Walk_Loop + head-turn + springs), 4.0 s: **60.11 fps**, avg 16.67 ms, p95 16.8, max 16.9.
- CPU, `Get-Process electron` TotalProcessorTime delta over the 5 s idle window: **0.26 core = 26.1 % of one core =
  1.3 % of the 20-thread machine**, all Electron processes summed (first pass: 20-23 %; one run this
  session read 34.7 %, another 22 %: the number is noisy at this scale and includes any other electron.exe).
- GPU (`nvidia-smi`, 1 Hz, system-wide): 9-14 % (first pass reported 3-4 %; other GPU users were running on
  the desktop this session, so I cannot attribute the difference to the runtime).
- Memory: renderer 244 MB, GPU process 125 MB, main 94 MB.
- Transparency unchanged: `idle_0.png` 960x1350 RGBA, corner alpha 0/0, 86.9 % fully transparent
  (PIL); `desktop_composite.png` is a real `CopyFromScreen` with a browser window behind the model.

## Commands run (evidence)

```
node --import ./test/register.mjs --test test/mixamo.test.mjs      (spikes/vrm)  -> tests 5, pass 5, fail 0   (before and after rm -rf lib)
npx electron ../../spikes/vrm/main.js                               (apps/desktop) -> ready {... threeRevision:"185", clips:[9], clipLoad.ms:61}
npx electron ../../spikes/vrm/main.js --eval <probe1..4.js>         (apps/desktop) -> head/knee/track probes (scratchpad logs); exit 0
npx electron ../../spikes/vrm/main.js --capture                     (apps/desktop) -> exit 0, error null, 68 PNGs + report.json
python make_sheet.py                                                (spikes/vrm)   -> sheet_motion.png (1600x3634), sheet_face.png (1800x1054)
node <scratch>/inspect_sit.mjs                                      (spikes/vrm/anim) -> Quaternius tracks: LinearInterpolant, 30 fps keys
```

## What is NOT done / caveats

- No real wave clip: `Interact` is a stand-in. The owner steps (VRoid VRMA_02, Mixamo wave.fbx) are unchanged.
- Sit has no chair/edge: hips height is the clip's; the pet must override it from the sensed edge.
- Jump uses the clip as-is (arms wide); a hop for the pet is probably still the procedural one (`H`).
- Foot slide during the walk-across is matched by measured speed only; not verified frame by frame.
- Head-turn clamps are hand-picked for this adult model; a chibi will want a smaller pitch range.
- Finger-curl hand pose (VERIFY next-step 4, second half) was not done: the Quaternius clips already
  close the hands, and the task list did not include it.
- `git status` for `spikes/vrm/`: `M index.html main.js make_sheet.py README.md test/*, evidence/*.png; D lib/*`.
  Nothing committed (per the rules). Files from other agents inside `spikes/vrm/` (`actions/`,
  `face_check*.js|html`, `anim/OWNER_CARD_mixamo.md`) were not touched.
- Lesson for the memory file (not written, outside my assigned directories): "three AnimationMixer +
  per-frame resetNormalizedPose = constant tracks vanish; snapshot/restore instead."
