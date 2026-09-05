"""Export a See-through PSD into a rig assets folder: one PNG per pixel layer (cropped to its opaque pixels) +
layers.json (the manifest build_rig.py reads) + _source.png (the flattened composite, for overlays).

  python tools/see_through/psd_layers.py --psd <file.psd> --out spikes/side_rig/assets_front [--min-blob 12] [--map-json <crop.json>]

Layer z = draw order from the bottom (index in the PSD stack). Empty layers are skipped. --map-json takes the crop
metadata written next to a tight-crop input (source scale vs the 4096x8192 canonical, crop box, paste offset, square
size) and records canonical_px -> canvas_px as {scale, offset} so face-kit anchors can be placed on the layers.
Requires psd-tools + Pillow.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage


def walk(node):
    """Every pixel layer, bottom-up, descending into groups (a PSD organised into folders has none at top level)."""
    for layer in node:
        if getattr(layer, "is_group", None) and layer.is_group():
            yield from walk(layer)
        else:
            yield layer


def despeckle(im, min_blob):
    """Drop isolated specks: See-through leaves a few stray pixels far from the artwork (one on the eyelash layer
    pushed its bounding box across the whole canvas), which then drags the layer's mesh with it."""
    a = np.asarray(im)
    solid = a[..., 3] > 40
    if not solid.any():
        return im
    lbl, n = ndimage.label(solid)
    if n <= 1:
        return im
    keep = np.zeros(n + 1, bool)
    keep[1:] = ndimage.sum(solid, lbl, range(1, n + 1)) >= min_blob
    if keep[1:].all():
        return im
    out = a.copy()
    out[~keep[lbl], 3] = 0
    return Image.fromarray(out)


def export(psd_path, out_dir, min_alpha_px=4, min_blob=12):
    psd = PSDImage.open(psd_path)
    os.makedirs(out_dir, exist_ok=True)
    layers, z, used = [], 0, {}
    for layer in walk(psd):
        if layer.kind != "pixel" or not layer.visible:
            continue
        im = layer.topil()
        if im is None:
            continue
        im = im.convert("RGBA")
        if min_blob:
            im = despeckle(im, min_blob)
        ab = im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()   # opaque extent (RGB under zero alpha is noise)
        if ab is None or (ab[2] - ab[0]) * (ab[3] - ab[1]) < min_alpha_px:
            continue
        im = im.crop(ab)
        name = layer.name.strip().lower().replace(" ", "_")
        used[name] = used.get(name, 0) + 1
        if used[name] > 1:                      # two layers can share a name; do not let one overwrite the other
            name = f"{name}_{used[name]}"
        x0, y0 = layer.bbox[0] + ab[0], layer.bbox[1] + ab[1]
        fn = name + ".png"
        im.save(os.path.join(out_dir, fn))
        layers.append({"name": name, "z": z, "bbox": [x0, y0, x0 + im.width, y0 + im.height], "size": [im.width, im.height],
                       "alpha_bbox": [0, 0, im.width, im.height], "file": fn})
        z += 1
    psd.composite().convert("RGBA").save(os.path.join(out_dir, "_source.png"))
    manifest = {"source": psd_path.replace("\\", "/"), "canvas": list(psd.size), "layers": layers}
    return manifest


def canonical_map(meta_path, canvas):
    """canvas_px = canonical_px * scale + offset, from the tight-crop metadata (see spikes/model/generated/see_through/in)."""
    m = json.load(open(meta_path))
    k = canvas[0] / m["square"]
    scale = m["source_scale_vs_canonical_4096"] * k
    offset = [(m["paste_offset"][0] - m["crop"][0]) * k, (m["paste_offset"][1] - m["crop"][1]) * k]
    return {"scale": scale, "offset": offset, "from": meta_path.replace("\\", "/")}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--psd", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--min-blob", type=int, default=12, help="drop alpha blobs smaller than this many pixels (stray specks that blow up a layer's bounding box)")
    p.add_argument("--map-json", default=None, help="crop metadata json of a tight-crop input; records canonical_to_canvas")
    a = p.parse_args()
    m = export(a.psd, a.out, min_blob=a.min_blob)
    if not m["layers"]:
        raise SystemExit(f"no pixel layers exported from {a.psd} - is it empty, or are all its layers hidden?")
    if a.map_json:
        m["canonical_to_canvas"] = canonical_map(a.map_json, m["canvas"])
    with open(os.path.join(a.out, "layers.json"), "w") as f:
        json.dump(m, f, indent=1)
    print(f"{len(m['layers'])} layers -> {a.out}: " + ", ".join(f"{l['name']}{l['bbox']}" for l in m["layers"]))
    if a.map_json:
        print("canonical_to_canvas", m["canonical_to_canvas"])


if __name__ == "__main__":
    main()
