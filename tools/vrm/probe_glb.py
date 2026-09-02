"""probe_glb.py - inspect an incoming rigged GLB/FBX/VRM exactly the way build_vrm.py will see it.

  blender --background --python tools/vrm/probe_glb.py -- --input model.glb --out probe.json [--print]

Imports the file with the same importer settings as build_vrm.py, applies object transforms, and
writes a JSON with everything CHECKLIST_incoming_glb.md asks about:

  bbox / height / width / depth (Blender Z-up world space, metres as exported)
  facing            "-Y" (glTF +Z forward, what build_vrm and the chain fractions assume) or "+Y"
  rest_pose         "T" / "A" / "?" from the upper-arm direction, with the angle
  armature          bone count, bone names, humanoid mapping result (mapped / missing / unmapped),
                    world position of every mapped humanoid bone head (hips x is the symmetry centre
                    the chain resolver uses)
  meshes            name, vertices, triangles, materials, shape keys, armature modifier
  materials         name, base-colour image (name, size), blend mode
  images            name, size, packed?
  warnings          plain-language problems (missing required bones, no textures, shape keys +
                    --force-tpose, model not facing -Y, scale far from 1 m, ...)

No Blender scene is saved; nothing is modified. Uses build_vrm's own import/mapping functions so
the answer matches what the build will do.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_vrm as bv  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="probe_glb.py")
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--print", action="store_true", help="also print the JSON to stdout")
    return p.parse_args(argv)


def bone_world(arm, bone, which="head"):
    return arm.matrix_world @ (bone.head_local if which == "head" else bone.tail_local)


def detect_facing(arm, mapping):
    """'-Y' if the toes sit in front of (more -Y than) the ankles, '+Y' if behind, None if unknown."""
    votes = []
    for side in ("left", "right"):
        foot, toes = mapping.get(f"{side}Foot"), mapping.get(f"{side}Toes")
        if foot and toes and foot in arm.data.bones and toes in arm.data.bones:
            dy = bone_world(arm, arm.data.bones[toes]).y - bone_world(arm, arm.data.bones[foot]).y
            if abs(dy) > 1e-5:
                votes.append(-1 if dy < 0 else 1)
    if not votes:
        # fall back to the foot bone's own direction (ankle -> toe tip) if it has length
        for side in ("left", "right"):
            foot = mapping.get(f"{side}Foot")
            if foot and foot in arm.data.bones:
                b = arm.data.bones[foot]
                dy = bone_world(arm, b, "tail").y - bone_world(arm, b).y
                if abs(dy) > 1e-5:
                    votes.append(-1 if dy < 0 else 1)
    if not votes:
        return None, "no foot/toe bones to vote with"
    s = sum(votes)
    if s == 0:
        return None, f"foot votes disagree {votes}"
    return ("-Y" if s < 0 else "+Y"), f"votes={votes}"


def detect_rest_pose(arm, mapping):
    angles = []
    for side, sign in (("left", 1.0), ("right", -1.0)):
        ua = mapping.get(f"{side}UpperArm")
        la = mapping.get(f"{side}LowerArm")
        if not ua or ua not in arm.data.bones:
            continue
        b = arm.data.bones[ua]
        tip = arm.data.bones[la].head_local if la and la in arm.data.bones else b.tail_local
        d = arm.matrix_world.to_3x3() @ (tip - b.head_local)
        if d.length < 1e-6:
            continue
        d.normalize()
        # angle below the horizontal, measured in the X/Z plane, positive = arm hanging down
        horiz = Vector((sign, 0.0, 0.0))
        ang = math.degrees(math.atan2(-d.z, max(d.dot(horiz), 1e-6)))
        angles.append(round(ang, 1))
    if not angles:
        return "?", angles
    mean = sum(angles) / len(angles)
    if mean < 12:
        kind = "T"
    elif mean < 70:
        kind = "A"
    else:
        kind = "arms-down"
    return kind, angles


def image_info(img):
    if img is None:
        return None
    return {"name": img.name, "size": [int(img.size[0]), int(img.size[1])], "packed": bool(img.packed_file),
            "filepath": img.filepath if not img.packed_file else ""}


def base_colour_image(mat):
    if not mat or not mat.use_nodes or not mat.node_tree:
        return None
    # follow the Principled BSDF base colour link first; otherwise any image node
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            inp = n.inputs.get("Base Color")
            if inp and inp.is_linked:
                src = inp.links[0].from_node
                if src.type == "TEX_IMAGE":
                    return src.image
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
    return None


def main():
    a = parse_args()
    bv.reset_scene()
    bv.ensure_addon()
    path = os.path.abspath(a.input)
    if not os.path.exists(path):
        bv.die(f"input not found: {path}")
    bv.import_model(path)
    arm, meshes = bv.find_armature_and_meshes()
    bv.apply_transforms(arm, meshes)
    lo, hi = bv.world_bbox(meshes)
    size = hi - lo
    mapping, missing = bv.map_humanoid(arm)
    facing, facing_why = detect_facing(arm, mapping)
    pose_kind, arm_angles = detect_rest_pose(arm, mapping)

    bones = []
    for b in arm.data.bones:
        v, why = bv.classify(b.name)
        bones.append({"name": b.name, "parent": b.parent.name if b.parent else None,
                      "depth": bv.bone_depth(b), "vrm": (v if v != "SPINECHAIN" else "spine-chain"),
                      "rule": why, "length": round((b.tail_local - b.head_local).length, 4)})
    humanoid_world = {}
    for vrm_name, bname in mapping.items():
        b = arm.data.bones.get(bname)
        if b:
            hw = bone_world(arm, b)
            humanoid_world[vrm_name] = [round(hw.x, 4), round(hw.y, 4), round(hw.z, 4)]
    mapped_names = set(mapping.values())
    unmapped = [b["name"] for b in bones if b["name"] not in mapped_names]

    mesh_rows = []
    total_tris = 0
    for m in meshes:
        me = m.data
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        total_tris += tris
        mlo = Vector((1e9,) * 3)
        mhi = Vector((-1e9,) * 3)
        for c in m.bound_box:
            w = m.matrix_world @ Vector(c)
            mlo = Vector(map(min, mlo, w))
            mhi = Vector(map(max, mhi, w))
        mesh_rows.append({
            "name": m.name, "vertices": len(me.vertices), "triangles": tris,
            "materials": [ms.material.name if ms.material else None for ms in m.material_slots],
            "shape_keys": [kb.name for kb in me.shape_keys.key_blocks] if me.shape_keys else [],
            "armature_modifier": any(md.type == "ARMATURE" and md.object == arm for md in m.modifiers),
            "vertex_groups": len(m.vertex_groups),
            "uv_layers": [uv.name for uv in me.uv_layers],
            "bbox": {"min": [round(x, 4) for x in mlo], "max": [round(x, 4) for x in mhi]},
        })

    mat_rows = []
    for mat in bv.used_materials(meshes):
        img = base_colour_image(mat)
        mat_rows.append({
            "name": mat.name, "base_colour_image": image_info(img),
            "blend_method": getattr(mat, "surface_render_method", getattr(mat, "blend_method", None)),
            "users_meshes": [m.name for m in meshes if any(ms.material == mat for ms in m.material_slots)],
            "face_regex_default_match": bool(bv.re.search(r"face|skin_face|head", mat.name, bv.re.I)),
        })
    images = [image_info(i) for i in bpy.data.images if i.users and i.size[0] > 0]

    warnings = []
    if missing:
        warnings.append(f"required humanoid bones missing: {missing} (build_vrm.py will stop)")
    if facing is None:
        warnings.append(f"could not detect facing ({facing_why}); the chain fractions assume the model faces -Y after import")
    elif facing != "-Y":
        warnings.append("model faces +Y after import (glTF -Z forward); hookup flips the depth axis of the chain fractions, but check the renders")
    if not (0.3 <= size.z <= 3.0):
        warnings.append(f"height {size.z:.3f} units - not metres? --height will rescale, but check that spring/collider radii still make sense")
    if any(r["shape_keys"] for r in mesh_rows):
        warnings.append("meshes carry shape keys: build_vrm.py --force-tpose is SKIPPED on such input (rest pose stays as exported)")
    if pose_kind == "A":
        warnings.append(f"rest pose is an A-pose (upper arms {arm_angles} deg below horizontal); --force-tpose is needed for a VRM 1.0 T-pose rest")
    if not any(r["base_colour_image"] for r in mat_rows):
        warnings.append("no material has a base-colour texture; export with baked/embedded textures")
    if len(mat_rows) == 1:
        warnings.append("single material: the face texture swap would replace the WHOLE body texture; ask the generator for a separate face material or skip --face-texture")
    if not any(r["face_regex_default_match"] for r in mat_rows):
        warnings.append("no material name matches the default face regex (face|skin_face|head); pass --face-material or skip the face texture")
    if not any(r["armature_modifier"] for r in mesh_rows):
        warnings.append("no mesh is skinned to the armature (export WITH the rig / skin)")
    if total_tris > 150000:
        warnings.append(f"{total_tris} triangles is heavy for the pet window; consider a decimated export")

    out = {
        "input": path,
        "bbox": {"min": [round(x, 4) for x in lo], "max": [round(x, 4) for x in hi]},
        "height": round(size.z, 4), "width": round(size.x, 4), "depth": round(size.y, 4),
        "centre_x": round((lo.x + hi.x) / 2, 4),
        "width_over_height": round(size.x / size.z, 3) if size.z else None,
        "depth_over_height": round(size.y / size.z, 3) if size.z else None,
        "facing": facing, "facing_detail": facing_why,
        "rest_pose": pose_kind, "upper_arm_angles_deg": arm_angles,
        "armature": {"name": arm.name, "bone_count": len(arm.data.bones), "bones": bones},
        "humanoid": {"mapped": mapping, "mapped_count": len(mapping), "missing_required": missing, "unmapped": unmapped,
                     "world_head_positions": humanoid_world},
        "meshes": mesh_rows, "triangles": total_tris,
        "materials": mat_rows, "images": images,
        "warnings": warnings,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"[probe] height={size.z:.3f} width={size.x:.3f} depth={size.y:.3f} facing={facing} pose={pose_kind} "
          f"bones={len(arm.data.bones)} mapped={len(mapping)} missing={missing} meshes={len(meshes)} "
          f"materials={len(mat_rows)} tris={total_tris}")
    for w in warnings:
        print(f"[probe] WARNING: {w}")
    if a.print:
        print(json.dumps(out, indent=2))
    print(f"[probe] written {a.out}")


if __name__ == "__main__":
    main()
