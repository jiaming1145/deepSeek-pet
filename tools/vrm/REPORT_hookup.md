# REPORT - one-command hookup for the owner's generated Whale-chan GLB (2026-09-01)

Scope: `tools/vrm/` only. New files; `build_vrm.py` was **not** edited by me (see "concurrent edits"
below - another agent was modifying it during this session). Nothing committed, no git write commands.

## What was built

| file | what |
|---|---|
| `tools/vrm/chains.whalechan.json` | 11 spring chains for Whale-chan: tail (7 bones), ear_L/ear_R (2), ahoge (2), bangs (3), sidelock_L/R (4), hair_back_L/R (5), skirt_front/back (3). Selectors are `frac` boxes in fractions of the model height plus `prefer` name hints; chibi-tuned stiffness/drag/gravity |
| `tools/vrm/hookup_whalechan.py` | the one command: probe -> resolve chains -> `build_vrm.py` -> `vrm_manifest.py` -> `render_turnaround.py` x3 -> compare sheet + posed sheet -> `summary.json`. Plain Python, orchestrates Blender via subprocess |
| `tools/vrm/probe_glb.py` | Blender script: imports the GLB with `build_vrm.py`'s own functions and reports bbox, facing, rest pose, bone map result, meshes, materials, textures, shape keys, warnings (step 1 of the hookup and the tool behind the checklist) |
| `tools/vrm/measure_turnaround.py` | derives the chain fractions from `spikes/model/turnaround/{front,right,back}.png`; writes `evidence/turnaround_landmarks.json` |
| `tools/vrm/CHECKLIST_incoming_glb.md` | what to inspect in the owner's GLB before hookup, with the exact one-liners |
| `tools/vrm/evidence/hookup_stock_*.{png,json}` | half-size copies of the stock proof's compare sheet, posed sheet, summary, resolved chains, probe |

## The one command

```powershell
python tools\vrm\hookup_whalechan.py --glb spikes\model\generated\tripo\whalechan_rigged.glb
```

Output folder `tools\vrm\out\whalechan\<timestamp>\` (git-ignored): `probe.json`, `chains.resolved.json`,
`whalechan.vrm` (+ `.manifest.json`, `build.log`), `manifest.txt/json`, `renders/turn_{000,090,180,270}.png`,
`renders/posed_{090,180}.png`, `renders/head_000_head.png`, `compare_sheet.png`, `sheet_posed.png`,
`summary.json`, `hookup.log`. `tools\vrm\out\whalechan\LATEST.txt` points at the last run.

Options: `--height` (default = chains file `height` = 1.0 m), `--face-material REGEX` (default
`face|skin_face|head`), `--no-face`, `--no-tpose`, `--no-auto-morphs`, `--pose-tail DEG` (35),
`--render-size`, `--skip-renders`, `--run-name`, `--blender` / `BLENDER_EXE`.

## Proof on the stock rigged GLB (verified: ran it)

```
python tools/vrm/hookup_whalechan.py --glb tools/vrm/out/stock/stock_rigged.glb --run-name stock-proof
exit=0   (69.2 s wall: probe 2.8 s, build 19.4 s, three renders 15.3 / 15.5 / 15.1 s, sheets < 1 s)
```

Key lines from `hookup.log` (full log in `tools/vrm/out/whalechan/stock-proof/hookup.log`):

```
[hookup] probe: height 1.5801 (w/h 1.488, d/h 0.472), facing -Y, rest pose T [-0.5, -0.5], 51 bones, 51 mapped, 8 meshes, 20 materials
[hookup] chain tail         route=object         object_hits=['tail'] material_hits=['tail_mat']
[hookup] chain skirt_front  route=bbox           object_hits=[] material_hits=[]
[hookup] chain skirt_back   route=bbox           object_hits=[] material_hits=[]
[hookup] chain hair_back_L  route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] chain hair_back_R  route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] chain sidelock_L   route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] chain sidelock_R   route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] chain bangs        route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] chain ear_L        route=object         object_hits=['ear_L'] material_hits=['ear_L_mat', 'ear_R_mat']
[hookup] chain ear_R        route=object         object_hits=['ear_R'] material_hits=['ear_L_mat', 'ear_R_mat']
[hookup] chain ahoge        route=material+bbox  object_hits=[] material_hits=['hair']
[hookup] face: mode=bridge texture=...\spikes\model\face\face_texture.png atlas=...\face_atlas_states.json material=robo_face
[hookup] build: exit 0 in 19.4 s
[hookup] build chain tail         {'verts': 331, 'axis': [0.0, 0.833, -0.553], 'length_m': 0.359}
[hookup] build chain skirt_front  {'verts': 383, ...}   skirt_back {'verts': 220, ...}   sidelock_R {'verts': 37, ...}
[hookup] build chain bangs        {'verts': 1413, ...}  ear_L {'verts': 111, ...}  ear_R {'verts': 111, ...}  ahoge {'verts': 2377, ...}
[hookup] build chain hair_back_L / hair_back_R / sidelock_L  {'verts': 0, 'skipped': 'selector matched no vertices'}
[hookup] build force-tpose skipped: a mesh has shape keys (applying a rest pose would break them)
[hookup] manifest: VRM 1.0, 85 joints, 51 humanoid, 8 springs [('tail', 8), ('skirt_front', 4), ('skirt_back', 4),
         ('sidelock_R', 5), ('bangs', 4), ('ear_L', 3), ('ear_R', 3), ('ahoge', 3)], 18 preset expr, mtoon 20/20
