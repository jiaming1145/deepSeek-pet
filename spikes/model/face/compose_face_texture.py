"""compose_face_texture.py - bridge the face kit (atlas.json + per-region atlases) to build_vrm.py.

build_vrm.py --face-atlas wants ONE square texture whose cells are complete faces, all the same size,
plus {"neutral": ..., "states": {name: {u, v, w, h}}} in glTF UV space (origin top-left, v down).
The kit instead ships a base skin plus separate eye / mouth / brow / fx atlases with anchors. This
script composes every expression state the runtime needs as a full face (base + brows + eyes +
mouth + fx, each cell at the same anchor), flattens it onto the skin colour (the face material is
OPAQUE; alpha is not part of the contract) and packs the cells into a grid.

  python compose_face_texture.py [--size 4096] [--out DIR]

Outputs (in --out, default this directory):
  face_texture.png          size x size RGBA (alpha 255 everywhere), N cells of identical size
  face_atlas_states.json    the build_vrm.py spec + cell / anchor metadata + the recipe of every cell
  face_texture_preview.png  labelled contact sheet for eyeballing

Per-region mixing (eyes and mouth animating independently) is what the kit was built for and what a
single texture-transform cannot do; every combination the pet needs is therefore a cell here. Adding a
state = adding a recipe to STATES.
"""
import argparse
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

# VRM preset names first (build_vrm.py turns these into preset expressions), then customs.
# Recipe keys: eye_l eye_r brow_l brow_r mouth fx. Unset eyes = open, mouth = closed; unset brows =
# the drawn brow fragments baked into base_no_eyes_mouth.png (verbatim), which every state without a
# brow change shares so the brow line is pixel-identical across blink / visemes / looks.
# Sides are the kit's: *_l is HER left (screen-right), look_left = she looks to her left.
STATES = [
    ("neutral", {}),
    ("blink", dict(eye_l="closed", eye_r="closed")),
    ("blinkLeft", dict(eye_l="closed")),
    ("blinkRight", dict(eye_r="closed")),
    ("aa", dict(mouth="aa")),
    ("ih", dict(mouth="ih")),
    ("ou", dict(mouth="ou")),
    ("ee", dict(mouth="ee")),
    ("oh", dict(mouth="oh")),
    ("happy", dict(eye_l="happy", eye_r="happy", mouth="smile", fx=("blush_l", "blush_r"))),
    ("angry", dict(brow_l="down_inner", brow_r="down_inner", mouth="frown")),
    ("sad", dict(eye_l="look_down", eye_r="look_down", brow_l="up_inner", brow_r="up_inner", mouth="frown")),
    ("relaxed", dict(eye_l="half_lid", eye_r="half_lid", mouth="smile")),
    ("surprised", dict(eye_l="surprised", eye_r="surprised", brow_l="up", brow_r="up", mouth="oh")),
    ("lookUp", dict(eye_l="look_up", eye_r="look_up")),
    ("lookDown", dict(eye_l="look_down", eye_r="look_down")),
    ("lookLeft", dict(eye_l="look_left", eye_r="look_left")),
    ("lookRight", dict(eye_l="look_right", eye_r="look_right")),
    # customs (the pet's mood vocabulary)
    ("sleepy", dict(eye_l="closed", eye_r="closed", mouth="ou")),
    ("affection", dict(eye_l="heart", eye_r="heart", brow_l="up", brow_r="up", mouth="smile", fx=("blush_l", "blush_r"))),
    ("panic", dict(eye_l="spiral", eye_r="spiral", brow_l="up_inner", brow_r="up_inner", mouth="wavy", fx=("sweat_drop",))),
    ("shy", dict(eye_l="look_down_right", eye_r="look_down_right", brow_l="up_inner", brow_r="up_inner", mouth="wavy", fx=("blush_l", "blush_r"))),
    ("smug", dict(eye_l="half_lid", eye_r="half_lid", brow_l="down", brow_r="down", mouth="smile")),
    ("pouty", dict(eye_l="look_left", eye_r="look_left", brow_l="down_inner", brow_r="down_inner", mouth="pout", fx=("blush_l", "blush_r"))),
    ("focused", dict(eye_l="half_lid", eye_r="half_lid", brow_l="down_inner", brow_r="down_inner", mouth="flat")),
    ("hurt", dict(brow_l="up_inner", brow_r="up_inner", mouth="frown", fx=("tear_l", "tear_r"))),
    ("confused", dict(eye_l="look_up", eye_r="look_up", brow_l="tilted", brow_r="neutral", mouth="flat")),
    ("shocked", dict(eye_l="surprised", eye_r="surprised", brow_l="up", brow_r="up", mouth="oh", fx=("sweat_drop",))),
    ("gentle", dict(mouth="smile", fx=("blush_l", "blush_r"))),
    ("cheerful", dict(brow_l="up", brow_r="up", mouth="open_wide", fx=("blush_l", "blush_r"))),
]
PRESETS = {"happy", "angry", "sad", "relaxed", "surprised", "neutral", "aa", "ih", "ou", "ee", "oh",
           "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight"}
