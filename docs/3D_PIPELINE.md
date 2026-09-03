# 3D pipeline — from the reference kit to a VRM in the pet window

Written 2026-09-01 against commit `c363385` and the skeptic's re-run in `spikes/model/VERIFY.md`.
Decision: `docs/DECISIONS.md` D-2026-09-01-04 (Whale-chan is a toon-shaded VRM 1.0 rendered by
three.js + `@pixiv/three-vrm`).

## The picture in one paragraph

We cannot model her by hand, so we make the 3D model in five hops. The community reference kit
gives us what she looks like from three sides; from that we generated four clean A-pose views
(done, accepted). You upload those four views to a hosted image-to-3D service that also auto-rigs
the mesh (your step, one paid month). A Blender script turns that rigged GLB into a VRM: it maps
the bones, adds tail / ear / hair / skirt bone chains with spring physics, applies toon shading,
puts her drawn face on as a texture with expression states, and exports. The Electron spike loads
the VRM in a transparent window with look-at, blink, expressions, spring bones, IK reach and
animation clips (CC0 Quaternius now, VRoid and Mixamo clips after two more owner logins). The pet
app then swaps its 2D stage for that runtime. Every hop is already proven on stock inputs; only
her own mesh is missing.

```
reference kit ──> turnaround ──> [OWNER] generator + auto-rig ──> hookup (Blender) ──> VRM ──> spike ──> pet
spikes/model/     spikes/model/   spikes/model/generated/         tools/vrm/          .vrm    spikes/vrm/  apps/desktop
reference/        turnaround/     <meshy|tripo>/                  build_vrm.py                index.html
                                                                                              anim/
face kit ───────────────────────────────────────────────────────────┘ (face texture + atlas)
spikes/model/face/
clips: spikes/vrm/anim/ (Quaternius CC0 now; [OWNER] VRoid .vrma pack, [OWNER] Mixamo FBX) ──> spike ──> pet
```

## Stages, artefacts, owners, checks

