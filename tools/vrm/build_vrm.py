"""build_vrm.py - Blender --background pipeline: rigged GLB/FBX -> VRM 1.0 (MToon, spring bones, expressions).

Run:
  blender --background --python tools/vrm/build_vrm.py -- --input model.glb --output out.vrm [options]

Options (all optional except --input/--output):
  --chains chains.json        extra spring-bone chains (tail/ears/hair/skirt) - see README for schema
  --face-material REGEX       regex picking the face material (default: face|skin_face|head)
  --face-texture face.png     replace the face material's base colour texture with this PNG
  --face-atlas atlas.json     texture-transform expressions {state:{u,v,w,h}} over that PNG (glTF UV space)
  --morph-map morphs.json     {preset_or_custom_name: shape_key_name} morph-target expressions
  --auto-morphs               guess morph-target expressions from common shape-key names
  --height METERS             uniformly scale the character so its bounding-box height equals this
  --force-tpose               rotate arms to a straight T-pose and apply it as the new rest pose
  --no-mtoon                  keep imported materials (skip MToon conversion)
  --shade-tint r,g,b          MToon shade colour multiplier (default 0.75,0.72,0.82)
  --outline-width F           MToon outline width (world coords, metres; default 0.0012 - 2.5 mm made the
                              lip geometry's inverted-hull outline poke through the mouth on a 1.6 m model)
  --outline-skip REGEX        extra materials that get no outline (face material + BLEND materials never do)
  --name NAME / --author NAME / --version V   VRM meta
  --manifest out.json         where to write the manifest (default: <output>.manifest.json)
  --save-blend out.blend      also save the Blender scene for inspection
"""

import argparse
import json
import math
import collections
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vrm_manifest import manifest as read_manifest, print_manifest  # noqa: E402

ADDON_MODULE = "bl_ext.user_default.vrm"

# ----------------------------------------------------------------------------------------------
# logging
# ----------------------------------------------------------------------------------------------
LOG = []


def log(msg):
    print(f"[build_vrm] {msg}")
    LOG.append(msg)


def die(msg, code=1):
    print(f"[build_vrm] ERROR: {msg}")
    sys.exit(code)


# ----------------------------------------------------------------------------------------------
# args
# ----------------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="build_vrm.py")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--chains", default=None)
    p.add_argument("--face-material", default=r"face|skin_face|head")
    p.add_argument("--face-texture", default=None)
    p.add_argument("--face-atlas", default=None)
    p.add_argument("--morph-map", default=None)
    p.add_argument("--auto-morphs", action="store_true")
    p.add_argument("--height", type=float, default=None)
    p.add_argument("--force-tpose", action="store_true")
    p.add_argument("--no-mtoon", action="store_true")
    p.add_argument("--shade-tint", default="0.75,0.72,0.82")
    p.add_argument("--outline-width", type=float, default=0.0012)
    p.add_argument("--outline-skip", default=None,
                   help="regex of extra materials that get no MToon outline (the face material and alpha-blended "
                        "materials never get one)")
    p.add_argument("--name", default="Character")
    p.add_argument("--author", default="owner")
    p.add_argument("--version", default="0.1.0")
    p.add_argument("--manifest", default=None)
    p.add_argument("--save-blend", default=None)
    return p.parse_args(argv)


# ----------------------------------------------------------------------------------------------
# add-on
# ----------------------------------------------------------------------------------------------
def ensure_addon():
    import addon_utils

    if ADDON_MODULE not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=ADDON_MODULE)
    if not hasattr(bpy.types, "EXPORT_SCENE_OT_vrm"):
        die("VRM add-on not available; run install_vrm_addon.py first")
    log("VRM add-on ready (bpy.ops.export_scene.vrm present)")


def armature_ext(arm_data):
    return arm_data.vrm_addon_extension


# ----------------------------------------------------------------------------------------------
# import
# ----------------------------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)


def import_model(path):
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects) if ext != ".blend" else set()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path, bone_heuristic="TEMPERANCE")
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True, use_image_search=True)
    elif ext == ".vrm":
        os.environ["BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION"] = "true"
        bpy.ops.import_scene.vrm(filepath=path)
    elif ext == ".blend":
        # a .blend keeps arbitrary vertex groups (glTF only stores bone weights), so this is the
        # route when the owner has painted tail/ear/hair regions by hand
        bpy.ops.wm.open_mainfile(filepath=path)
        ensure_addon()
    else:
        die(f"unsupported input extension {ext}")
    new = [o for o in bpy.data.objects if o not in before]
    log(f"imported {len(new)} objects from {path}")
    return new


def find_armature_and_meshes():
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        die("no armature found in input (export the model WITH its rig)")
    arm = max(arms, key=lambda a: len(a.data.bones))
    # Auto-riggers ship the GLB with an animation clip on the armature (Meshy: 'Armature|clip0|baselayer').
    # Blender evaluates it at the current frame, so every render, probe and weight scan would see a posed
    # mesh instead of the bind pose. Strip it and reset the pose.
    clips = [a.name for a in bpy.data.actions]
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    if clips:
        log(f"cleared {len(clips)} animation clip(s) baked into the input: {clips}")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    skinned = [
        m for m in meshes if any(md.type == "ARMATURE" and md.object == arm for md in m.modifiers)
    ]
    # helper geometry that is neither skinned nor parented to the rig (Meshy adds a stray icosphere) is dropped
    stray = [m for m in meshes if m not in skinned and m.parent is None]
    for m in stray:
        log(f"dropping stray mesh {m.name!r} ({len(m.data.vertices)} verts): not skinned and not parented to the rig")
        bpy.data.objects.remove(m, do_unlink=True)
    meshes = [m for m in meshes if m not in stray]
    log(f"armature: {arm.name} ({len(arm.data.bones)} bones); meshes={len(meshes)} skinned={len(skinned)}")
    return arm, meshes


def apply_transforms(arm, meshes):
    bpy.ops.object.select_all(action="DESELECT")
    for o in [arm] + meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")


def world_bbox(meshes):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for m in meshes:
        for c in m.bound_box:
            w = m.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def normalize_height(arm, meshes, target):
    lo, hi = world_bbox(meshes)
    h = hi.z - lo.z
    if h <= 0:
        return
    s = target / h
    for o in [arm] + [m for m in meshes if m.parent is None]:
        o.scale *= s
        o.location *= s
    bpy.context.view_layer.update()
    apply_transforms(arm, meshes)
    lo, hi = world_bbox(meshes)
    log(f"height normalised: {h:.3f} -> {hi.z - lo.z:.3f} (scale {s:.4f})")


