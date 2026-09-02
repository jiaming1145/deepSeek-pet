# Checklist - inspecting the owner's generated GLB before `hookup_whalechan.py`

Run these on the file Tripo / Meshy hands back (`spikes/model/generated/<tripo|meshy>/*.glb`) before
the one-command hookup. Every check names the exact command; nothing here needs the Blender UI.

```powershell
$B   = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$GLB = "D:\ds\spikes\model\generated\tripo\whalechan_rigged.glb"   # <- the incoming file
```

The single most useful command is the probe (it is step 1 of the hookup, and answers 1-8 below in
one go, ~20 s):

```powershell
& $B --background --python tools\vrm\probe_glb.py -- --input $GLB --out toolsrm\out\probe\probe.json --print
```

It prints one summary line plus `WARNING:` lines, and writes the full JSON. Anything listed under
`warnings` must be understood before running the hookup. The rest of this file explains each check,
what "good" looks like for Whale-chan, and the fallback one-liners that need no script.

## 1. Is it a rigged glTF at all (skin + skeleton, textures embedded)?

```powershell
python tools\vrm\vrm_manifest.py $GLB
```

Good: `nodes=` > 50, `bones(skin joints)=` >= 22 (the 15 required humanoid bones plus spine/neck/toes/fingers),
`meshes=` >= 1, `images=` >= 1, `extensions: []` or only `KHR_*` (no `VRMC_*` - it must be a plain GLB, not an
already-converted VRM).
Bad: `bones(skin joints)=0` -> the export has no skin; re-export "with rig / animation-ready".
`images=0` -> textures were not embedded; re-export with baked/embedded textures.

Raw glTF JSON, no scripts:

```powershell
python -c "import sys; sys.path.insert(0,'tools/vrm'); from vrm_manifest import read_glb_json as r; g=r(sys.argv[1]); print(len(g.get('skins',[])),'skins', len(g.get('images',[])),'images', [n.get('name') for n in g['nodes']][:40])" $GLB
```

## 2. Bone names - will `build_vrm.py` map them?

```powershell
& $B --background --python tools\vrm\probe_glb.py -- --input $GLB --out toolsrm\out\probe\probe.json
python -c "import json; p=json.load(open('tools/vrm/out/probe/probe.json')); print('missing:', p['humanoid']['missing_required']); print('unmapped:', p['humanoid']['unmapped'])"
```

Good: `missing: []`. The mapper accepts Mixamo (`mixamorig:Hips`, `LeftArm`, `LeftForeArm`, ...), VRoid
(`J_Bip_L_UpperArm`), Rigify (`upper_arm.L`), Unreal (`upperarm_l`) and `Left/Right/L_/_L/.L` side markers.
Required: hips, spine, head, both upper/lower arms, hands, upper/lower legs, feet.
`unmapped` is fine for finger tips, `_end` leaves, twist/IK helpers, and any tail/ear/hair bones the
generator added (the chain builder replaces those weights anyway).
Bad: generic names (`joint_12`, `Bone.003`) -> `missing` is non-empty and the build stops. Rename in
Blender (or extend `SIDED` / `UNSIDED` in `build_vrm.py`).

Without the probe, from the raw node list:

```powershell
python -c "import sys; sys.path.insert(0,'tools/vrm'); from vrm_manifest import read_glb_json as r; g=r(sys.argv[1]); j=g['skins'][0]['joints']; print('\n'.join(g['nodes'][i].get('name','?') for i in j))" $GLB
```

## 3. Scale - metres, centimetres, or arbitrary?

`probe.json` -> `height`, `width`, `depth` (Blender world units after transforms are applied).

