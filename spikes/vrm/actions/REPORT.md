# REPORT — actions layer spike (2026-09-01)

Scope: `D:\ds\spikes\vrm\actions\` (new; nothing outside it was touched, nothing committed).
Inputs: stock `spikes/vrm/models/VRM1_Constraint_Twist_Sample.vrm`, the Quaternius CC0 library and
`anim/vrma/three-vrm_test.vrma` via the shared loaders `anim/retarget/index.js`,
`anim/ACTION_CLIPS.json`, `docs/ACTION_VOCABULARY.md`, `@ds/protocol` `EMOTIONS`.

## Deliverables

| file | what |
|---|---|
| `ActionController.js` | the module: `start/stop/update/setEmotion`, 17 actions, 8 look patterns, 9 emotions, lanes as data (`ACTIONS`), props, IK, spring impulse, clip machine |
| `lab.html` + `lab.js` | renderer page (pet-style transparent window, same camera framing as `../index.html`), one import map for one three instance, `window.lab` control surface with deterministic stepping |
| `main.js` | Electron harness copied from `../main.js`; `--capture` writes `shots/` (48 action frames + 8 look + 10 emotion + HUD) and `shots/report.json` |
| `make_sheet.py` | `evidence/sheet_actions.png` (2000x2494) and `evidence/sheet_emotions.png` (2500x630) |
| `README.md` | API, clip-vs-procedural table, gotchas, known defects |

## Verified (ran it)

```
cd D:\ds\apps\desktop && npx electron ../../spikes/vrm/actions/main.js --capture
  ready {"library":{"quaternius":45,"vrma":["three-vrm_test.vrma"],"mixamo":[],"missing":[...29 owner refs...]}, ...}
  captured idle/walk/hop/sit/sleep/wake/stretch/stumble/recover/reach/inspect/wave/eat/drink/celebrate/tail_react
  perf {"idleFps":59.94,"busyFps":60.05,"p95Idle":16.8,"p95Busy":16.8}      exit=0, errors: []