# ----------------------------------------------------------------------------------------------
# humanoid bone mapping
# ----------------------------------------------------------------------------------------------
PREFIX_RE = re.compile(
    r"^(mixamorig\d*[:_]?|armature\||def-|org-|mch-|j_bip_|j_adj_|j_sec_|bip01[ _]?|character1_|"
    r"root_|b_|bone_|skeleton_|rig[:_])",
    re.IGNORECASE,
)
IGNORE_RE = re.compile(r"(_end$|end$|endsite|_site$|twist|roll|ik$|_ik|pole|target|helper|ctrl|control)", re.I)

# core-name -> vrm bone (sided)
SIDED = {
    "shoulder": "shoulder", "clavicle": "shoulder", "collar": "shoulder", "collarbone": "shoulder",
    "arm": "upperArm", "upperarm": "upperArm", "uparm": "upperArm", "bicep": "upperArm",
    "humerus": "upperArm", "armupper": "upperArm",
    "forearm": "lowerArm", "lowerarm": "lowerArm", "lowarm": "lowerArm", "elbow": "lowerArm",
    "armlower": "lowerArm", "ulna": "lowerArm",
    "hand": "hand", "wrist": "hand",
    "upleg": "upperLeg", "upperleg": "upperLeg", "thigh": "upperLeg", "legupper": "upperLeg",
    "hip": "upperLeg", "femur": "upperLeg",
    "leg": "lowerLeg", "lowerleg": "lowerLeg", "lowleg": "lowerLeg", "calf": "lowerLeg",
    "shin": "lowerLeg", "knee": "lowerLeg", "leglower": "lowerLeg", "tibia": "lowerLeg",
    "foot": "foot", "ankle": "foot",
    "toebase": "toes", "toe": "toes", "toes": "toes", "ball": "toes",
    "eye": "eye",
}
UNSIDED = {
    "hips": "hips", "pelvis": "hips", "hip": "hips",
    "neck": "neck", "neck1": "neck", "neck01": "neck",
    "head": "head", "jaw": "jaw",
}
FINGER_RE = re.compile(r"^(?:hand)?(thumb|index|middle|ring|pinky|little)[_ ]?(\d+|metacarpal|proximal|intermediate|distal)?(?:[_ ]?(\d+))?$")
FINGER_NAMES = {"thumb": "Thumb", "index": "Index", "middle": "Middle", "ring": "Ring", "pinky": "Little", "little": "Little"}

REQUIRED = ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm",
            "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg",
            "rightLowerLeg", "rightFoot"]

VRM_TO_PROP = {}  # e.g. leftUpperArm -> left_upper_arm


def vrm_to_prop(name):
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def split_side(raw):
    """Return (side, core) with side in {'left','right',None}; core is lower-case alnum."""
    s = PREFIX_RE.sub("", raw)
    s = s.replace("mixamorig:", "")
    side = None
    m = re.match(r"^(left|right)[ _.\-]?(.*)$", s, re.I)
    if m:
        side = m.group(1).lower()
        s = m.group(2)
    else:
        m = re.match(r"^(.*?)[ _.\-](left|right)$", s, re.I)
        if m:
            side = m.group(2).lower()
            s = m.group(1)
        else:
            m = re.match(r"^([lr])[_.\- ](.+)$", s, re.I)  # L_UpperArm, l_arm
            if m:
                side = "left" if m.group(1).lower() == "l" else "right"
                s = m.group(2)
            else:
                m = re.match(r"^(.+?)[_.\- ]([lr])(?:\.\d+)?$", s, re.I)  # upper_arm.L, Arm_R
                if m:
                    side = "left" if m.group(2).lower() == "l" else "right"
                    s = m.group(1)
                else:
                    m = re.match(r"^([LR])([A-Z].*)$", s)  # LArm, RHand
                    if m:
                        side = "left" if m.group(1) == "L" else "right"
                        s = m.group(2)
    core = re.sub(r"[^a-z0-9]", "", s.lower())
    core = re.sub(r"(\d+)$", lambda mm: mm.group(1), core)
    return side, core


def classify(raw):
    """Return VRM bone name (camelCase) or None, plus a reason string."""
    if IGNORE_RE.search(raw):
        return None, "ignored pattern"
    side, core = split_side(raw)
    # fingers
    m = FINGER_RE.match(core)
    if m and side:
        finger = FINGER_NAMES[m.group(1)]
        seg = m.group(2) or m.group(3)
        if seg is None:
            return None, "finger without segment"
        if seg.isdigit():
            n = int(seg)
            if finger == "Thumb":
                seg_name = {1: "Metacarpal", 2: "Proximal", 3: "Distal"}.get(n)
            else:
                seg_name = {1: "Proximal", 2: "Intermediate", 3: "Distal"}.get(n)
        else:
            seg_name = seg.capitalize()
        if seg_name is None:
            return None, "finger segment out of range"
        return f"{side}{finger}{seg_name}", "finger"
    # strip trailing digits for lookup, keep original for spine chain handling
    core_nd = re.sub(r"\d+$", "", core)
    if core_nd.startswith("spine") or core_nd in ("chest", "upperchest", "torso", "abdomen"):
        return "SPINECHAIN", "spine chain"
    if side and core_nd in SIDED:
        v = SIDED[core_nd]
        return side + v[0].upper() + v[1:], "sided"
    if not side and core_nd in UNSIDED:
        return UNSIDED[core_nd], "unsided"
    if not side and core in UNSIDED:
        return UNSIDED[core], "unsided"
    return None, "no rule"


def bone_depth(b):
    d = 0
    while b.parent:
        b = b.parent
        d += 1
    return d


def map_humanoid(arm):
    bones = arm.data.bones
    mapping = {}  # vrm -> bone name
    unmapped = []
    spine_chain = []
    conflicts = []
    for b in sorted(bones, key=bone_depth):
        v, why = classify(b.name)
        if v == "SPINECHAIN":
            spine_chain.append(b)
        elif v is None:
            unmapped.append((b.name, why))
        elif v in mapping:
            conflicts.append((v, mapping[v], b.name))
        else:
            mapping[v] = b.name
    # spine chain: order by depth; assign spine/chest/upperChest
    spine_chain.sort(key=bone_depth)
    # keep only the ones on the path between hips and neck/head if such a path exists
    if len(spine_chain) == 1:
        mapping["spine"] = spine_chain[0].name
    elif len(spine_chain) == 2:
        mapping["spine"], mapping["chest"] = spine_chain[0].name, spine_chain[1].name
    elif len(spine_chain) >= 3:
        mapping["spine"] = spine_chain[0].name
        mapping["chest"] = spine_chain[1].name
        mapping["upperChest"] = spine_chain[-1].name
        for extra in spine_chain[2:-1]:
            unmapped.append((extra.name, "extra spine segment (VRM allows only 3)"))
    missing = [r for r in REQUIRED if r not in mapping]
    log(f"humanoid mapping: {len(mapping)} bones mapped, {len(unmapped)} unmapped, {len(conflicts)} conflicts")
    for k in sorted(mapping):
        log(f"  {k:24s} <- {mapping[k]}")
    for n, why in unmapped:
        log(f"  UNMAPPED {n!r}: {why}")
    for v, keep, drop in conflicts:
        log(f"  CONFLICT {v}: kept {keep!r}, dropped {drop!r}")
    if missing:
        log(f"  MISSING required: {missing}")
    return mapping, missing


