# VERIFY — skeptic re-run of the five 3D-pipeline builders (2026-09-01)

Everything below was re-run or re-viewed in this session. Labels: **confirmed** (ran it / looked at it),
**refuted** (evidence contradicts the claim), **could not verify** (no runnable check available here).
Scratch outputs (rebuilt VRM, renders, logs) are in the session scratchpad `verify/`; nothing was written
to the repo except this file. No git write commands were run.

## Method (what was actually executed)

| check | command | result |
|---|---|---|
| VRM spike unit tests | `cd spikes/vrm && node --import ./test/register.mjs --test test/mixamo.test.mjs` | `tests 5, pass 5, fail 0` |
| VRM spike capture | `cd apps/desktop && npx electron ../../spikes/vrm/main.js --capture` | exit 0 in 28 s; 48 PNGs + report.json regenerated; 60.0 fps, avg 16.67 ms, p95 16.8; all-electron 19.8 % of one core; nvidia-smi 4 % x5 |
| VRM spike alpha | PIL on regenerated `shots/idle_0.png` | 960x1350 RGBA, corner alpha 0/0, 86.7 % fully transparent, 13.1 % fully opaque |
| anim smoke test | `cd spikes/vrm/anim && node retarget/smoke.mjs` | `ALL CHECKS PASSED`, exit 0 (45 clips, 53 tracks, 0.0301 / 0.0325 / 0.0006 deg) |
| anim preview capture | `cd apps/desktop && npx electron ../../spikes/vrm/anim/preview/main.cjs --capture` | exit 0; 12 clips captured, 24 PNGs + report.json (builder said 25 PNGs: it is 24 PNGs + report.json) |
| anim on a REAL Mixamo FBX (the builder could not) | temp script importing `anim/retarget/loadMixamoAnimation.js`, fed `spikes/vrm/clips/SambaDancing.fbx` | 52 mapped, 0 unmapped, 53 tracks, 18.2 s, hipsScale 0.00911 (99.7 cm -> 0.908 m); hips at 1 s = (0.098, 0.861, -0.065), head world y 1.336. The real-FBX path works |
| Blender env | `blender.exe --background --python-expr ...` | `(5, 2, 0)`, `FRESH True True` (VRM add-on present in a fresh process) |
| Blender build | `build_vrm.py --input out/stock/stock_rigged.glb ... --auto-morphs` to scratchpad | exit 0; 51/51 mapped; 4 chains (tail 7+end, ears 2+end, hair_tail 6+end); 19,350,812 bytes; manifest: VRM 1.0, 72 joints, 4 springs, 18 presets |
| Blender validity | `gltf-validator` (scratchpad copy) on the rebuilt VRM; `render_turnaround.py` re-import | `errors 0 warnings 26`; `re-import OK: spec=1.0 bones=72 humanoid_mapped=51 springs=4 meshes=8 materials_mtoon=20` |
| Blender renders | `render_turnaround.py --focus head --expression happy` on the rebuilt VRM, and on the ORIGINAL `vendor/samples/Seed-san.vrm` for comparison | both exit 0, viewed (see refuted item below) |
| face kit | `cd spikes/model/face && python build_face.py && python verify_atlas.py` | `DONE` in 42.8 s; `neutral round trip mean 0.000, max 1.1`; `cheerful mean 0.022`; every output byte-identical to the builder's (deterministic) |
| reference pack | `build_reference_pack.py`, `extract_palette.py`, `assemble_turnaround.py` | all exit 0; all outputs byte-identical to the builder's |
| determinism | md5 of 155 deliverable files before/after re-running every script | only the Electron screenshots changed (expected); face kit, reference pack, turnaround, Blender evidence identical |
| tree hygiene | `git status --short` | outside Codex's files only: `M apps/desktop/package.json`, `M pnpm-lock.yaml` (three deps, allowed), `M docs/DECISIONS.md` (see gaps), `?? spikes/character/` (pre-existing 2D spike, not a builder's), `?? spikes/model/`, `?? spikes/vrm/`, `?? tools/vrm/` |

## Per builder

