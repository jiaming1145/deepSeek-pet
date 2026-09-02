# REPORT - Blender VRM pipeline (tools/vrm), proven on a stock model

Date: 2026-09-01. Windows 11, Blender 5.2.0 LTS (bundled Python 3.13.13), Node 24.
Everything below is **verified (ran it)** unless marked otherwise.

## 1. Environment and add-on

* `blender.exe --background --python-expr "import bpy,sys;print(bpy.app.version)"` -> `(5, 2, 0)`.
* VRM Add-on for Blender (saturday06): latest release **v4.5.0** (2026-07-27), extension build
  `VRM_Addon_for_Blender-Extension-4_5_0.zip`; its `blender_manifest.toml` says
  `blender_version_min = "4.2.0"`, `blender_version_max = "5.3.0"` -> **Blender 5.2 is supported**,
  no other Blender was installed.
* `install_vrm_addon.py`: `bpy.ops.extensions.package_install_files(repo="user_default",
  enable_on_install=True)` then `preferences.addon_enable` + `wm.save_userpref` (the operator alone
  does not persist in `--background`). Fresh-process check:
  `hasattr(bpy.types,'IMPORT_SCENE_OT_vrm') -> True`, add-on in prefs -> True.
  Installed at `%APPDATA%\Blender Foundation\Blender\5.2\extensions\user_default\vrm`.

## 2. Scripts (D:\ds\tools\vrm)

`build_vrm.py` covers task items a-e:

* a. imports GLB/glTF, FBX, VRM or .blend; largest armature; bone -> VRM humanoid mapping by prefix
  stripping (`mixamorig:`, `J_Bip_`, `DEF-`, `Bip01`...), side markers (`Left/Right`, `L_/R_`,
  `_L/.L`, `LArm`), sided/unsided core-name tables (Mixamo, VRoid, Rigify, Unreal mannequin vocab),
  spine-chain rule (depth-ordered -> spine/chest/upperChest), finger rule. Unmapped bones are logged
  with a reason; missing required bones abort with exit 1.
* b. `chains.json`: selector (object / material / bbox / vertex_group) -> PCA axis -> N deform bones
  + `_end` leaf under a humanoid parent, linear-ramp weights with parent blend at the root,
  registered as `VRMC_springBone` springs (stiffness root->tip ramp, drag, gravity power/dir, hit
  radius, collider groups); head/hips/chest sphere colliders generated.
* c. `vrm.convert_material_to_mtoon1` per material; base texture also as shade-multiply texture,
  shade tint, toony 0.9, outline worldCoordinates 2.5 mm, outline colour = 0.28 x texture mean.
* d. `--face-texture` swaps base+shade texture of the `--face-material` match; `--face-atlas`
  rescales that material's UVs into the neutral cell and adds one `textureTransformBind`
  expression per state (`isBinary`, glTF UV space, exported verbatim); `--auto-morphs` /
  `--morph-map` add morph-target binds.
* e. `bpy.ops.export_scene.vrm` (VRM 1.0) + `vrm_manifest.py` (parses the GLB JSON chunk: bones,
  humanoid map, springs, expressions, materials, triangles) -> printed and written as JSON.

Also: `install_vrm_addon.py`, `render_turnaround.py` (re-import + EEVEE renders, expression /
posed-chain options), `make_stock_input.py` (test scaffolding), `run_demo.ps1`, `README.md`,
`.gitignore` (ignores `out/` and `vendor/`), `evidence/`.

## 3. Stock proof

**Input**: Seed-san.vrm (VRM Consortium sample by VirtualCast, VRM Public License 1.0, from
vrm-c/vrm-specification). `make_stock_input.py` makes it look like a Tripo/Meshy export: 90
non-humanoid bones (hair, robo-wire) dissolved into humanoid ancestors, 51 humanoid bones renamed
`mixamorig:*`, MToon -> Principled BSDF, all VRM data stripped, synthetic `tail` (rigid to Hips)
and `ear_L`/`ear_R` (rigid to Head) meshes added, a 2x4 face atlas from the `faceparts` texture
(cell 0 original, others tinted + banded) and chain specs. `stock_rigged.glb`: 60 nodes, 1 skin,
`extensionsUsed=['KHR_materials_emissive_strength']` (asserted: no `VRMC_*`).

