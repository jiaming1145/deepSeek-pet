"""render_turnaround.py - re-import a VRM with the add-on (validity check) and render it from 4 angles.

  blender --background --python tools/vrm/render_turnaround.py -- --vrm out.vrm --outdir renders/
        [--prefix name] [--size 640x900] [--expression happy] [--pose-tail 25]

--expression applies an expression at weight 1 before rendering: morph-target binds through the
add-on preview, texture-transform binds by writing the bind offset into the material's
KHR_texture_transform (the same thing a runtime does).
--pose-tail rotates every spring-chain root bone by N degrees so the chain weights are visible.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

ADDON_MODULE = "bl_ext.user_default.vrm"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vrm_manifest import manifest as read_manifest  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--vrm", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--prefix", default="turn")
    p.add_argument("--size", default="640x900")
    p.add_argument("--expression", default=None)
    p.add_argument("--pose-tail", type=float, default=0.0)
    p.add_argument("--angles", default="0,90,180,270")
    p.add_argument("--focus", default="body", choices=["body", "head"])
    return p.parse_args(argv)


def log(msg):
    print(f"[render] {msg}")


def main():
    a = parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    os.environ["BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION"] = "true"
    bpy.ops.wm.read_homefile(use_empty=True)
    if ADDON_MODULE not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=ADDON_MODULE)

    res = bpy.ops.import_scene.vrm(filepath=os.path.abspath(a.vrm))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if "FINISHED" not in res or not arms:
        log(f"RE-IMPORT FAILED: {res}")
        sys.exit(1)
    arm = arms[0]
    ext = arm.data.vrm_addon_extension
    hb = ext.vrm1.humanoid.human_bones
    mapped = sum(1 for _, b in hb.human_bone_name_to_human_bone().items() if b.node.bone_name)
    log(f"re-import OK: spec={ext.spec_version} bones={len(arm.data.bones)} humanoid_mapped={mapped} "
        f"springs={len(ext.spring_bone1.springs)} meshes={len(meshes)} "
        f"materials_mtoon={sum(1 for m in bpy.data.materials if m.vrm_addon_extension.mtoon1.enabled)}")
    m = read_manifest(os.path.abspath(a.vrm))

    # --- optional expression
    if a.expression:
        applied = []
        for kind in ("preset", "custom"):
            e = m["expressions"][kind].get(a.expression)
            if not e:
                continue
            for b in e["textureTransformBinds"]:
                mat = bpy.data.materials.get(b["material"])
                if not mat:
                    continue
                tex = mat.vrm_addon_extension.mtoon1.pbr_metallic_roughness.base_color_texture
                tex.extensions.khr_texture_transform.offset = tuple(b["offset"])
                sh = mat.vrm_addon_extension.mtoon1.extensions.vrmc_materials_mtoon.shade_multiply_texture
                sh.extensions.khr_texture_transform.offset = tuple(b["offset"])
                applied.append(f"{kind}:{a.expression} texture offset {b['offset']} on {mat.name}")
            if e["morphTargetBinds"]:
                # drive the shape keys directly (the add-on's preview needs a UI depsgraph pass)
                grp = getattr(ext.vrm1.expressions.preset, a.expression, None) if kind == "preset" else None
                if grp is None:
                    for c in ext.vrm1.expressions.custom:
                        if c.custom_name == a.expression:
                            grp = c
                for b in (grp.morph_target_binds if grp is not None else []):
                    ob = bpy.data.objects.get(b.node.mesh_object_name)
                    if ob and ob.data.shape_keys and b.index in ob.data.shape_keys.key_blocks:
                        ob.data.shape_keys.key_blocks[b.index].value = b.weight
                        applied.append(f"{kind}:{a.expression} shape key {ob.name}/{b.index}={b.weight}")
        log(f"expression applied: {applied}")

    # --- optional tail/chain pose
    if a.pose_tail:
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="POSE")
        for s in ext.spring_bone1.springs:
            if not s.joints:
                continue
            root = s.joints[0].node.bone_name
            pb = arm.pose.bones.get(root)
            if pb:
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = Euler((math.radians(a.pose_tail), 0, 0))
        bpy.ops.object.mode_set(mode="OBJECT")
        log(f"posed spring roots by {a.pose_tail} deg")

    # --- scene
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for me in meshes:
        for c in me.bound_box:
            w = me.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    height = hi.z - lo.z
    log(f"bbox lo={tuple(round(x, 3) for x in lo)} hi={tuple(round(x, 3) for x in hi)} height={height:.3f}")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    w, h = (int(x) for x in a.size.lower().split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.84, 0.88, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = Euler((math.radians(55), 0, math.radians(35)))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    # frame either the whole body or the head
    frame_h = height * 1.15
    if a.focus == "head":
        head_name = hb.head.node.bone_name
        hbone = arm.data.bones[head_name]
        # the head bone is short on most rigs; frame a quarter of the body height above the neck
        head_c = arm.matrix_world @ hbone.head_local
        frame_h = max((hbone.tail_local - hbone.head_local).length * 3.0, height * 0.24)
        centre = Vector((head_c.x, head_c.y, head_c.z + frame_h * 0.32))
    # vertical FOV: sensor_fit AUTO applies the 36mm sensor to the larger image side
    if h >= w:
        fov_v = 2 * math.atan((cam.data.sensor_width / 2) / cam.data.lens)
    else:
        fov_v = 2 * math.atan(((cam.data.sensor_width / 2) / cam.data.lens) * (h / w))
    dist = (frame_h / 2) / math.tan(fov_v / 2)
    log(f"camera: frame_h={frame_h:.3f} fov_v={math.degrees(fov_v):.1f} dist={dist:.3f} centre={tuple(round(x, 3) for x in centre)}")

    outputs = []
    for yaw in (float(x) for x in a.angles.split(",")):
        # yaw 0 = front. Blender-imported VRM faces -Y, so the front camera sits at -Y.
        r = math.radians(yaw)
        pos = centre + Vector((-math.sin(r) * dist, -math.cos(r) * dist, 0.0))
        cam.location = pos
        cam.rotation_euler = (centre - pos).to_track_quat("-Z", "Y").to_euler()
        tag = f"{a.prefix}_{int(yaw):03d}" + (f"_{a.expression}" if a.expression else "") + ("_head" if a.focus == "head" else "")
        path = os.path.join(os.path.abspath(a.outdir), tag + ".png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        outputs.append(path)
        log(f"rendered {path}")
    with open(os.path.join(a.outdir, f"{a.prefix}_reimport_check.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "vrm": os.path.abspath(a.vrm), "reimport": "FINISHED", "spec": ext.spec_version,
                "bones": len(arm.data.bones), "humanoid_mapped": mapped,
                "springs": [(s.vrm_name, len(s.joints)) for s in ext.spring_bone1.springs],
                "renders": outputs,
            },
            f, indent=2,
        )


if __name__ == "__main__":
    main()