[hookup] render turnaround: exit 0   render posed tail: exit 0   render head: exit 0
[hookup] compare sheet D:\ds\tools\vrm\out\whalechan\stock-proof\compare_sheet.png
```

`renders/turn_reimport_check.json`: `reimport FINISHED, spec 1.0, bones 85, humanoid_mapped 51, 8 springs`.
`manifest.txt`: `extensions: ['KHR_materials_unlit', 'KHR_materials_emissive_strength', 'VRMC_materials_mtoon',
'VRMC_vrm', 'VRMC_springBone']`, `nodes=93 bones(skin joints)=85 meshes=8 triangles=45408 images=11`,
18 preset + 12 custom expressions (the 30 face-bridge states as `isBinary` texture-transform binds on
`robo_face`, plus blink/blinkLeft/blinkRight morph binds from `--auto-morphs`), 3 colliders.

A first run (before two fixes) had the tail chain grab Seed-san's `hair_tail` mesh too (loose
`^tail|tail$` regex) and had all boxes shifted +0.25 m because the bbox centre was used as the
symmetry centre (the stock's mechanical arm skews it). Fixed: word-bounded regexes, x anchored on the
hips bone. The numbers above are from the second, fixed run.

### What the images show (viewed at full size; half-size copies in `evidence/`)

- `compare_sheet.png` (2900x2050): 2x2 grid, each tile = accepted Whale-chan reference (left) beside
  the stock render (right) for FRONT / RIGHT / BACK / LEFT (yaw 0 / 90 / 180 / 270). The stock is
  Seed-san with the synthetic blue tail slab and fin ears; the plumbing (view mapping, scaling to a
  common height, labels) is what this proves. Yaw 90 shows the character's right side facing
  screen-right, matching `right.png`'s convention; yaw 270 matches the mirrored `left.png`.
- `sheet_posed.png`: `--pose-tail 35` rotates EVERY spring root by 35 deg (that is how
  `render_turnaround.py` works), so on the stock you see the tail slab bent upwards **and** the
  trousers front/back panels, the bangs, the ahoge region and the ears displaced - the trousers tear
  open because Whale-chan's skirt boxes landed on Seed-san's trousers. That is expected on the stock
  and is exactly the picture that will tell you, on the real GLB, which chain grabbed what.
- `renders/head_000_head.png`: Seed-san's head; the swapped face texture went to `robo_face` (the
  first material matching the default regex - a backpack robot face, not visible here). The mouth
  still shows the dark-blob defect VERIFY.md reported; that is `build_vrm.py`'s face-parts alpha
  issue, not something the hookup changes (see concurrent edits).
- Framing: the figure spans rows 23..899 of the 900-px render, i.e. the feet touch the bottom edge.
  `render_turnaround.py` frames `height * 1.15` at the bbox centre with a 50 mm lens, but the near
  half of a 0.47 H-deep body is magnified about 1.17x by perspective, so the 15 % margin is eaten.
  Whale-chan's tail makes the side views 0.77 H deep, so expect the same tight crop. Fix belongs in
  `render_turnaround.py` (longer lens or `frame_h = height * 1.35`); I did not edit that file.

## How the fractions were derived (chains.whalechan.json)

`python tools/vrm/measure_turnaround.py` -> `evidence/turnaround_landmarks.json`. It finds the figure
bbox in each view automatically (non-white pixels: 2699 px tall in all three views, front width 0.593 H,
back width 0.636 H, side depth 0.766 H, tail flukes z 0.152-0.364 H, ahoge z 0.911-1.0 H, upper-body
half width 0.263 H) and converts landmark pixel coordinates read off the images into fractions:

| landmark | measured (fractions of H) | used in |
|---|---|---|
| head top / chin / eyes / brows | 0.93 / 0.62 / 0.69 / 0.72 | bangs z >= 0.72 (above the brows), ahoge z >= 0.94 |
| ahoge | x +-0.05, depth 0.09-0.21 | ahoge box x +-0.08, depth 0.02-0.28 |
| fin ears | z 0.65-0.72, x 0.16-0.30 (root-tip), depth 0.24-0.41 | ear boxes x +-[0.16, 0.36], z 0.63-0.74, depth 0.20-0.44 |
| bangs | z 0.67-0.88, depth 0.00-0.15 | bangs box z 0.72-0.88 (fallback) / 0.66-0.90 (with hair material), depth -0.02-0.16 |
| side locks | z 0.36-0.78, x 0.12-0.22, depth 0.16-0.26 | sidelock boxes x +-[0.12, 0.32], depth 0.12-0.30, z 0.60-0.78 fallback / 0.36-0.78 with hair material |
| back hair | z 0.24-0.88, depth 0.32-0.54, x +-0.28 | hair_back boxes z 0.36-0.88, depth 0.34-0.58, x 0..+-0.30 |
| shoulders / hand / arm | shoulder z 0.56, hand z 0.37, arm 0.24 H | side-lock fallback z-min 0.60 (T-posed arm occupies z 0.50-0.58) |
| skirt | z 0.20-0.45, x +-0.20, front depth 0.00, back depth 0.37, legs' front 0.12 | skirt_front depth -0.02-0.11, skirt_back depth 0.25-0.39, both z 0.19-0.44 |
| tail | exits skirt z 0.185, hips z 0.32, root depth 0.35, flukes z 0.15-0.36, fluke x +-0.30 (curled) | tail box z 0.03-0.37, depth 0.40-2.0 (behind the skirt back), x +-0.36 |

Frame: **x** from the hips bone (the symmetry centre - the bbox centre is wrong whenever an arm is
asymmetric, as the stock's 0.25 m offset showed; falls back to the bbox centre), **z** from the bbox
floor, **depth** from the bbox front plane (face / skirt front) backwards, all in units of the height
`--height` normalises to. The task asked for fractions of height and width; I deliberately express
x in height too, because `build_vrm.py` applies the chains **after** `--force-tpose`, and the T-pose
widens the bbox from 0.59 H (35 deg A-pose) to about 0.76 H, so width fractions would land in
different places depending on the input pose. Depth fractions were rejected for the same reason (tail
straight = 0.77 H, tail curled = about 0.55 H). Height is the one measure that stays put.

Chibi tuning: tail stiffness 0.9 -> 0.35 at the tip, drag 0.30, gravity 0.20, hit radius 3 cm on a
1 m model (heavy, slow swing); hair 0.7-0.8 -> 0.3, drag 0.35, gravity 0.15 (soft); bangs 1.4, ears 1.2,
ahoge 1.6 with zero gravity (short, springy, return quickly); skirt 1.1 with gravity 0.10. Colliders:
hips for tail/skirt, head + chest for the hair (the chest group only exists when a chest bone maps).
`blend_root` 0.10-0.30 keeps the chain roots from tearing off the parent bone. These are tuned by
reasoning from the demo's proven tail values, not yet by watching them move in three-vrm.

## What the bbox fallback gets wrong (honest limits)

Only when the GLB has no separate parts and no usable material names (the common one-mesh, one-
material generator export). The hookup logs the chosen `route` per chain so you know when you are here.

1. Back-hair tips below 0.36 H (they reach 0.24 H) fall into the skirt_back / tail boxes and swing with
   the skirt or the tail. Cosmetic; they move in the same direction anyway.
2. Side locks: only the part beside the head (z >= 0.60 H) is chained, because a T-posed upper arm
   crosses the same x range at z 0.50-0.58; the lower two thirds of each lock keep the auto-rigger's
   weights (usually the arm or the chest). With a `hair` material the full lock is chained.
3. Bangs: the forehead skin under the bangs (hidden) moves with them; the eyes are excluded by the
   0.72 H floor. With a `hair` material the box widens to 0.66-0.90 H.
4. Ear vs side-lock overlap (x 0.16-0.22, z 0.65-0.72, depth 0.24-0.26): the ear chain is applied
   last and wins; a few hair vertices there flap with the ear.
5. The whole approach assumes the generated model keeps the reference proportions (head 0.62-0.93 H,
   tail behind the skirt, ears at 0.65-0.72 H). `probe.json` gives `width_over_height` /
   `depth_over_height` to sanity-check that before trusting the boxes; the posed sheet is the check after.
6. `--force-tpose` is skipped by `build_vrm.py` when any mesh has shape keys (the stock has them, so
   the proof did not exercise it). The probe warns, the hookup carries the warning into `summary.json`,
   and the checklist gives the Blender one-liner that strips shape keys first.

Best mitigation is upstream: ask the generator for segmented parts (`tail`, `ear_L`, `ear_R`,
`ahoge`, `hair_*`, `skirt_*`) - the `prefer.object` route then uses the whole part and ignores the box.

## Face input

`spikes/model/face/face_texture.png` + `face_atlas_states.json` appeared during this session (another
agent's face-bridge output, schema `whalechan.face_texture/1`, 4096x4096, 5x6 cells, 30 states). The
hookup found them and used them (`mode=bridge`); `build_vrm.py` consumed the atlas without error and
emitted 30 texture-transform expressions. If they are absent the hookup falls back to `neutral.png`
as a plain face texture and says so in `summary.json`. On the stock, the face material regex matched
`robo_face` (a backpack part), so the Whale-chan face is in the file but not on Seed-san's face - the
stock has no material named face/head; that is a stock limitation, not a hookup one. On a one-material
owner export the hookup warns that the swap would replace the whole body texture (use `--no-face`).

## Concurrent edits observed (not mine)

`git status` during this session showed `M tools/vrm/build_vrm.py` and `M tools/vrm/make_stock_input.py`
appearing mid-session (adds `detect_alpha_mode`, keeps BLEND/MASK alpha through MToon conversion, no
outline on face materials). I did not touch either file. The stock proof ran against the working-tree
`build_vrm.py` with sha1 `f81355df1d9230232f5dfc80dd9e0585c4f0b906` (recorded in `summary.json` ->
`steps.build.build_vrm_py_sha1` on every run, so a future run can tell which pipeline version it used).
The hookup only depends on `build_vrm.py`'s CLI (`--input/--output/--chains/--height/--force-tpose/
--face-material/--face-texture/--face-atlas/--auto-morphs/--name/--author`) and its log lines
`chain <name>: N verts ...`, `chain <name>: selector matched no vertices; skipping`, `force-tpose ...`,
`face texture -> ...`, `height normalised ...`; if those change, `summary.json` loses detail but the run
still completes.

## Not done / out of scope

- `tools/vrm/README.md` not updated (existing file; add a "hookup" section when the tree is quiet).
- The produced VRM was not loaded in three-vrm (`spikes/vrm/index.html`) - VERIFY.md item 1 still stands.
- `render_turnaround.py` framing crop and its rotate-every-chain `--pose-tail` are inherited behaviour.
- Fractions are validated only against the 2D turnaround; the first real GLB will move some numbers.

## When the owner's GLB lands

1. `CHECKLIST_incoming_glb.md` steps 1-7 (the probe answers most of them in one run).
2. `python tools\vrm\hookup_whalechan.py --glb <file>` and open `compare_sheet.png`, `sheet_posed.png`,
   `summary.json` -> `warnings` and `steps.build.chains` (a chain with `verts: 0` matched nothing).
3. Adjust the offending `frac` box in `chains.whalechan.json` (or rename parts to hit `prefer.object`), rerun.
