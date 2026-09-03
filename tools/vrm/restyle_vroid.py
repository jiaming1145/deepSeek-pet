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
    p.add_argument("--chibi", action="store_true", help="apply the palette's chibi proportions (head up, limbs down) by weighted vertex scaling")
    p.add_argument("--hair-from", default=None, help="donor VRM whose hair mesh + hair springs replace the base's hair")
    p.add_argument("--hair-textures", default=None, help="restyled PNGs for the donor's hair images (names may carry a .001 suffix)")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------------------------- textures
def swap_textures(tex_dir, extra_dir=None):
    """Replace packed VRM images by copying pixels from same-size PNGs (a filepath reload is ignored on packed data).
    Image names may carry Blender's .001 suffix after a second import; the lookup strips it."""
    swapped, skipped = [], []
    for img in list(bpy.data.images):
        base = img.name.replace("/", "_")
        stem = re.sub(r"[.][0-9]{3}$", "", base)
        dirs = ([extra_dir] if (extra_dir and base != stem) else []) + [tex_dir] + ([extra_dir] if extra_dir else [])
        cands = []
        for d in dirs:
            cands += [os.path.join(d, base + ".png"), os.path.join(d, stem + ".png")]
        cand = next((c for c in cands if os.path.exists(c)), None)
        if cand is None:
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
            swapped.append(f"{img.name}<-{os.path.basename(os.path.dirname(cand))}")
        except Exception as e:  # noqa: BLE001
            skipped.append((img.name, str(e)))
        bpy.data.images.remove(new)
    log(f"textures swapped: {len(swapped)} -> {swapped}; skipped {skipped}")
    return swapped


