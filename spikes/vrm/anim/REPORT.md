# REPORT — animation sources for the 3D (VRM) pet

Directory: `D:\ds\spikes\vrm\anim\` (only files inside it were written). Date: 2026-09-02.
Status: DONE with owner steps outstanding (two free-but-login-gated sources).

## Plain summary

We now have a licence-clean, downloaded motion library that already animates a VRM correctly:
Quaternius' Universal Animation Library (CC0, 45 usable clips incl. idle, walk, jog, sprint,
jump start/loop/land, sit enter/idle/exit, dance, interact, pick-up, hit reactions, roll, a
lie-on-back "death"), plus the loaders/retargeter the runtime spike imports and a Node test that
proves the retargeting maths to 0.03 deg. Two more free sources need the owner's login: VRoid's
official 7-clip `.vrma` pack (BOOTH) and Mixamo (Adobe) for wave/eat/drink/sleep/stretch/climb;
both are documented as instruction cards. 7 of 17 vocabulary actions are covered right now,
7 wait on the owner downloads, 3 stay procedural by design.

## What was delivered

| item | path |
|---|---|
| CC0 clip library (46 clips, one GLB) + licence | `quaternius/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb`, `.../License.txt` |
| `.vrma` fixture (MIT) | `vrma/three-vrm_test.vrma` |
| Provenance + licences, rejected sources, owner steps | `SOURCES.md` |
| Mixamo owner card (25 search strings, export settings, licence in plain words) | `OWNER_CARD_mixamo.md`, drop folder `mixamo/` |
| Retarget/loader ES modules | `retarget/index.js` -> `retargetToVRM.js`, `loadMixamoAnimation.js` (port of three-vrm's example), `mixamoVRMRigMap.js` (verbatim MIT), `quaterniusVRMRigMap.js`, `loadQuaterniusAnimations.js`, `loadVRMAnimation.js` (`@pixiv/three-vrm-animation`) |
| Node smoke test + inspector | `retarget/smoke.mjs`, `retarget/inspect-file.mjs` (+ `node-env.mjs`, `node-vrm.mjs` shims) |
| Action -> clip map | `ACTION_CLIPS.json` |
| Electron visual proof | `preview/index.html`, `preview/main.cjs`, `preview/shots/*.png` (25 screenshots) |
| Usage docs | `README.md` |
| Local deps (not committed) | `package.json`, `pnpm-lock.yaml`, `node_modules/` (`pnpm install --ignore-workspace`: three 0.185.1, @pixiv/three-vrm* 3.5.5, jsdom 30.0.1); `.gitignore` covers `node_modules/` and `mixamo/*.fbx` |

## Verified (ran it)

1. Node smoke test: `cd D:\ds\spikes\vrm\anim && node retarget/smoke.mjs` -> exit 0, `ALL CHECKS PASSED`:

```
three 185, node v24.17.0
PASS  loaded VRM VRM1_Constraint_Twist_Sample.vrm (metaVersion 1, hips rest y=0.908)
PASS  vrma three-vrm_test.vrma: duration=3.000s tracks=3 (rot 1, hipsPos 0, expression 1, lookAt 1)
PASS  quaternius: retargeted 45 clips (source 46 incl. A_TPose)
PASS  quaternius Idle_Loop: duration=2.500s tracks=53 (rot 52, hipsScale 0.9906, unmapped=[root])
PASS  quaternius Walk_Loop: duration=1.333s tracks=53 (rot 52, hipsScale 0.9906, unmapped=[root])
... (Jog_Fwd_Loop, Jump_Start/Loop/Land, Sitting_Enter/Idle_Loop, Dance_Loop, Interact, PickUp_Table, Hit_Chest, Roll, Death01: all 53 tracks)
PASS  quaternius Walk_Loop: normalized-bone world rotation == source delta, max err 0.0301 deg (leftThumbDistal)
PASS  quaternius Sitting_Idle_Loop: normalized-bone world rotation == source delta, max err 0.0325 deg (rightThumbProximal)
PASS  mixamo(synthetic): tracks=5 (rot 4, hips pos 1), hipsScale=0.00927 (src hips 98 cm -> vrm 0.908 m)
PASS  mixamo(synthetic): normalized-bone world rotation == source delta, max err 0.0006 deg
PASS  mixamo(synthetic): hips y at t=0 is 0.9081 m == VRM rest hips height
INFO  no .fbx in anim/mixamo yet (owner step, see OWNER_CARD_mixamo.md) - real-FBX check skipped
PASS  playing three-vrm_test.vrma through AnimationMixer(vrm.scene) writes the normalized bones
```

The "world rotation == source delta" checks pose the source rig and the VRM independently with
an `AnimationMixer` at three sample times and compare every mapped bone's world quaternion;
that is the correctness proof of the retarget maths, not just "it produced tracks".

2. Electron render: `cd D:\ds\apps\desktop && npx electron ../../spikes/vrm/anim/preview/main.cjs --capture`
(transparent, frameless, always-on-top window, same flags as the pet) captured 25 PNGs into
`preview/shots/`. Viewed and described honestly:

- `quaternius_Walk_Loop_1.png`: mid-stride, one foot planted on the grid line, opposite arm
  swinging; body upright, facing camera, feet at floor height (hips scale 0.99 is right).
- `quaternius_Idle_Loop_0.png`: relaxed stance, weight on one leg, hands loose. Correct.
- `quaternius_Sitting_Idle_Loop_0.png`: seated pose, knees bent, hands on thighs; hovering at
  chair height with no chair (expected; the runtime pins hips to the sensed edge).
- `quaternius_Death01_1.png`: lying on her back, legs up mid-fall. Works as a lie-down pose.
- `vrma_three-vrm_test_0.png`: T-pose with a small head turn; the fixture only animates the
  head, expression and lookAt, so this is the expected picture.
- No limb inversions, no A-pose offset (the `A_TPose` reference clip handled Rigify's A-pose
  bind), no candy-wrapper twists visible at the sampled frames.

3. Bone inventory: `node retarget/inspect-file.mjs "quaternius/.../AnimationLibrary_Godot_Standard.glb"`
printed 53 bones (`root`, `DEF-hips`, `DEF-spine001..003`, `DEF-neck`, `DEF-head`, full 15-finger
hands, legs with toes) and the 46 clip names/durations that `ACTION_CLIPS.json` lists.

## How the retargeting works (for the runtime-spike builder)

`retargetToVRM.js` is three-vrm's `loadMixamoAnimation` algorithm made rig-agnostic:
`q' = parentRestWorld * q * inverse(restWorld)` per rotation track, applied to VRM's
normalized (identity-rest, T-pose) bones, hips translation scaled by
`vrm.humanoid.normalizedRestPose.hips.position[1] / sourceHipsRestHeight`, VRM 0.x x/z flip.
Three deliberate deviations from the sample, all in comments:

1. Only the hips translation track is kept (VRMA spec allows translation on hips only;
   copying other bones' local positions onto a different-proportion VRM shears it). Opt-in
   `keepNonHipsTranslation`.
2. Scale tracks are dropped.
3. Hips height and translation are measured in the source root's frame using the hips
   parent's rest matrix, not `hips.position.y`. Identical for Mixamo (identity parent); required
   for Rigify/glTF where hips sit under a rotated `root` bone (the naive version gave scale 18.1).

Plus `restPoseClip`: for rigs whose bind pose is not a T-pose, the first frame of a supplied
clip becomes the reference pose (Quaternius ships `A_TPose`). The induction
`T_i = W_i * inverse(R_i)` holds for any consistent reference, so the result stays exact.

`loadMixamoAnimation(url, vrm)` keeps the sample's signature and behaviour (clip `mixamo.com`,
FBXLoader, bind-pose rest, hips normalisation). It could not be exercised on a real FBX because
Mixamo needs an Adobe login; the code path is covered by a synthetic `mixamorig*` T-pose rig
with a 1 s clip (hips bob/translate, arm swing, neck turn, leg swing): the maths check passed
at 0.0006 deg, and the hips track came out at exactly the VRM rest height. The first real FBX
the owner drops in `mixamo/` is picked up automatically by `smoke.mjs` and the preview.

## Coverage vs docs/ACTION_VOCABULARY.md (see ACTION_CLIPS.json)

| status | actions |
|---|---|
| covered now (CC0, in tree) | idle, walk, hop, sit, celebrate (+ run, dance, jump, fall as extras); recover has a stopgap (`Jump_Land` tail), sleep has a crude stopgap (`Death01` end pose) |
| owner download needed | wave (VRoid `VRMA_02` or Mixamo `Waving`), eat, drink, sleep, wake, stretch, climb (Mixamo) |
| procedural by design | stumble, reach, inspect, tail_react (Quaternius `Hit_Chest`/`Hit_Head`/`Interact` listed as blend references) |

Not found anywhere licence-clean: a native `.vrma` idle/walk pack. Every public `.vrma`
repository hit was a Mixamo conversion (not redistributable); the VRM consortium's spec repo has
no `.vrma` samples. `.vrma` therefore covers only the VRoid 7-pack (owner) and the fixture; the
bulk of coverage is glTF (Quaternius) retargeted at load time, which three-vrm plays just as
natively via `AnimationMixer` on `vrm.scene`.

## Owner actions

1. VRoid 7-pack (5 min): log in at https://vroid.booth.pm/items/5512385 -> Free Download ->
   unzip -> copy `VRMA_01.vrma ... VRMA_07.vrma` into `D:\ds\spikes\vrm\anim\vrma\` -> run
   `node retarget/smoke.mjs` in `anim/`. Credit line for the app: "Character animation credits
   to pixiv Inc.'s VRoid Project".
2. Mixamo (25 min): follow `OWNER_CARD_mixamo.md` (Adobe ID, 25 clips, FBX Binary / Without
   Skin / 30 fps / no keyframe reduction, save to `anim/mixamo/<name>.fbx`), then the same smoke
   + preview commands.

## Concerns / notes for the controller

- `anim/` is 19 MB without `node_modules`: the VRM sample (10.8 MB) duplicates
  `spikes/vrm/models/VRM1_Constraint_Twist_Sample.vrm`; the GLB is 6.7 MB; screenshots 2.4 MB.
  If size matters, gitignore `testdata/` and point `smoke.mjs`/`preview` at `../models/`.
- Deps were installed into `anim/` only (`pnpm install --ignore-workspace`) to avoid touching
  the desktop lockfile while another agent works on it. The runtime spike must resolve the
  loaders' bare imports to one three instance (importmap in `README.md`).
- Quaternius clips are stylised human proportions; on a chibi with short arms the hands may
  intersect the body in `Sitting_*`/`Interact`. Retargeting is rotation-only, so this is
  expected and is what the procedural IK/hand-offset layer is for.
- `Death01` as a sleep stopgap is visibly a fall; `sleep`/`wake` really want the Mixamo pair.
- Mixamo clip titles in the owner card are search strings, not guaranteed exact titles; the
  card tells the owner to pick by preview.
- No `docs/DECISIONS.md` edits, no git operations, nothing written outside `anim/`.
