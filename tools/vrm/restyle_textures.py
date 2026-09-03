"""Repaint a VRoid outfit and hair texture set into Whale-chan's palette. Pure PIL, no Blender.

    python tools/vrm/restyle_textures.py --src <dumped textures dir> --out <dir> [--palette palette.json]

Rules (measured on AvatarSample_G's Onepiece/Shoes/Hair textures, but written by colour class, not by pixel):
- fabric (white, cream, peach, pink; anything that is not gold and not transparent) -> navy ramp by luminance
- lace / frills: white pixels within a few px of pink stay white (lace is drawn white ON pink hems)
- gold trims and buttons stay
- pink accents that are thin lines (jabot ribbon, shoe straps) -> light blue
- hair: grey strands with pink tips -> navy strands, light-blue tips; the material tint is set to white in Blender
- optional painted overlays: white apron on the front skirt panel + white bib, as UV rectangles from the palette file
"""
from __future__ import annotations

import argparse
import colorsys
import json
import os

import numpy as np
from PIL import Image, ImageFilter

NAVY = (0.11, 0.17, 0.38)       # dress body
NAVY_DARK = (0.06, 0.09, 0.22)  # deepest shading
LIGHT_BLUE = (0.55, 0.80, 0.98) # bows, tips
HAIR_NAVY = (0.14, 0.30, 0.68)
HAIR_TIP = (0.52, 0.82, 1.00)


def rgb_to_hls(arr):
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx, mn = arr[..., :3].max(-1), arr[..., :3].min(-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d < 1e-6, 0, np.where(l < 0.5, d / np.maximum(mx + mn, 1e-6), d / np.maximum(2 - mx - mn, 1e-6)))
    h = np.zeros_like(l)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.maximum(d, 1e-6), 0); gc = np.where(m, (mx - g) / np.maximum(d, 1e-6), 0); bc = np.where(m, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2 + rc - bc, 4 + gc - rc))
    h = (h / 6.0) % 1.0
    return h, l, s


def ramp(lum, dark, light):
    """luminance 0..1 -> colour between dark and light (keeps the shading of the source)."""
    t = np.clip(lum, 0, 1)[..., None]
    return np.array(dark) * (1 - t) + np.array(light) * t


def classify(rgba):
    """Colour classes by chroma (max-min), not HLS saturation: pastels have tiny chroma but HLS saturation near 1."""
    a = rgba[..., 3]
    rgb = rgba[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    chroma = mx - mn
    l = (mx + mn) / 2
    h, _, s = rgb_to_hls(rgb)
    opaque = a > 0.5
    solid = a > 0.9
    gold = opaque & (h > 0.07) & (h < 0.15) & (chroma > 0.35) & (l > 0.28) & (l < 0.74)
    pink = opaque & ((h > 0.83) | (h < 0.04)) & (chroma > 0.12) & (l > 0.4)
    white = opaque & (mn > 0.84)
    cream = opaque & (h > 0.04) & (h < 0.18) & (chroma > 0.06) & (chroma < 0.45) & (l > 0.68) & ~gold
    fabric = opaque & ~gold
    return {"opaque": opaque, "solid": solid, "gold": gold, "pink": pink, "white": white, "cream": cream,
            "fabric": fabric, "l": l, "h": h, "s": s, "chroma": chroma}


def erode(mask, px):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MinFilter(px * 2 + 1))) > 127


def dilate(mask, px):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127