Good: any value; `--height 1.0` (the chains file's `height`) rescales uniformly. But note the number:
`1.0`-`1.8` = metres, `100`-`180` = centimetres, `0.01`-`0.05` or `> 1000` = arbitrary units (check that
the generator did not also bake a non-uniform scale: `width / height` should be about 0.6 in A-pose,
0.75 in T-pose; `depth / height` about 0.55 with a curled tail, 0.77 with a straight one - see
`evidence/turnaround_landmarks.json`).

Bare Blender one-liner (no scripts):

```powershell
& $B --background --python-expr "import bpy,sys; bpy.ops.wm.read_homefile(use_empty=True); bpy.ops.import_scene.gltf(filepath=sys.argv[-1]); from mathutils import Vector; ms=[o for o in bpy.data.objects if o.type=='MESH']; pts=[o.matrix_world@Vector(c) for o in ms for c in o.bound_box]; lo=Vector(map(min,*pts)); hi=Vector(map(max,*pts)); print('BBOX', tuple(lo), tuple(hi), 'H', hi.z-lo.z, 'W', hi.x-lo.x, 'D', hi.y-lo.y)" -- $GLB
```

## 4. Pose - T, A, or arms down? Shape keys present?

`probe.json` -> `rest_pose` (`T` / `A` / `arms-down`), `upper_arm_angles_deg`, and each mesh's `shape_keys`.

Good: `T`, or `A` with **no shape keys** (then `--force-tpose` straightens the arms and bakes the rest
pose). VRM 1.0 requires a T-pose rest; the Quaternius/Mixamo clips assume one.
Bad: `A` **with** shape keys - `build_vrm.py` skips `--force-tpose` on meshes with shape keys and the
VRM exports with the A-pose as rest (arms droop under every clip). Options: ask the generator for a
T-pose / "no facial blendshapes" export, or delete the shape keys in Blender first:

```powershell
& $B --background --python-expr "import bpy,sys; bpy.ops.wm.read_homefile(use_empty=True); bpy.ops.import_scene.gltf(filepath=sys.argv[-2]); [o.shape_key_clear() for o in bpy.data.objects if o.type=='MESH' and o.data.shape_keys]; bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format='GLB')" -- $GLB toolsrm\out\probe\whalechan_noshapes.glb
```

Also: `facing` must be `-Y` (glTF +Z forward, the normal case). `+Y` is handled (the hookup mirrors
the depth axis) but look at the renders; `null` means no toe bones to vote with - look at
`renders/turn_000.png` and make sure the face is in the front view.

## 5. Materials - how many, is there a face material, are the textures there?

`probe.json` -> `materials[]` with `base_colour_image`, `users_meshes`, `face_regex_default_match`.

```powershell
python -c "import json; p=json.load(open('tools/vrm/out/probe/probe.json')); [print(m['name'], '|', (m['base_colour_image'] or {}).get('size'), '| face-regex:', m['face_regex_default_match'], '|', m['users_meshes']) for m in p['materials']]"
```

Good for Whale-chan: **2+ materials with one named `face`/`head`** (or at least a separate material
for the eyes/mouth region). Then `--face-texture` replaces only that texture, and the face-bridge atlas
expressions can follow.
Single material (the usual Meshy/Tripo "one baked texture" case): the face swap would replace the
**whole body texture** -> the hookup logs a warning and still runs if a name matches; pass `--no-face`
to skip the swap, or `--face-material '^$'` (matches nothing, same effect), and plan for the runtime
face-overlay route instead. No material name matching `face|skin_face|head`: the hookup skips the
face texture and says so (`summary.json` -> `warnings`).
`base_colour_image: null` on every material: textures not embedded -> re-export.

## 6. Parts - separate meshes for the tail / ears / hair, or one blob?

`probe.json` -> `meshes[]` (`name`, `vertices`, `materials`, `bbox`).

If the generator exported segmented parts, the hookup promotes those chains automatically
(`chains.resolved.json` -> `_resolution[].route` = `object`), which is far more reliable than the
bbox fallback. Names it recognises (case-insensitive regex, see `chains.whalechan.json` -> `prefer`):
`tail`, `fluke`, `ear_L`/`ear_R`/`left_ear`/`fin_L`, `ahoge`, `bang`/`fringe`/`hair_front`,
`sidelock_L`/`hair_side_L`, `hair_back_L`/`back_hair_L`, `skirt_f`/`apron`, `skirt_b`/`bow`.
One mesh, one material: every chain falls back to `route = bbox`; expect the known overlaps
(REPORT_hookup.md "what the bbox fallback gets wrong") and check `renders/posed_*.png`.

## 7. Polygon budget

`probe.json` -> `triangles`. Good: < 60k for the pet window (the stock Seed-san is 45k). The probe
warns above 150k; Meshy "high" exports are often 300k+ -> use the generator's decimate option.

## 8. Facing and symmetry sanity (eyes)

After the hookup, open `renders/turn_000.png`: the face must be visible, tail behind, ears left and
right. If the front view shows the back of the head, the file was exported -Z forward; the probe
should have said `facing: +Y` - if it said `-Y`, the toe bones point backwards (report it).

## 9. Textures readable by three-vrm

`python tools\vrm\vrm_manifest.py $GLB` -> `images=`; then `probe.json -> images[].size`. PNG/JPEG
only (KTX2/basis needs a decoder the runtime spike does not load). Sizes of 2048 or 4096 are fine.

## 10. Then

```powershell
python tools\vrm\hookup_whalechan.py --glb $GLB
```

and look at `tools\vrm\out\whalechan\<timestamp>\compare_sheet.png` (reference beside render, 4 views),
`sheet_posed.png` (tail chain bending, head close-up), `summary.json` (`warnings`, per-chain vertex
counts under `steps.build.chains` - a chain with `verts: 0` matched nothing and was skipped).