### 1. runtime-vrm-spike — mostly confirmed; the wave and IK are real but crude; README overclaims head look-at

Screenshots (viewed at full 960x1350 and on both contact sheets):
- **Transparent window: confirmed.** Checkerboard shows through around the model on every sheet tile; `desktop_composite.png` is a real screen grab with the model standing over a Chrome window (tab strip, address bar, bookmarks visible behind her).
- **Model renders with MToon: confirmed** (toon-shaded VRM sample girl, white tee, black shorts).
- **Breathing: confirmed but invisible at sheet scale** (builder says the same).
- **Look-at: eyes only, subtle.** In the face crops the irises shift a few px left/right/up/down. The head does not turn. The REPORT says so; the README says "look-at follows the cursor (eyes + head, via vrm.lookAt)" — **refuted for "head"**.
- **Blink, visemes, 5 expressions, crossfade midpoint: confirmed** — genuinely different lids/mouths, the crossfade tile is a real in-between.
- **Spring bones: confirmed** — hair and side strands visibly flare at +60 / +190 ms after the nudge; report.json springAfter numbers reproduced on the re-run (0.053, 0.137, ... vs rest 0.091).
- **Wave: real arm motion, reads as a salute / raised hand, not a friendly wave.** `wave_2.png`: right arm straight up, hand tilted; fingers flat. Builder's "stiff, salute-like" is honest; I would call it not-yet-a-wave.
- **IK reach: confirmed as real IK** — `ik_reach_0` has a bent elbow with the palm toward the viewer, `ik_reach_2` an overhead reach, out-of-range tile a straight arm toward the target; report.json 0.0002 m errors reproduced (0.2144 m for the clamp case).
- **Hop: confirmed** — anticipation tile shorter, apex tile higher with stretched proportions, landing squash.
- **VRMA: confirmed but trivial** — T-pose with one arm/head moving (3-track test clip).
- **Mixamo FBX retarget: confirmed and the only good-looking motion** — `mixamo_1.png` is a real dance pose in profile, hair following.
- **Perf: confirmed** (60 fps vsync-locked, ~20 % of one core across all electron.exe, GPU 3-4 %). Headroom not measured (builder says so).
- **Deps: confirmed** — `apps/desktop/package.json` diff adds exactly `three 0.185.1`, `@pixiv/three-vrm 3.5.5`, `@pixiv/three-vrm-animation 3.5.5` as devDependencies; lockfile diff matches.
- Could not verify: the Get-Process CPU number independently (accepted as the builder's upper bound).
- Note: `spikes/vrm/` has no `.gitignore`; `clips/SambaDancing.fbx` (Mixamo data) and `models/*.vrm` (10.8 MB) would be committed with the directory.

### 2. blender-vrm-pipeline — pipeline runs and reproduces; one visible face defect the builder did not report

- **Add-on, build, FBX/blend routes, validator, re-import: confirmed** (I rebuilt the GLB route from scratch: identical bone/chain/expression counts, validator 0 errors, re-import OK).
- **Tail chain bends along its bones: confirmed** (`posed_090.png`: the pale-blue tail slab curves upward as one chain; body untouched).
- **Happy = pink irises via texture-transform: confirmed** (`head_000_happy_head.png` vs neutral yellow irises; reproduced on my rebuilt VRM).
- **Blink = eyes closed by shape key: confirmed.**
- **"neutral cell = original texture, so the UV rescale is right": partially refuted.** I rendered the ORIGINAL Seed-san head with the same script: it has a thin closed-smile mouth and thin brows. Every pipeline head render (neutral, happy, blink, and my rebuild) shows a **dark brown blob over the mouth and heavy dark brows**. The eyes are right; the mouth/brow overlays are not. Likely cause (read the code, untested): the faceparts material's alpha-blend mode is lost in `make_stock_input.py` (MToon -> Principled) or in `convert_to_mtoon`, so the transparent mouth/brow quads render opaque. Whale-chan will get her own face texture, but the same alpha-mode handling applies to her face material and to the atlas swap, so it must be fixed before trusting `--face-texture`.
- **`--force-tpose`: could not verify** (stock input already T-posed; builder says the same). Note it silently skips when any mesh has shape keys — Tripo/Meshy rigs with facial blendshapes would export an A-pose VRM with only a log line as warning.
- **Not loaded in three-vrm: confirmed gap** (builder says so). The `isBinary` texture-transform presets are unproven in the runtime.
- Sizes: `evidence/` 6.3 MB; `out/` and `vendor/` correctly git-ignored (`git check-ignore` confirms).

### 3. reference-pack — confirmed and honestly described

- **17 crops, labels/arrows removed, >= 1024 px: confirmed** (`_contact_sheet.png` viewed: 17 tiles, residual water puddles under feet and the plush whale exactly as the builder listed; palette.json 14 entries).
- **Turnaround: confirmed as described.** `_contact_sheet.png`: four views, same height and baseline, white background. Front arms ~35 deg, side arms hanging ~15 deg, back arms ~35 deg. Tail: flukes viewer-left in front, curling viewer-right in back, long and straight in both sides; left is a pixel mirror of right. This is "usable to try, not strict", as claimed.
- **Scripts reproduce byte-identically: confirmed.**
- **OpenAI 429 / Gemini route: could not verify** (no generation re-run; 11 candidates exist on disk with the names the report lists).
- **Tripo/Meshy UI labels and prices: could not verify** (no web access used here; the card itself marks them unverified).
- **Card consistency: refuted in two places** — the turnaround card demands "about 35 degrees" arms, the 3D card says "A-pose (arms about 45 degrees)"; and the 3D card's "ASSUMPTION until tools/vrm/README.md exists" block is stale (the README exists and disagrees, see gaps).
- Sizes: `spikes/model/` is 68 MB (turnaround PNGs 3.2 MB each, `_candidates/` 16.6 MB, `face/_scratch/` 7.8 MB).

### 4. animation-sources — confirmed, and I closed its main open item

- **Quaternius CC0 library present with License.txt (CC0 1.0 verbatim), 46 clips, smoke test all-pass: confirmed.**
- **Preview screenshots: confirmed** — Walk_Loop mid-stride with a planted foot, Sitting_Idle seated with hands on thighs hovering at chair height, Death01 lying on back with legs up. Poses are correct, no A-pose offset, feet at grid height.
- **Real Mixamo FBX path "untested": now tested by me** — `parseMixamoAnimation` on `spikes/vrm/clips/SambaDancing.fbx`: 52/52 mapped, 53 tracks, sane hips height. The first owner drop-in will work.
- **ACTION_CLIPS.json 18 actions, docs/ACTION_VOCABULARY.md exists: confirmed.**
- **VRoid BOOTH pack / GitHub .vrma search: could not verify** (owner-gated / not re-fetched).
- Nits: REPORT.md and ACTION_CLIPS.json are dated 2026-09-02 (today is 2026-09-01); "25 PNGs" is 24 PNGs + report.json; `node_modules/` (its own three copy) and `mixamo/*.fbx` are git-ignored, `testdata/*.vrm` (10.8 MB duplicate) is not.

### 5. face-atlas — confirmed and unusually honest; the weak moods are as weak as stated

- **All files exist at the stated sizes, build is deterministic (42.8 s), round-trip verifier passes: confirmed.**
- **`preview_expressions.png` viewed:** neutral/focused/sleepy/gentle/affection read; cheerful reads but the open mouth is a plain vector U with a red tongue (not the sheet's rounded D); smug/shy/confused partial; **hurt** has two large flat cyan tear ovals; **pouty** and **shocked** do not read (no cheek puff, iris stays large). Exactly the builder's table.
- **`preview_atlases.png` viewed:** 14 eye states x2, 14 mouths (the open ones are clearly synthetic vector shapes), 7 brow states x2 (neutral_verbatim is fragments), 15 FX cells including two plain gradient/ellipse shadows. As described.
- **No 3D render: confirmed gap** (builder says so).
- **atlas.json UV note "flip v for GL": misleading for our stack** — glTF/three-vrm textures already use a top-left origin (`flipY=false`), so the kit's convention matches `build_vrm.py`'s "glTF UV space" without a flip. Harmless, but the sentence will send someone the wrong way.

## Integration gaps (across builders)

1. **Face kit vs Blender pipeline: schema mismatch, not consumable.** `build_vrm.py apply_face_atlas` reads `atlas["states"]` as a single grid on ONE face material with uniform cells; `spikes/model/face/atlas.json` has no top-level `states` (KeyError, verified) — it is five regions (eye_l, eye_r, mouth, brow_l, brow_r) with anchors and FOUR atlases of different cell sizes (eyes 640x704, mouth 320x288, brows 384x256, fx variable) plus a base skin image. Bridging needs either (a) a converter that composites full-face cells (one per expression) into one 2xN grid the pipeline understands, or (b) per-region UV islands / overlay quads in the runtime. Option (a) loses per-region mixing (eyes and mouth animating independently), which is the point of the kit.
2. **Runtime spike does not use the animation builder's loaders.** `spikes/vrm/index.html` imports its own `./lib/loadMixamoAnimation.js` and an importmap into `apps/desktop/node_modules`; the anim package resolves `three/examples/jsm/...` (not mapped in the runtime page, which maps only `three/addons/`) into its own `anim/node_modules` copy of three 0.185.1. Two copies of three, two Mixamo loaders, and `loadQuaterniusAnimations` / `loadVRMAnimation` / `attachLookAtProxy` are never exercised in the pet-style window except by the anim builder's own preview. Only the FBX drop folder (`anim/mixamo/`) is shared.
3. **3D owner card contradicts the Blender README.** Card: "Generate parts / segmentation: OFF (one mesh)", "Auto Split: off", nothing about the face material. README: prefer tail/ears/skirt as separate named meshes (`object` selectors), and "ask for face on its own material / UV island" or the whole head becomes the atlas cell. Following the card as written forces the `material`+`bbox` selector route and makes the face swap replace the whole head texture.
4. **Pose contract drift.** Turnaround card: arms "about 35 degrees". 3D card: "A-pose about 45 degrees", then Meshy "Pose = A-Pose". Blender: `--force-tpose` (untested) silently skips if the export has shape keys. VRM 1.0 wants T-pose rest.
5. **Blender face-parts alpha defect** (see builder 2) will hit Whale-chan's face material the same way if her face uses alpha-blended overlays.
6. **Two DECISIONS/ownership items.** `docs/DECISIONS.md` is modified in the tree (D-2026-09-01-04, the 3D superseding entry); no builder claims it and the brief said it was pending — the controller should confirm who wrote it before committing. `spikes/character/` (the rejected 2D cutout spike) is untracked and not part of this batch.
7. **Licence/size for commit:** `spikes/vrm/clips/SambaDancing.fbx` (Mixamo data, 3.7 MB) has no ignore rule; `spikes/vrm/models/` and `anim/testdata/` carry the same 10.8 MB VRM twice; `spikes/model/` is 68 MB of PNGs.

## Consolidated owner actions (ordered)

1. Look at these five images and decide whether the 3D direction's motion ceiling is acceptable before spending credits: `D:\ds\spikes\vrm\evidence\sheet_motion.png`, `D:\ds\spikes\vrm\evidence\sheet_face.png`, `D:\ds\spikes\vrm\anim\preview\shots\quaternius_Walk_Loop_1.png`, `D:\ds\spikes\model\turnaround\_contact_sheet.png`, `D:\ds\spikes\model\face\preview_expressions.png`.
2. (Optional, 5 min) Try it live: `cd D:\ds\apps\desktop` then `npx electron ../../spikes/vrm/main.js`; move the mouse (eye look-at), keys 1-5/0 expressions, B blink, T talk, W wave, H hop, N nudge, R IK-reach to cursor, A VRMA clip, M Mixamo clip, Space stop, G HUD.
3. Decide the pose contract once: tell the controller "35 deg A-pose in all four views" or "45 deg"; the two owner cards currently disagree.
4. (Optional) Regenerate any turnaround view that fails the checklist in `D:\ds\spikes\model\OWNER_CARD_turnaround.md` (attach the three reference PNGs it names; run FRONT first, then the other three with the accepted front.png as reference 1); overwrite `turnaround\front.png / left.png / back.png / right.png` only with passing views.
5. Run `D:\ds\spikes\model\OWNER_CARD_3d.md` on Meshy (https://app.meshy.ai, free tier 100 credits, 20 per generation) and/or Tripo (https://www.tripo3d.ai/app, multi-view may need the $19.90 plan): upload `turnaround\front.png` as main plus `left/back/right.png`, Pose = A-Pose, Biped/humanoid auto-rig with Mixamo-style bone names if offered, download the RIGGED GLB and the un-rigged GLB into `D:\ds\spikes\model\generated\meshy\` or `generated\tripo\` with a `notes.txt` (asset URL, credits spent) and two viewport screenshots. **Before you click Generate, ask the controller which of the two conflicting instructions to follow (one mesh vs separate tail/ear/skirt meshes; face on its own material).**
6. VRoid 7-clip VRMA pack (5 min): log in to BOOTH/pixiv, open https://vroid.booth.pm/items/5512385, click "Free Download", unzip, copy `VRMA_01.vrma` to `VRMA_07.vrma` into `D:\ds\spikes\vrm\anim\vrma\`, then `cd D:\ds\spikes\vrm\anim && node retarget/smoke.mjs`. Add the credit line "Character animation credits to pixiv Inc.'s VRoid Project" to the app credits.
7. Mixamo (25 min): sign in at https://www.mixamo.com with an Adobe ID, keep the default X Bot/Y Bot, and for each row of `D:\ds\spikes\vrm\anim\OWNER_CARD_mixamo.md` search the string, pick by preview, Download with Format = FBX Binary, Skin = Without Skin, FPS = 30, Keyframe Reduction = none, save as `D:\ds\spikes\vrm\anim\mixamo\<name>.fbx`. Then `cd D:\ds\spikes\vrm\anim && node retarget/smoke.mjs` and `cd D:\ds\apps\desktop && npx electron ../../spikes/vrm/anim/preview/main.cjs --capture`.
8. Decide on the face kit's synthetic states: accept the vector open-mouth/brow states for now, or commission a few drawn open-mouth frames (and a shrunken-iris "shock" eye) via an image-model card before the 3D hookup.
9. (Optional) If you want the stricter OpenAI edits route for the turnaround, add credits at https://platform.openai.com/settings/organization/billing/ and tell the controller to rerun the front prompt with provider openai / gpt-image-1.5 / input_fidelity high.
10. Controller commit (named paths only, after confirming `docs/DECISIONS.md` authorship): `spikes/vrm/` (decide on `clips/SambaDancing.fbx` and `models/*.vrm`; `anim/node_modules` and `anim/mixamo/*.fbx` are ignored; consider ignoring `anim/testdata/`), `tools/vrm/` (`out/`, `vendor/` ignored; `evidence/` 6.3 MB), `spikes/model/` (68 MB; consider excluding `turnaround/_candidates/` and `face/_scratch/`), `apps/desktop/package.json`, `pnpm-lock.yaml`.

## Next steps for the build team (before the owner's GLB arrives)

1. Fix the Blender face-parts alpha/mouth defect and re-render the stock head until it matches the original Seed-san mouth; then load `tools/vrm/out/build/stock_character.vrm` in `spikes/vrm/index.html` and prove the `isBinary` texture-transform presets in three-vrm.
2. Reconcile the two owner cards with `tools/vrm/README.md` (segmentation, face material, pose angle) and remove the stale "README does not exist" assumption block.
3. Write the face-kit -> `build_vrm.py` bridge (or a runtime per-region overlay shader) and prove one crossfade in the Electron window.
4. Point the runtime spike at `anim/retarget/index.js` (extend its importmap with `three/examples/jsm/` and `@pixiv/three-vrm-core`) so there is one three instance and one loader set; add a head-turn layer to look-at and a finger-curl hand pose.
