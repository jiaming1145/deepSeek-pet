"""Build spikes/model/reference/ from the community sheets + our canonical.
Crops are hand-picked boxes on the 1448x1086 sheets; background (cream) is
flood-filled from the border to white so the figure is isolated without
touching interior whites. Upscale is Lanczos only (no detail synthesis)."""
import json, os, sys
from collections import deque
import numpy as np
from PIL import Image, ImageFilter
KIT = r"C:/Users/jiami/AppData/Local/Temp/claude/D--ds/6937fa24-7aae-458e-9817-d81b1ced4b57/scratchpad/whalechan/assets/readme/en"
CS = KIT + "/character-samples"
OUT = r"D:/ds/spikes/model/reference"
CANON = r"D:/ds/runs/deepseek_humanized_20260830_001/01_design/canonical/revisions/v005/canonical_v005.png"
os.makedirs(OUT, exist_ok=True)

CROPS = {
  # name: (sheet, (x0,y0,x1,y1))
  "overview_front":      ("overview",  (285, 120, 800, 960)),
  "overview_side":       ("overview",  (860,  60, 1300, 570)),
  "overview_back":       ("overview",  (980, 550, 1320, 1010)),
  "overview_tail_attachment": ("overview", (712, 745, 950, 960)),
  "tail_at_rest_back":   ("tail",      (740,  60,  960, 400)),
  "tail_turning_side":   ("tail",      (1020, 60, 1390, 400)),
  "tail_accelerating_side": ("tail",   (740, 420, 1090, 720)),
  "tail_balancing_side": ("tail",      (750, 700, 1080, 1000)),
  "tail_cozy_hug":       ("tail",      (1080, 700, 1390, 1000)),
  "costume_headband_ruffle": ("costume", (770,  40, 1020, 300)),
  "costume_jeweled_bow": ("costume",   (990, 225, 1255, 460)),
  "costume_white_bib":   ("costume",   (860, 425, 1085, 655)),
  "costume_gold_trim_hem": ("costume", (1080, 595, 1335, 830)),
  "costume_whale_apron_motif": ("costume", (930, 785, 1185, 1020)),
  "costume_full_pose":   ("costume",   (180, 130, 960, 980)),
  "color_full_pose":     ("color",     (60, 130, 780, 1000)),
}
SHEETS = {
  "overview": CS + "/whalechan-character-overview-reference-sheet.webp",
  "tail":     CS + "/whalechan-character-tail-motion-reference-sheet.webp",
  "costume":  CS + "/whalechan-character-costume-layers-reference-sheet.webp",
  "color":    CS + "/whalechan-character-color-material-reference-sheet.webp",
}

def isolate(img, tol=28):
    """Flood-fill the sheet's cream background from the border -> alpha 0."""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    # background reference colour = median of border pixels
    border = np.concatenate([a[0], a[-1], a[:,0], a[:,-1]])
    bg = np.median(border, axis=0)
    close = (np.abs(a - bg).max(axis=2) <= tol)
    mask = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            if close[y, x] and not mask[y, x]: mask[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w-1):
            if close[y, x] and not mask[y, x]: mask[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True; q.append((ny, nx))
    fg = ~mask
    from scipy import ndimage
    lab, n = ndimage.label(fg, structure=np.ones((3,3)))
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n+1))
        fg = lab == (int(np.argmax(sizes)) + 1)
        mask = ~fg
    alpha = fg.astype(np.uint8) * 255
    # soften the cut edge by 1px so the anti-aliased rim is kept
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MaxFilter(3)))
    rgba = np.dstack([a.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA"), mask

def upscale(img, min_long=1024):
    s = max(1.0, min_long / max(img.size))
    if s == 1.0: return img
    return img.resize((round(img.width*s), round(img.height*s)), Image.LANCZOS)

manifest = {}
sheets = {k: Image.open(v).convert("RGB") for k, v in SHEETS.items()}
# label boxes / arrows that sit next to (or over) the figures; painted with the sheet's
# own background colour so the flood fill removes them. Sheet coords (x0,y0,x1,y1).
PAINT = {
  "overview": [(285,120,425,190),   # tail of the "CHARACTER OVERVIEW" title over the front view
               (1130,175,1340,242), # SIDE PROFILE label
               (1232,585,1400,656), # BACK VIEW label
               (860,60,880,160)],   # arrow head near side view
  "costume":  [(1225,788,1400,832), # GOLD-TRIM HEM label overlapping the callout circle
               (1030,130,1200,200), (1260,320,1400,370), (1115,520,1275,570), (1180,920,1400,965)],
  "tail":     [(1300,220,1390,290), (1055,660,1240,710), (755,880,805,955)],
}
from PIL import ImageDraw
for k, boxes in PAINT.items():
    a = np.asarray(sheets[k]); bg = tuple(int(v) for v in np.median(np.concatenate([a[0],a[-1],a[:,0],a[:,-1]]),axis=0))
    d = ImageDraw.Draw(sheets[k])
    for b in boxes: d.rectangle(b, fill=bg)
for name, (sheet, box) in CROPS.items():
    crop = sheets[sheet].crop(box)
    rgba, bgmask = isolate(crop)
    white = Image.new("RGB", crop.size, (255, 255, 255)); white.paste(rgba, mask=rgba.split()[3])
    up_white = upscale(white); up_rgba = upscale(rgba)
    up_white.save(f"{OUT}/{name}.png"); up_rgba.save(f"{OUT}/{name}_rgba.png")
    manifest[name] = {"sheet": os.path.basename(SHEETS[sheet]), "crop_box_xyxy": box,
                      "source_px": crop.size, "output_px": up_white.size,
                      "bg_removed_fraction": round(float(bgmask.mean()), 3)}
    print(f"{name:32s} {crop.size} -> {up_white.size}  bg={bgmask.mean():.2f}")

# canonical -> 2048 tall
c = Image.open(CANON).convert("RGBA")
s = 2048 / c.height
c2 = c.resize((round(c.width*s), 2048), Image.LANCZOS)
c2.save(f"{OUT}/canonical_front_2048_rgba.png")
w = Image.new("RGB", c2.size, (255,255,255)); w.paste(c2, mask=c2.split()[3]); w.save(f"{OUT}/canonical_front_2048_white.png")
manifest["canonical_front_2048"] = {"source": CANON, "source_px": c.size, "output_px": c2.size}
print("canonical", c.size, "->", c2.size)

# portrait (4-head standard form) full copy, upscaled to 2048 tall for reference
p = Image.open(KIT + "/whalechan-standard-character-portrait.webp").convert("RGB")
p.crop((150, 160, 941, 1600)).save(f"{OUT}/portrait_standard_form_4head.png")
json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=2)