def apply_humanoid(arm, mapping):
    ext = armature_ext(arm.data)
    ext.spec_version = "1.0"
    hb = ext.vrm1.humanoid.human_bones
    hb.initial_automatic_bone_assignment = False
    hb.allow_non_humanoid_rig = False
    for vrm, bname in mapping.items():
        prop = vrm_to_prop(vrm)
        grp = getattr(hb, prop, None)
        if grp is None:
            log(f"  add-on has no property for {vrm} ({prop})")
            continue
        grp.node.bone_name = bname
    # let the add-on refresh its internal candidate caches
    try:
        bpy.ops.vrm.update_vrm1_expression_ui_list_elements()
    except Exception:  # noqa: BLE001
        pass


# ----------------------------------------------------------------------------------------------
# T-pose
# ----------------------------------------------------------------------------------------------
def apply_bone_fixups(arm, mapping, spec):
    """Move joints of the imported rig (world coords). Skinning at rest is identity whatever the joint
    positions, so this never deforms the rest mesh; it only changes where limbs pivot. Used when an
    auto-rigger drops a joint somewhere absurd (Meshy: an elbow behind the back)."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    inv = arm.matrix_world.inverted()
    for j in spec.get("joints", []):
        bname = mapping.get(j["bone"]) or j["bone"]
        eb = arm.data.edit_bones.get(bname)
        if eb is None:
            log(f"bone-fixup: {j['bone']!r} not found; skipped")
            continue
        if "head" in j:
            new_head = inv @ Vector([float(x) for x in j["head"]])
            old_head = eb.head.copy()
            parent = eb.parent
            if parent is not None and (parent.tail - old_head).length < 1e-5:
                parent.tail = new_head  # connected (or coincident) parent tail follows the joint
            eb.head = new_head
            log(f"bone-fixup: {bname} head {tuple(round(v, 3) for v in (arm.matrix_world @ old_head))} -> {tuple(round(v, 3) for v in (arm.matrix_world @ new_head))}")
        if "length" in j:  # keep the direction, set the length (auto-rig hand bones can be as long as a forearm)
            d = (eb.tail - eb.head)
            old_len = d.length
            eb.tail = eb.head + d.normalized() * float(j["length"])
            log(f"bone-fixup: {bname} length {old_len:.3f} -> {float(j['length']):.3f}")
    bpy.ops.object.mode_set(mode="OBJECT")


def _seg_dist(p, a, b):
    """Distance from point p to segment ab."""
    ab = b - a
    l2 = ab.length_squared
    if l2 < 1e-12:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


def clean_far_weights(arm, meshes, mapping, spec):
    """Auto-riggers (Meshy, Tripo) bleed arm/shoulder weights into skirts and hair; forcing a T-pose then
    drags those parts up with the arms. Rule: the listed bones may only influence vertices within
    `radius` of their own segment (rest pose, world units). Farther vertices lose that weight; the rest
    is renormalised, and a vertex left with nothing is given to the nearest `fallback` bone."""
    rspec = spec.get("radius", 0.09)   # number, or {"default": r, "<humanoid name>": r, ...}
    rmap = dict(rspec) if isinstance(rspec, dict) else {"default": float(rspec)}
    rdefault = float(rmap.get("default", 0.09))
    bones = [mapping.get(b) or b for b in spec.get("bones", [])]
    bones = [b for b in bones if b in arm.data.bones]
    bone_radius = {}
    for hname in spec.get("bones", []):
        bname = mapping.get(hname) or hname
        bone_radius[bname] = float(rmap.get(hname, rdefault))
    # zones: regions (e.g. the skirt) where every cleanup bone gets a tighter radius, because the
    # hands hang against the skirt and would otherwise keep dragging it
    global _REL_ARM, _REL_MAP
    _REL_ARM, _REL_MAP = arm, mapping
    zone_of = {}  # (mesh name, vertex index) -> radius
    for z in spec.get("zones", []):
        zr = float(z["radius"])
        for m, idx in select_vertices(z, meshes):
            for i in idx:
                zone_of[(m.name, i)] = min(zr, zone_of.get((m.name, i), zr))
        log(f"weight-cleanup zone {z.get('name', '?')}: radius {zr:.3f}")
    fallback = [mapping.get(b) or b for b in spec.get("fallback", ["hips", "spine", "chest", "upperChest", "neck", "head"])]
    fallback = [b for b in fallback if b in arm.data.bones]
    segs = {b: (arm.matrix_world @ arm.data.bones[b].head_local, arm.matrix_world @ arm.data.bones[b].tail_local) for b in bones + fallback}
    stripped = {b: 0 for b in bones}
    orphans = 0
    for m in meshes:
        gi = {vg.index: vg.name for vg in m.vertex_groups}
        by_name = {vg.name: vg for vg in m.vertex_groups}
        target_idx = {by_name[b].index for b in bones if b in by_name}
        if not target_idx:
            continue
        for v in m.data.vertices:
            hits = [g for g in v.groups if g.group in target_idx and g.weight > 0.0]
            if not hits:
                continue
            w = m.matrix_world @ v.co
            removed = 0.0
            zr = zone_of.get((m.name, v.index))
            for g in hits:
                b = gi[g.group]
                a, t = segs[b]
                r = bone_radius.get(b, rdefault) if zr is None else min(zr, bone_radius.get(b, rdefault))
                if _seg_dist(w, a, t) > r:
                    removed += g.weight
                    by_name[b].remove([v.index])
                    stripped[b] += 1
            if removed <= 0.0:
                continue
            rest = [(gi[g.group], g.weight) for g in v.groups if g.weight > 0.0]
            total = sum(x for _, x in rest)
            if total > 1e-6:
                for name, x in rest:
                    by_name[name].add([v.index], x / total, "REPLACE")
            else:
                orphans += 1
                best = min(fallback, key=lambda b: _seg_dist(w, *segs[b])) if fallback else None
                if best:
                    if best not in by_name:
                        by_name[best] = m.vertex_groups.new(name=best)
                    by_name[best].add([v.index], 1.0, "REPLACE")
    # second pass: a skirt-like zone is a surface of revolution around its axis bone. Vertices still holding
    # arm weight that sit ON the zone's radial profile (built from arm-free vertices, mirrored across x) are
    # skirt wall fused to a hand/cuff; strip them. Vertices protruding beyond the profile are the hand.
    for z in spec.get("zones", []):
        prof = z.get("profile")
        if not prof:
            continue
        axis_b = mapping.get(prof.get("axis_bone", "hips")) or prof.get("axis_bone", "hips")
        ax = arm.matrix_world @ arm.data.bones[axis_b].head_local
        margin = float(prof.get("margin", 0.015))
        zbin, abin = float(prof.get("z_bin", 0.02)), math.radians(float(prof.get("angle_bin_deg", 15)))
        zsel = {(m.name, i) for m, idx in select_vertices(z, meshes) for i in idx}
        bins = {}
        pending = []
        for m in meshes:
            gi = {vg.index: vg.name for vg in m.vertex_groups}
            by_name = {vg.name: vg for vg in m.vertex_groups}
            for v in m.data.vertices:
                if (m.name, v.index) not in zsel:
                    continue
                w = m.matrix_world @ v.co
                r = math.hypot(w.x - ax.x, w.y - ax.y)
                key = (int((w.z - ax.z) // zbin), int(math.atan2(abs(w.x - ax.x), w.y - ax.y) // abin))
                armw = [(gi[g.group], g.weight) for g in v.groups if gi[g.group] in bones and g.weight > 0.0]
                if armw:
                    pending.append((m, v, w, r, key, armw, by_name, gi))
                else:
                    bins.setdefault(key, []).append(r)
        ref = {k: sorted(v)[len(v) // 2] for k, v in bins.items() if len(v) >= 6}
        stripped2 = collections.Counter()
        kept = 0
        for m, v, w, r, key, armw, by_name, gi in pending:
            rr = ref.get(key)
            if rr is None:  # try neighbouring angle bins
                cands = [ref[k] for k in (
                    (key[0], key[1] - 1), (key[0], key[1] + 1), (key[0] - 1, key[1]), (key[0] + 1, key[1])) if k in ref]
                rr = sum(cands) / len(cands) if cands else None
            if rr is None or r > rr + margin:
                kept += 1
                continue
            for name, x in armw:
                by_name[name].remove([v.index]); stripped2[name] += 1
            rest = [(gi[g.group], g.weight) for g in v.groups if g.weight > 0.0]
            total = sum(x for _, x in rest)
            if total > 1e-6:
                for name, x in rest:
                    by_name[name].add([v.index], x / total, "REPLACE")
            else:
                best = min(fallback, key=lambda b: _seg_dist(w, *segs[b])) if fallback else None
                if best:
                    if best not in by_name:
                        by_name[best] = m.vertex_groups.new(name=best)
                    by_name[best].add([v.index], 1.0, "REPLACE")
        log(f"weight-cleanup profile {z.get('name', '?')}: {len(ref)} profile bins from arm-free verts; {len(pending)} ambiguous verts -> "
            f"stripped on-profile {dict(stripped2)}; kept protruding {kept}")
    log(f"weight-cleanup: radius {rdefault:.3f} ({len(zone_of)} zone verts); stripped " + ", ".join(f"{b}:{n}" for b, n in stripped.items() if n) + f"; {orphans} verts re-homed to nearest of {fallback}")


def force_tpose(arm, meshes, mapping):
    """Rotate arm chains to point straight along +/-X (VRM's T-pose convention) and bake as rest pose."""
    if any(m.data.shape_keys for m in meshes):
        log("force-tpose skipped: a mesh has shape keys (applying a rest pose would break them)")
        return
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for side, sign in (("left", 1.0), ("right", -1.0)):
        for part in ("UpperArm", "LowerArm", "Hand"):
            bname = mapping.get(f"{side}{part}")
            if not bname:
                continue
            pb = arm.pose.bones[bname]
            bpy.context.view_layer.update()
            head = arm.matrix_world @ pb.head
            tail = arm.matrix_world @ pb.tail
            cur = (tail - head).normalized()
            want = Vector((sign, 0.0, 0.0))
            rot = cur.rotation_difference(want)
            mw = arm.matrix_world @ pb.matrix
            new_mw = Matrix.Translation(head) @ rot.to_matrix().to_4x4() @ Matrix.Translation(-head) @ mw
            pb.matrix = arm.matrix_world.inverted() @ new_mw
            bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    # bake: apply armature modifier on meshes then apply pose as rest
    for m in meshes:
        mods = [md for md in m.modifiers if md.type == "ARMATURE" and md.object == arm]
        if not mods:
            continue
        bpy.context.view_layer.objects.active = m
        md = mods[0]
        copy = m.modifiers.new(name="tpose_bake", type="ARMATURE")
        copy.object = arm
        copy.use_vertex_groups = md.use_vertex_groups
        # move copy before original so it evaluates first
        while m.modifiers.find(copy.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=copy.name)
        bpy.ops.object.modifier_apply(modifier=copy.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    log("force-tpose: arms straightened and applied as rest pose")


# ----------------------------------------------------------------------------------------------
# extra chains (tail / ears / hair / skirt)
# ----------------------------------------------------------------------------------------------
_REL_ARM = None     # armature used by "rel" selectors; set by build_chain
_REL_MAP = {}       # vrm humanoid name -> bone name


def select_vertices(spec, meshes):
    """Return list of (mesh_obj, [vertex indices]) matching a chain selector."""
    sel = spec.get("select", {})
    obj_re = re.compile(sel["object"], re.I) if "object" in sel else None
    vg_name = sel.get("vertex_group")
    mat_re = re.compile(sel["material"], re.I) if "material" in sel else None
    bbox = sel.get("bbox")  # {"min":[x,y,z],"max":[x,y,z]} in world space (Blender Z-up)
    rel = sel.get("rel")    # {"bone": name, "min": [dx,dy,dz], "max": [dx,dy,dz]} offsets from that bone's head, world units
    if rel and _REL_ARM is not None:
        bname = rel["bone"]
        bone = _REL_ARM.data.bones.get(bname) or _REL_ARM.data.bones.get(_REL_MAP.get(bname, bname))
        if bone is None:
            log(f"select: rel bone {bname!r} not found; selector matches nothing")
            return []
        head = _REL_ARM.matrix_world @ bone.head_local
        lo = [head[i] + float(rel["min"][i]) for i in range(3)]
        hi = [head[i] + float(rel["max"][i]) for i in range(3)]
        bbox = {"min": lo, "max": hi}
        log(f"select: rel to {bone.name} head=({head.x:.3f},{head.y:.3f},{head.z:.3f}) -> bbox {tuple(round(v,3) for v in lo)}..{tuple(round(v,3) for v in hi)}")
    vg_min = float(sel.get("vertex_group_min", 0.5))
    out = []
    for m in meshes:
        if obj_re and not obj_re.search(m.name):
            continue
        idx = set(range(len(m.data.vertices))) if (obj_re or not (vg_name or mat_re or bbox)) else set()
        if vg_name:
            vg = m.vertex_groups.get(vg_name)
            if vg is None:
                continue
            gi = vg.index
            idx = {v.index for v in m.data.vertices for g in v.groups if g.group == gi and g.weight >= vg_min}
        if mat_re:
            mi = {i for i, ms in enumerate(m.material_slots) if ms.material and mat_re.search(ms.material.name)}
            if not mi:
                continue
            mat_idx = {vi for p in m.data.polygons if p.material_index in mi for vi in p.vertices}
            idx = idx & mat_idx if (vg_name or obj_re) else mat_idx
        if bbox:
            lo, hi = Vector(bbox["min"]), Vector(bbox["max"])
            inside = set()
            for v in m.data.vertices:
                w = m.matrix_world @ v.co
                if lo.x <= w.x <= hi.x and lo.y <= w.y <= hi.y and lo.z <= w.z <= hi.z:
                    inside.add(v.index)
            idx = idx & inside if (vg_name or obj_re or mat_re) else inside
        if idx:
            out.append((m, sorted(idx)))
    return out


def principal_axis(points):
    """PCA on Nx3 points -> (centroid, unit axis, min_t, max_t)."""
    import numpy as np

    P = np.asarray(points, dtype=np.float64)
    c = P.mean(axis=0)
    Q = P - c
    cov = Q.T @ Q / max(len(P), 1)
    w, v = np.linalg.eigh(cov)
    axis = v[:, int(np.argmax(w))]
    t = Q @ axis
    return Vector(c), Vector(axis), float(t.min()), float(t.max())


def build_chain(arm, meshes, spec, mapping):
    name = spec["name"]
    n_bones = int(spec.get("bones", 6))
    parent_key = spec.get("parent", "hips")
    parent_bone = mapping.get(parent_key, parent_key)
    if parent_bone not in arm.data.bones:
        log(f"chain {name}: parent bone {parent_key!r} not found; skipping")
        return None
    global _REL_ARM, _REL_MAP
    _REL_ARM, _REL_MAP = arm, mapping
    sel = select_vertices(spec, meshes)
    if not sel:
        log(f"chain {name}: selector matched no vertices; skipping")
        return None
    pts = []
    for m, idx in sel:
        mw = m.matrix_world
        pts.extend([tuple(mw @ m.data.vertices[i].co) for i in idx])
    centroid, axis, tmin, tmax = principal_axis(pts)
    if spec.get("axis"):  # explicit root->tip direction (hanging hair = [0,0,-1]); PCA picks the width of a wide slab
        axis = Vector([float(x) for x in spec["axis"]]).normalized()
        ts = [(Vector(p) - centroid).dot(axis) for p in pts]
        tmin, tmax = min(ts), max(ts)
    # root = end closest to parent bone head
    parent_head_w = arm.matrix_world @ arm.data.bones[parent_bone].head_local
    end_a = centroid + axis * tmin
    end_b = centroid + axis * tmax
    if (end_b - parent_head_w).length < (end_a - parent_head_w).length:
        axis = -axis
        tmin, tmax = -tmax, -tmin
    p0 = centroid + axis * tmin
    p1 = centroid + axis * tmax
    length = (p1 - p0).length
    root_mode = spec.get("root", "auto")
    if root_mode == "parent_head":
        p0 = parent_head_w
    log(f"chain {name}: {len(pts)} verts, axis={tuple(round(x, 3) for x in axis)}, length={length:.3f}, "
        f"root={tuple(round(x, 3) for x in p0)}, parent={parent_bone}")

    # --- bones
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    names = []
    prev = eb[parent_bone]
    step = (p1 - p0) / n_bones
    for i in range(n_bones):
        b = eb.new(f"{name}_{i + 1:02d}")
        b.head = inv @ (p0 + step * i)
        b.tail = inv @ (p0 + step * (i + 1))
        b.parent = prev
        b.use_connect = i > 0
        b.use_deform = True
        prev = b
        names.append(b.name)
    end = eb.new(f"{name}_end")
    end.head = prev.tail
    end.tail = inv @ (p1 + step * 0.35)
    end.parent = prev
    end.use_connect = True
    end.use_deform = False
    end_name = end.name
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- weights: linear ramp along the axis, blended into the parent near the root
    blend_root = float(spec.get("blend_root", 0.15))
    for m, idx in sel:
        groups = {nm: (m.vertex_groups.get(nm) or m.vertex_groups.new(name=nm)) for nm in names}
        pgrp = m.vertex_groups.get(parent_bone) or m.vertex_groups.new(name=parent_bone)
        all_groups = {g.index: g for g in m.vertex_groups}
        for vi in idx:
            v = m.data.vertices[vi]
            w = m.matrix_world @ v.co
            t = (w - p0).dot(axis) / max(length, 1e-6)
            t = min(max(t, 0.0), 1.0)
            # remove every existing weight on this vertex
            for g in list(v.groups):
                all_groups[g.group].remove([vi])
            # position within chain: bone i covers [i/n, (i+1)/n]; blend to next bone across the seam
            x = t * n_bones - 0.5  # centre of bone i at x=i
            i0 = int(math.floor(x))
            f = x - i0
            i1 = i0 + 1
            wts = {}
            if i0 >= 0:
                wts[names[min(i0, n_bones - 1)]] = 1.0 - f
            if i1 <= n_bones - 1:
                wts[names[i1]] = wts.get(names[i1], 0.0) + f
            elif i0 >= n_bones - 1:
                wts[names[-1]] = 1.0
            if i0 < 0:  # before centre of first bone
                wts[names[0]] = 1.0
            parent_w = 0.0
            if blend_root > 0 and t < blend_root:
                parent_w = 1.0 - t / blend_root
            total = sum(wts.values())
            for nm, val in wts.items():
                groups[nm].add([vi], val / total * (1.0 - parent_w), "REPLACE")
            if parent_w > 0:
                pgrp.add([vi], parent_w, "REPLACE")
        # make sure the mesh deforms with this armature
        if not any(md.type == "ARMATURE" and md.object == arm for md in m.modifiers):
            md = m.modifiers.new(name="Armature", type="ARMATURE")
            md.object = arm
            m.parent = arm
            m.matrix_parent_inverse = arm.matrix_world.inverted()

    # --- spring registration
    ext = armature_ext(arm.data)
    sb = ext.spring_bone1
    spring = sb.add_spring()
    spring.vrm_name = name
    spring.center.bone_name = mapping.get(spec.get("center", ""), "") if spec.get("center") else ""
    stiffness = float(spec.get("stiffness", 0.8))
    drag = float(spec.get("drag", 0.35))
    gravity = float(spec.get("gravity", 0.1))
    gdir = spec.get("gravity_dir", [0.0, -1.0, 0.0])
    radius = float(spec.get("hit_radius", 0.02))
    stiff_tip = float(spec.get("stiffness_tip", stiffness * 0.5))
    for j, nm in enumerate(names + [end_name]):
        joint = spring.add_joint()
        joint.node.bone_name = nm
        k = j / max(len(names), 1)
        joint.stiffness = stiffness + (stiff_tip - stiffness) * k
        joint.drag_force = drag
        joint.gravity_power = gravity
        joint.gravity_dir = gdir
        joint.hit_radius = radius
    for cg_name in spec.get("collider_groups", []):
        for cg in sb.collider_groups:
            if cg.vrm_name == cg_name:
                ref = spring.add_collider_group()
                ref.collider_group_uuid = cg.uuid
    log(f"chain {name}: {n_bones} deform bones + end, spring joints={len(spring.joints)} "
        f"stiffness={stiffness}->{stiff_tip} drag={drag} gravity={gravity}")
    return names


def add_default_colliders(arm, mapping, spec):
    """Sphere colliders on head and hips (so hair/tail chains do not pass through the body)."""
    ext = armature_ext(arm.data)
    sb = ext.spring_bone1
    made = []
    for key, radius_scale in (("head", 0.9), ("hips", 1.0), ("chest", 0.9)):
        bname = mapping.get(key)
        if not bname:
            continue
        b = arm.data.bones[bname]
        r = max((b.tail_local - b.head_local).length * radius_scale, 0.02)
        col = sb.add_collider(bpy.context, arm)
        col.node.bone_name = bname
        col.shape_type = "Sphere"
        col.shape.sphere.radius = r
        col.shape.sphere.offset = (0.0, r * 0.5, 0.0) if key == "head" else (0.0, 0.0, 0.0)
        grp = sb.add_collider_group()
        grp.vrm_name = f"{key}_colliders"
        ref = grp.add_collider()
        ref.collider_uuid = col.uuid
        made.append(grp.vrm_name)
    log(f"colliders: {made}")
    return made


# ----------------------------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------------------------
def image_mean_rgb(img):
    try:
        import numpy as np

        w, h = img.size
        if w == 0 or h == 0:
            return None
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        a = px[:, 3:4]
        if a.sum() < 1e-6:
            return None
        rgb = (px[:, :3] * a).sum(axis=0) / a.sum()
        return tuple(float(x) for x in rgb)
    except Exception as e:  # noqa: BLE001
        log(f"  mean colour failed for {img.name}: {e!r}")
        return None


def used_materials(meshes):
    mats = []
    for m in meshes:
        for ms in m.material_slots:
            if ms.material and ms.material not in mats:
                mats.append(ms.material)
    return mats


def detect_alpha_mode(mat):
    """('OPAQUE'|'MASK'|'BLEND', cutoff) read off the Principled node tree the glTF/FBX importer built.

    The VRM add-on's convert_material_to_mtoon1 copies colours and textures but never sets the MToon
    alpha mode, so every BLEND overlay (mouth/brow planes, glass) silently became OPAQUE. The importer
    records the glTF alphaMode as: BLEND -> surface_render_method 'BLENDED' + texture alpha wired into
    the Alpha socket; MASK -> Alpha <- Math(1 - (a < cutoff)); OPAQUE -> Alpha = 1 constant.
    """
    if not mat.use_nodes or not mat.node_tree:
        return "OPAQUE", 0.5
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return "OPAQUE", 0.5
    alpha_in = bsdf.inputs.get("Alpha")
    if alpha_in is None:
        return "OPAQUE", 0.5
    blended = getattr(mat, "surface_render_method", "") == "BLENDED" or getattr(mat, "blend_method", "") in ("BLEND", "HASHED")
    if not alpha_in.is_linked:
        if float(alpha_in.default_value) < 1.0:
            return "BLEND", 0.5
        return "OPAQUE", 0.5
    # walk back through Math nodes looking for the importer's clip chain
    node, cutoff, hops = alpha_in.links[0].from_node, None, 0
    while node is not None and node.type == "MATH" and hops < 4:
        for i in (0, 1):
            if node.operation in ("LESS_THAN", "GREATER_THAN") and not node.inputs[i].is_linked:
                cutoff = float(node.inputs[i].default_value)
        if node.operation == "ROUND":
            cutoff = 0.5
        nxt = None
        for sock in node.inputs:
            if sock.is_linked:
                nxt = sock.links[0].from_node
                break
        node, hops = nxt, hops + 1
    if cutoff is not None and not blended:
        return "MASK", cutoff
    return "BLEND", 0.5


def convert_to_mtoon(meshes, shade_tint, outline_width, no_outline_pattern=None):
    """Convert every used material to MToon. Face-part materials (those matching no_outline_pattern,
    i.e. --face-material) and alpha-blended overlays get NO outline: the outline shell of the mouth
    cavity / brow / lash planes that sit just inside or on the skin pokes through the face and reads as
    a dark blob over the mouth and heavy brows (the defect the stock Seed-san build showed; its own
    face materials ship with outlineWidthMode 'none')."""
    no_outline_re = re.compile(no_outline_pattern, re.I) if no_outline_pattern else None
    mats = used_materials(meshes)
    for mat in mats:
        gltf = mat.vrm_addon_extension.mtoon1
        if not gltf.enabled:
            alpha_mode, cutoff = detect_alpha_mode(mat)
            bpy.ops.vrm.convert_material_to_mtoon1(material_name=mat.name)
            gltf = mat.vrm_addon_extension.mtoon1
            gltf.alpha_mode = alpha_mode
            if alpha_mode == "MASK":
                gltf.alpha_cutoff = cutoff
            if alpha_mode != "OPAQUE":
                log(f"  alpha mode kept on {mat.name}: {alpha_mode}" + (f" cutoff={cutoff}" if alpha_mode == "MASK" else ""))
        gltf.enabled = True
        mtoon = gltf.extensions.vrmc_materials_mtoon
        base_img = gltf.pbr_metallic_roughness.base_color_texture.index.source
        if base_img is not None:
            # the add-on copies the Principled "Base Color" socket value as the factor even when a texture
            # is wired into it; the glTF importer leaves that socket at Blender's 0.8 grey, so every textured
            # material came out 20 % darker than the input. glTF semantics: texture linked -> factor 1.
            fac = tuple(gltf.pbr_metallic_roughness.base_color_factor)
            if any(abs(c - 0.8) < 1e-3 for c in fac[:3]):
                gltf.pbr_metallic_roughness.base_color_factor = (1.0, 1.0, 1.0, fac[3])
        mean = image_mean_rgb(base_img) if base_img else None
        if base_img:
            mtoon.shade_multiply_texture.index.source = base_img
        mtoon.shade_color_factor = shade_tint
        mtoon.shading_toony_factor = 0.9
        mtoon.shading_shift_factor = -0.05
        mtoon.gi_equalization_factor = 0.9
        skip_outline = (no_outline_re is not None and no_outline_re.search(mat.name)) or gltf.alpha_mode == "BLEND"
        mtoon.outline_width_mode = "none" if skip_outline else "worldCoordinates"
        mtoon.outline_width_factor = outline_width
        if mean:
            mtoon.outline_color_factor = tuple(max(0.0, c * 0.28) for c in mean)
        else:
            mtoon.outline_color_factor = (0.1, 0.08, 0.12)
        mtoon.outline_lighting_mix_factor = 1.0
        log(f"  MToon {mat.name}: base_tex={base_img.name if base_img else None} mean={tuple(round(c, 3) for c in mean) if mean else None} "
            f"outline={mtoon.outline_width_mode} outline_col={tuple(round(c, 3) for c in mtoon.outline_color_factor)} alpha={gltf.alpha_mode}")
    log(f"materials converted to MToon: {len(mats)}")


# ----------------------------------------------------------------------------------------------
# face texture / expressions
# ----------------------------------------------------------------------------------------------
PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral", "aa", "ih", "ou", "ee", "oh",
           "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight"]
PRESET_ALIASES = {  # lower-case shape-key name -> preset
    "blink": "blink", "eye_close": "blink", "eyes_closed": "blink", "fcl_eye_close": "blink", "eyeblink": "blink",
    "blink_l": "blinkLeft", "blink_r": "blinkRight", "fcl_eye_close_l": "blinkLeft", "fcl_eye_close_r": "blinkRight",
    "a": "aa", "aa": "aa", "mouth_a": "aa", "fcl_mth_a": "aa", "vrc.v_aa": "aa",
    "i": "ih", "ih": "ih", "mouth_i": "ih", "fcl_mth_i": "ih", "vrc.v_ih": "ih",
    "u": "ou", "ou": "ou", "mouth_u": "ou", "fcl_mth_u": "ou", "vrc.v_ou": "ou",
    "e": "ee", "ee": "ee", "mouth_e": "ee", "fcl_mth_e": "ee", "vrc.v_ee": "ee",
    "o": "oh", "oh": "oh", "mouth_o": "oh", "fcl_mth_o": "oh", "vrc.v_oh": "oh",
    "happy": "happy", "joy": "happy", "fcl_all_joy": "happy", "smile": "happy",
    "angry": "angry", "fcl_all_angry": "angry",
    "sad": "sad", "sorrow": "sad", "fcl_all_sorrow": "sad",
    "relaxed": "relaxed", "fun": "relaxed", "fcl_all_fun": "relaxed",
    "surprised": "surprised", "fcl_all_surprised": "surprised",
}


def find_face_material(meshes, pattern):
    rx = re.compile(pattern, re.I)
    for mat in used_materials(meshes):
        if rx.search(mat.name):
            return mat
    return None


def expression_group(ext, name):
    if name in PRESETS:
        return getattr(ext.vrm1.expressions.preset, vrm_to_prop(name)), "preset"
    for c in ext.vrm1.expressions.custom:
        if c.custom_name == name:
            return c, "custom"
    c = ext.vrm1.expressions.custom.add()
    c.custom_name = name
    return c, "custom"


def swap_face_texture(face_mat, png_path):
    img = bpy.data.images.load(png_path, check_existing=True)
    img.pack()
    gltf = face_mat.vrm_addon_extension.mtoon1
    if gltf.enabled:
        gltf.pbr_metallic_roughness.base_color_texture.index.source = img
        gltf.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source = img
    else:
        # plain principled: replace the image on every image node
        for n in face_mat.node_tree.nodes:
            if n.type == "TEX_IMAGE":
                n.image = img
    log(f"face texture -> {os.path.basename(png_path)} ({img.size[0]}x{img.size[1]}) on material {face_mat.name}")
    return img


def clear_secondary_face_maps(mat):
    """Drop every texture on the face material except base/shade colour (VRM add-on MToon props and
    the Principled node tree), so texture-transform expressions move one map, not a stack."""
    cleared = []
    ext = getattr(mat, "vrm_addon_extension", None)
    mtoon1 = getattr(ext, "mtoon1", None) if ext else None
    if mtoon1 is not None:
        try:
            mtoon1.emissive_factor = (0.0, 0.0, 0.0)
        except Exception as e:  # noqa: BLE001
            log(f"face: could not zero emissive_factor: {e}")
        candidates = [("emissive_texture", mtoon1)]
        vm = getattr(getattr(mtoon1, "extensions", None), "vrmc_materials_mtoon", None)
        if vm is not None:
            candidates += [(n, vm) for n in ("matcap_texture", "rim_multiply_texture", "outline_width_multiply_texture", "uv_animation_mask_texture")]
        for name, owner in candidates:
            tex = getattr(owner, name, None)
            idx = getattr(tex, "index", None)
            if idx is not None and getattr(idx, "source", None) is not None:
                try:
                    idx.source = None
                    cleared.append(name)
                except Exception as e:  # noqa: BLE001
                    log(f"face: could not clear {name}: {e}")
    nt = mat.node_tree
    if nt:
        for node in list(nt.nodes):
            if node.type == "BSDF_PRINCIPLED":
                for inp_name in ("Emission Strength",):
                    if inp_name in node.inputs:
                        node.inputs[inp_name].default_value = 0.0
                for inp_name in ("Emission Color", "Emission"):
                    if inp_name in node.inputs:
                        for link in list(node.inputs[inp_name].links):
                            nt.links.remove(link)
                            cleared.append("node:" + inp_name)
    log(f"face: secondary maps cleared on {mat.name}: {cleared or 'none present'}")


def apply_face_atlas(arm, meshes, face_mat, atlas):
    """atlas: {"neutral": "<state>", "states": {name: {"u","v","w","h"}}} in glTF UV space (v down)."""
    states = atlas["states"]
    neutral_name = atlas.get("neutral", "neutral" if "neutral" in states else next(iter(states)))
    n = states[neutral_name]
    u0, v0, w, h = float(n["u"]), float(n["v"]), float(n["w"]), float(n["h"])
    # 1) scale mesh UVs of face-material polygons into the neutral cell
    touched = 0
    for m in meshes:
        slots = [i for i, ms in enumerate(m.material_slots) if ms.material == face_mat]
        if not slots or not m.data.uv_layers.active:
            continue
        uv = m.data.uv_layers.active.data
        for p in m.data.polygons:
            if p.material_index not in slots:
                continue
            for li in p.loop_indices:
                bu, bv = uv[li].uv
                uv[li].uv = (u0 + bu * w, (1.0 - v0 - h) + bv * h)
                touched += 1
    log(f"face atlas: neutral cell {neutral_name} (u={u0} v={v0} w={w} h={h}); {touched} UV loops rescaled")
    # 1b) the atlas replaces base and shade; any OTHER map on this material (emissive, matcap, rim,
    # outline-width) still samples the original UV layout and washes the cells out under the offset.
    clear_secondary_face_maps(face_mat)
    # 2) expressions as texture-transform binds (offset from the neutral cell, in glTF UV space)
    ext = armature_ext(arm.data)
    made = []
    for st_name, cell in states.items():
        if st_name == neutral_name:
            continue
        du, dv = float(cell["u"]) - u0, float(cell["v"]) - v0
        grp, kind = expression_group(ext, st_name)
        bind = grp.texture_transform_binds.add()
        bind.material = face_mat
        bind.scale = (1.0, 1.0)
        bind.offset = (du, dv)
        grp.is_binary = bool(cell.get("binary", True))
        # Every cell is a whole face and the binds are ADDITIVE offsets on one material, so two active
        # states would land on a garbage cell. VRM overrides solve that: an expression's override
        # multiplies the weight of the OTHER expressions of that category (blink / lookAt / mouth) by
        # (1 - its weight); it must not name its own category, or it blocks itself (three-vrm applies
        # the multiplier to blink/blinkLeft/blinkRight, aa/ih/ou/ee/oh and lookUp/Down/Left/Right).
        is_blink = st_name in ("blink", "blinkLeft", "blinkRight")
        is_mouth = st_name in ("aa", "ih", "ou", "ee", "oh")
        is_look = st_name in ("lookUp", "lookDown", "lookLeft", "lookRight")
        grp.override_blink = "none" if is_blink else "block"
        grp.override_mouth = "none" if is_mouth else "block"
        grp.override_look_at = "none" if is_look else "block"
        made.append((kind, st_name, (du, dv)))
    for kind, st, off in made:
        log(f"  expression {kind}:{st} textureTransform offset={tuple(round(x, 4) for x in off)} binary")
    return made


def apply_morph_map(arm, meshes, morph_map):
    ext = armature_ext(arm.data)
    made = []
    for expr_name, key_name in morph_map.items():
        for m in meshes:
            sk = m.data.shape_keys
            if not sk or key_name not in sk.key_blocks:
                continue
            grp, kind = expression_group(ext, expr_name)
            bind = grp.morph_target_binds.add()
            bind.node.mesh_object_name = m.name
            bind.index = key_name
            bind.weight = 1.0
            made.append((kind, expr_name, m.name, key_name))
    for kind, e, m, k in made:
        log(f"  expression {kind}:{e} morph {m}/{k}")
    return made


def auto_morph_map(meshes):
    found = {}
    for m in meshes:
        sk = m.data.shape_keys
        if not sk:
            continue
        for kb in sk.key_blocks:
            preset = PRESET_ALIASES.get(kb.name.lower())
            if preset and preset not in found:
                found[preset] = kb.name
    return found


# ----------------------------------------------------------------------------------------------
# meta + export
# ----------------------------------------------------------------------------------------------
def set_meta(arm, name, author, version):
    meta = armature_ext(arm.data).vrm1.meta
    meta.vrm_name = name
    meta.version = version
    if not meta.authors:
        a = meta.authors.add()
        a.value = author
    meta.avatar_permission = "onlyAuthor"
    meta.commercial_usage = "personalNonProfit"
    meta.credit_notation = "required"
    meta.modification = "prohibited"
    meta.allow_redistribution = False


def export_vrm(arm, out_path):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    # validator first so the failure reason is printed
    try:
        bpy.ops.vrm.model_validate(armature_object_name=arm.name, show_successful_message=False)
    except Exception as e:  # noqa: BLE001
        log(f"validator raised: {e!r}")
    res = bpy.ops.export_scene.vrm(filepath=out_path, armature_object_name=arm.name, ignore_warning=True)
    if "FINISHED" not in res or not os.path.exists(out_path):
        die(f"VRM export failed ({res})")
    log(f"exported {out_path} ({os.path.getsize(out_path)} bytes)")


def main():
    args = parse_args()
    reset_scene()
    ensure_addon()
    if not os.path.exists(args.input):
        die(f"input not found: {args.input}")
    import_model(os.path.abspath(args.input))
    arm, meshes = find_armature_and_meshes()
    apply_transforms(arm, meshes)
    if args.height:
        normalize_height(arm, meshes, args.height)

    mapping, missing = map_humanoid(arm)
    if missing:
        die(f"required humanoid bones missing: {missing}. Rename bones or extend build_vrm.SIDED/UNSIDED.")
    chains = None
    if args.chains:
        with open(args.chains, encoding="utf-8") as f:
            chains = json.load(f)
    if chains and chains.get("bone_fixups"):
        apply_bone_fixups(arm, mapping, chains["bone_fixups"])
    if chains and chains.get("weight_cleanup"):
        clean_far_weights(arm, meshes, mapping, chains["weight_cleanup"])
    if args.force_tpose:
        force_tpose(arm, meshes, mapping)
    apply_humanoid(arm, mapping)
    set_meta(arm, args.name, args.author, args.version)

    if chains:
        if chains.get("colliders", True):
            add_default_colliders(arm, mapping, chains)
        for spec in chains.get("chains", []):
            build_chain(arm, meshes, spec, mapping)

    if not args.no_mtoon:
        tint = tuple(float(x) for x in args.shade_tint.split(","))
        no_outline = args.face_material if not args.outline_skip else f"(?:{args.face_material})|(?:{args.outline_skip})"
        convert_to_mtoon(meshes, tint, args.outline_width, no_outline_pattern=no_outline)

    face_mat = find_face_material(meshes, args.face_material)
    log(f"face material: {face_mat.name if face_mat else None} (pattern {args.face_material!r})")
    if args.face_texture:
        if not face_mat:
            die("--face-texture given but no material matched --face-material")
        swap_face_texture(face_mat, os.path.abspath(args.face_texture))
    if args.face_atlas:
        if not face_mat:
            die("--face-atlas given but no material matched --face-material")
        with open(args.face_atlas, encoding="utf-8") as f:
            apply_face_atlas(arm, meshes, face_mat, json.load(f))

    morphs = {}
    if args.auto_morphs:
        morphs.update(auto_morph_map(meshes))
    if args.morph_map:
        with open(args.morph_map, encoding="utf-8") as f:
            morphs.update(json.load(f))
    if morphs:
        apply_morph_map(arm, meshes, morphs)

    if args.save_blend:
        os.makedirs(os.path.dirname(os.path.abspath(args.save_blend)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
        log(f"saved {args.save_blend}")

    out = os.path.abspath(args.output)
    export_vrm(arm, out)
    m = read_manifest(out)
    m["log"] = LOG
    m["input"] = os.path.abspath(args.input)
    print_manifest(m)
    mpath = args.manifest or (out + ".manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2)
    log(f"manifest written: {mpath}")


if __name__ == "__main__":
    main()
