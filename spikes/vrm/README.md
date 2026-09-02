# VRM runtime spike

A stock VRM 1.0 humanoid rendered with three.js + `@pixiv/three-vrm` inside the same kind of window
the pet uses (transparent, frameless, always-on-top, 640x900), driven by **one runtime**: one three
instance, one `AnimationMixer`, the shared retarget loaders in `anim/retarget/` (Quaternius glTF,
Mixamo FBX, VRMA), with the procedural layers stacked on top: breathing, cursor look-at with a
**head-turn layer** (head + neck + chest), blink, lip flap, expression crossfade, spring-bone physics,
two-bone IK reach, a squash-and-stretch hop, and a walk-across-the-window demo with root motion.
Results and honest notes: `REPORT.md` (first pass) and `REPORT_unify.md` (this pass); pictures:
`evidence/`.

## Run

Dependencies live in `apps/desktop` (`three@0.185.1`, `@pixiv/three-vrm@3.5.5`,
`@pixiv/three-vrm-animation@3.5.5`, installed with `pnpm add -D`). The page loads them through an
import map pointing at `../../apps/desktop/node_modules/...`, so no bundler and no network. The
import map maps `three`, `three/addons/` AND `three/examples/jsm/` (the specifier the shared loaders
use) to that single copy of three, so the page and `anim/retarget/` share one three instance.
`@pixiv/three-vrm-core` is deliberately not mapped: three-vrm and three-vrm-animation bundle it and
nothing in `anim/retarget/` imports it directly (mapping it would load a second copy of the classes).

```
cd D:\ds\apps\desktop
npx electron ../../spikes/vrm/main.js                  # interactive window, stays open
npx electron ../../spikes/vrm/main.js --capture        # scripted capture -> spikes/vrm/shots/, then exits
npx electron ../../spikes/vrm/main.js --eval x.js      # run an async snippet against the live window (js/wait/shoot), print JSON, exit
python ../../spikes/vrm/make_sheet.py                  # contact sheets -> spikes/vrm/evidence/
cd ..\..\spikes\vrm && node --import ./test/register.mjs --test test/mixamo.test.mjs   # unit tests (shared loader)
```

## Interactive controls (also printed on the HUD)

