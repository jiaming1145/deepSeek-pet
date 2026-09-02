# tools/vrm - Blender pipeline: auto-rigged GLB/FBX -> VRM 1.0

Turns what Tripo / Meshy hand back (a humanoid-rigged GLB or FBX with baked textures) into a
VRM 1.0 the pet renderer (three.js + @pixiv/three-vrm) can load: humanoid bone map, MToon toon
materials, spring-bone chains for tail / ears / hair / skirt, face-texture swap and expression
presets. Everything runs headless in Blender; nothing here needs the Blender UI.

Verified on: Blender 5.2.0 LTS (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`),
VRM Add-on for Blender 4.5.0 (extension build, supports Blender 4.2 - 5.2), Windows 11.

## Files

| file | purpose |
|---|---|
| `install_vrm_addon.py` | headless install + enable + verify of saturday06/VRM-Addon-for-Blender (downloads the release zip into `vendor/` if missing, saves user prefs so later `--background` runs keep it) |
| `build_vrm.py` | the pipeline: import GLB/FBX/VRM/.blend -> map bones -> extra spring chains -> MToon -> face texture / atlas expressions / morph expressions -> export VRM 1.0 + manifest |
| `vrm_manifest.py` | reads the JSON chunk of a .vrm/.glb and prints bones, humanoid map, springs, expressions, materials, triangles (plain Python, no Blender needed) |
| `render_turnaround.py` | re-imports a VRM (validity check) and renders it with EEVEE from N angles; can apply an expression or rotate the chain roots |
| `make_stock_input.py` | test scaffolding: converts a sample VRM into a "what an auto-rigger gives you" GLB (Mixamo bone names, no VRM data, no hair bones, rigid tail/ear meshes) plus a face atlas and chain spec |
| `run_demo.ps1` | the whole proof end to end |
| `evidence/` | renders, manifests and specs from the last proven run |

## Commands

```powershell
$B = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"

# 0. once: add-on
& $B --background --python tools\vrm\install_vrm_addon.py

# 1. build a VRM from a Tripo/Meshy export
& $B --background --python tools\vrm\build_vrm.py -- `
    --input  runs\whalechan\tripo_export.glb `
    --output runs\whalechan\whalechan.vrm `
    --chains tools\vrm\chains.whalechan.json `
    --face-material "face" `
    --face-texture runs\whalechan\face_atlas.png `
    --face-atlas   runs\whalechan\face_atlas.json `
    --height 1.0 --force-tpose `
    --name "Whale-chan" --author "owner"

# 2. inspect
python tools\vrm\vrm_manifest.py runs\whalechan\whalechan.vrm

# 3. look at it
& $B --background --python tools\vrm\render_turnaround.py -- --vrm runs\whalechan\whalechan.vrm --outdir runs\whalechan\renders
& $B --background --python tools\vrm\render_turnaround.py -- --vrm runs\whalechan\whalechan.vrm --outdir runs\whalechan\renders --focus head --angles 0 --expression happy

# proof on the stock model (downloads Seed-san, ~4 min)
powershell -ExecutionPolicy Bypass -File tools\vrm\run_demo.ps1
```

`build_vrm.py` options: `--chains`, `--face-material REGEX` (default `face|skin_face|head`),
`--face-texture PNG`, `--face-atlas JSON`, `--morph-map JSON`, `--auto-morphs`, `--height M`,
`--force-tpose`, `--no-mtoon`, `--shade-tint r,g,b`, `--outline-width F`, `--name/--author/--version`,
`--manifest PATH`, `--save-blend PATH`. Exit code is non-zero when a required humanoid bone is
missing (the log lists every unmapped bone with the reason) or when the export fails.

### chains.json

```json
{
  "colliders": true,
  "chains": [
    {"name": "tail",  "select": {"object": "^tail$"},          "bones": 7, "parent": "hips",
     "stiffness": 0.9, "stiffness_tip": 0.35, "drag": 0.3, "gravity": 0.25,
     "gravity_dir": [0, -1, 0], "hit_radius": 0.03, "blend_root": 0.12,
     "collider_groups": ["hips_colliders"]},
    {"name": "ear_L", "select": {"object": "^ear_L$"},         "bones": 2, "parent": "head"},
    {"name": "bangs", "select": {"material": "hair", "bbox": {"min": [-0.2, -0.3, 1.3], "max": [0.2, 0.0, 1.6]}},
     "bones": 3, "parent": "head"},
    {"name": "skirt_F", "select": {"vertex_group": "skirt_front"}, "bones": 3, "parent": "hips"}
  ]
}
```

* `select` picks vertices by any combination of `object` (regex on object name), `material`
  (regex on material name), `bbox` (world space, Blender Z-up, metres) and `vertex_group`
  (+ `vertex_group_min`, default 0.5). Vertex groups only exist in a `.blend` input - glTF/FBX
  keep only bone weights - so paint them in Blender, save, and pass the `.blend` as `--input`.
* The chain is laid along the selection's principal axis (PCA); the root is the end nearest the
  parent bone's head. `bones` deform bones + one non-deform `<name>_end` leaf are created, all
  registered as one `VRMC_springBone` spring. Weights are a linear ramp along the axis; the first
  `blend_root` fraction blends back into the parent bone so the joint does not tear.
* `parent` is a VRM humanoid name (`hips`, `head`, `chest`, ...) or a literal bone name.
* `colliders: true` adds sphere colliders on head / hips / chest and the collider groups
  `head_colliders`, `hips_colliders`, `chest_colliders` that a chain can reference.
* Stiffness ramps from `stiffness` at the root to `stiffness_tip` (default half) at the tip.

### face_atlas.json

```json
{"neutral": "neutral", "cols": 2, "rows": 4,
 "states": {"neutral": {"u": 0.0, "v": 0.0,  "w": 0.5, "h": 0.25},
            "blink":   {"u": 0.5, "v": 0.0,  "w": 0.5, "h": 0.25},
            "happy":   {"u": 0.0, "v": 0.25, "w": 0.5, "h": 0.25}}}
```

Coordinates are glTF UV space (origin top-left, v downwards, 0..1). The face material's mesh UVs
are rescaled into the neutral cell; every other state becomes a VRM expression with a
`textureTransformBind` `{offset: (u - u0, v - v0), scale: (1, 1)}` on that material. Names that
are VRM presets (`blink blinkLeft blinkRight aa ih ou ee oh happy angry sad relaxed surprised
neutral lookUp lookDown lookLeft lookRight`) become preset expressions, anything else a custom
expression. They are marked `isBinary` because a texture-transform at weight 0.5 slides the UV
halfway, it does not crossfade - crossfading two face states in the runtime means either two
overlaid face meshes with alpha, or an `isBinary` snap on the atlas plus a morph/alpha fade on top.

### Morph targets

`--auto-morphs` maps common shape-key names (`blink`, `eye_close`, `Fcl_EYE_Close`, `A/aa`,
`Fcl_MTH_A`, `vrc.v_aa`, `happy/joy`, ...) to presets; `--morph-map {"happy": "smile_key"}` adds
explicit ones. A preset can carry both a morph bind and a texture bind (blink in the demo does).

## What to export from Tripo / Meshy

* **Format**: GLB (preferred) or FBX, *with the rig* ("rigged"/"animation-ready" export, not the
  static mesh). Tripo: "Rig" -> export "GLB (rigged)"; Meshy: "Rigging" -> download "FBX/GLB
  with skeleton". Bring the base-colour texture baked into the file (embedded images); PBR
  metal/rough maps are ignored (MToon is unlit-ish), so "baked/albedo" texture mode is right.
* **Rig type**: humanoid / biped with Mixamo-compatible names (`Hips, Spine, Spine1, Spine2,
  Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand, LeftHandThumb1..3, ..., LeftUpLeg,
  LeftLeg, LeftFoot, LeftToeBase`, with or without the `mixamorig:` prefix). Also recognised:
  VRoid `J_Bip_L_UpperArm`, Rigify `upper_arm.L / thigh.L / shin.L / f_index.01.L`, Unreal
  mannequin `upperarm_l / calf_l / clavicle_l / thumb_01_l`, and `Left`/`Right`/`L_`/`_L`/`.L`
  side markers. Anything else is logged as UNMAPPED and the build stops if a required bone is
  missing (hips, spine, head, both upper/lower arms, hands, upper/lower legs, feet).
* **Pose**: T-pose or A-pose in rest. VRM 1.0 wants a T-pose rest; pass `--force-tpose` for an
  A-pose export (arms are rotated straight and baked as the new rest pose; skipped if the mesh
  has shape keys).
* **Scale**: metres; pass `--height 1.0` (or whatever the chibi should be) if the export is in cm
  or arbitrary units.
* **Parts**: if the generator can export the tail / ears / skirt as separate meshes (Tripo
  "segmented" export does), name them (`tail`, `ear_L`, `ear_R`, `skirt`) and use `object`
  selectors. If everything is one mesh, use `material` + `bbox` selectors, or paint vertex groups
  in Blender and use the `.blend` route.
* **Face**: a separate face material (or at least a separate material for the eyes/mouth region)
  is what makes the texture swap and atlas possible. Ask for "face on its own material / UV
  island" in the generation prompt; otherwise the whole head texture becomes the atlas cell.
* **Texture packing**: one base-colour PNG per material, UV in 0..1, no UDIM, no texture atlas
  shared with the face if the face is to be swapped (the swap replaces that material's texture
  wholesale).

## Known limits

* Bone mapping is by name; a rig with generic names (`joint_12`) fails on purpose - rename in
  Blender or extend `SIDED` / `UNSIDED` in `build_vrm.py`. Spine chains longer than 3 bones keep
  first / second / last as spine / chest / upperChest and log the rest.
* Chains are straight lines along the PCA axis. A curled tail gets a straight chain through it
  (the weights still follow the mesh; the spring simulation curls it at runtime).
* Chain weights replace whatever the auto-rigger painted on those vertices; the parent-blend
  region is the only thing that stops a seam. Tune `blend_root`.
* Texture-transform expressions cannot crossfade (see above); morph-target expressions can.
* `--force-tpose` refuses meshes with shape keys.
* The eye-look-at and first-person sections of VRM are left at defaults (three-vrm handles
  look-at procedurally from the head bone; adding eye bones is not automated).
* MToon values are one uniform guess (shade tint 0.75,0.72,0.82, toony 0.9, outline 2.5 mm in a
  base-colour-derived dark tint); per-material overrides are not exposed yet - edit the exported
  VRM in Blender or extend `convert_to_mtoon`.
* The Blender EEVEE preview brightens untextured MToon colours against a bright grey world; the
  exported factors are exact (see `evidence/*.manifest.json`), judge colours in three-vrm.
* Licence reminder: Seed-san (VirtualCast, VRM Public License 1.0) is used as a pipeline test
  input only; it is not redistributed from this repo and must not ship with the pet.
