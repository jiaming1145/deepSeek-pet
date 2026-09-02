# VRM runtime spike - report

**Repo** D:\ds, **dir** `spikes/vrm/`. **Goal** prove the motion ceiling of the 3D (VRM + three.js)
approach inside the real pet-style Electron window, today, with a stock model and screenshots.

## Verdict (short)

Everything in the task list runs in the transparent 640x900 always-on-top window at a locked
60 fps (vsync), 16.7 ms/frame, GPU at 3 % on the 3070 Ti, and roughly a fifth of one CPU core for
all Electron processes combined (Electron's own per-process counter says far less; see
"Measurements" - I trust the Get-Process number). Look-at, blink, visemes, expression crossfade,
spring bones, VRMA playback and Mixamo FBX retargeting are library features that just worked.
Breathing, wave, two-bone IK and the hop are procedural layers written here; they work
mechanically (IK converges to 0.2 mm on reachable targets) but look like what they are:
first-pass procedural motion on a stiff-handed stock model. The motion ceiling is far above the
2D cutout; the remaining risk is in *authoring* (model quality, hand poses, clip curation), not in
the runtime.

Evidence: `evidence/sheet_motion.png`, `evidence/sheet_face.png`, raw captures in `shots/`,
numbers in `shots/report.json`. Every claim below is from those files or a command output.

## What was built

| file | what |
|---|---|
| `index.html` | three.js r185 + three-vrm 3.5.5 scene, VRM load (GLTFLoader + VRMLoaderPlugin + VRMAnimationLoaderPlugin), MToon materials, transparent clear colour, key/fill/ambient light, auto framing with 30 % headroom, procedural layers, `window.lab` control surface, HUD, key bindings |
| `main.js` | Electron harness copied from `spikes/character/main.js` (transparent, frameless, always-on-top, 640x900, `backgroundThrottling:false`); `--capture` drives every action through `executeJavaScript`, screenshots with `capturePage`, takes a real desktop screenshot via PowerShell, samples perf |
| `lib/loadMixamoAnimation.js`, `lib/mixamoVRMRigMap.js` | port of three-vrm's `examples/humanoidAnimation/loadMixamoAnimation.js` (MIT); the retarget step is a pure function (`retargetMixamoAsset`) so it is unit-testable |
| `test/mixamo.test.mjs` (+ `register.mjs`, `resolve-three.mjs`) | 5 node:test cases: bone map validity/uniqueness against the 55 VRM 1.0 bone names, track renaming, hips scale, rest-rotation bake-out, VRM0 flip, input not mutated |
| `make_sheet.py` | contact sheets over a checkerboard so the alpha is visible |
| `README.md` | how to run, keys, Mixamo drop-in, licences |

Per-frame order (this matters and is the thing to carry into the real pet):
`resetNormalizedPose -> mixer (clip) -> idle arm pose (skipped while a clip owns the arms) ->
breathing -> wave -> hop -> IK -> vrm.update(dt)` (look-at, expressions, spring bones,
normalized-to-raw copy) `-> render`. All procedural rotation is done on
`vrm.humanoid.getNormalizedBoneNode(name)` so it is model-independent.

Dependencies: `pnpm add -D three@0.185.1 @pixiv/three-vrm@3.5.5 @pixiv/three-vrm-animation@3.5.5`
in `apps/desktop` (three-vrm 3.x peer-depends on `three >= 0.137`; output
`+ @pixiv/three-vrm 3.5.5 / + @pixiv/three-vrm-animation 3.5.5 / + three 0.185.1`, `Done in 2.5s`).
The page loads them via an import map to `../../apps/desktop/node_modules/...` over `file://`
with `allow-file-access-from-files`: no bundler, no network at runtime.

## Model and licences

- `models/VRM1_Constraint_Twist_Sample.vrm` (10.8 MB) from
  `https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/`. VRM meta read out of
  the file: name `VRM1_Constraint_Twist_Sample`, `(c) 2022 pixiv Inc.`, licence
  `https://vrm.dev/licenses/1.0/` (VRM Public License 1.0), `allowRedistribution: true`,
  `modification: allowModificationRedistribution`, `creditNotation: unnecessary`,
  `avatarPermission: everyone`. 54 humanoid bones, 18 expressions (aa angry blink blinkLeft
  blinkRight ee happy ih lookDown lookLeft lookRight lookUp neutral oh ou relaxed sad surprised),
  57 spring joints in 22 springs, bone-type look-at, MToon materials, 1.615 m tall. It is a slim
  adult-proportioned girl in a T-shirt, not a chibi; proportions change nothing in the code paths
  but do change how much a Mixamo clip needs hips scaling (handled) and how IK reach limits feel.