| key | action |
|---|---|
| mouse move | look-at follows the cursor: eyes via `vrm.lookAt`, plus the head-turn layer (head 60 / neck 25 / upper chest 15 %, yaw clamped to +-40 deg from the body, pitch +22/-28, ~120 ms smoothing) |
| `E` | toggle the head-turn layer (eyes keep tracking) |
| `1` `2` `3` `4` `5` | expression happy / angry / sad / relaxed / surprised (250 ms crossfade) |
| `0` | neutral |
| `B` | toggle auto blink |
| `T` | toggle lip flap (aa / ih / ou / ee / oh cycling) |
| `L` | toggle look-at |
| `I` | toggle idle breathing |
| `W` | "wave": plays Quaternius `Interact` once (one-arm reach forward; the library has no Wave clip), crossfades back to `Idle_Loop` |
| `J` | jump: `Jump_Start` -> `Jump_Land` -> `Idle_Loop` (one-shots chained on the mixer's `finished` event) |
| `S` | sit: `Sitting_Enter` -> `Sitting_Idle_Loop`; press again to stand: `Sitting_Exit` -> `Idle_Loop` |
| `K` | walk across the window: root motion + `Walk_Loop`, turning to face the travel direction, then back to the camera |
| `H` | squash-and-stretch hop (procedural, on top of whatever clip plays) |
| `N` | nudge the whole model sideways: hair/skirt spring bones react |
| `R` | IK-reach the right hand toward the cursor; `R` again releases |
| `A` | play the VRMA sample clip (`clips/test.vrma`) through `loadVRMAnimation` |
| `M` | play the Mixamo FBX (`clips/SambaDancing.fbx`) through `loadMixamoAnimation` |
| `Space` | stop all clips (procedural idle stance resumes); any action key starts the clip route again |
| `G` | toggle HUD |

The default state is the `Idle_Loop` clip; every clip change is a crossfade (0.15-0.35 s) on the
single `AnimationMixer`. `window.lab` exposes the same controls to `executeJavaScript`
(`lab.action('walk')`, `lab.clip('quaternius:Sitting_Idle_Loop', {fade: 0.5})`, `lab.walk()`,
`lab.head()`, `lab.clipSpeed('quaternius:Walk_Loop')`, `lab.stats()`, ...); `main.js --capture` is
the reference script.

## Per-frame order (carry this into the real pet)

```
mixer.update(dt)  ->  snapshot the clip pose  ->  [no clip: resetNormalizedPose + idle arm pose]
  -> breathing -> hop -> IK -> walk root motion -> head-turn look-at
  -> vrm.update(dt)  (eye look-at, expressions, spring bones, normalized->raw copy)
  -> render  ->  restore the clip-pose snapshot
```

Do NOT call `resetNormalizedPose()` every frame while a clip plays. three's `PropertyMixer` only
writes a bone when the blended value differs from what it wrote last time, so any track with a
constant value (`Sitting_Idle_Loop`'s knees and hips height, for example) is written once and never
again; a per-frame reset then leaves those bones at rest. The snapshot/restore keeps the bones equal
to what the mixer last wrote, so the mixer's cache stays truthful and the procedural layers still
start from a clean clip pose each frame. (`REPORT_unify.md` has the numbers.)

## Dropping in Mixamo clips

Download any Mixamo animation as **FBX Binary, "Without Skin"** (30 fps, no keyframe reduction is
fine) and put it in `spikes/vrm/anim/mixamo/` (see `anim/OWNER_CARD_mixamo.md` for the wanted
list). The capture script plays every `*.fbx` it finds there after the built-in test clip;
interactively, call `lab.play('mixamo', './anim/mixamo/<file>.fbx')`. The retarget is
`anim/retarget/loadMixamoAnimation.js` (three-vrm's official example generalised in
`retargetToVRM.js`): 52 `mixamorig*` joints -> VRM humanoid bones, rest rotations baked out, hips
translation scaled by the hips-height ratio so the clip fits a chibi as well as a 1.6 m adult.

## Layout

```
index.html        renderer: scene, VRM load, clip library + mixer, procedural layers, control surface, HUD
main.js           Electron harness (window like the pet) + capture script + --eval + perf sampling
test/             node:test for the retarget path, run against anim/retarget/ (resolve hook maps three + @pixiv to apps/desktop)
models/           VRM1_Constraint_Twist_Sample.vrm  (pixiv, VRM Public License 1.0)
clips/            test.vrma (three-vrm example, MIT repo), SambaDancing.fbx (from the three.js repo; Mixamo data - test only)
anim/             animation sources + shared loaders (see anim/README.md); anim/mixamo/ is the FBX drop folder
shots/            raw captures + report.json (regenerated by --capture)
evidence/         sheet_motion.png, sheet_face.png
make_sheet.py     builds the sheets (checkerboard behind the alpha)
```

`lib/` (the spike's private copy of the Mixamo loader) is gone; the shared loaders are the only
loaders.

## Licences of the test assets

- `models/VRM1_Constraint_Twist_Sample.vrm`: (c) 2022 pixiv Inc., VRM Public License 1.0
  (https://vrm.dev/licenses/1.0/); meta says redistribution and modification allowed, credit
  unnecessary. Test asset only; it is not Whale-chan.
- `anim/quaternius/...AnimationLibrary_Godot_Standard.glb`: Quaternius Universal Animation Library,
  CC0 1.0 (licence file next to it).
- `clips/test.vrma`: from the `pixiv/three-vrm` repository (MIT), `packages/three-vrm-animation/examples/models/test.vrma`.
- `clips/SambaDancing.fbx`: from the `mrdoob/three.js` repository examples. The repository is MIT
  but the file itself is Mixamo (Adobe) animation data; Adobe's Mixamo terms allow use in your own
  projects but the three.js README only explicitly licenses `nurbs.fbx`. Kept here only to exercise
  the loader; do not ship it with the pet.
- `anim/retarget/mixamoVRMRigMap.js`, `loadMixamoAnimation.js`: ported from `pixiv/three-vrm` (MIT).
