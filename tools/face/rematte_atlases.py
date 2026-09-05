"""Re-matte the face-kit atlases so each cell carries only the drawn feature, not the skin disc around it.

The atlases in spikes/model/face were cut with a generous round matte: an open-eye cell is ~61 % pale skin
and a closed-eye cell ~88 %, all of it lifted from a differently shaded copy of her face. Composited over the
decomposed head that reads as a disc of wrong skin around each eye.

This rebuilds every cell's alpha. Starting from the ink - the lashes, iris, brow and lip lines - it grows
outward through everything that is not skin, which keeps the eye white, the highlights and the anti-aliased
lash edges while stopping dead at the disc; then it adds back whatever the ink fully encloses and feathers a
couple of pixels. Colour, not distance, decides the boundary: a distance feather cannot tell a wide-eyed cell
(whose disc reaches onto the cheek) from a narrow one, and that is how the `surprised` state kept its disc
through the first version of this tool. Writes matted copies plus an atlas manifest pointing at them.

    python tools/face/rematte_atlases.py [--base spikes/model/face] [--feather 0.006] [--dry-run]

Writes <base>/matted/atlas_*.png and <base>/atlas_matted.json (a copy of atlas.json with the file names
swapped). Nothing in the original kit is modified. Needs Pillow + numpy + scipy:
D:/tools/see-through/.venv/Scripts/python.exe
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def ink_mask(rgb, alpha, lum_max=0.72, sat_min=0.28, a_min=0.25):
    """Drawn ink: painted pixels that are darker or more saturated than skin."""
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    lum = rgb.mean(2)
    return (alpha > a_min) & ((lum < lum_max) | (sat > sat_min))


def skin_mask(rgb, alpha, lum_min=0.72, sat_max=0.35, warmth=0.03):
    """Her skin and blush: pale, unsaturated and warm. The eye white and the highlights are neutral or cool,
    so this separates the disc the cells were cut with from the drawing inside it."""
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    lum = rgb.mean(2)
    return (alpha > 0.06) & (lum > lum_min) & (sat < sat_max) & ((rgb[..., 0] - rgb[..., 2]) > warmth)


def feature_matte(cell, feather_px, close_px):
    """Alpha for the drawn feature only. Grow out from the ink through everything that is not skin - that keeps
    the eye white, the highlights and the anti-aliased lash edges but stops dead at the skin disc - then add
    back whatever the ink fully encloses, and feather a couple of pixels so nothing looks cut with scissors."""
    a = np.asarray(cell, dtype=np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    ink = ink_mask(rgb, alpha)
    if not ink.any():
        return None
    painted = alpha > 0.06
    grow = ndimage.binary_propagation(ink, mask=painted & ~skin_mask(rgb, alpha))
    closed = ndimage.binary_closing(ink, structure=np.ones((close_px, close_px)))
    core = grow | ndimage.binary_fill_holes(closed)
    # the kit was cut from a hair-erased copy of her face, so where her bangs crossed the eye the erase left pale
    # strand ghosts. They survive as small islands detached from the drawing; drop anything far below the main piece.
    lbl, n = ndimage.label(core)
    if n > 1:
        areas = ndimage.sum(core, lbl, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = areas >= max(200.0, 0.02 * areas.max())
        core = keep[lbl]
    dist = ndimage.distance_transform_edt(~core)
    w = np.clip(1.0 - dist / max(feather_px, 1e-6), 0.0, 1.0)
    w = w * w * (3.0 - 2.0 * w)                     # smoothstep
    out = np.asarray(cell).copy()
    out[..., 3] = np.clip(alpha * np.maximum(w, core.astype(np.float32)) * 255.0, 0, 255).astype(np.uint8)
    return out


def harmonise_mouth_cavity(cell, cavity_rgb):
    """Some open-mouth cells were drawn with a near-white interior and others with a dark one, so talking flickered
    white-dark-white. Repaint the enclosed near-white area to the dark colour the rest of the set uses, leaving the
    lip line and the tongue alone."""
    a = np.asarray(cell, dtype=np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    pale = (alpha > 0.5) & (rgb.mean(2) > 0.88) & (sat < 0.12)
    inside = ndimage.binary_fill_holes(ink_mask(rgb, alpha))
    target = pale & inside
    if target.sum() < 50:
        return cell
    out = np.asarray(cell).copy()
    out[target, :3] = cavity_rgb
    return out


# A shut eyelid does not rest at the top of the eye, it rests low - roughly two thirds of the way down the
# opening. Anything lower than that reads as a squint; anything higher, as here, leaves bare skin under the lash
# line and looks like the eye is missing rather than closed.
LID_REST = 0.65


def state_offsets(arr, at, rows):
    """The shipped `closed` and `happy` cells are drawn near the top of their frame while every other state fills
    it, so a blink put her lash line above her eye with a gap of bare skin below. Measure each short cell and
    record the shift that seats it at LID_REST down the open eye, for the runtime to apply on the swap."""
    cw, ch = at["cell_px"]
    states = at["states"] if isinstance(at["states"], list) else list(at["states"])
    if "open" not in states:
        return {}
    out = {}
    for r, region in enumerate(rows):
        def span(state):
            i = states.index(state)
            a = arr[r * ch:(r + 1) * ch, i * cw:(i + 1) * cw, 3] > 25
            if not a.any():
                return None
            ys = np.nonzero(a.any(axis=1))[0]
            return int(ys.min()), int(ys.max())
        base = span("open")
        if base is None:
            continue
        rest = base[0] + LID_REST * (base[1] - base[0])
        off = {}
        for st in states:
            b = span(st)
            if b is None:
                continue
            if (b[1] - b[0]) > 0.55 * (base[1] - base[0]):
                continue                     # a full-height eye, not a closed lid
            dy = round(rest - (b[0] + b[1]) / 2)
            if dy > 20:                      # only lift cells that are genuinely floating
                off[st] = [0, dy]
        if off:
            out[region] = off
    return out


def cells_of(atlas_name, at, size):
    """Yield (x0, y0, x1, y1) for every cell of a gridded atlas; fx has explicit cells instead."""
    if at.get("cell_px"):
        cw, ch = at["cell_px"]
        rows = len(at.get("rows") or [None])
        states = at["states"] if isinstance(at["states"], list) else list(at["states"])
        for r in range(rows):
            for c in range(len(states)):
                yield (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)
    else:
        for cell in (at.get("cells") or {}).values():
            x, y, w, h = cell["px"]
            yield (x, y, x + w, y + h)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default=os.path.join("spikes", "model", "face"))
    p.add_argument("--feather", type=float, default=0.006, help="feather radius as a fraction of the cell's short side; only for anti-aliasing, the matte itself is colour-aware")
    p.add_argument("--atlases", default="eyes,brows,mouth", choices=None,
                   help="which atlases to re-matte; fx is refused because its decals (blush, shadows) are skin tint by design")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    atlas = json.load(open(os.path.join(a.base, "atlas.json")))
    out_dir = os.path.join(a.base, "matted")
    os.makedirs(out_dir, exist_ok=True)
    manifest = json.loads(json.dumps(atlas))
    want = set(a.atlases.split(","))
    if want & {"fx"}:
        raise SystemExit("fx decals are skin tint by design (face_shadow is pure pale skin, no ink) - re-matting them would erase them")
    for name, at in atlas["atlases"].items():
        if name not in want:
            continue
        sheet = Image.open(os.path.join(a.base, at["file"])).convert("RGBA")
        arr = np.asarray(sheet).copy()
        short = min(at["cell_px"]) if at.get("cell_px") else 128
        feather = max(2.0, a.feather * short)
        close_px = max(3, int(round(short * 0.012)) | 1)
        before = after = 0
        skipped = []
        states = at["states"] if isinstance(at.get("states"), list) else list(at.get("states") or [])
        for i, (x0, y0, x1, y1) in enumerate(cells_of(name, at, sheet.size)):
            cell = arr[y0:y1, x0:x1]
            painted = (cell[..., 3] > 15).sum()
            matted = feature_matte(cell, feather, close_px)
            before += painted
            if matted is None:
                # no ink at all: the cell is pure skin tint, so we cannot tell the drawing from the disc.
                # Left untouched, which means it still pastes a disc - say so rather than hiding it in the totals.
                after += painted
                if painted:
                    skipped.append(states[i % len(states)] if states else f"cell {i}")
                continue
            arr[y0:y1, x0:x1] = matted
            after += (matted[..., 3] > 15).sum()
        if name == "mouth":
            # sample the dark cavity the majority of the cells already use, then bring the pale ones into line
            dark = np.array([118, 44, 58], np.uint8)
            for (x0, y0, x1, y1) in cells_of(name, at, sheet.size):
                arr[y0:y1, x0:x1] = harmonise_mouth_cavity(arr[y0:y1, x0:x1], dark)
        if at.get("rows"):
            offs = state_offsets(arr, at, at["rows"])
            for region, off in offs.items():
                manifest["regions"].setdefault(region, {})["state_offsets_px"] = off
                print(f"  {region}: seated the closed lid - {', '.join(f'{k} +{v[1]}px' for k, v in off.items())}")
        fn = at["file"].replace(".png", "_matted.png")
        if not a.dry_run:
            Image.fromarray(arr).save(os.path.join(out_dir, fn))
        manifest["atlases"][name]["file"] = f"matted/{fn}"
        print(f"{name}: feather {feather:.0f} px, close {close_px} px, painted pixels {before} -> {after} ({after / max(before, 1):.0%})")
        if skipped:
            print(f"  WARNING: {len(skipped)} cell(s) had no ink and were left as shipped (they still carry a skin disc): {', '.join(sorted(set(skipped)))}")
    manifest["source_atlas"] = "atlas.json"
    manifest["note"] = "cells re-matted by tools/face/rematte_atlases.py: the drawn feature only, no skin disc"
    if not a.dry_run:
        with open(os.path.join(a.base, "atlas_matted.json"), "w") as f:
            json.dump(manifest, f, indent=1)
        print("manifest:", os.path.join(a.base, "atlas_matted.json"))


if __name__ == "__main__":
    main()