- `clips/test.vrma` from `pixiv/three-vrm` `packages/three-vrm-animation/examples/models/` (repo
  MIT). A 3-track engineering test clip (3 s), not a nice motion.
- `clips/SambaDancing.fbx` (3.7 MB) from `mrdoob/three.js` `examples/models/fbx/`. This is Mixamo
  (Adobe) data; the three.js README only explicitly licenses `nurbs.fbx`, and Mixamo's terms allow
  use in your own projects but not redistribution as an asset. Used only to exercise the FBX
  loader path; flagged in README as not to ship.
- vrm-c samples: `Seed-san.vrm` is also VRM Public License 1.0 but was not needed.

## Screenshot review (what looked good, what looked wrong)

All shots are 960x1350 (640x900 at devicePixelRatio 1.5), RGBA. I viewed both sheets and several
frames at full resolution.

**Transparency - verified.** `idle_0.png` alpha: corner pixels 0, 82.1 % of pixels fully
transparent, 17.6 % fully opaque (PIL on the capture). `desktop_composite.png` is a real
`CopyFromScreen` of the window region: the model stands over a browser window (tab strip and
address bar visible behind her). The window is genuinely see-through, not a black box.

**Idle breathing - works, subtle.** Frames at t=0 and t=0.9 s of the 3.6 s cycle differ by
21 364 changed pixels (>30/255), but at contact-sheet scale it is nearly invisible. Amplitude is
1.5-2.2 deg on spine/chest/upperChest plus 2.5 deg shoulder lift. A real idle needs an authored
or captured idle clip underneath, with this only as an additive layer.

**Look-at - works.** Bone look-at; the eyes clearly track left/right/up/down in the face crops.
The model's `rangeMap` limits how far the eyes travel, so "up" is mild. The head does not turn -
the sample only wires eye bones; the pet needs a head-turn layer (rotate `head`/`neck` toward the
target with a lag) on top of `vrm.lookAt`.

**Blink - works.** 0 / 0.5 / 1 weights render open, half-closed, closed lids.

**Lip sync - works; `aa` strong, `ih`/`ou` subtle.** `aa` is an obvious open mouth; `ih` a narrow
opening and `ou` a small pucker on this model. The cycling flap reads as talking. Real lip sync
should take its envelope from audio energy, not a sine.

**Expressions + crossfade - works and looks good.** happy (closed happy eyes, open smile), angry
(brows down, small frown), sad (brows up, downturned mouth), relaxed (soft smile), surprised (wide
eyes, open mouth). The 70 ms crossfade frame happy->surprised is a genuine in-between (eyes half
open, mouth between shapes), not a pop.

**Spring bones - works, convincing.** After `nudge(1.6, 0.4)` (impulse on the model root through a
damped spring) the hair, side strands and T-shirt hem visibly lag and flare at +60 ms and +190 ms,
then settle. Numeric (x of six spring-joint children relative to the root): rest
`[0.091, 0.089, 0.211, -0.091, -0.089, -0.211]` -> `[0.050, ...]` -> `[0.137, ...]` -> `[0.066, ...]`
-> `[0.096, ...]` over 450 ms, i.e. about +-4.5 cm swing, decaying. Same reaction on the hop landing.

**Wave - works, reads as a wave but stiff.** Right arm up-and-out, forearm vertical swinging
+-32 deg at 2.2 Hz, hand +-22 deg. At the inward extreme (wave 42 %) it looks like a salute; the
fingers stay straight (T-pose hand), which is the main reason it looks stiff. Needs a hand-pose
layer (finger curl) and some shoulder/torso lean; a Mixamo "Waving" clip would beat this.

**IK reach - converges; looks OK front-on; elbow orientation basic.** Two-bone analytic IK (law of
cosines for the elbow, `setFromUnitVectors` aim for the upper arm, single pole twist).
`report.json` `ik[]`: three reachable targets at 0.358-0.366 m from the shoulder (arm length
0.435 m) all end with hand error **0.0002 m**; the deliberately out-of-range target at 0.635 m ends
at 0.214 m error = fully extended toward it (correct clamping). "forward" reads as a hand raised
toward the viewer with a bent elbow; "across/low" puts the hand in front of the hip; "up/out" is an
overhead reach with a slight bend. My first run had all targets out of reach (straight arms,
0.2-0.29 m errors) - fixed by choosing targets at 85 % of arm length. The pole is fixed
(below/behind the shoulder); a real implementation needs a target-following pole and wrist
orientation.

