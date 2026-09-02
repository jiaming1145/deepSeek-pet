"""Extract the Whale-chan palette from the colour/material sheet swatches + our canonical parts.
Each entry = median of a small disc at a hand-picked swatch location (no k-means guessing)."""
import json, numpy as np
from PIL import Image
KIT = r"C:/Users/jiami/AppData/Local/Temp/claude/D--ds/6937fa24-7aae-458e-9817-d81b1ced4b57/scratchpad/whalechan/assets/readme/en"
sheet = np.asarray(Image.open(KIT+"/character-samples/whalechan-character-color-material-reference-sheet.webp").convert("RGB"))
portrait = np.asarray(Image.open(KIT+"/whalechan-standard-character-portrait.webp").convert("RGB"))
PARTS = r"D:/ds/runs/deepseek_humanized_20260830_001/03_parts/revisions/v005/final"

def disc(a, x, y, r=6):
    ys, xs = np.mgrid[y-r:y+r+1, x-r:x+r+1]
    m = (ys-y)**2 + (xs-x)**2 <= r*r
    px = a[ys[m], xs[m]]
    return [int(v) for v in np.median(px, axis=0)]

def hx(c): return "#%02x%02x%02x" % tuple(c)

samples = {
  # bottom-right swatch dots on the colour sheet (solid discs)
  "navy_swatch_dot":  disc(sheet, 1220, 812, 14),
  "white_swatch_dot": disc(sheet, 1220, 905, 14),
  "skin_swatch_dot":  disc(sheet, 1220, 975, 14),
  # callout circles: sample a flat area inside each
  "deep_sea_navy_skirt": disc(sheet, 860, 245, 8),
  "mid_blue_hair":       disc(sheet, 1120, 290, 8),
  "cyan_tips_hair":      disc(sheet, 1300, 300, 8),
  "apron_white":         disc(sheet, 880, 520, 8),
  "accent_gold_bow":     disc(sheet, 1085, 560, 5),
  "skin_tone_cheek":     disc(sheet, 1250, 520, 8),
  # portrait footer swatches (navy / blue / gold)
  "portrait_navy":  disc(portrait, 787, 1622, 10),
  "portrait_blue":  disc(portrait, 830, 1622, 10),
  "portrait_gold":  disc(portrait, 873, 1622, 10),
}
for k, v in samples.items(): print(f"{k:24s} {hx(v)}  {v}")

# canonical parts: median of opaque pixels per part (our own art = authoritative)
def part_median(name, alpha_min=250):
    im = np.asarray(Image.open(f"{PARTS}/{name}.png").convert("RGBA"))
    m = im[...,3] >= alpha_min
    if m.sum() == 0: return None
    return [int(v) for v in np.median(im[m][:, :3], axis=0)]
import os
part_names = [p[:-4] for p in os.listdir(PARTS) if p.endswith(".png")]
print(len(part_names), "parts")
interesting = [p for p in part_names if any(s in p for s in ("hair","dress","apron","skirt","skin","face","head_base","iris","bow","tail","fin","ear","sock","shoe","bonnet","sleeve","cuff","gold","trim","leg","arm","hand","neck","brooch","gem"))]
partcols = {}
for p in sorted(interesting):
    c = part_median(p)
    if c: partcols[p] = hx(c)
for p, c in partcols.items(): print(f"  {p:36s} {c}")
json.dump({"sheet_samples": {k: hx(v) for k, v in samples.items()}, "canonical_part_medians": partcols},
          open("reference/_palette_raw.json", "w"), indent=2)
