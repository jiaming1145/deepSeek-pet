"""Offline render of the front rig's rest pose with the face kit on top - the same compositing the runtime
does, without launching Electron. Use it to check face alignment, tone and resolution.

    python spikes/side_rig/preview_front.py [--rig rig_front.json] [--mood neutral] [--zoom 4] [--out <png>]

Needs Pillow: D:/tools/see-through/.venv/Scripts/python.exe
"""
import argparse
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FACE = os.path.join(HERE, "..", "model", "face")
HIDDEN_WHEN_KIT = ("eyewhite", "irides", "eyelash", "eyebrow", "mouth")   # the kit draws no nose, so hers stays


def cell_box(atlas, region_row, col, cell_px):
    cw, ch = cell_px
    return (col * cw, region_row * ch, (col + 1) * cw, (region_row + 1) * ch)


def render(rig_path, mood="neutral", kit=True, zoom=4, crop="face", atlas_json="atlas_matted.json"):
    rig = json.load(open(rig_path))
    assets = os.path.join(HERE, rig.get("assets", "assets"))
    W, H = rig["canvas"]
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for name in rig["order"]:
        if kit and name in HIDDEN_WHEN_KIT:
            continue
        lay = rig["layers"][name]
        im = Image.open(os.path.join(assets, lay["file"])).convert("RGBA")
        canvas.alpha_composite(im, (int(lay["bbox"][0]), int(lay["bbox"][1])))
    if kit:
        paste_kit(canvas, rig, mood, atlas_json)
    if crop == "face":
        fb = rig["layers"]["face"]["bbox"]
        pad = int((fb[2] - fb[0]) * 0.35)
        box = (max(0, fb[0] - pad), max(0, fb[1] - pad), min(W, fb[2] + pad), min(H, fb[3] + pad))
        canvas = canvas.crop(box)
    return canvas.resize((canvas.width * zoom, canvas.height * zoom), Image.LANCZOS)


def paste_kit(canvas, rig, mood, atlas_json="atlas_matted.json"):
    """Place the atlas cells exactly where rig.js mountKit puts them: canvas_px = (kit_px + crop) * scale + offset."""
    atlas = json.load(open(os.path.join(FACE, atlas_json)))
    states = json.load(open(os.path.join(FACE, "face_atlas_states.json")))
    rec = states["recipes"].get(mood) or states["recipes"]["neutral"]
    m = rig["canonical_to_canvas"]
    sc, (ox, oy) = m["scale"], m["offset"]
    cx0, cy0 = atlas["face"]["canonical_crop_box"][:2]
    alias = {"verbatim": "neutral_verbatim"}
    order = ["eye_l", "eye_r", "mouth", "brow_l", "brow_r"]
    for region in order:
        reg = atlas["regions"][region]
        at_name = {"eye_l": "eyes", "eye_r": "eyes", "brow_l": "brows", "brow_r": "brows", "mouth": "mouth"}[region]
        at = atlas["atlases"][at_name]
        state = rec.get(region) or {"eye_l": "open", "eye_r": "open", "mouth": "closed"}.get(region, "neutral_verbatim")
        state = alias.get(state, state)
        names = at["states"] if isinstance(at["states"], list) else list(at["states"])
        col = names.index(state) if state in names else 0
        row = at["rows"].index(region) if at.get("rows") else 0
        sheet = Image.open(os.path.join(FACE, at["file"])).convert("RGBA")
        cw, ch = at["cell_px"]
        cell = sheet.crop(cell_box(at, row, col, (cw, ch)))
        kx, ky = reg["cell_origin_on_face_px"]
        x = (kx + cx0) * sc + ox
        y = (ky + cy0) * sc + oy
        w = max(1, round(cw * sc))
        h = max(1, round(ch * sc))
        canvas.alpha_composite(cell.resize((w, h), Image.LANCZOS), (round(x), round(y)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rig", default=os.path.join(HERE, "rig_front.json"))
    p.add_argument("--mood", default="neutral")
    p.add_argument("--zoom", type=int, default=4)
    p.add_argument("--no-kit", action="store_true")
    p.add_argument("--full", action="store_true")
    p.add_argument("--atlas", default="atlas_matted.json")
    p.add_argument("--out", default=os.path.join(HERE, "evidence", "preview_front.png"))
    a = p.parse_args()
    im = render(a.rig, a.mood, kit=not a.no_kit, zoom=a.zoom, crop="full" if a.full else "face", atlas_json=a.atlas)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    bg = Image.new("RGBA", im.size, (48, 48, 56, 255))
    bg.alpha_composite(im)
    bg.convert("RGB").save(a.out)
    print(a.out, im.size)


if __name__ == "__main__":
    main()