# ----------------------------------------------------------------------------------------------- hair transplant
def transplant_hair(base_arm, donor_path, suffix="_hx"):
    """Replace the base's hair with a donor VRoid model's hair: same head topology across VRoid samples, so the
    donor hair is aligned by head-bone position and size, its hair joints are renamed and joined into the base
    armature under the head bone, and its spring definitions are copied."""
    from mathutils import Matrix
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=os.path.abspath(donor_path))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.animation_data:
            o.animation_data_clear()
    darm = next(o for o in new if o.type == "ARMATURE")
    dhair = next(o for o in new if o.type == "MESH" and "hair" in o.name.lower())
    dmap = B.humanoid_from_extension(darm)
    bmap = B.humanoid_from_extension(base_arm)
    dhead, bhead = darm.data.bones[dmap["head"]], base_arm.data.bones[bmap["head"]]
    weighted = set()
    for v in dhair.data.vertices:
        for g in v.groups:
            if g.weight > 0.001:
                weighted.add(dhair.vertex_groups[g.group].name)
    body = set(dmap.values()) | {"Root", "Global", "Position"}
    hair_bones = [n for n in weighted if n in darm.data.bones and n not in body and not n.startswith("J_Sec_")]
    # expand to the whole hair joint tree: unweighted root joints at the scalp and _end leaves belong to the chains
    grow = set(hair_bones)
    for n in list(grow):
        p = darm.data.bones[n].parent
        while p is not None and p.name not in body and not p.name.startswith("J_Sec_"):
            grow.add(p.name)
            p = p.parent
    stack = list(grow)
    while stack:
        for c in darm.data.bones[stack.pop()].children:
            if c.name not in grow and c.name not in body:
                grow.add(c.name)
                stack.append(c.name)
    hair_bones = sorted(grow)
    log(f"hair donor {os.path.basename(donor_path)}: mesh {dhair.name} {len(dhair.data.vertices)} verts, {len(hair_bones)} hair bones, {len(weighted)} weighted groups")
    dsb = darm.data.vrm_addon_extension.spring_bone1
    springs = []
    for sp in dsb.springs:
        joints = [(j.node.bone_name, j.stiffness, j.drag_force, j.gravity_power, tuple(j.gravity_dir), j.hit_radius) for j in sp.joints]
        if joints and all(j[0] in hair_bones or (j[0].endswith("_end") and j[0][:-4] in hair_bones) for j in joints):
            springs.append((sp.vrm_name, joints))
    dh = darm.matrix_world @ dhead.head_local
    bh = base_arm.matrix_world @ bhead.head_local
    s_ = (bhead.tail_local - bhead.head_local).length / max((dhead.tail_local - dhead.head_local).length, 1e-6)
    M = Matrix.Translation(bh) @ Matrix.Scale(s_, 4) @ Matrix.Translation(-dh)
    for o in (darm, dhair):
        o.matrix_world = M @ o.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    darm.select_set(True)
    dhair.select_set(True)
    bpy.context.view_layer.objects.active = darm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    log(f"hair aligned: scale {s_:.3f}, head {tuple(round(v, 3) for v in dh)} -> {tuple(round(v, 3) for v in bh)}")
    rename = {n: n + suffix for n in hair_bones}
    end_names = {n + "_end": n + suffix + "_end" for n in hair_bones if (n + "_end") in darm.data.bones}
    rename.update(end_names)
    bpy.context.view_layer.objects.active = darm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = darm.data.edit_bones
    for old_name, new_name in rename.items():
        if old_name in eb:
            eb[old_name].name = new_name
    keep = set(rename.values())
    for b in list(eb):
        if b.name not in keep:
            eb.remove(b)
    bpy.ops.object.mode_set(mode="OBJECT")
    for vg in dhair.vertex_groups:
        if vg.name in rename:
            vg.name = rename[vg.name]
    bpy.ops.object.select_all(action="DESELECT")
    darm.select_set(True)
    base_arm.select_set(True)
    bpy.context.view_layer.objects.active = base_arm
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode="EDIT")
    eb = base_arm.data.edit_bones
    roots = 0
    for nw in keep:
        if nw in eb and eb[nw].parent is None:
            eb[nw].parent = eb[bmap["head"]]
            eb[nw].use_connect = False
            roots += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    dhair.parent = base_arm
    dhair.matrix_parent_inverse = base_arm.matrix_world.inverted()
    for md in dhair.modifiers:
        if md.type == "ARMATURE":
            md.object = base_arm
    dhair.name = "HairTransplant"
    sb = base_arm.data.vrm_addon_extension.spring_bone1
    by_uuid = {c.uuid: c for c in sb.colliders}
    head_groups = []
    for cg in sb.collider_groups:
        if any(by_uuid.get(r.collider_uuid) is not None and by_uuid[r.collider_uuid].node.bone_name == bmap["head"] for r in cg.colliders):
            head_groups.append(cg)
    made = 0
    for name, joints in springs:
        sp = sb.add_spring()
        sp.vrm_name = f"hair{suffix}-{made:02d}"
        for (bn, st, dr, gp, gd, hr) in joints:
            j = sp.add_joint()
            j.node.bone_name = rename.get(bn, bn)
            j.stiffness, j.drag_force, j.gravity_power, j.gravity_dir, j.hit_radius = st, dr, gp, gd, hr
        for cg in head_groups:
            ref = sp.add_collider_group()
            ref.collider_group_uuid = cg.uuid
        made += 1
    removed = []
    for o in list(bpy.data.objects):
        if o in new and o.type == "MESH" and o is not dhair:
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.parent == base_arm and o is not dhair and "hair" in o.name.lower():
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    log(f"hair transplanted: {roots} root chains under {bmap['head']}, {made} springs copied (+{len(head_groups)} head collider groups), removed {removed}")
    return dhair


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


