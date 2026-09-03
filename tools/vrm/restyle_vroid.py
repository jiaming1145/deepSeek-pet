"""Restyle a VRoid-made VRM into Whale-chan without an editor. Blender headless.

    blender --background --python tools/vrm/restyle_vroid.py -- --input <base.vrm> --textures <restyled png dir>
        --palette tools/vrm/palette.whalechan.json --output <out.blend> [--render <png>]

Steps: import the VRM (0.x or 1.0) with the VRM add-on -> replace textures by image name from --textures ->
apply MToon colour factors from the palette (baked hair gets a white tint, brows go navy) -> build a whale
tail and two fin ears as procedural meshes skinned to hips / head (a later chain pass splits them into
spring bones) -> save a .blend that build_vrm.py accepts as input, plus an optional front render.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_vrm as B  # noqa: E402  (ensure_addon, log, armature_ext)


def log(msg):
    print(f"[restyle] {msg}", flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--textures", required=True, help="dir of restyled PNGs named like the VRM's images")
    p.add_argument("--palette", default=os.path.join(HERE, "palette.whalechan.json"))
    p.add_argument("--output", required=True, help=".blend to write (build_vrm.py input)")
    p.add_argument("--render", default=None, help="optional front/side render PNG")
    p.add_argument("--no-parts", action="store_true", help="skip tail and fins")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------------------------- textures
def swap_textures(tex_dir):
    """Replace packed VRM images by copying pixels from same-size PNGs (a filepath reload is ignored on packed data)."""
    swapped, skipped = [], []
    for img in list(bpy.data.images):
        cand = os.path.join(tex_dir, img.name.replace("/", "_") + ".png")
        if not os.path.exists(cand):
            continue
        new = bpy.data.images.load(cand)
        if tuple(new.size) != tuple(img.size):
            img.scale(new.size[0], new.size[1])
        try:
            buf = [0.0] * (new.size[0] * new.size[1] * 4)
            new.pixels.foreach_get(buf)
            img.pixels.foreach_set(buf)
            img.update()
            if img.packed_file:
                img.pack()
            swapped.append(img.name)
        except Exception as e:  # noqa: BLE001
            skipped.append((img.name, str(e)))
        bpy.data.images.remove(new)
    log(f"textures swapped: {len(swapped)} -> {swapped}; skipped {skipped}")
    return swapped


def apply_material_factors(factors):
    for mat in bpy.data.materials:
        if not mat.users or mat.name.startswith("MToon Outline"):
            continue
        ext = getattr(mat, "vrm_addon_extension", None)
        if ext is None:
            continue
        for pattern, f in factors.items():
            if pattern.startswith("_") or not re.search(pattern, mat.name):
                continue
            mt = ext.mtoon1
            if "base_color" in f:
                mt.pbr_metallic_roughness.base_color_factor = f["base_color"]
            if "shade_color" in f:
                mt.extensions.vrmc_materials_mtoon.shade_color_factor = f["shade_color"]
            log(f"material {mat.name}: factors {f}")


# ----------------------------------------------------------------------------------------------- parts
def mtoon_material(name, rgb, shade, template):
    """Copy an existing MToon material (keeps outline/shading setup), strip its textures, set flat colours."""
    mat = template.copy()
    mat.name = name
    mt = mat.vrm_addon_extension.mtoon1
    try:
        mt.pbr_metallic_roughness.base_color_texture.index.source = None
        mt.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source = None
    except Exception as e:  # noqa: BLE001
        log(f"material {name}: could not clear textures ({e})")
    mt.pbr_metallic_roughness.base_color_factor = (*rgb, 1.0)
    mt.extensions.vrmc_materials_mtoon.shade_color_factor = tuple(shade)
    return mat


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return p0 * (u ** 3) + p1 * (3 * u * u * t) + p2 * (3 * u * t * t) + p3 * (t ** 3)


def build_tail(arm, hips_name, spec, mat_top, mat_belly):
    """Whale tail: tapered tube along a bezier from the lower back, flukes at the tip. Facing -Y => back is +Y."""
    hips = arm.matrix_world @ arm.data.bones[hips_name].head_local
    L = spec["length"]
    drop = spec.get("drop", 0.55) * L
    # S-curve: leaves the lower back going back and slightly up, then sweeps down to the tip
    p0 = hips + Vector((0, 0.06, -0.04))
    p1 = hips + Vector((0, 0.06 + L * 0.45, 0.02))
    p2 = hips + Vector((0, 0.06 + L * 0.85, -drop * 0.55))
    p3 = hips + Vector((0, 0.06 + L, -drop))
    bm = bmesh.new()
    rings = []
    N, SEG = 12, 16
    for i in range(SEG + 1):
        t = i / SEG
        c = bezier(p0, p1, p2, p3, t)
        d = (bezier(p0, p1, p2, p3, min(1, t + 0.01)) - bezier(p0, p1, p2, p3, max(0, t - 0.01))).normalized()
        side = d.cross(Vector((0, 0, 1))).normalized() if abs(d.z) < 0.99 else Vector((1, 0, 0))
        up = side.cross(d).normalized()
        r = spec["root_radius"] * (1 - t) + spec["tip_radius"] * t
        ring = [bm.verts.new(c + (side * math.cos(a) * r * 1.15 + up * math.sin(a) * r * 0.85)) for a in [k * 2 * math.pi / N for k in range(N)]]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(N):
            bm.faces.new((a[k], a[(k + 1) % N], b[(k + 1) % N], b[k]))
    bm.faces.new(rings[0][::-1])
    # flukes: two flat lobes at the tip, spanning sideways, slightly swept back
    tip = bezier(p0, p1, p2, p3, 1.0)
    span, flen, th = spec["fluke_span"], spec["fluke_len"], spec["tip_radius"] * 0.6
    for sgn in (1, -1):
        prof = [(0.0, -0.35), (0.25, -0.55), (0.6, -0.5), (0.95, -0.25), (1.0, 0.15), (0.75, 0.45), (0.4, 0.45), (0.1, 0.2)]
        top = [bm.verts.new(tip + Vector((sgn * x * span / 2, y * flen, th))) for x, y in prof]
        bot = [bm.verts.new(tip + Vector((sgn * x * span / 2, y * flen, -th))) for x, y in prof]
        ftop = bm.faces.new(top if sgn > 0 else top[::-1]); fbot = bm.faces.new(bot[::-1] if sgn > 0 else bot)
        for k in range(len(prof)):
            q = (top[k], bot[k], bot[(k + 1) % len(prof)], top[(k + 1) % len(prof)])
            bm.faces.new(q if sgn > 0 else q[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    me = bpy.data.meshes.new("WhaleTail")
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new("WhaleTail", me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(mat_top); me.materials.append(mat_belly)
    for poly in me.polygons:
        poly.material_index = 1 if poly.normal.z < -0.7 else 0   # pale belly only on near-horizontal undersides
        poly.use_smooth = True
    return obj


def build_fin(arm, head_name, spec, side, mat_top, mat_inner):
    """Fin ear: a flat teardrop sticking out sideways and a little back from the head, slightly drooping."""
    head = arm.matrix_world @ arm.data.bones[head_name].head_local
    top = arm.matrix_world @ arm.data.bones[head_name].tail_local
    base = head + Vector((side * 0.085, 0.0, (top.z - head.z) * 0.55))
    Lf, Hf, th = spec["length"], spec["height"], spec["thickness"]
    prof = [(0.0, 0.5), (0.0, -0.5), (0.45, -0.7), (0.85, -0.45), (1.0, 0.0), (0.8, 0.45), (0.4, 0.6)]
    bm = bmesh.new()
    def P(x, y, z):
        # x outward (sideways), y along the fin height (z world), swept back 25 deg, drooping 20 deg
        out = Vector((side, 0.45, -0.35)).normalized() * (x * Lf)
        return base + out + Vector((0, 0, y * Hf)) + Vector((0, z, 0))
    a = [bm.verts.new(P(x, y, +th / 2)) for x, y in prof]
    b = [bm.verts.new(P(x, y, -th / 2)) for x, y in prof]
    bm.faces.new(a); bm.faces.new(b[::-1])
    n = len(prof)
    for k in range(n):
        bm.faces.new((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    me = bpy.data.meshes.new(f"FinEar_{'L' if side > 0 else 'R'}")
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(obj)
    me.materials.append(mat_top); me.materials.append(mat_inner)
    for poly in me.polygons:
        poly.material_index = 1 if (poly.normal.y > 0.5) else 0   # back face pale, outer/front face navy
        poly.use_smooth = True
    return obj


def skin_to_bone(obj, arm, bone_name):
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    md = obj.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    md.use_vertex_groups = True


# ----------------------------------------------------------------------------------------------- render
def render(path, meshes):
    scene = bpy.context.scene
    zs = [(m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices]
    xs = [(m.matrix_world @ v.co).x for m in meshes for v in m.data.vertices]
    ys = [(m.matrix_world @ v.co).y for m in meshes for v in m.data.vertices]
    h = max(zs) - min(zs); c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs) + h / 2))
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 480; scene.render.resolution_y = 800
    world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.86, 0.86, 0.88, 1)
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = h * 1.12
    camo = bpy.data.objects.new("cam", cam); scene.collection.objects.link(camo); scene.camera = camo
    outs = []
    for yaw, name in ((0, "front"), (90, "side"), (180, "back")):
        a = math.radians(yaw)
        camo.location = (c.x - math.sin(a) * h * 3, c.y - math.cos(a) * h * 3, c.z)
        camo.rotation_euler = (math.radians(90), 0, -a)
        p = path.replace(".png", f"_{name}.png")
        scene.render.filepath = p; bpy.ops.render.render(write_still=True); outs.append(p)
    log(f"renders: {outs} (compose the strip outside Blender; its python has no PIL)")
    for o in (camo,):
        bpy.data.objects.remove(o, do_unlink=True)


def main():
    a = parse_args()
    pal = json.load(open(a.palette, encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    B.ensure_addon()
    os.environ["BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION"] = "true"
    bpy.ops.import_scene.vrm(filepath=os.path.abspath(a.input))
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    log(f"imported {os.path.basename(a.input)}: {len(arm.data.bones)} bones, meshes {[m.name for m in meshes]}")
    swap_textures(os.path.abspath(a.textures))
    apply_material_factors(pal.get("material_factors", {}))
    if not a.no_parts:
        hm = B.humanoid_from_extension(arm)
        hips, head = hm.get("hips"), hm.get("head")
        template = next((m for m in bpy.data.materials if m.users and re.search("Onepice|Onepiece|Tops|Bottoms|CLOTH", m.name) and not m.name.startswith("MToon Outline")), None)
        if template is None:
            template = next(m for m in bpy.data.materials if m.users and getattr(m, "vrm_addon_extension", None))
        pt, pf = pal["parts"]["tail"], pal["parts"]["fins"]
        tail_top = mtoon_material("WhaleTail_Top", pt["top"], [c * 0.55 for c in pt["top"]], template)
        tail_belly = mtoon_material("WhaleTail_Belly", pt["belly"], [c * 0.75 for c in pt["belly"]], template)
        fin_top = mtoon_material("FinEar_Top", pf["top"], [c * 0.55 for c in pf["top"]], template)
        fin_inner = mtoon_material("FinEar_Inner", pf["inner"], [c * 0.75 for c in pf["inner"]], template)
        tail = build_tail(arm, hips, pt, tail_top, tail_belly); skin_to_bone(tail, arm, hips)
        finL = build_fin(arm, head, pf, +1, fin_top, fin_inner); skin_to_bone(finL, arm, head)
        finR = build_fin(arm, head, pf, -1, fin_top, fin_inner); skin_to_bone(finR, arm, head)
        log(f"parts: tail {len(tail.data.vertices)} verts on {hips}; fins {len(finL.data.vertices)}+{len(finR.data.vertices)} verts on {head}")
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if a.render:
        render(os.path.abspath(a.render), meshes)
    os.makedirs(os.path.dirname(os.path.abspath(a.output)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.output))
    log(f"saved {a.output}")


if __name__ == "__main__":
    main()