**Hop (squash and stretch) - works, cartoony.** Root scale y 0.86 on anticipation with knees bent
35 deg, 1.12 stretch at launch, 16 cm apex, 0.84 squash on landing, volume-preserving x/z. The
first run cropped the head at the apex; adding 30 % headroom to the framing fixed it. Hair reacts
on landing. Scaling the whole root squashes the head too, which reads as 2D-style squash and is
arguably what a chibi wants.

**VRMA - loads and plays.** `test.vrma` -> `createVRMAnimationClip` gives 3 tracks, 3 s; the arm
rotates through the frames. It is a bare test clip, so it looks like a T-pose with one arm
swinging. No nicer licence-clean VRMA was found in the vrm-c or three-vrm repos (VRoid motion
packs sit behind their own terms and were not downloaded).

**Mixamo FBX retarget - works, and is the best-looking motion on the sheet.** Samba Dancing:
53 tracks, 18.2 s. Frames show hip sway, a back turn, raised arms and a lifted leg; hair follows
the body through the spring bones. This is the path that gives the pet real animation: drop FBX
"Without Skin" files into `anim/mixamo/`, the capture script auto-plays every file there. The
ported loader passes 5 unit tests (`node --import ./test/register.mjs --test test/mixamo.test.mjs`
-> `tests 5, pass 5, fail 0`).

**Wrong regardless of feature:** T-pose "paddle" hands with straight fingers in every idle frame;
flat lighting (key + fill only, no rim); a hair strand briefly clipping the shirt after the nudge.
None are runtime limits.

## Measurements (5 s idle, blink + look on, HUD on)

From `shots/report.json` (last run):

- Renderer frame timing (rAF deltas): 347 frames in 5.78 s, **60.0 fps**, avg **16.67 ms**,
  p50 16.7, p95 16.8, max 17.0 ms. A flat vsync lock: no jitter, and no evidence of where the real
  cost ceiling is. To find it, disable vsync or add models.
- CPU, Electron `app.getAppMetrics().cpu.percentCPUUsage` per process: Browser 0, GPU 0.8,
  Utility 0, Tab (renderer) 0.6 (% of one core). Implausibly low; reported, not trusted.
- CPU, `Get-Process electron` TotalProcessorTime delta over the same 5 s: **0.23 CPU-ms per
  wall-ms = 23 % of one core = 1.2 % of the 20-thread machine**, summed over main + GPU + renderer
  + utility processes (an earlier run: 18.2 %). Caveat: it sums every `electron.exe` on the machine
  at that moment, so it is an upper bound if another Electron dev instance was running.
- GPU (`nvidia-smi`, once per second): utilization **3 %** every sample; 3.75 GB VRAM in use
  system-wide (desktop + browser + this window).
- Memory (working set): ~336 MB renderer (Tab) process, ~125 MB GPU process.

## What I did NOT do / caveats

- A sibling agent's `spikes/vrm/anim/` package (its own `package.json`, `retarget/`, `testdata/`,
  `vrma/`) appeared while I was working. I did not touch it; I moved my two test clips out of
  `anim/` into `clips/` and only *read* `anim/mixamo/*.fbx` as the owner's drop folder.
- Nothing committed. Files outside `spikes/vrm/`: only `apps/desktop/package.json` and
  `pnpm-lock.yaml` (the three deps).
- Head-turn look-at, finger poses, IK wrist orientation, audio-driven lip sync, and clip blending
  (idle <-> Mixamo crossfade) are not implemented; the idle arm pose is switched off while a clip
  plays instead of blended.
- No chibi model was available; proportions untested. Hips-height scaling in the Mixamo loader is
  the only proportion-dependent code.
- Frame timing is vsync-bound; headroom not measured.

## Commands run (evidence)

```
pnpm add -D three@0.185.1 @pixiv/three-vrm@3.5.5 @pixiv/three-vrm-animation@3.5.5   (apps/desktop)  -> Done in 2.5s
node --import ./test/register.mjs --test test/mixamo.test.mjs   (spikes/vrm) -> tests 5, pass 5, fail 0
npx electron ../../spikes/vrm/main.js --capture   (apps/desktop) -> 48 PNGs + report.json in spikes/vrm/shots, exit 0, error: null
python make_sheet.py -> evidence/sheet_motion.png (1600x3184), evidence/sheet_face.png (1800x1054)
python (PIL) on shots/idle_0.png -> RGBA, corner alpha 0/0, 82.1 % transparent px
```