def recolour_outfit(img: Image.Image, overlays=None, lace_px=10, thin_px=6):
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    c = classify(rgba)
    out = rgba.copy()
    # lace: white pixels near pink stay white
    near_pink = dilate(c["pink"], lace_px)
    lace = c["white"] & near_pink
    # thin pink accents (ribbons, straps): pink shapes that vanish under a morphological opening -> light blue
    opened = dilate(erode(c["pink"], thin_px), thin_px)
    thin_pink = c["pink"] & c["solid"] & ~opened
    # fabric -> navy ramp; luminance remapped so white fabric becomes mid navy and shadows deep navy
    lum = c["l"]
    navy = ramp((lum - 0.35) / 0.65, NAVY_DARK, NAVY)
    fab = c["fabric"] & ~lace & ~thin_pink
    out[..., :3] = np.where(fab[..., None], navy, out[..., :3])
    out[..., :3] = np.where(thin_pink[..., None], ramp((lum - 0.3) / 0.7, (0.25, 0.45, 0.75), LIGHT_BLUE), out[..., :3])
    # lace -> pure white ramp (VRoid lace carries the fabric's pink tint); gold stays as-is
    out[..., :3] = np.where(lace[..., None], ramp((lum - 0.4) / 0.6, (0.80, 0.83, 0.90), (1.0, 1.0, 1.0)), out[..., :3])
    # overlays: white apron / bib rectangles or polygons in UV space (0..1, origin top-left)
    if overlays:
        H, W = out.shape[:2]
        from PIL import ImageDraw
        layer = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(layer)
        for ov in overlays:
            pts = [(x * W, y * H) for x, y in ov["poly"]]
            d.polygon(pts, fill=255)
        m = (np.asarray(layer) > 127) & c["opaque"] & ~c["gold"] & ~thin_pink
        white = ramp((lum - 0.2) / 0.8, (0.75, 0.78, 0.85), (0.98, 0.98, 1.0))
        out[..., :3] = np.where(m[..., None], white, out[..., :3])
        # emblems: a little whale (body ellipse + fluke + eye) drawn flat in light blue on an overlay
        for ov in overlays:
            em = ov.get("emblem")
            if not em:
                continue
            ex, ey = em["center"][0] * W, em["center"][1] * H
            r = em.get("size", 0.05) * W
            el = Image.new("L", (W, H), 0)
            de = ImageDraw.Draw(el)
            de.ellipse([ex - r, ey - r * 0.55, ex + r * 0.55, ey + r * 0.55], fill=255)                 # body
            de.polygon([(ex + r * 0.45, ey), (ex + r * 0.95, ey - r * 0.5), (ex + r * 0.95, ey + r * 0.5)], fill=255)  # fluke
            de.ellipse([ex - r * 0.62, ey - r * 0.12, ex - r * 0.42, ey + r * 0.08], fill=0)            # eye
            me = (np.asarray(el) > 127) & c["opaque"]
            out[..., :3] = np.where(me[..., None], np.array(em.get("color", [0.45, 0.70, 0.95])), out[..., :3])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA"), {
        "lace_px": int(lace.sum()), "thin_pink_px": int(thin_pink.sum()), "fabric_px": int(fab.sum()), "gold_px": int(c["gold"].sum())}


def recolour_hair(img: Image.Image, tip_from=0.55):
    """grey strands with coloured tips -> navy strands with light-blue tips, baked (tint becomes white)."""
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    c = classify(rgba)
    H = rgba.shape[0]
    v = (np.arange(H) / H)[:, None]
    v = np.broadcast_to(v, rgba.shape[:2])
    t = np.clip((v - tip_from) / (1 - tip_from), 0, 1)  # 0 at roots, 1 at the very tips (VRoid strands: root at top)
    lum = c["l"]
    base = ramp((lum - 0.3) / 0.7, (0.07, 0.15, 0.40), HAIR_NAVY)
    tip = ramp((lum - 0.3) / 0.7, (0.30, 0.55, 0.85), HAIR_TIP)
    col = base * (1 - t[..., None]) + tip * t[..., None]
    out = rgba.copy()
    out[..., :3] = np.where(c["opaque"][..., None], col, out[..., :3])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--palette", default=os.path.join(os.path.dirname(__file__), "palette.whalechan.json"))
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    pal = json.load(open(a.palette, encoding="utf-8")) if os.path.exists(a.palette) else {}
    report = {}
    for name in sorted(os.listdir(a.src)):
        if not name.lower().endswith(".png") or name.endswith("_small.png"):
            continue
        stem = name[:-4]
        img = Image.open(os.path.join(a.src, name))
        kind = pal.get("textures", {}).get(stem, {}).get("kind")
        if kind is None:
            low = stem.lower()
            kind = "hair" if "hair" in low else ("outfit" if any(k in low for k in ("onepiece", "onepice", "tops", "bottoms", "shoes", "cloth")) else "keep")
        if kind == "hair":
            res = recolour_hair(img, tip_from=pal.get("hair_tip_from", 0.55)); stats = {}
        elif kind == "outfit":
            res, stats = recolour_outfit(img, overlays=pal.get("textures", {}).get(stem, {}).get("overlays"))
        else:
            continue
        res.save(os.path.join(a.out, name))
        report[name] = {"kind": kind, **stats}
        print(f"[restyle] {name}: {kind} {stats}")
    json.dump(report, open(os.path.join(a.out, "restyle_report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
