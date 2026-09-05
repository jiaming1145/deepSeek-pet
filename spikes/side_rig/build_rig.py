"""Derive a 2D side-view skeleton from See-through layers and write rig.json + a bone overlay for checking.

    python spikes/side_rig/build_rig.py [--assets spikes/side_rig/assets] [--out spikes/side_rig/rig.json]

Canvas is the PSD canvas (pixels, y down, character faces -x). Rigid parts hang off one bone; the tail, back
hair and skirt are chains whose joints are placed on the medial axis of the layer's alpha. Weights for chain
layers are computed in the runtime from the polyline (parameter t along the chain).
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw


def alpha(path, bbox=None, canvas=None):
    """Opaque mask of a layer PNG, padded into canvas coordinates when bbox/canvas are given."""
    m = np.asarray(Image.open(path).convert("RGBA"))[..., 3] > 40
    if bbox is None or canvas is None:
        return m
    full = np.zeros((canvas[1], canvas[0]), dtype=bool)
    x0, y0 = int(bbox[0]), int(bbox[1])
    h, w = m.shape
    full[y0:y0 + h, x0:x0 + w] = m[: canvas[1] - y0, : canvas[0] - x0]
    return full


def medial_x(mask, x0, x1, n, ymin=None, ymax=None):
    """Sample n+1 points along x: mean y of opaque pixels in each column band."""
    pts = []
    edges = np.linspace(x0, x1, n + 1)
    for i in range(n + 1):
        a, b = int(edges[max(0, i - 1)] if i else edges[0]), int(edges[min(n, i + 1)] if i < n else edges[n])
        band = mask[:, a:b + 1]
        if ymin is not None:
            band = band.copy(); band[:ymin] = False
        if ymax is not None:
            band = band.copy(); band[ymax:] = False
        ys = np.nonzero(band.any(axis=1))[0]
        pts.append([float(edges[i]), float(ys.mean()) if len(ys) else (pts[-1][1] if pts else 0.0)])
    return pts


def medial_y(mask, y0, y1, n, xmin=None):
    pts = []
    edges = np.linspace(y0, y1, n + 1)
    for i in range(n + 1):
        a, b = int(edges[max(0, i - 1)] if i else edges[0]), int(edges[min(n, i + 1)] if i < n else edges[n])
        band = mask[a:b + 1, :]
        if xmin is not None:
            band = band.copy(); band[:, :xmin] = False
        xs = np.nonzero(band.any(axis=0))[0]
        pts.append([float(xs.mean()) if len(xs) else (pts[-1][0] if pts else 0.0), float(edges[i])])
    return pts


def split_layer(assets, L, name, cx, canvas):
    """Split a layer PNG into <name>_r (screen-left, her right) and <name>_l (screen-right) by the centre x."""
    m = L[name]
    im = Image.open(os.path.join(assets, m["file"])).convert("RGBA")
    a = np.asarray(im).copy()
    x0 = m["bbox"][0]
    col = np.arange(a.shape[1]) + x0
    out = {}
    for side, keep in (("r", col < cx), ("l", col >= cx)):
        b = a.copy()
        b[:, ~keep, 3] = 0
        alpha = b[..., 3] > 40
        if not alpha.any():
            continue
        ys, xs = np.nonzero(alpha)
        fn = f"{name}_{side}.png"
        Image.fromarray(b).save(os.path.join(assets, fn))
        out[side] = {"name": f"{name}_{side}", "file": fn, "bbox": m["bbox"], "alpha_bbox": [int(xs.min() + x0), int(ys.min() + m["bbox"][1]), int(xs.max() + x0), int(ys.max() + m["bbox"][1])], "mask": alpha}
    return out


def build_front(a):
    meta = json.load(open(os.path.join(a.assets, "layers.json")))
    L = {m["name"]: m for m in meta["layers"]}
    W, H = meta["canvas"]
    bb = lambda n: L[n]["bbox"]  # noqa: E731
    fx0, fy0, fx1, fy1 = bb("face")
    cx = (fx0 + fx1) / 2
    tx0, ty0, tx1, ty1 = bb("topwear")
    bx0, by0, bx1, by1 = bb("bottomwear") if "bottomwear" in L else (tx0, ty0 + (ty1 - ty0) * 0.45, tx1, ty1)   # one-piece dress: skirt = lower part
    nx0, ny0, nx1, ny1 = bb("neck") if "neck" in L else (cx - 20, fy1 - 10, cx + 20, ty0 + 10)
    torso_cx = (tx0 + tx1) / 2
    floor = max(bb(n)[3] for n in ("footwear", "legwear") if n in L)
    hips = [torso_cx, (ty1 + by0) / 2]
    chest = [torso_cx, ty0 + (ty1 - ty0) * 0.25]
    neck_top = [(nx0 + nx1) / 2, ny0]
    head_top = [cx, fy0 + 20]
    bones = [
        {"name": "root", "parent": None, "head": [torso_cx, floor], "tail": [torso_cx, floor - 30]},
        {"name": "hips", "parent": "root", "head": hips, "tail": chest},
        {"name": "chest", "parent": "hips", "head": chest, "tail": [neck_top[0], ny1]},
        {"name": "neck", "parent": "chest", "head": [neck_top[0], ny1], "tail": neck_top},
        {"name": "head", "parent": "neck", "head": neck_top, "tail": head_top},
    ]
    attach = {"face": {"rigid": "head"}, "front_hair": {"rigid": "head"}, "headwear": {"rigid": "head"}, "ears": {"rigid": "head"},
              "eyewhite": {"rigid": "head"}, "irides": {"rigid": "head"}, "eyelash": {"rigid": "head"}, "eyebrow": {"rigid": "head"},
              "mouth": {"rigid": "head"}, "neck": {"rigid": "neck"}, "earwear": {"rigid": "head"}, "eyewear": {"rigid": "head"},
              "topwear": {"chain": ["hips", "chest"], "axis": "y", "grid": [6, 8]}}
    layers = {m["name"]: {"file": m["file"], "bbox": m["bbox"]} for m in meta["layers"]}
    order = [m["name"] for m in meta["layers"]]
    # legs: split legwear/footwear by centre; one thigh/shin/foot per side from the split masks
    legs = split_layer(a.assets, L, "legwear", cx, (W, H)) if "legwear" in L else {}
    shoes = split_layer(a.assets, L, "footwear", cx, (W, H)) if "footwear" in L else {}
    for side in ("l", "r"):
        if side not in legs:
            continue
        lb = legs[side]["alpha_bbox"]
        lcx = (lb[0] + lb[2]) / 2
        hip = [lcx * 0.4 + torso_cx * 0.6, hips[1]]
        knee = [lcx, lb[1] + (lb[3] - lb[1]) * 0.5]
        ankle = [lcx, lb[3] - 10]
        toe = [lcx, floor - 4]
        if side in shoes:
            sb = shoes[side]["alpha_bbox"]; ankle = [(sb[0] + sb[2]) / 2, sb[1] + 8]; toe = [(sb[0] + sb[2]) / 2, sb[3] - 4]
        bones += [{"name": f"thigh_{side}", "parent": "hips", "head": hip, "tail": knee},
                  {"name": f"shin_{side}", "parent": f"thigh_{side}", "head": knee, "tail": ankle},
                  {"name": f"foot_{side}", "parent": f"shin_{side}", "head": ankle, "tail": toe}]
        nm = legs[side]["name"]; layers[nm] = {"file": legs[side]["file"], "bbox": legs[side]["bbox"]}
        attach[nm] = {"chain": [f"thigh_{side}", f"shin_{side}"], "axis": "y", "grid": [4, 8]}
        order.insert(order.index("legwear"), nm)
        if side in shoes:
            sn = shoes[side]["name"]; layers[sn] = {"file": shoes[side]["file"], "bbox": shoes[side]["bbox"]}
            attach[sn] = {"rigid": f"foot_{side}"}; order.insert(order.index("footwear"), sn)
    for n in ("legwear", "footwear"):
        if n in order and any(k.startswith(n + "_") for k in layers):
            order.remove(n)
    # arms: split handwear by centre
    arms = split_layer(a.assets, L, "handwear", cx, (W, H)) if "handwear" in L else {}
    for side in ("l", "r"):
        if side not in arms:
            continue
        ab = arms[side]["alpha_bbox"]
        acx = (ab[0] + ab[2]) / 2
        shoulder = [tx0 + 8 if side == "r" else tx1 - 8, ty0 + (ty1 - ty0) * 0.18]
        wrist = [acx, ab[3] - 22]
        elbow = [(shoulder[0] + wrist[0]) / 2, (shoulder[1] + wrist[1]) / 2]
        tip = [acx, ab[3] - 4]
        bones += [{"name": f"upper_arm_{side}", "parent": "chest", "head": shoulder, "tail": elbow},
                  {"name": f"forearm_{side}", "parent": f"upper_arm_{side}", "head": elbow, "tail": wrist},
                  {"name": f"hand_{side}", "parent": f"forearm_{side}", "head": wrist, "tail": tip}]
        nm = arms[side]["name"]; layers[nm] = {"file": arms[side]["file"], "bbox": arms[side]["bbox"]}
        attach[nm] = {"chain": [f"upper_arm_{side}", f"forearm_{side}", f"hand_{side}"], "axis": "y", "grid": [4, 10]}
        order.insert(order.index("handwear"), nm)
    if "handwear" in order and any(k.startswith("handwear_") for k in layers):
        order.remove("handwear")
    # back hair: split, one chain per side down the medial axis
    hair_names_all = []
    if "back_hair" in L:
        hairs = split_layer(a.assets, L, "back_hair", cx, (W, H))
        hb = bb("back_hair")
        for side in ("l", "r"):
            if side not in hairs:
                continue
            full = np.zeros((H, W), dtype=bool)
            m_ = hairs[side]["mask"]; full[hb[1]:hb[1] + m_.shape[0], hb[0]:hb[0] + m_.shape[1]] = m_[: H - hb[1], : W - hb[0]]
            pts = medial_y(full, fy0 + (fy1 - fy0) * 0.45, hairs[side]["alpha_bbox"][3] - 10, 5)
            names = [f"hair_{side}_{i + 1}" for i in range(5)]
            for i in range(5):
                bones.append({"name": names[i], "parent": "head" if i == 0 else names[i - 1], "head": pts[i], "tail": pts[i + 1]})
            hair_names_all += names
            nm = hairs[side]["name"]; layers[nm] = {"file": hairs[side]["file"], "bbox": hairs[side]["bbox"]}
            attach[nm] = {"chain": ["head"] + names, "axis": "y", "grid": [8, 16], "rigid_above": fy0 + (fy1 - fy0) * 0.45}
            order.insert(order.index("back_hair"), nm)
        if any(k.startswith("back_hair_") for k in layers):
            order.remove("back_hair")
    # tail: medial axis from the body edge outwards (whichever side it sticks out)
    tail_names = []
    if "tail" in L:
        tb = bb("tail")
        tail_mask = alpha(os.path.join(a.assets, L["tail"]["file"]), tb, (W, H))
        right_side = (tb[2] - bx1) > (bx0 - tb[0])
        x_root, x_tip = (max(tb[0], bx1 - 12), tb[2] - 10) if right_side else (min(tb[2], bx0 + 12), tb[0] + 10)
        pts = medial_x(tail_mask, x_root, x_tip, 6)
        tail_names = [f"tail_{i + 1}" for i in range(6)]
        for i in range(6):
            bones.append({"name": tail_names[i], "parent": "hips" if i == 0 else tail_names[i - 1], "head": pts[i], "tail": pts[i + 1]})
        attach["tail"] = {"chain": tail_names, "axis": "x", "grid": [18, 8]}
    # skirt: two hanging bones
    skirt_mid = [torso_cx, by0 + (by1 - by0) * 0.5]
    bones += [{"name": "skirt_1", "parent": "hips", "head": [torso_cx, by0 + 6], "tail": skirt_mid},
              {"name": "skirt_2", "parent": "skirt_1", "head": skirt_mid, "tail": [torso_cx, by1 - 6]}]
    attach["bottomwear"] = {"chain": ["skirt_1", "skirt_2"], "axis": "y", "grid": [10, 8]}
    # ahoge from the topmost hair pixels (front hair or headwear may hold it; use whichever layer reaches highest)
    top_layer = min((n for n in ("back_hair", "front_hair", "headwear") if n in L), key=lambda n: bb(n)[1])
    tm = alpha(os.path.join(a.assets, L[top_layer]["file"]), bb(top_layer), (W, H))
    ys = np.nonzero(tm[: max(10, int(fy0) + 10), :].any(axis=1))[0]
    if len(ys):
        y_top, y_base = int(ys.min()), int(ys.max())
        cxa = lambda y: float(np.nonzero(tm[y, :])[0].mean()) if tm[y, :].any() else cx  # noqa: E731
        y_mid = (y_top + y_base) // 2
        pts = [[cxa(y_base), float(y_base)], [cxa(y_mid), float(y_mid)], [cxa(y_top + 3), float(y_top + 3)]]
        bones += [{"name": "ahoge_1", "parent": "head", "head": pts[0], "tail": pts[1]}, {"name": "ahoge_2", "parent": "ahoge_1", "head": pts[1], "tail": pts[2]}]
    springs = {"skirt": {"bones": ["skirt_1", "skirt_2"], "stiffness": 120, "damping": 9, "inertia": 0.7, "limit": 0.35}}
    if tail_names:
        springs["tail"] = {"bones": tail_names, "stiffness": 60, "damping": 6, "inertia": 0.9, "limit": 0.6}
    for side in ("l", "r"):
        names = [n for n in hair_names_all if n.startswith(f"hair_{side}_")]
        if names:
            springs[f"hair_{side}"] = {"bones": names, "stiffness": 80, "damping": 7, "inertia": 1.2, "limit": 0.5}
    if any(b["name"] == "ahoge_1" for b in bones):
        springs["ahoge"] = {"bones": ["ahoge_1", "ahoge_2"], "stiffness": 140, "damping": 8, "inertia": 1.5, "limit": 0.6}
    for n in list(attach):
        if n not in layers:
            del attach[n]
    rig = {"canvas": [W, H], "floor": floor, "facing": "front", "view": "front", "bones": bones, "attach": attach, "duplicates": [], "order": order,
           "layers": layers, "eyes": {"center": [cx, (bb("eyewhite")[1] + bb("eyewhite")[3]) / 2 if "eyewhite" in L else fy0 + (fy1 - fy0) * 0.45]},
           "mouth": {"center": [(bb("mouth")[0] + bb("mouth")[2]) / 2, (bb("mouth")[1] + bb("mouth")[3]) / 2] if "mouth" in L else [cx, fy0 + (fy1 - fy0) * 0.7]},
           "springs": springs}
    json.dump(rig, open(a.out, "w"), indent=1)
    # overlay
    src = os.path.join(a.assets, "_source.png")
    comp = Image.open(src).convert("RGBA").resize((W, H)) if os.path.exists(src) else Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(comp)
    for b in bones:
        col = (255, 60, 60) if "tail" in b["name"] else (60, 200, 60) if "hair" in b["name"] else (60, 60, 255) if b["name"].endswith("_r") else (255, 160, 0)
        d.line([tuple(b["head"]), tuple(b["tail"])], fill=col, width=3)
        d.ellipse([b["head"][0] - 4, b["head"][1] - 4, b["head"][0] + 4, b["head"][1] + 4], fill=col)
        d.text((b["head"][0] + 5, b["head"][1] - 12), b["name"], fill=(0, 0, 0))
    comp.save(os.path.join(os.path.dirname(a.out), os.path.basename(a.out).replace(".json", "_overlay.png")))
    print(f"front rig: {len(bones)} bones, {len(attach)} attachments -> {a.out}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--assets", default=os.path.join(os.path.dirname(__file__), "assets"))
    p.add_argument("--out", default=None)
    p.add_argument("--view", default="side", choices=["side", "front"], help="side: profile (near/far limb duplicates); front: facing views, limbs and hair split left/right")
    a = p.parse_args()
    if a.out is None:
        a.out = os.path.join(os.path.dirname(__file__), "rig.json" if a.view == "side" else "rig_front.json")
    if a.view == "front":
        return build_front(a)
    meta = json.load(open(os.path.join(a.assets, "layers.json")))
    L = {m["name"]: m for m in meta["layers"]}
    W, H = meta["canvas"]
    bb = lambda n: L[n]["bbox"]  # noqa: E731  (x0, y0, x1, y1)

    fx0, fy0, fx1, fy1 = bb("face")
    tx0, ty0, tx1, ty1 = bb("topwear")
    bx0, by0, bx1, by1 = bb("bottomwear") if "bottomwear" in L else (tx0, ty0 + (ty1 - ty0) * 0.45, tx1, ty1)   # one-piece dress: skirt = lower part
    lx0, ly0, lx1, ly1 = bb("legwear")
    sx0, sy0, sx1, sy1 = bb("footwear")
    hx0, hy0, hx1, hy1 = bb("handwear")
    nx0, ny0, nx1, ny1 = bb("neck")
    torso_cx = (tx0 + tx1) / 2
    leg_cx = (lx0 + lx1) / 2
    floor = sy1
    hips = [torso_cx, (ty1 + by0) / 2]
    chest = [torso_cx, ty0 + (ty1 - ty0) * 0.25]
    neck_top = [(nx0 + nx1) / 2, ny0]
    head_top = [(fx0 + fx1) / 2 - 10, fy0 + 20]
    knee = [leg_cx, ly0 + (ly1 - ly0) * 0.45]
    ankle = [leg_cx, sy0 + 8]
    toe = [sx0 + 8, sy1 - 4]
    shoulder = [(hx0 + hx1) / 2, hy0 + 6]
    elbow = [(hx0 + hx1) / 2, hy0 + (hy1 - hy0) * 0.48]
    wrist = [(hx0 + hx1) / 2 - 2, hy0 + (hy1 - hy0) * 0.86]
    hand_tip = [(hx0 + hx1) / 2 - 4, hy1 - 4]

    bones = [
        {"name": "root", "parent": None, "head": [torso_cx, floor], "tail": [torso_cx, floor - 30]},
        {"name": "hips", "parent": "root", "head": hips, "tail": chest},
        {"name": "chest", "parent": "hips", "head": chest, "tail": [neck_top[0], ny1]},
        {"name": "neck", "parent": "chest", "head": [neck_top[0], ny1], "tail": neck_top},
        {"name": "head", "parent": "neck", "head": neck_top, "tail": head_top},
    ]
    for side, dx in (("near", 0), ("far", 7)):
        bones += [
            {"name": f"thigh_{side}", "parent": "hips", "head": [hips[0] + dx, hips[1]], "tail": [knee[0] + dx, knee[1]]},
            {"name": f"shin_{side}", "parent": f"thigh_{side}", "head": [knee[0] + dx, knee[1]], "tail": [ankle[0] + dx, ankle[1]]},
            {"name": f"foot_{side}", "parent": f"shin_{side}", "head": [ankle[0] + dx, ankle[1]], "tail": [toe[0] + dx, toe[1]]},
            {"name": f"upper_arm_{side}", "parent": "chest", "head": [shoulder[0] + dx, shoulder[1]], "tail": [elbow[0] + dx, elbow[1]]},
            {"name": f"forearm_{side}", "parent": f"upper_arm_{side}", "head": [elbow[0] + dx, elbow[1]], "tail": [wrist[0] + dx, wrist[1]]},
            {"name": f"hand_{side}", "parent": f"forearm_{side}", "head": [wrist[0] + dx, wrist[1]], "tail": [hand_tip[0] + dx, hand_tip[1]]},
        ]
    # tail chain along the tail's medial axis, root at the body side (smallest x of the tail that overlaps the skirt)
    tail_mask = alpha(os.path.join(a.assets, L["tail"]["file"]), bb("tail"), (W, H))
    tb = bb("tail")
    tail_root_x = max(tb[0], bx1 - 12)
    tail_pts = medial_x(tail_mask, tail_root_x, tb[2] - 10, 6)
    tail_names = [f"tail_{i + 1}" for i in range(6)]
    for i in range(6):
        bones.append({"name": tail_names[i], "parent": "hips" if i == 0 else tail_names[i - 1], "head": tail_pts[i], "tail": tail_pts[i + 1]})
    # back hair chain: from the back of the head down the hair's medial axis (only the part behind the face)
    hair_mask = alpha(os.path.join(a.assets, L["back_hair"]["file"]), bb("back_hair"), (W, H))
    hb = bb("back_hair")
    hair_pts = medial_y(hair_mask, fy0 + (fy1 - fy0) * 0.55, hb[3] - 12, 5, xmin=int(fx1 - 30))
    hair_names = [f"hair_{i + 1}" for i in range(5)]
    for i in range(5):
        bones.append({"name": hair_names[i], "parent": "head" if i == 0 else hair_names[i - 1], "head": hair_pts[i], "tail": hair_pts[i + 1]})
    # skirt: two bones hanging from the hips
    skirt_mid = [torso_cx, by0 + (by1 - by0) * 0.5]
    bones += [
        {"name": "skirt_1", "parent": "hips", "head": [torso_cx, by0 + 6], "tail": skirt_mid},
        {"name": "skirt_2", "parent": "skirt_1", "head": skirt_mid, "tail": [torso_cx, by1 - 6]},
    ]
    # ahoge: two bones up the topmost hair pixels (rows above the face)
    top_rows = hair_mask[: max(10, int(fy0) + 10), :]
    ys = np.nonzero(top_rows.any(axis=1))[0]
    if len(ys):
        y_top, y_base = int(ys.min()), int(ys.max())
        def cx_at(y):
            xs = np.nonzero(hair_mask[y, :])[0]
            return float(xs.mean()) if len(xs) else (fx0 + fx1) / 2
        y_mid = (y_top + y_base) // 2
        ahoge = [[cx_at(y_base), float(y_base)], [cx_at(y_mid), float(y_mid)], [cx_at(y_top + 3), float(y_top + 3)]]
    else:
        ahoge = [[hb[0] + 40, 62], [hb[0] + 55, 30], [hb[0] + 75, 8]]
    bones += [
        {"name": "ahoge_1", "parent": "head", "head": ahoge[0], "tail": ahoge[1]},
        {"name": "ahoge_2", "parent": "ahoge_1", "head": ahoge[1], "tail": ahoge[2]},
    ]

    # layer attachments: rigid -> one bone; chain -> ordered bones + axis; split -> rule by y
    attach = {
        "face": {"rigid": "head"}, "front_hair": {"rigid": "head"}, "headwear": {"rigid": "head"}, "ears": {"rigid": "head"},
        "eyewhite": {"rigid": "head"}, "irides": {"rigid": "head"}, "eyelash": {"rigid": "head"}, "eyebrow": {"rigid": "head"},
        "mouth": {"rigid": "head"}, "neck": {"rigid": "neck"},
        "topwear": {"chain": ["hips", "chest"], "axis": "y", "grid": [6, 8]},
        "bottomwear": {"chain": ["skirt_1", "skirt_2"], "axis": "y", "grid": [10, 8]},
        "legwear": {"chain": ["thigh_near", "shin_near"], "axis": "y", "grid": [4, 8]},
        "footwear": {"rigid": "foot_near"},
        "handwear": {"chain": ["upper_arm_near", "forearm_near", "hand_near"], "axis": "y", "grid": [4, 10]},
        "tail": {"chain": tail_names, "axis": "x", "grid": [18, 8]},
        "back_hair": {"chain": ["head"] + hair_names, "axis": "y", "grid": [10, 16], "rigid_above": fy0 + (fy1 - fy0) * 0.55},
    }
    # duplicated far limbs drawn behind the body, slightly darker
    dup = [
        {"name": "legwear_far", "from": "legwear", "chain": ["thigh_far", "shin_far"], "axis": "y", "grid": [4, 8], "tint": 0.78, "z_before": "back_hair"},
        {"name": "footwear_far", "from": "footwear", "rigid": "foot_far", "tint": 0.78, "z_before": "back_hair"},
        {"name": "handwear_far", "from": "handwear", "chain": ["upper_arm_far", "forearm_far", "hand_far"], "axis": "y", "grid": [4, 10], "tint": 0.78, "z_before": "back_hair"},
    ]
    order = [m["name"] for m in meta["layers"]]  # PSD bottom -> top
    rig = {"canvas": [W, H], "floor": floor, "facing": "-x", "bones": bones, "attach": attach, "duplicates": dup, "order": order,
           "layers": {m["name"]: {"file": m["file"], "bbox": m["bbox"]} for m in meta["layers"]},
           "eyes": {"center": [(bb("eyewhite")[0] + bb("eyewhite")[2]) / 2, (bb("eyewhite")[1] + bb("eyewhite")[3]) / 2]},
           "mouth": {"center": [(bb("mouth")[0] + bb("mouth")[2]) / 2, (bb("mouth")[1] + bb("mouth")[3]) / 2]},
           "springs": {"tail": {"bones": tail_names, "stiffness": 60, "damping": 6, "inertia": 0.9, "limit": 0.6},
                       "hair": {"bones": hair_names, "stiffness": 80, "damping": 7, "inertia": 1.2, "limit": 0.5},
                       "skirt": {"bones": ["skirt_1", "skirt_2"], "stiffness": 120, "damping": 9, "inertia": 0.7, "limit": 0.35},
                       "ahoge": {"bones": ["ahoge_1", "ahoge_2"], "stiffness": 140, "damping": 8, "inertia": 1.5, "limit": 0.6}}}
    json.dump(rig, open(a.out, "w"), indent=1)

    # overlay for checking
    comp = Image.open(os.path.join(a.assets, "..", "..", "model", "generated", "see_through", "in", "overview_side.png")).convert("RGBA").resize((W, H)) \
        if os.path.exists(os.path.join(a.assets, "..", "..", "model", "generated", "see_through", "in", "overview_side.png")) else Image.new("RGBA", (W, H), (255, 255, 255, 255))
    ov = comp.copy()
    d = ImageDraw.Draw(ov)
    by_name = {b["name"]: b for b in bones}
    for b in bones:
        col = (255, 60, 60) if "tail" in b["name"] else (60, 200, 60) if "hair" in b["name"] else (60, 60, 255) if "far" in b["name"] else (255, 160, 0)
        d.line([tuple(b["head"]), tuple(b["tail"])], fill=col, width=3)
        d.ellipse([b["head"][0] - 4, b["head"][1] - 4, b["head"][0] + 4, b["head"][1] + 4], fill=col)
        d.text((b["head"][0] + 5, b["head"][1] - 12), b["name"], fill=(0, 0, 0))
    ov.save(os.path.join(os.path.dirname(a.out), "rig_overlay.png"))
    print(f"rig: {len(bones)} bones, {len(attach)} attachments, {len(dup)} duplicates -> {a.out}; overlay rig_overlay.png")


if __name__ == "__main__":
    main()
