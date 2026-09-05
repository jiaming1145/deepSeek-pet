"""Re-matte the face-kit atlases so each cell carries only the drawn feature, not the skin disc around it.

The atlases in spikes/model/face were cut with a generous round matte: an open-eye cell is ~61 % pale skin
and a closed-eye cell ~88 %, all of it lifted from a differently shaded copy of her face. Composited over the
decomposed head that reads as a disc of wrong skin around each eye. This rebuilds every cell's alpha from the
ink it contains - the lashes, iris, brow and lip lines, plus whatever they enclose (the sclera) - with a short
feather so anti-aliased edges survive, and writes matted copies plus an atlas manifest pointing at them.

    python tools/face/rematte_atlases.py [--base spikes/model/face] [--feather 0.035] [--dry-run]

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


def feature_matte(cell, feather_px, close_px):
    """Alpha for the drawn feature: ink, what the ink encloses, and a feathered rim - no skin disc."""
    a = np.asarray(cell, dtype=np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    ink = ink_mask(rgb, alpha)
    if not ink.any():
        return None
    # close small gaps in the outline, then fill what it encloses (the eye white inside the lashes)
    closed = ndimage.binary_closing(ink, structure=np.ones((close_px, close_px)))
    core = ndimage.binary_fill_holes(closed) | ink
    # feather outward from the core so lash tips and soft edges keep their anti-aliasing
    dist = ndimage.distance_transform_edt(~core)
    w = np.clip(1.0 - dist / max(feather_px, 1e-6), 0.0, 1.0)
    w = w * w * (3.0 - 2.0 * w)                     # smoothstep
    out = np.asarray(cell).copy()
    out[..., 3] = np.clip(alpha * np.maximum(w, core.astype(np.float32)) * 255.0, 0, 255).astype(np.uint8)
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
    p.add_argument("--feather", type=float, default=0.035, help="feather radius as a fraction of the cell's short side")
    p.add_argument("--atlases", default="eyes,brows,mouth", help="which atlases to re-matte (fx decals are skin tint by design)")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    atlas = json.load(open(os.path.join(a.base, "atlas.json")))
    out_dir = os.path.join(a.base, "matted")
    os.makedirs(out_dir, exist_ok=True)
    manifest = json.loads(json.dumps(atlas))
    want = set(a.atlases.split(","))
    for name, at in atlas["atlases"].items():
        if name not in want:
            continue
        sheet = Image.open(os.path.join(a.base, at["file"])).convert("RGBA")
        arr = np.asarray(sheet).copy()
        short = min(at["cell_px"]) if at.get("cell_px") else 128
        feather = max(2.0, a.feather * short)
        close_px = max(3, int(round(short * 0.012)) | 1)
        before = after = 0
        for (x0, y0, x1, y1) in cells_of(name, at, sheet.size):
            cell = arr[y0:y1, x0:x1]
            painted = (cell[..., 3] > 15).sum()
            matted = feature_matte(cell, feather, close_px)
            if matted is None:
                continue
            arr[y0:y1, x0:x1] = matted
            before += painted
            after += (matted[..., 3] > 15).sum()
        fn = at["file"].replace(".png", "_matted.png")
        if not a.dry_run:
            Image.fromarray(arr).save(os.path.join(out_dir, fn))
        manifest["atlases"][name]["file"] = f"matted/{fn}"
        print(f"{name}: feather {feather:.0f} px, close {close_px} px, painted pixels {before} -> {after} ({after / max(before, 1):.0%})")
    manifest["source_atlas"] = "atlas.json"
    manifest["note"] = "cells re-matted by tools/face/rematte_atlases.py: the drawn feature only, no skin disc"
    if not a.dry_run:
        with open(os.path.join(a.base, "atlas_matted.json"), "w") as f:
            json.dump(manifest, f, indent=1)
        print("manifest:", os.path.join(a.base, "atlas_matted.json"))


if __name__ == "__main__":
    main()