**Build, GLB route** (`out/build_glb.log`, exit 0):
```
humanoid mapping: 51 bones mapped, 0 unmapped, 0 conflicts
chain tail:      331 verts, axis=(0.0, 0.833, -0.553), length=0.567 -> 7 deform bones + end, 8 joints, stiffness 0.9->0.35
chain ear_L/R:   111 verts each -> 2 bones + end, 3 joints
chain hair_tail: 156 verts (object selector) -> 6 bones + end, 7 joints
colliders: ['head_colliders', 'hips_colliders', 'chest_colliders']
materials converted to MToon: 20
face texture -> face_atlas.png (2048x4096) on material eye; 3990 UV loops rescaled into the neutral cell
expressions: blink/happy/angry/sad/surprised/aa/oh textureTransform offsets (0.5,0) (0,0.25) (0.5,0.25) (0,0.5) (0.5,0.5) (0,0.75) (0.5,0.75)
             blink/blinkLeft/blinkRight morph binds from shape keys eye_close/blink_L/blink_R
exported stock_character.vrm (19,350,820 bytes)
manifest: VRM 1.0; extensions KHR_materials_unlit, KHR_materials_emissive_strength, VRMC_materials_mtoon, VRMC_vrm, VRMC_springBone
          nodes=80 skin joints=72 meshes=8 triangles=45408 images=11 humanoid=51 springs=4 colliders=3
```
JSON spot-check: `tail_mat.baseColorFactor=[0.15,0.32,0.75,1]`, `shadeColorFactor=[0.75,0.72,0.82]`,
`outlineWidthMode=worldCoordinates/0.0025`; `preset.happy={isBinary:true, textureTransformBinds:
[{material:5 (eye), offset:[0,0.25], scale:[1,1]}]}`; `tail` spring 8 joints -> collider group 1,
`hair_tail` 7 joints -> group 0.

**.blend route** (`out/build_blend.log`, exit 0): painted vertex groups survive only in .blend;
`chains_blend.json` uses `vertex_group` selectors -> 12 chains (tail, 2 ears, TailHair 6 bones,
7 front-hair strands x 2 bones, RoboWire 6 bones), 100 bones, 12 springs in the VRM.

**FBX route** (`out/build_fbx.log`, exit 0): stock GLB re-exported as FBX, `build_vrm.py --input
stock_rigged.fbx` -> 51/51 mapped, 4 chains, VRM 15,150,772 bytes, 72 joints.

**Negative test**: Khronos `RiggedFigure.glb` (generic names) -> `0 mapped, 19 UNMAPPED (no rule)`,
`MISSING required: [...]`, exit 1 with the rename hint.

**Validity**: add-on re-import `re-import OK: spec=1.0 bones=72 humanoid_mapped=51 springs=4
meshes=8 materials_mtoon=20` (blend route bones=100 springs=12). Khronos gltf-validator
2.0.0-dev.3.10: `stock_character.vrm errors 0 warnings 26`, `stock_character_blendroute.vrm errors 0
warnings 26`, `stock_rigged.glb errors 0 warnings 14` (unlit+mtoon pairing, generated tangents;
VRMC extensions unknown to the validator).

**Renders** (EEVEE headless, copies in `tools/vrm/evidence/`), viewed and described:

| file | what I see |
|---|---|
| `neutral_000.png` | front: toon-shaded Seed-san in T-pose with dark outlines, light-blue ear cones both sides of the head, robo arm right, yellow eyes normal (neutral cell = original texture, so the UV rescale is right) |
| `neutral_090.png` / `neutral_270.png` | sides: pale-blue tail tube leaves the hips backwards and droops; ear fins above the head |
| `neutral_180.png` | back: tail hangs behind the backpack |
| `posed_090.png` / `posed_180.png` | chain roots rotated 35 deg: the tail swings up and bends along its bones (weights follow the chain), hair_tail lifts, body untouched |
| `blendroute_090.png` | 12-chain build posed the same way, no tearing at strand roots |
| `head_000_head.png` | head close-up neutral: yellow-brown irises |
| `head_000_happy_head.png` | happy applied via the exported offset (0,0.25) written into KHR_texture_transform: irises turn pink (happy cell); only the `eye` material changes |
| `head_000_blink_head.png` | blink: eyes closed by the `eye_close` shape key, remaining eye sliver grey (blink cell) - both bind types of one preset land |

