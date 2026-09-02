"""make_stock_input.py - turn a sample VRM into the kind of file Tripo/Meshy auto-rig hands us.

  blender --background --python tools/vrm/make_stock_input.py -- --vrm Seed-san.vrm --outdir out/

Produces, in --outdir:
  stock_rigged.glb   plain glTF: one humanoid skeleton with Mixamo names ("mixamorig:Hips", ...),
                     Principled BSDF materials with base-colour textures, NO VRM extension data,
                     no hair/accessory bones (their weights are merged into the nearest humanoid bone,
                     which is exactly what an auto-rigger gives you), plus a synthetic "tail" mesh and
                     two "ear_L/ear_R" meshes skinned rigidly to Hips/Head, and merged vertex groups
                     "vg_<spring name>" marking where the original hair strands were.
  face_atlas.png     2x4 atlas built from the face texture (cell 0 = original, others tinted+banded)
  face_atlas.json    atlas spec in glTF UV space for build_vrm.py --face-atlas
  chains.json        chain spec exercising object / vertex-group selectors
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

ADDON_MODULE = "bl_ext.user_default.vrm"

VRM_TO_MIXAMO = {
    "hips": "Hips", "spine": "Spine", "chest": "Spine1", "upperChest": "Spine2",
    "neck": "Neck", "head": "Head",
    "leftShoulder": "LeftShoulder", "leftUpperArm": "LeftArm", "leftLowerArm": "LeftForeArm", "leftHand": "LeftHand",
    "rightShoulder": "RightShoulder", "rightUpperArm": "RightArm", "rightLowerArm": "RightForeArm", "rightHand": "RightHand",
    "leftUpperLeg": "LeftUpLeg", "leftLowerLeg": "LeftLeg", "leftFoot": "LeftFoot", "leftToes": "LeftToeBase",
    "rightUpperLeg": "RightUpLeg", "rightLowerLeg": "RightLeg", "rightFoot": "RightFoot", "rightToes": "RightToeBase",
}
FINGERS = {"Thumb": "Thumb", "Index": "Index", "Middle": "Middle", "Ring": "Ring", "Little": "Pinky"}
SEGS_THUMB = {"Metacarpal": 1, "Proximal": 2, "Distal": 3}
SEGS = {"Proximal": 1, "Intermediate": 2, "Distal": 3}
for side in ("left", "right"):
    S = side.capitalize()
    for f, mf in FINGERS.items():
        segs = SEGS_THUMB if f == "Thumb" else SEGS
        for seg, n in segs.items():
            VRM_TO_MIXAMO[f"{side}{f}{seg}"] = f"{S}Hand{mf}{n}"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--vrm", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--face-material", default="eye")
    p.add_argument("--prefix", default="mixamorig:")
    return p.parse_args(argv)


def log(msg):
    print(f"[stock] {msg}")


def enum_to_camel(enum_name):
    # HumanBoneName.LEFT_UPPER_ARM -> leftUpperArm
    parts = enum_name.split(".")[-1].lower().split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def restore_alpha_mode(mat, alpha_mode, cutoff):
    """Wire the base-colour texture alpha into the Principled BSDF the way the glTF importer does, so
    the glTF exporter writes alphaMode BLEND / MASK (+alphaCutoff) instead of OPAQUE."""
    if alpha_mode not in ("BLEND", "MASK") or not mat.node_tree:
        return
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    base = bsdf.inputs["Base Color"]
    tex = base.links[0].from_node if base.is_linked and base.links[0].from_node.type == "TEX_IMAGE" else None
    alpha_in = bsdf.inputs["Alpha"]
    if tex is None:
        if alpha_mode == "BLEND" and alpha_in.default_value >= 1.0:
            alpha_in.default_value = 0.999
    elif alpha_mode == "BLEND":
        links.new(tex.outputs["Alpha"], alpha_in)
    else:  # MASK: alpha = 1 - (a < cutoff), the chain the exporter's detect_alpha_clip recognises
        sub = nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[0].default_value = 1.0
        lt = nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = cutoff
        links.new(tex.outputs["Alpha"], lt.inputs[0])
        links.new(lt.outputs[0], sub.inputs[1])
        links.new(sub.outputs[0], alpha_in)
    mat.surface_render_method = "BLENDED" if alpha_mode == "BLEND" else "DITHERED"
    log(f"  alpha mode kept on {mat.name}: {alpha_mode}" + (f" cutoff={cutoff}" if alpha_mode == "MASK" else ""))


def main():
    a = parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    os.environ["BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION"] = "true"
    bpy.ops.wm.read_homefile(use_empty=True)
    if ADDON_MODULE not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=ADDON_MODULE)
    bpy.ops.import_scene.vrm(filepath=os.path.abspath(a.vrm))
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    ext = arm.data.vrm_addon_extension
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    log(f"imported {a.vrm}: {len(arm.data.bones)} bones, {len(meshes)} meshes")

    # --- humanoid map from the VRM
    vrm_map = {}
    for enum_name, hb in ext.vrm1.humanoid.human_bones.human_bone_name_to_human_bone().items():
        if hb.node.bone_name:
            vrm_map[enum_to_camel(str(enum_name))] = hb.node.bone_name
    humanoid_bones = set(vrm_map.values())
    log(f"humanoid bones in source: {len(humanoid_bones)}")

    # --- merged vertex groups marking the hair strands (what an artist would paint by hand)
    spring_groups = {}
    for s in ext.spring_bone1.springs:
        spring_groups[f"vg_{s.vrm_name}"] = [j.node.bone_name for j in s.joints if j.node.bone_name]
    for m in meshes:
        for gname, bones in spring_groups.items():
            src = [m.vertex_groups[b] for b in bones if b in m.vertex_groups]
            if not src:
                continue
            idxs = {g.index for g in src}
            acc = {}
            for v in m.data.vertices:
                w = sum(g.weight for g in v.groups if g.group in idxs)
                if w > 0.01:
                    acc[v.index] = min(w, 1.0)
            if acc:
                vg = m.vertex_groups.new(name=gname)
                for vi, w in acc.items():
                    vg.add([vi], w, "REPLACE")
                log(f"  {m.name}: vertex group {gname} <- {len(acc)} verts from {bones}")

    # --- dissolve non-humanoid bones: weights to nearest humanoid ancestor
    def humanoid_ancestor(b):
        while b is not None and b.name not in humanoid_bones:
            b = b.parent
        return b.name if b else vrm_map["hips"]

    redirect = {b.name: humanoid_ancestor(b) for b in arm.data.bones if b.name not in humanoid_bones}
    for m in meshes:
        by_index = {g.index: g for g in m.vertex_groups}
        moves = {}
        for v in m.data.vertices:
            for g in v.groups:
                src = by_index[g.group].name
                if src in redirect and g.weight > 0:
                    moves.setdefault(v.index, {}).setdefault(redirect[src], 0.0)
                    moves[v.index][redirect[src]] += g.weight
        for vi, dests in moves.items():
            for dst, w in dests.items():
                vg = m.vertex_groups.get(dst) or m.vertex_groups.new(name=dst)
                cur = 0.0
                for g in m.data.vertices[vi].groups:
                    if g.group == vg.index:
                        cur = g.weight
                vg.add([vi], min(cur + w, 1.0), "REPLACE")
        for src in redirect:
            if src in m.vertex_groups:
                m.vertex_groups.remove(m.vertex_groups[src])
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name in list(redirect):
        eb = arm.data.edit_bones.get(name)
        if eb:
            arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"dissolved {len(redirect)} non-humanoid bones into their humanoid ancestors")

    # --- strip VRM data so the file is a plain rigged glTF
    for col in list(ext.spring_bone1.colliders):
        if col.bpy_object:
            bpy.data.objects.remove(col.bpy_object, do_unlink=True)
    ext.spring_bone1.colliders.clear()
    ext.spring_bone1.collider_groups.clear()
    ext.spring_bone1.springs.clear()
    for m in meshes:
        for md in list(m.modifiers):
            if md.type != "ARMATURE":
                m.modifiers.remove(md)
    for mat in list(bpy.data.materials):
        gltf = mat.vrm_addon_extension.mtoon1
        if gltf.enabled:
            alpha_mode, cutoff = gltf.alpha_mode, float(gltf.alpha_cutoff)
            bpy.ops.vrm.convert_mtoon1_to_bsdf_principled(material_name=mat.name)
            # the add-on's conversion only copies the constant alpha factor; a real generator export
            # keeps alphaMode BLEND/MASK with the texture alpha wired in, so restore that here
            restore_alpha_mode(mat, alpha_mode, cutoff)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("MToon Outline"):
            bpy.data.materials.remove(mat)
    for o in list(bpy.data.objects):
        if o.type not in ("ARMATURE", "MESH"):
            bpy.data.objects.remove(o, do_unlink=True)

    # --- rename humanoid bones to Mixamo names
    rename = {}
    for vrm, bname in vrm_map.items():
        if vrm in VRM_TO_MIXAMO:
            rename[bname] = a.prefix + VRM_TO_MIXAMO[vrm]
    for bname, new in rename.items():
        arm.data.bones[bname].name = new  # vertex groups follow automatically
    log(f"renamed {len(rename)} bones to Mixamo names (prefix {a.prefix!r})")
    unrenamed = [b.name for b in arm.data.bones if b.name not in rename.values()]
    if unrenamed:
        log(f"bones left with original names (no Mixamo equivalent): {unrenamed}")
    hips = arm.data.bones[a.prefix + "Hips"]
    head = arm.data.bones[a.prefix + "Head"]

    # --- synthetic tail + ears (rigid-skinned, the way an auto-rigger leaves accessories)
    def tube(name, path, radius_fn, colour, bone):
        verts, faces = [], []
        rings = len(path)
        seg = 10
        for i, (p, r) in enumerate(zip(path, [radius_fn(i / (rings - 1)) for i in range(rings)])):
            d = (path[min(i + 1, rings - 1)] - path[max(i - 1, 0)]).normalized()
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            x = d.cross(up).normalized()
            y = x.cross(d).normalized()
            for k in range(seg):
                t = 2 * math.pi * k / seg
                verts.append(p + (x * math.cos(t) + y * math.sin(t)) * r)
        for i in range(rings - 1):
            for k in range(seg):
                a0 = i * seg + k
                a1 = i * seg + (k + 1) % seg
                faces.append((a0, a1, a1 + seg, a0 + seg))
        # cap the tip
        tip = len(verts)
        verts.append(path[-1])
        for k in range(seg):
            faces.append(((rings - 1) * seg + k, (rings - 1) * seg + (k + 1) % seg, tip))
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in verts], [], faces)
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        mat = bpy.data.materials.new(name + "_mat")
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = colour
        me.materials.append(mat)
        ob.vertex_groups.new(name=bone).add(list(range(len(verts))), 1.0, "REPLACE")
        md = ob.modifiers.new("Armature", "ARMATURE")
        md.object = arm
        ob.parent = arm
        uv = me.uv_layers.new()
        for li in range(len(me.loops)):
            uv.data[li].uv = (0.5, 0.5)
        return ob

    hips_w = arm.matrix_world @ hips.head_local
    head_w = arm.matrix_world @ head.head_local
    head_len = (head.tail_local - head.head_local).length
    # tail: from the hips, backwards (+Y in Blender = behind a -Y-facing character) and drooping
    path = []
    for i in range(9):
        t = i / 8
        path.append(hips_w + Vector((0.0, 0.05 + 0.45 * t, -0.02 - 0.28 * t * t)))
    tube("tail", path, lambda t: 0.055 * (1 - 0.75 * t) + 0.012, (0.15, 0.32, 0.75, 1.0), a.prefix + "Hips")
    for side, sx in (("L", 1.0), ("R", -1.0)):
        base = head_w + Vector((sx * head_len * 0.55, 0.0, head_len * 0.75))
        path = [base + Vector((sx * 0.13 * t, 0.0, 0.09 * t)) for t in (0, 0.25, 0.5, 0.75, 1.0)]
        tube(f"ear_{side}", path, lambda t: 0.035 * (1 - 0.8 * t) + 0.006, (0.35, 0.6, 0.9, 1.0), a.prefix + "Head")
    log("added synthetic tail + ear_L + ear_R meshes")

    # --- face atlas from the face material's texture
    import numpy as np

    face_mat = bpy.data.materials.get(a.face_material)
    img = None
    if face_mat and face_mat.node_tree:
        for n in face_mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                img = n.image
                break
    if img is None:
        log(f"no texture on material {a.face_material!r}; atlas skipped")
    else:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)  # row 0 = bottom
        cols, rows = 2, 4
        atlas = np.zeros((h * rows, w * cols, 4), dtype=np.float32)
        states = ["neutral", "blink", "happy", "angry", "sad", "surprised", "aa", "oh"]
        tints = {
            "neutral": (1, 1, 1), "blink": (0.55, 0.55, 0.65), "happy": (1.0, 0.75, 0.85),
            "angry": (1.0, 0.55, 0.45), "sad": (0.6, 0.7, 1.0), "surprised": (1.0, 1.0, 0.6),
            "aa": (0.7, 1.0, 0.7), "oh": (0.8, 0.65, 1.0),
        }
        spec = {"neutral": "neutral", "cols": cols, "rows": rows, "states": {}}
        for i, st in enumerate(states):
            c, r = i % cols, i // cols  # r = 0 is the TOP row in glTF/image space
            cell = px.copy()
            tr, tg, tb = tints[st]
            cell[..., 0] *= tr
            cell[..., 1] *= tg
            cell[..., 2] *= tb
            if st != "neutral":
                band = slice(int(h * 0.42), int(h * 0.58))  # horizontal bar through the middle
                cell[band, :, 0:3] = np.array(tints[st], dtype=np.float32) * 0.5
                cell[band, :, 3] = 1.0
            y0 = (rows - 1 - r) * h  # numpy rows grow upward
            atlas[y0 : y0 + h, c * w : (c + 1) * w] = cell
            spec["states"][st] = {"u": c / cols, "v": r / rows, "w": 1 / cols, "h": 1 / rows}
        out_img = bpy.data.images.new("face_atlas", width=w * cols, height=h * rows, alpha=True)
        out_img.pixels.foreach_set(atlas.ravel())
        out_img.file_format = "PNG"
        out_img.save(filepath=os.path.join(os.path.abspath(a.outdir), "face_atlas.png"))
        with open(os.path.join(a.outdir, "face_atlas.json"), "w", encoding="utf-8") as f:
            json.dump(spec, f, indent=2)
        log(f"face atlas: {w * cols}x{h * rows} from {img.name} ({face_mat.name}) -> face_atlas.png/.json")

    # --- chain spec for build_vrm.py
    chains = {
        "colliders": True,
        "chains": [
            {"name": "tail", "select": {"object": "^tail$"}, "bones": 7, "parent": "hips",
             "stiffness": 0.9, "stiffness_tip": 0.35, "drag": 0.3, "gravity": 0.25, "hit_radius": 0.03,
             "blend_root": 0.12, "collider_groups": ["hips_colliders"]},
            {"name": "ear_L", "select": {"object": "^ear_L$"}, "bones": 2, "parent": "head",
             "stiffness": 1.2, "drag": 0.4, "gravity": 0.0, "hit_radius": 0.01, "blend_root": 0.2},
            {"name": "ear_R", "select": {"object": "^ear_R$"}, "bones": 2, "parent": "head",
             "stiffness": 1.2, "drag": 0.4, "gravity": 0.0, "hit_radius": 0.01, "blend_root": 0.2},
        ],
    }
    # separate hair_tail mesh -> object selector (survives glTF); painted vertex groups only survive
    # in the .blend, so those chains go into chains_blend.json for the .blend input route
    chains["chains"].append(
        {"name": "hair_tail", "select": {"object": "^hair_tail$"}, "bones": 6, "parent": "head",
         "stiffness": 0.7, "drag": 0.35, "gravity": 0.15, "hit_radius": 0.02, "blend_root": 0.1,
         "collider_groups": ["head_colliders"]}
    )
    chains_blend = {"colliders": True, "chains": [dict(c) for c in chains["chains"] if c["name"] != "hair_tail"]}
    for gname, bones in spring_groups.items():
        if not any(gname in m.vertex_groups for m in meshes):
            continue
        n = max(2, min(len(bones) - 1, 6))
        chains_blend["chains"].append(
            {"name": gname.replace("vg_", "hair_"), "select": {"vertex_group": gname, "vertex_group_min": 0.3},
             "bones": n, "parent": "head", "stiffness": 0.7, "drag": 0.35, "gravity": 0.15,
             "hit_radius": 0.015, "blend_root": 0.1, "collider_groups": ["head_colliders"]}
        )
    with open(os.path.join(a.outdir, "chains_blend.json"), "w", encoding="utf-8") as f:
        json.dump(chains_blend, f, indent=2)
    log(f"chains_blend.json: {[c['name'] for c in chains_blend['chains']]}")
    with open(os.path.join(a.outdir, "chains.json"), "w", encoding="utf-8") as f:
        json.dump(chains, f, indent=2)
    log(f"chains.json: {[c['name'] for c in chains['chains']]}")

    # --- export plain GLB (+ a .blend that keeps the painted vertex groups)
    out = os.path.join(os.path.abspath(a.outdir), "stock_rigged.glb")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(a.outdir), "stock_rigged.blend"))
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_animations=False, export_skins=True,
        export_morph=True, export_yup=True, export_apply=False, export_image_format="AUTO",
    )
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from vrm_manifest import read_glb_json

    g = read_glb_json(out)
    names = [n.get("name") for n in g["nodes"]]
    log(f"exported {out}: {os.path.getsize(out)} bytes, nodes={len(names)}, "
        f"extensionsUsed={g.get('extensionsUsed', [])}, skins={len(g.get('skins', []))}")
    log(f"bone names: {[n for n in names if n and n.startswith(a.prefix)][:12]} ...")
    assert not any(e.startswith("VRMC") for e in g.get("extensionsUsed", [])), "VRM data leaked into stock GLB"


if __name__ == "__main__":
    main()