# billboard FX that float beside the head are outside neutral.png and cannot live in a face cell
OUTSIDE_FX = {"question_mark", "sleepy_marks", "heart_fx", "anger_mark", "sparkle_l", "sparkle_r"}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--size", type=int, default=4096, help="square texture size (2048 or 4096)")
    p.add_argument("--pad", type=int, default=8, help="skin-coloured margin inside every cell (mip bleed guard)")
    p.add_argument("--kit", default=HERE, help="directory holding atlas.json and the atlas PNGs")
    p.add_argument("--out", default=HERE)
    return p.parse_args()


def load(path):
    return np.array(Image.open(path).convert("RGBA")).astype(np.float32)


def over(dst, src):
    """Porter-Duff over on float RGBA 0..255 (same maths as build_face.py / verify_atlas.py)."""
    sa = src[..., 3:4] / 255.0
    da = dst[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa * 255.0], -1)


class Kit:
    def __init__(self, kit_dir):
        self.dir = kit_dir
        self.A = json.load(open(os.path.join(kit_dir, "atlas.json"), encoding="utf-8"))
        self.atlases = {k: load(os.path.join(kit_dir, v["file"])) for k, v in self.A["atlases"].items()}
        self.FW, self.FH = self.A["face"]["size_px"]
        self.base_verbatim = load(os.path.join(kit_dir, self.A["face"]["base_no_eyes_mouth"]))
        self.base_synth = load(os.path.join(kit_dir, self.A["face"]["base_skin_nose"]))
        clean = load(os.path.join(kit_dir, self.A["face"]["head_base_clean"]))
        solid = clean[..., 3] >= 254
        self.skin = np.median(clean[solid][:, :3], axis=0)

    def cell(self, face, atlas_key, row, state):
        """Blit an atlas cell so its anchor lands on the region anchor (verify_atlas.py's blit_cell)."""
        at = self.A["atlases"][atlas_key]
        img = self.atlases[atlas_key]
        c = at["cells"][row][state]
        AW, AH = at["size_px"]
        x0, y0 = int(round(c["u"] * AW)), int(round(c["v"] * AH))
        w, h = int(round(c["w"] * AW)), int(round(c["h"] * AH))
        sprite = img[y0:y0 + h, x0:x0 + w]
        ax, ay = at["anchor_in_cell_px"]
        rx, ry = self.A["regions"][row]["anchor_px"]
        px, py = int(round(rx - ax)), int(round(ry - ay))
        layer = np.zeros((self.FH, self.FW, 4), np.float32)
        sx0, sy0 = max(px, 0), max(py, 0)
        sx1, sy1 = min(px + w, self.FW), min(py + h, self.FH)
        layer[sy0:sy1, sx0:sx1] = sprite[sy0 - py:sy1 - py, sx0 - px:sx1 - px]
        return over(face, layer)

    def fx(self, face, name):
        c = self.A["atlases"]["fx"]["cells"][name]
        img = self.atlases["fx"]
        x0, y0, w, h = c["px"]
        sprite = img[y0:y0 + h, x0:x0 + w]
        bx0, by0 = c["face_bbox_px"][:2]
        layer = np.zeros((self.FH, self.FW, 4), np.float32)
        sx0, sy0 = max(bx0, 0), max(by0, 0)
        sx1, sy1 = min(bx0 + w, self.FW), min(by0 + h, self.FH)
        if sx1 > sx0 and sy1 > sy0:
            layer[sy0:sy1, sx0:sx1] = sprite[sy0 - by0:sy1 - by0, sx0 - bx0:sx1 - bx0]
        return over(face, layer)

    def compose(self, eye_l="open", eye_r="open", brow_l=None, brow_r=None, mouth="closed", fx=()):
        synth_brows = brow_l is not None or brow_r is not None
        face = (self.base_synth if synth_brows else self.base_verbatim).copy()
        if synth_brows:
            face = self.cell(face, "brows", "brow_l", brow_l or "neutral")
            face = self.cell(face, "brows", "brow_r", brow_r or "neutral")
        face = self.cell(face, "eyes", "eye_l", eye_l)
        face = self.cell(face, "eyes", "eye_r", eye_r)
        face = self.cell(face, "mouth", "mouth", mouth)
        for f in fx:
            if f in OUTSIDE_FX:
                continue
            face = self.fx(face, f)
        return face

    def flatten(self, face):
        """RGBA over the skin colour -> opaque RGB uint8 (the face material is OPAQUE)."""
        a = face[..., 3:4] / 255.0
        rgb = face[..., :3] * a + self.skin[None, None, :] * (1 - a)
        return np.clip(rgb + 0.5, 0, 255).astype(np.uint8)