| # | stage | where it lives | whose step | status 2026-09-01 | what the check proves |
|---|---|---|---|---|---|
| 1 | Reference kit | `spikes/model/reference/` (17 crops on white and RGBA, `palette.json`, `canonical_front_2048_*.png`, `manifest.json`, `_contact_sheet.png`); scripts in `spikes/model/scripts/` | build team | done | `build_reference_pack.py` and `extract_palette.py` re-run byte-identically (VERIFY); every crop >= 1024 px is asserted in code; the contact sheet was viewed |
| 2 | Turnaround | `spikes/model/turnaround/front.png left.png back.png right.png` (2560 x 3072, white), `_contact_sheet.png`, `manifest.json`, rejected candidates in `_candidates/`; regeneration card `spikes/model/OWNER_CARD_turnaround.md` | build team (owner only if a view is regenerated) | done, accepted; pose contract = A-pose, arms about 35 degrees, in all four views | the acceptance checklist in the turnaround card (same height, same arm angle, one tail, socks, no text) was applied by eye on the contact sheet; `assemble_turnaround.py` normalises height and baseline and is deterministic |
| 3 | Face kit | `spikes/model/face/` (`atlas_eyes/mouth/brows/fx.png`, `atlas.json`, `neutral.png`, `base_no_eyes_mouth.png`, `preview_*.png`, `build_face.py`, `verify_atlas.py`) | build team | done; the open-mouth, pouty and shocked states are synthetic and weak (owner action 8 in VERIFY) | `build_face.py` is deterministic (42.8 s) and `verify_atlas.py` round-trips neutral at mean 0.000 / max 1.1. Known gap: `atlas.json` (five regions, four atlases) does not match the single-grid `face_atlas.json` that `build_vrm.py` reads; the bridge is a build-team item |
| 4 | Rigged mesh from a generator | `spikes/model/generated/meshy/` or `generated/tripo/` (`whalechan_<service>_<date>_rigged.glb`, `_unrigged.glb`, two screenshots, `notes.txt`); card `spikes/model/OWNER_CARD_3d.md` | **owner** | not started; multi-view is a paid feature on both services, recommendation is Meshy Pro for one month | the card's inspection step (tail attached, both fin-ears, apron raised, face not smeared) plus `python tools\vrm\vrm_manifest.py <glb>` showing Mixamo-style bone names |
| 5 | Hookup: GLB to VRM | `tools/vrm/build_vrm.py` (+ `install_vrm_addon.py` once, `vrm_manifest.py`, `render_turnaround.py`, `README.md`); proof inputs `tools/vrm/out/stock/stock_rigged.glb` (from `make_stock_input.py`); evidence `tools/vrm/evidence/` | build team | proven on the stock rig: 51/51 bones mapped, 4 spring chains, VRM 1.0, gltf-validator 0 errors, re-import OK | exit code 0 with every humanoid bone mapped; `vrm_manifest.py` lists bones, springs, expressions, MToon materials; `render_turnaround.py` re-imports (validity) and renders 360 / head / expression views. Known defect: alpha-blended face-part overlays render opaque (VERIFY builder 2); must be fixed before trusting `--face-texture` |
| 6 | Runtime spike | `spikes/vrm/index.html` + `main.js` (Electron harness, `--vrm <path>`), `evidence/sheet_motion.png`, `sheet_face.png`, `shots/report.json`; clips and retarget in `spikes/vrm/anim/` (`retarget/index.js`, `quaternius/`, `vrma/`, `mixamo/`, `preview/`, `ACTION_CLIPS.json`, `SOURCES.md`) | build team; clip logins are owner steps | proven on `spikes/vrm/models/VRM1_Constraint_Twist_Sample.vrm`: transparent window, MToon, look-at (eyes and head turn), blink, visemes, 5 expressions, spring bones, IK reach, hop, real clips with crossfades, walk across the window with foot planting, VRMA and Mixamo playback at 60 fps, ~30 % of one core | `npx electron ../../spikes/vrm/main.js --capture` regenerates 48 PNGs + `report.json`; `node retarget/smoke.mjs` retargets 45 Quaternius clips (0.03 deg error) and every `.vrma` / `.fbx` dropped in; `anim/preview/main.cjs --capture` screenshots each clip on the VRM |
| 7 | Pet | `apps/desktop/src/renderer/pet/` (Codex's uncommitted stage work), `packages/protocol`, `packages/behaviors`, `packages/stage` | build team (Codex + Claude) | not started for 3D; the contract is `docs/ACTION_VOCABULARY.md` (section 6 says what changes) | the pet window shows her VRM with the at-rest layer and the action vocabulary driving clips + procedural layers; screenshot of the running pet |

Paths in `tools/vrm/README.md` examples use `runs\whalechan\`, which is git-ignored; that is fine
for build outputs. Anything meant to be kept (the accepted VRM, evidence renders) goes next to its
source under `spikes/model/generated/<service>/` or `tools/vrm/evidence/` and is committed by the
controller with named paths.

## Your steps (owner), in order

1. **Look before spending.** `spikes\vrm\evidence\sheet_motion.png`, `sheet_face.png`,
   `spikes\vrm\anim\preview\shots\quaternius_Walk_Loop_1.png`, `spikes\model\turnaround\_contact_sheet.png`,
   `spikes\model\face\preview_expressions.png`. Optional 5 minutes live:
   `cd D:\ds\apps\desktop` then `npx electron ../../spikes/vrm/main.js` (keys are printed on the HUD).
2. **Run the 3D card**, `spikes\model\OWNER_CARD_3d.md`: Meshy Pro for one month ($20), multi-view
   with our four PNGs, Pose = A-Pose, Auto-Rig Humanoid, download rigged and un-rigged GLB into
   `spikes\model\generated\meshy\`. Tripo Pro only if Meshy fails the inspection. Free tiers cannot
   download what we need (verified on both sites 2026-09-01).
3. **VRoid VRMA pack** (5 minutes, free, BOOTH login): `spikes\vrm\anim\SOURCES.md` "Owner-gated";
   seven `.vrma` files into `spikes\vrm\anim\vrma\`; gives a native wave and celebrate poses.
4. **Mixamo clips** (25 minutes, free Adobe ID): `spikes\vrm\anim\OWNER_CARD_mixamo.md`; FBX Binary,
   Without Skin, 30 fps, no keyframe reduction, into `spikes\vrm\anim\mixamo\`; gives sleep, wake,
   stretch, eat, drink, climb.
5. **Decide the weak face states** (VERIFY owner action 8): accept the vector open-mouth / brow
   states for now, or commission drawn frames later.

After 2, the build team runs stage 5 on your GLB, fixes what the manifest and renders show, loads
the VRM in the spike, and only then touches the pet.

## Hookup command (what the build team runs on your GLB)

One command. It probes the GLB, resolves the chain spec to the model's real size, builds the VRM
with her face texture and expression atlas, tail / ear / hair / skirt spring chains, MToon and an
outline scaled to the chibi, renders a four-view compare sheet beside the accepted turnaround and a
posed-tail sheet, then loads the VRM in the action lab (the real transparent window), captures every
action and emotion, and copies those sheets into the same run folder:

```powershell
python tools\vrm\hookup_whalechan.py --glb spikes\model\generated\meshy\whalechan_meshy_<date>_rigged.glb --face-material "<regex for her face material, from probe.json>"
```

Outputs land in `tools\vrm\out\whalechan\<timestamp>\`: `probe.json`, `chains.resolved.json`,
`whalechan.vrm`, `manifest.json`, `build.log`, `renders\`, `compare_sheet.png`, `sheet_posed.png`,
`window_sheet_actions.png`, `window_sheet_emotions.png`, `window_report.json`, `summary.json`. To
look at her live afterwards:

```powershell
cd D:\ds\apps\desktop
npx electron ../../spikes/vrm/actions/main.js --vrm ../../tools/vrm/out/whalechan/<timestamp>/whalechan.vrm
npx electron ../../spikes/vrm/main.js --vrm ../../tools/vrm/out/whalechan/<timestamp>/whalechan.vrm
```

Do not run `build_vrm.py` directly with `chains.whalechan.json`: that file holds fractions of model
height that only `hookup_whalechan.py` resolves into absolute boxes. Check `probe.json` for the face
material name before the first run; `--face-material` defaults to `face|skin_face|head` and the
script warns when more than one material matches.

### Repairing an auto-rig (what the Meshy run needed, 2026-09-02)

Meshy's API rig of her mesh needed four repairs before the skirt and hair behaved. All of them live in
`tools/vrm/chains.meshy01.json` and run inside `build_vrm.py`; pass the file with `--chains`:

```powershell
python tools\vrm\hookup_whalechan.py --glb spikes\model\generated\meshy\whalechan_meshy_rigged.glb --chains tools\vrm\chains.meshy01.json --run-name meshy-08
```

- **Baked clip and stray mesh.** The GLB carries an animation clip (`Armature|clip0|baselayer`) and a
  32-vertex icosphere. Blender evaluates the clip at the current frame, so every render and vertex
  scan saw a posed mesh. `find_armature_and_meshes` now clears all clips, resets the pose and drops
  unskinned, unparented meshes.
- **`bone_fixups`.** Both elbows sat 0.14 behind her back and the hand bones were as long as the
  forearms, pointing down through the skirt. `{"bone": "leftLowerArm", "head": [x, y, z]}` moves a
  joint (rest skinning is identity, so the rest mesh never deforms); `{"bone": "leftHand", "length":
  0.06}` shortens a bone along its own direction.
- **`weight_cleanup`.** Arm bones may only influence vertices within a sleeve radius of their own
  segment (`radius` is a number or `{"default", "<humanoid name>": r}`); `zones` give a region a
  tighter radius (the skirt, because the hands hang against it), and a zone `profile` treats the
  region as a surface of revolution around `axis_bone`: vertices on the mirrored radial profile are
  skirt, vertices protruding beyond it are hand. Stripped weight is renormalised; a vertex left
  with nothing goes to the nearest `fallback` bone. Runs before `--force-tpose`, which is what
  used to drag the skirt up like a sail.
- **Bone-relative chain selectors.** `"select": {"rel": {"bone": "hips", "min": [dx, dy, dz],
  "max": [...]}}` boxes in world units around a humanoid bone's head, so a chain file survives a
  regenerated mesh as long as the proportions hold. `"axis": [0, 0, -1]` forces a root-to-tip
  direction when PCA would pick the width of a wide slab (back hair). On this chibi the head bone
  sits at the chin (z 0.54 of 1.0) and the head fills the top 0.46, which is why the hair, ear and
  ahoge boxes are where they are.

Known remaining defect of the current mesh: her left cuff and the skirt side are one fused surface
(the turnaround had the arms against the dress), so a triangle of skirt rises with the left arm in
arm-above-shoulder actions. No weight rule can split a welded surface; the upstream fix is a
turnaround with the hands clear of the skirt (`spikes/model/OWNER_CARD_regen.md`).

## Licence chain

| link | licence | what it means for the pet |
|---|---|---|
| Community reference kit (`Neko3000/deepseek-whalechan`, the sheets cropped into `spikes/model/reference/`) | CC BY-NC-SA 4.0 | Everything derived from it (turnaround, generated mesh, VRM) is non-commercial and share-alike, and needs attribution. This is the binding constraint on the whole chain. |
| Our canonical illustration and v005 parts (face texture source) | ours | no constraint |
| Turnaround images (Gemini image model through our tool chain) | generator terms; derived from the kit | inherit NC-SA from the kit |
| Generated mesh and rig, Meshy paid plan | private ownership, no attribution to Meshy; rights tied to the plan at generation time; conditioned on our right to the uploaded reference | private, but still NC-SA through the kit. Free plan would be CC BY 4.0 public with the credit line "Model created with Meshy – CC BY 4.0 License". |
| Generated mesh and rig, Tripo paid plan | "Private Models · Commercial Use" | same; free plan is "Public Models · Non-Commercial Use" |
| VRM sample used for proofs (`VRM1_Constraint_Twist_Sample.vrm`, pixiv) and Seed-san (VirtualCast) | VRM Public License 1.0 | test inputs only; never shipped |
| Quaternius Universal Animation Library (Standard), 46 clips | CC0 1.0 (`License.txt` in the tree) | free for anything, no attribution |
| VRoid VRMA_MotionPack (7 clips, owner download) | pixiv terms: any use incl. commercial with the credit line "Character animation credits to pixiv Inc.'s VRoid Project"; no redistribution of the motions in extractable form | ship inside the pet only; credit line in About |
| Mixamo clips (owner download) | Adobe: royalty-free personal and commercial, no attribution; no redistribution of raw files; no ML training | FBX stays a private build input (git-ignored); ship only inside the pet's bundle |
| three.js, @pixiv/three-vrm, three-vrm-animation, the ported Mixamo loader and rig map, VRM Add-on for Blender | MIT | no constraint |

Net: the pet can be built and used privately now; any public release needs either a re-drawn
reference that does not derive from the kit, or an explicit licence from the kit's author.

## Known gaps carried from VERIFY.md (so nobody is surprised)

1. Face kit `atlas.json` and `build_vrm.py --face-atlas` speak different schemas; a bridge or a
   runtime per-region overlay is needed before her face goes on the model (a bridge is being
   written in `spikes/model/face/`, untracked at the time of writing).
2. The Blender face-parts alpha defect (opaque mouth/brow overlays on the stock head).
3. The runtime spike and the anim package each carry their own copy of three and their own Mixamo
   loader; the spike should import `anim/retarget/index.js`.
4. Fixed 2026-09-01 evening: the head turns with look-at and actions play real clips. The wave is Quaternius `Interact` until the owner drops `VRMA_02.vrma` or `mixamo/wave.fbx`, which the action controller then prefers automatically.
5. `--force-tpose` is untested on a real A-pose export and skips silently when shape keys exist.
6. Segmentation is off for the first generation; the tail / ear / skirt chains will be placed by
   material and bounding box unless a segmented second download keeps the rig.