python make_sheet.py   -> wrote sheet_actions.png (2000, 2494); wrote sheet_emotions.png (2500, 630)
```

- 68 files in `shots/` (8.8 MB), `report.json` has `errors: []`.
- Every action ran through the real clip machine: `report.json` frames show `Jump_Start -> Jump_Land`
  for hop, `Sitting_Enter -> Sitting_Idle_Loop` for sit, `Death01` at 0.98/1.85/2.4 s for sleep and
  1.99/1.39/0.78 s (reversed) for wake, `Dance_Loop` for celebrate, `Jump_Land` 0.5->1.27 s for recover,
  `Idle_Loop` under every procedural action.
- IK: reach (left arm, picked as the nearer arm for a target on the character's left) 0.0221 m at
  20 % (still easing in), 0.0002 m at 50/80 %; inspect (right arm) 0.0002 m; eat/drink 0.0003 m.
- Props: eat prop world position (0.022, 1.313, 0.083) at 80 % with the head joint at (0.001, 1.347,
  -0.075): 3 cm below and 16 cm in front of the head joint, i.e. at the face (the sheet shows the
  apple at the mouth).
- Spring impulse: first spring-child x samples 0.1435/0.0742/0.2243 at rest -> 0.2195/0.1717/0.2948
  50 ms after `tail_react` (hair strands displaced 5-10 cm; the stock model has no tail bone).
- Look patterns (head yaw/pitch, deg): follow -19.8/-7.8, cursorLock -33.1/-12.7, away +36.0/+1.2,
  down +2.4/+21.0, up 0/-19.6, edge -40.8/+6.0, none 0/0 - the head turn is real now (VERIFY.md
  refuted "eyes + head" for the first spike; here the neck+head bones turn and the eyes take the rest).
- Emotions: expression weights per emotion are in `report.json` (`surprised` = surprised 1 + oh .25;
  `question` = surprised .45 + blinkLeft .6 + lookUp .25 + oh .15; ...), and the face row of
  `sheet_emotions.png` shows nine distinct faces plus a real crossfade in-between at 70 ms.
- Perf (real rAF loop, 960x1350 @1.5 dpr): idle 59.9 fps avg 16.63 ms p95 16.8 ms; busy (eat with
  IK + prop + chew, wander gaze, happy) 60.05 fps avg 16.63 ms p95 16.8 ms, max 17.0 ms. Vsync-locked
  in both; headroom not measured. Process CPU from `getAppMetrics` over the busy window: GPU 0.8 %,
  renderer 0.7 % (per-process percentCPUUsage; renderer working set 264 MB).

## Bug found and fixed on the way (worth keeping)

The first capture showed T-poses at hop 50 %, sleep 80 % and wake 20 %. Root cause (verified with a
probe, not guessed): three's `PropertyMixer.apply()` only calls `binding.setValue` when the blended
value changed since the previous frame; a clamped `LoopOnce` clip produces the same value every
frame, so nothing is written while three-vrm's `resetNormalizedPose()` wipes the bones each frame.
`ActionController._forceApply()` re-applies every active binding after `mixer.update`. The second
capture shows the mid-air hop pose and the held lying pose.

## Viewed (the sheets, honestly)

`evidence/sheet_actions.png`, row by row:

- **idle / walk**: Idle_Loop weight shift, Walk_Loop mid-stride toward the viewer; walk is in place.
- **hop**: 20 % crouched wind-up with arms back, 50 % airborne with arms out and legs tucked
  (the flight hold over the clamped Jump_Start pose + root arc), 80 % deep landing crouch. Reads.
- **sit**: enter is a real squat-down, 50/80 % seated with hands on thighs - **floating at chair
  height with no chair**.
- **sleep**: 20 % still upright (the slowed fall has not started), 50/80 % lying on the floor, feet
  toward the camera, small, hair spread. It is a death animation slowed down; nothing about it says
  "sleep" except the closed eyes, which are too small to see at this size.
- **wake**: 20/50 % lying (50 % shifted to the left edge and partly cropped by the 640-px window),
  80 % crouch with one hand on the knee - reversed fall, reads as "getting up" only in the last frame.
- **stretch**: arms straight up, 50 % hands meeting overhead, back arched. Reads as a stretch.
- **stumble**: 20 % torso thrown to the side with hair flying and a surprised face; 50/80 % already
  back to an idle stance with the surprised face. Too short and too subtle.
- **recover**: 20 % head-down crouch, 50 % rising, 80 % standing. Reads as regaining balance but the
  crouch is deeper than a stumble warrants.
- **reach**: left arm raised with a bent elbow, open hand - the nearer-arm pick worked, but the pose
  reads as "raising a hand" rather than reaching, because the wrist does not aim at the target.
- **inspect**: leans and looks down at the right hand held low; 20 % has the lean before the arm
  arrives (awkward), 50/80 % read as examining something in the hand.
- **wave**: right arm out and up, elbow bent, open palm toward the viewer at all three frames
  (the swing is visible as the forearm angle). Reads as a wave now; the first draft folded behind the
  head and had a fist - fixed by building the arm from world directions and opening the fingers.
- **eat**: 20 % apple held at chest height, 50 % on its way up, 80 % at the mouth with the wrist
  turned. Reads; the mouth-open bite is small.
- **drink**: cup at the mouth (20 %), at the chest (50 %), back at the mouth (80 %). Reads.
- **celebrate**: Dance_Loop poses with the happy face and hair flying. Reads.
- **tail_react**: hair flared to the side and hips twisted at 20 %, settling by 80 %. On a model with
  a tail chain this is the tail; here it is the hair.
- **look row**: head clearly turned left (follow/cursorLock/edge, increasing), right (away), chin
  down (down), chin up (up), straight (none). wander is a random point (here left-down).

`evidence/sheet_emotions.png`: neutral, happy (closed smiling eyes), sad (droop), angry (brows),
think (eyes up-left, head tilt), surprised (round mouth, wide eyes), awkward (half-smile, looking
down-right), question (one-eye squint, small o mouth), curious (light surprise + smile - the weakest,
close to surprised), crossfade midpoint is a real in-between.

## What still looks wrong / not done

1. `sit` needs a seat; `sleep`/`wake` need real clips (Mixamo "Sleeping Idle", "Lying Down", "Get
   Up" are the owner rows in `anim/OWNER_CARD_mixamo.md`); the data-driven upgrade path is in place
   and untested with a real file because none exists in the tree.
2. `stumble` should be longer/bigger and drive the arms more; `recover` should start from a lighter
   crouch (use Jump_Land from 0.62 s instead of 0.5 s once a real stumble exists to chain from).
3. `reach`/`inspect` need a wrist-aim (orient the hand toward the target) and a finger pose; the
   idle clip's fists make everything below the elbow look tense.
4. `eat`: the bite mouth-open is small (`aa` 0.55 peak on a 0.34 s window); the left hand does not
   hold a bowl; no swallow. `drink` has no head-back on the return.
5. `tail_react` is proven on hair only; `_impulseTail` writes `_prevTail` of `VRMSpringBoneJoint`
   (a private field of three-vrm 3.5.5) - re-check on upgrade.
6. `_forceApply` reads `AnimationMixer._bindings/_nActiveBindings/_accuIndex` (private). It is the
   fix for a real three limitation (change-detection in `PropertyMixer.apply`) and must survive a
   three upgrade; a unit test that steps a clamped clip under `resetNormalizedPose` is the next step.
7. Two capture-sampling caveats: sampling 20/50/80 % of a periodic action lands on similar phases
   (eat uses 4 bites in the capture for that reason); `look wander` is random, so its tile changes
   between runs.
8. Not measured: CPU headroom (the loop is vsync-locked at 60 fps in both windows), a desktop
   composite screenshot (the transparency was proven by the first spike; `capturePage` alpha is
   reused here unchanged).
9. `shots/` (8.8 MB) has no ignore rule under `spikes/vrm/` - decide before committing, as VERIFY.md
   already flagged for `spikes/vrm/shots/`.