# ----------------------------------------------------------------------------------------------- head accessories
def head_box(arm, meshes, head_name):
    """World bbox of the vertices that follow the head bone (skull + face), for placing accessories."""
    xs, ys, zs = [], [], []
    for m in meshes:
        if "hair" in m.name.lower() or m.name.startswith(("FinEar", "WhaleTail", "Headdress", "Ahoge", "HairBow")):
            continue
        vg = m.vertex_groups.get(head_name)
        if vg is None:
            continue
        gi = vg.index
        for v in m.data.vertices:
            if any(g.group == gi and g.weight > 0.6 for g in v.groups):
                w = m.matrix_world @ v.co
                xs.append(w.x); ys.append(w.y); zs.append(w.z)
    if not xs:
        return None
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def tube_along(points, radius_fn, N=10, cap=True):
    """bmesh tube through a polyline (list of Vectors)."""
    bm = bmesh.new()
    rings = []
    for i, c in enumerate(points):
        d = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((0, 0, 1))).normalized() if abs(d.z) < 0.99 else Vector((1, 0, 0))
        up = side.cross(d).normalized()
        r = radius_fn(i / max(len(points) - 1, 1))
        rings.append([bm.verts.new(c + side * math.cos(a) * r + up * math.sin(a) * r) for a in [k * 2 * math.pi / N for k in range(N)]])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(N):
            bm.faces.new((a[k], a[(k + 1) % N], b[(k + 1) % N], b[k]))
    if cap:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mesh_object(name, bm, materials):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for mat in materials:
        me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def build_headdress(arm, meshes, head_name, spec, mat_white, mat_navy):
    """Maid headdress: a white band lying on the skull from ear to ear (width runs front-to-back on the
    surface), a scalloped frill hanging off its front edge, and a thin navy line along the back edge."""
    (x0, x1), (y0, y1), (z0, z1) = head_box(arm, meshes, head_name)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    zc = z0 + (z1 - z0) * 0.58                      # skull centre sits above the chin/neck part of the box
    rx, ry, rz = (x1 - x0) / 2 * 1.02, (y1 - y0) / 2 * 1.02, (z1 - zc) * 1.02
    # the hair sits above the skull: grow the ellipsoid to the hair's top and its width at the temples
    hair = [m for m in meshes if "hair" in m.name.lower()]
    if hair:
        pts = [m.matrix_world @ v.co for m in hair for v in m.data.vertices]
        top = max(pt.z for pt in pts)
        band_z = zc + rz * 0.55
        wide = [abs(pt.x - cx) for pt in pts if abs(pt.z - band_z) < 0.03 and pt.y < cy + 0.03]
        rz = max(rz, (top - zc) * 1.01)
        if wide:
            rx = max(rx, max(wide) * 1.01)
        ry = max(ry, rx * 0.95)
    band_w, frill, lift = spec.get("band_width", 0.045), spec.get("frill", 0.018), 0.006
    y_mid = cy - ry * 0.10                          # a little forward of the crown

    def on_skull(a, y):
        f = math.sqrt(max(0.0, 1.0 - ((y - cy) / ry) ** 2))
        pnt = Vector((cx + rx * f * math.cos(a), y, zc + rz * f * math.sin(a)))
        n = Vector(((pnt.x - cx) / rx ** 2, (pnt.y - cy) / ry ** 2, (pnt.z - zc) / rz ** 2)).normalized()
        return pnt + n * lift, n

    bm = bmesh.new()
    K = 30
    back, front, frl = [], [], []
    for i in range(K + 1):
        t = i / K
        a = math.pi * (0.10 + 0.80 * t)              # from above one ear, over the crown, to the other
        pb, _ = on_skull(a, y_mid + band_w * 0.5)
        pf, nf = on_skull(a, y_mid - band_w * 0.5)
        scallop = 1.0 + 0.6 * max(0.0, math.sin(t * K * 0.9 * math.pi))
        pfr = pf + Vector((0, -frill * 0.6, 0)) * scallop - nf * 0.004 + Vector((0, 0, -frill * 0.35))
        back.append(bm.verts.new(pb)); front.append(bm.verts.new(pf)); frl.append(bm.verts.new(pfr))
    for i in range(K):
        bm.faces.new((back[i], back[i + 1], front[i + 1], front[i]))
        bm.faces.new((front[i], front[i + 1], frl[i + 1], frl[i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:], thickness=0.005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_object("Headdress", bm, [mat_white, mat_navy])
    for poly in obj.data.polygons:
        poly.material_index = 0
    return obj


def build_ahoge(arm, meshes, head_name, spec, mat_hair):
    """One curl standing up from the crown, curling forward: a tapered tube along a bezier."""
    (x0, x1), (y0, y1), (z0, z1) = head_box(arm, meshes, head_name)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    top = Vector((cx + 0.01, cy + 0.01, z1 - 0.004))
    L = spec.get("length", 0.10)
    pts = [bezier(top, top + Vector((0.0, 0.03, L * 0.9)), top + Vector((0.01, -0.06, L * 1.15)), top + Vector((0.02, -0.11, L * 0.75)), i / 14) for i in range(15)]
    r0 = spec.get("radius", 0.011)
    bm = tube_along(pts, lambda t: r0 * (1.0 - 0.85 * t) + 0.002, N=8)
    return mesh_object("Ahoge", bm, [mat_hair])


def build_hair_bows(arm, meshes, head_name, spec, mat_bow):
    """Two small bows at the temples, each two flattened lobes + a knot."""
    (x0, x1), (y0, y1), (z0, z1) = head_box(arm, meshes, head_name)
    cy = (y0 + y1) / 2
    zb = z0 + (z1 - z0) * spec.get("height_frac", 0.78)
    size = spec.get("size", 0.045)
    # hair surface half-width at that height (front half), so the bow sits on the hair, not inside it
    hair = [m for m in meshes if "hair" in m.name.lower()]
    hx = 0.0
    for m in hair:
        for v in m.data.vertices:
            w = m.matrix_world @ v.co
            if abs(w.z - zb) < 0.03 and w.y < cy + 0.02:
                hx = max(hx, abs(w.x))
    hx = max(hx, (x1 - x0) / 2) + 0.006
    objs = []
    for side, sx in (("L", 1), ("R", -1)):
        centre = Vector((sx * hx, cy - (y1 - y0) * 0.22, zb))
        bm = bmesh.new()
        for lobe in (1, -1):
            c = centre + Vector((sx * 0.004, lobe * size * 0.55, 0))
            ring = []
            for k in range(10):
                a = k * 2 * math.pi / 10
                ring.append(bm.verts.new(c + Vector((0, math.cos(a) * size * 0.55, math.sin(a) * size * 0.32))))
            ring2 = [bm.verts.new(v.co + Vector((sx * 0.014, 0, 0))) for v in ring]
            bm.faces.new(ring); bm.faces.new(ring2[::-1])
            for k in range(10):
                bm.faces.new((ring[k], ring2[k], ring2[(k + 1) % 10], ring[(k + 1) % 10]))
        knot = bmesh.ops.create_cube(bm, size=size * 0.3)
        for v in knot["verts"]:
            v.co = centre + Vector((sx * 0.012, 0, 0)) + Vector((v.co.x * 0.6, v.co.y, v.co.z))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(mesh_object(f"HairBow_{side}", bm, [mat_bow]))
    return objs


# ----------------------------------------------------------------------------------------------- chibi
def subtree(arm, root_name):
    names, stack = set(), [arm.data.bones[root_name]]
    while stack:
        b = stack.pop()
        names.add(b.name)
        stack.extend(b.children)
    return names


def scale_region(arm, meshes, bone_names, pivot, k):
    """Scale vertices about `pivot` by 1 + (k-1) * w, w = summed weight of `bone_names` (smooth at the borders),
    on the base mesh and every shape key; scale the bones of the region about the same pivot by k."""
    moved = 0
    for m in meshes:
        gidx = {vg.index for vg in m.vertex_groups if vg.name in bone_names}
        if not gidx:
            continue
        inv = m.matrix_world.inverted()
        pl = inv @ pivot
        factors = []
        for v in m.data.vertices:
            w = min(1.0, sum(g.weight for g in v.groups if g.group in gidx))
            factors.append(1.0 + (k - 1.0) * w)
        targets = [m.data.vertices] + ([kb.data for kb in m.data.shape_keys.key_blocks] if m.data.shape_keys else [])
        for coords in targets:
            for i, c in enumerate(coords):
                f = factors[i]
                if f != 1.0:
                    c.co = pl + (c.co - pl) * f
        moved += sum(1 for f in factors if f != 1.0)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    inv = arm.matrix_world.inverted()
    pl = inv @ pivot
    for name in bone_names:
        eb = arm.data.edit_bones.get(name)
        if eb is None:
            continue
        eb.head = pl + (eb.head - pl) * k
        eb.tail = pl + (eb.tail - pl) * k
    bpy.ops.object.mode_set(mode="OBJECT")
    return moved


def chibify(arm, meshes, spec):
    """Whale-chan proportions from a human-ratio VRoid body: big head, short limbs, slightly shorter torso.
    Everything hanging off a scaled bone (hair, fins, sleeves, shoes) follows through its weights."""
    hm = B.humanoid_from_extension(arm)
    W = arm.matrix_world
    head_k, arm_k, leg_k = float(spec.get("head", 1.35)), float(spec.get("arm", 0.8)), float(spec.get("leg", 0.72))
    report = {}
    head_set = subtree(arm, hm["head"])
    pivot = W @ arm.data.bones[hm["head"]].head_local
    report["head"] = scale_region(arm, meshes, head_set, pivot, head_k)
    for side in ("left", "right"):
        ua = hm.get(f"{side}UpperArm")
        if ua:
            report[f"{side}Arm"] = scale_region(arm, meshes, subtree(arm, ua), W @ arm.data.bones[ua].head_local, arm_k)
        ul = hm.get(f"{side}UpperLeg")
        if ul:
            report[f"{side}Leg"] = scale_region(arm, meshes, subtree(arm, ul), W @ arm.data.bones[ul].head_local, leg_k)
    # head collider grows with the head
    sb = arm.data.vrm_addon_extension.spring_bone1
    for c in sb.colliders:
        if c.node.bone_name in head_set and c.shape_type == "Sphere":
            c.shape.sphere.radius *= head_k
    # feet back on the floor
    zmin = min((m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices)
    arm.location.z -= zmin
    bpy.context.view_layer.update()
    log(f"chibi: head x{head_k}, arms x{arm_k}, legs x{leg_k}; vertices moved {report}; floor shift {-zmin:.3f}")


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
    if a.hair_from:
        transplant_hair(arm, a.hair_from)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    swap_textures(os.path.abspath(a.textures), os.path.abspath(a.hair_textures) if a.hair_textures else None)
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
        acc = pal.get("accessories", {})
        if acc.get("headdress", {}).get("enabled", True):
            white = mtoon_material("Headdress_White", acc["headdress"].get("white", [0.98, 0.98, 1.0]), [0.72, 0.76, 0.86], template)
            navy = mtoon_material("Headdress_Navy", pt["top"], [c * 0.55 for c in pt["top"]], template)
            hd = build_headdress(arm, meshes, head, acc["headdress"], white, navy); skin_to_bone(hd, arm, head)
        if acc.get("ahoge", {}).get("enabled", True):
            hair_mat = mtoon_material("Ahoge_Hair", acc["ahoge"].get("color", [0.14, 0.30, 0.68]), [0.08, 0.16, 0.42], template)
            ah = build_ahoge(arm, meshes, head, acc["ahoge"], hair_mat); skin_to_bone(ah, arm, head)
        if acc.get("bows", {}).get("enabled", True):
            bow_mat = mtoon_material("HairBow_Blue", acc["bows"].get("color", [0.55, 0.80, 0.98]), [0.35, 0.55, 0.80], template)
            for bo in build_hair_bows(arm, meshes, head, acc["bows"], bow_mat):
                skin_to_bone(bo, arm, head)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        log(f"accessories: {[o.name for o in meshes if o.name.startswith(('Headdress', 'Ahoge', 'HairBow'))]}")
    if a.chibi:
        chibify(arm, [o for o in bpy.data.objects if o.type == "MESH"], pal.get("chibi", {}))
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if a.render:
        render(os.path.abspath(a.render), meshes)
    os.makedirs(os.path.dirname(os.path.abspath(a.output)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.output))
    log(f"saved {a.output}")


if __name__ == "__main__":
    main()