Observation: untextured MToon colours (tail/ears) render paler in Blender's EEVEE MToon preview
than their factors; exported factors are exact, so judge colour in three-vrm.

`run_demo.ps1` re-ran install -> stock -> build -> 5 render passes -> manifest in one go and
ended with `[demo] done`; renders regenerated byte-identical to `evidence/`.

## 4. Gotchas (also in README)

* `wm.read_factory_settings` resets prefs and breaks the extension in-process ("No add-on
  preferences for bl_ext.user_default.vrm"); use `read_homefile(use_empty=True)` +
  `preferences.addon_enable`, not `addon_utils.enable`.
* Background VRM import of a licensed model needs `BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION=true`.
* glTF/FBX keep only bone weights; painted vertex groups need the .blend route.
* `Image.save()` needs `save(filepath=...)` for generated images.
* PowerShell 5.1 + `$ErrorActionPreference="Stop"` turns Blender stderr DeprecationWarnings into
  NativeCommandError; the demo uses Start-Process with redirected streams.
* The add-on's expression `preview` does not move shape keys in background; drive
  `key_blocks[].value` directly.
* Texture-transform expressions must be `isBinary` (three-vrm applies offset x weight = UV slide).

## 5. Not proven / limits

* Not yet loaded in three-vrm (renderer task); `isBinary` texture presets and the
  KHR_texture_transform v-axis should be checked there first.
* `--force-tpose` implemented but not exercised (stock input already T-posed): **likely, untested**.
* Chains are straight PCA lines; per-material MToon overrides not exposed; eye bones / look-at
  and first-person left at defaults.
* `evidence/` is 6.3 MB of PNG/JSON; `out/` (122 MB) and `vendor/` (12 MB) are git-ignored and
  regenerated by `run_demo.ps1` (~4 min, downloads Seed-san on first run).

## 6. Commands run

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python-expr "import bpy,sys;print('BLENDER',bpy.app.version, sys.version)"
"...\blender.exe" --background --python D:\ds\tools\vrm\install_vrm_addon.py
"...\blender.exe" --background --python-expr "import bpy;print('FRESH', hasattr(bpy.types,'IMPORT_SCENE_OT_vrm'), 'bl_ext.user_default.vrm' in bpy.context.preferences.addons)"  -> FRESH True True
"...\blender.exe" --background --python make_stock_input.py -- --vrm vendor/samples/Seed-san.vrm --outdir out/stock
"...\blender.exe" --background --python build_vrm.py -- --input out/stock/stock_rigged.glb --output out/build/stock_character.vrm --chains out/stock/chains.json --face-material "^eye$" --face-texture out/stock/face_atlas.png --face-atlas out/stock/face_atlas.json --auto-morphs --name StockTest --author pipeline-test --save-blend out/build/stock_character.blend
"...\blender.exe" --background --python build_vrm.py -- --input out/stock/stock_rigged.blend --output out/build/stock_character_blendroute.vrm --chains out/stock/chains_blend.json --face-material "^eye$" --name StockTestBlend
"...\blender.exe" --background --python build_vrm.py -- --input out/stock_fbx/stock_rigged.fbx --output out/build/stock_from_fbx.vrm --chains out/stock/chains.json --face-material "^eye$" --name StockFBX
"...\blender.exe" --background --python build_vrm.py -- --input vendor/samples/RiggedFigure.glb --output out/build/riggedfigure_negative.vrm   -> exit 1 (expected)
"...\blender.exe" --background --python render_turnaround.py -- --vrm out/build/stock_character.vrm --outdir out/renders --prefix neutral
"...\blender.exe" --background --python render_turnaround.py -- --vrm out/build/stock_character.vrm --outdir out/renders --prefix head --angles 0 --focus head --size 640x640 [--expression happy | --expression blink]
"...\blender.exe" --background --python render_turnaround.py -- --vrm out/build/stock_character.vrm --outdir out/renders --prefix posed --pose-tail 35 --angles 90,180
node validate.js out/build/stock_character.vrm out/build/stock_character_blendroute.vrm out/stock/stock_rigged.glb   (gltf-validator 2.0.0-dev.3.10, scratchpad)
powershell -ExecutionPolicy Bypass -File D:\ds\tools\vrm\run_demo.ps1   -> [demo] done
```