def choose_grid(n, size, fw, fh, pad):
    best = None
    for cols in range(1, n + 1):
        rows = math.ceil(n / cols)
        cw, ch = size // cols, size // rows
        s = min((cw - 2 * pad) / fw, (ch - 2 * pad) / fh)
        if s <= 0:
            continue
        if best is None or s > best[0]:
            best = (s, cols, rows, cw, ch)
    return best


def main():
    a = parse_args()
    kit = Kit(a.kit)
    os.makedirs(a.out, exist_ok=True)
    names = [n for n, _ in STATES]
    assert len(set(names)) == len(names), "duplicate state name"
    for n, r in STATES:
        for k in ("eye_l", "eye_r"):
            assert r.get(k, "open") in kit.A["atlases"]["eyes"]["states"], (n, k, r.get(k))
        for k in ("brow_l", "brow_r"):
            assert r.get(k) is None or r[k] in kit.A["atlases"]["brows"]["states"], (n, k, r.get(k))
        assert r.get("mouth", "closed") in kit.A["atlases"]["mouth"]["states"], (n, r.get("mouth"))
        for f in r.get("fx", ()):
            assert f in kit.A["atlases"]["fx"]["cells"], (n, f)

    S = a.size
    scale, cols, rows, cw, ch = choose_grid(len(STATES), S, kit.FW, kit.FH, a.pad)
    face_w, face_h = int(round(kit.FW * scale)), int(round(kit.FH * scale))
    ox, oy = (cw - face_w) // 2, (ch - face_h) // 2          # face centred in its cell
    skin8 = tuple(int(round(c)) for c in kit.skin)
    print(f"[compose] {len(STATES)} states -> {cols}x{rows} grid of {cw}x{ch} px cells in {S}x{S}; "
          f"face {kit.FW}x{kit.FH} -> {face_w}x{face_h} at ({ox},{oy}) (scale {scale:.4f}); skin bg {skin8}")

    atlas = Image.new("RGBA", (S, S), skin8 + (255,))
    spec_states = {}
    recipes = {}
    cells_rgb = {}
    for i, (name, recipe) in enumerate(STATES):
        col, row = i % cols, i // cols
        rgb = kit.flatten(kit.compose(**recipe))
        cells_rgb[name] = rgb
        im = Image.fromarray(rgb, "RGB").resize((face_w, face_h), Image.LANCZOS)
        atlas.paste(im, (col * cw + ox, row * ch + oy))
        spec_states[name] = {"u": col * cw / S, "v": row * ch / S, "w": cw / S, "h": ch / S, "binary": True}
        recipes[name] = {"kind": "preset" if name in PRESETS else "custom",
                         "eye_l": recipe.get("eye_l", "open"), "eye_r": recipe.get("eye_r", "open"),
                         "brow_l": recipe.get("brow_l") or "verbatim", "brow_r": recipe.get("brow_r") or "verbatim",
                         "mouth": recipe.get("mouth", "closed"),
                         "fx": [f for f in recipe.get("fx", ()) if f not in OUTSIDE_FX],
                         "fx_skipped_outside_face": [f for f in recipe.get("fx", ()) if f in OUTSIDE_FX]}
        print(f"[compose]   {name:11s} cell ({col},{row}) u={spec_states[name]['u']:.5f} v={spec_states[name]['v']:.5f}  {recipes[name]}")
    atlas.save(os.path.join(a.out, "face_texture.png"))

    # region anchors inside a cell (0..1 of the cell) for a UV unwrapper / a later per-region overlay
    regions = {}
    for rname, r in kit.A["regions"].items():
        px, py = r["anchor_px"]
        regions[rname] = {"anchor_cell_uv": [round((ox + px * scale) / cw, 5), round((oy + py * scale) / ch, 5)],
                          "anchor_face_uv": [round(px / kit.FW, 5), round(py / kit.FH, 5)]}
    spec = {
        "schema": "whalechan.face_texture/1",
        "neutral": "neutral",
        "cols": cols, "rows": rows,
        "states": spec_states,
        "texture": {"file": "face_texture.png", "size_px": [S, S], "cell_px": [cw, ch],
                    "face_in_cell_px": [ox, oy, face_w, face_h],
                    "face_in_cell_uv": [round(ox / cw, 5), round(oy / ch, 5), round(face_w / cw, 5), round(face_h / ch, 5)],
                    "face_source_px": [kit.FW, kit.FH], "scale": round(scale, 6), "pad_px": a.pad,
                    "background_rgb": list(skin8), "alpha": "opaque (255 everywhere)"},
        "uv_note": "glTF UV space: origin top-left, v down; build_vrm.py rescales the face material's mesh UVs "
                   "(0..1 over the whole cell, so map the face island to face_in_cell_uv) into the neutral cell and "
                   "emits every other state as an isBinary textureTransformBind offset (u-u0, v-v0).",
        "sides": "kit convention: *_l is HER left (screen-right in the texture); lookLeft = she looks to her left.",
        "regions": regions,
        "recipes": recipes,
        "source": {"kit": os.path.relpath(a.kit, a.out) if os.path.abspath(a.kit) != os.path.abspath(a.out) else ".",
                   "atlas_schema": kit.A.get("schema")},
    }
    with open(os.path.join(a.out, "face_atlas_states.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=1)

    # self-check: the neutral cell must be neutral.png (flattened, downscaled) and every cell must differ
    # from neutral somewhere (otherwise the recipe is a no-op)
    neutral_png = kit.flatten(load(os.path.join(a.kit, kit.A["face"]["file"])))
    ref = np.array(Image.fromarray(neutral_png, "RGB").resize((face_w, face_h), Image.LANCZOS)).astype(np.float32)
    got = np.array(atlas.crop((ox, oy, ox + face_w, oy + face_h)).convert("RGB")).astype(np.float32)
    d = np.abs(got - ref)
    print(f"[check] neutral cell vs neutral.png (flattened, downscaled): mean |diff| {d.mean():.3f}, max {d.max():.1f}")
    diffs = {n: float(np.abs(cells_rgb[n].astype(np.float32) - cells_rgb["neutral"].astype(np.float32)).mean()) for n in names if n != "neutral"}
    zero = [n for n, v in diffs.items() if v == 0.0]
    print("[check] mean |diff| vs neutral per state: " + ", ".join(f"{n}={v:.2f}" for n, v in diffs.items()))
    if zero:
        print(f"[check] WARNING states identical to neutral: {zero}")

    # preview sheet
    thumb = 256
    tw, th = thumb, int(round(thumb * ch / cw))
    sheet = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 26) + 8), (246, 243, 236))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    for i, (name, _) in enumerate(STATES):
        col, row = i % cols, i // cols
        cell = atlas.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)).convert("RGB").resize((tw, th), Image.LANCZOS)
        x, y = 8 + col * (tw + 8), 8 + row * (th + 26)
        sheet.paste(cell, (x, y + 18))
        dr.text((x, y), f"{name} ({recipes[name]['kind']})", fill=(30, 40, 80), font=font)
    sheet.save(os.path.join(a.out, "face_texture_preview.png"))
    print(f"[compose] wrote face_texture.png ({S}x{S}), face_atlas_states.json ({len(spec_states)} states), face_texture_preview.png")


if __name__ == "__main__":
    main()
