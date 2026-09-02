"""Normalise accepted turnaround candidates into turnaround/{front,left,back,right}.png:
same figure height, same baseline, centred on a 2048x3072 pure-white canvas. Also removes the
thin ground line some candidates drew, and derives left = mirror(right) when told to."""
import sys, json, numpy as np
from PIL import Image, ImageOps
from scipy import ndimage
C = "turnaround/_candidates/"
# (candidate, strip_ground_line) -- only front_v4 drew a thin ground line under the shoes
PICK = {"front": (C+"front_v4_g31-0.jpg", True), "right": (C+"right_v1_g31-0.jpg", False),
        "back": (C+"back_v4_g31-0.jpg", False)}
MIRROR_LEFT_FROM_RIGHT = True
CANVAS = (2560, 3072); TARGET_H = 2700; BASELINE = 2900

def fg_mask(im, strip_line, tol=18):
    a = np.asarray(im.convert("RGB")).astype(int)
    m = (255 - a).max(axis=2) > tol
    # drop thin horizontal ground lines: rows whose fg run is 1-6 px tall and wide, below the figure
    # ground line: in the bottom 15% of the figure, any row whose fg run is wider than 45% of the
    # figure width is a drawn line, not shoes (two shoes cover ~25%). Blank those rows.
    ys_all = np.where(m.any(axis=1))[0]; xs_all = np.where(m.any(axis=0))[0]
    fh = ys_all.max() - ys_all.min(); fw = xs_all.max() - xs_all.min()
    cand = [] if not strip_line else [y for y in range(int(ys_all.max() - 0.15*fh), ys_all.max()+1) if m[y].sum() > 0.45*fw]
    # group consecutive candidate rows; only a THIN group (<= 12 px) is a drawn line, a thick one is the tail
    groups, cur = [], []
    for y in cand:
        if cur and y != cur[-1] + 1: groups.append(cur); cur = []
        cur.append(y)
    if cur: groups.append(cur)
    for g in groups:
        if len(g) <= 12:
            for y in range(g[0]-2, g[-1]+3):
                if 0 <= y < m.shape[0] and m[y].sum() > 0.3*fw: m[y] = False
    lab, n = ndimage.label(m, structure=np.ones((3,3)))
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n+1))
        keep = np.zeros(n+1, bool)
        for i, s in enumerate(sizes, 1):
            ys, xs = np.where(lab == i)
            h, w = np.ptp(ys)+1, np.ptp(xs)+1
            line_like = h <= 8 and w > 0.15*m.shape[1]
            keep[i] = (s >= 0.002*sizes.max()) and not line_like
        keep[0] = False
        m = keep[lab]
    return m

out = {}
for view, (path, strip) in PICK.items():
    im = Image.open(path).convert("RGB")
    m = fg_mask(im, strip)
    ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    # white-out everything that is not kept foreground (ground line, shadow specks)
    a = np.asarray(im).copy(); a[~m] = 255
    crop = Image.fromarray(a).crop((x0, y0, x1+1, y1+1))
    s = TARGET_H / crop.height
    crop = crop.resize((round(crop.width*s), TARGET_H), Image.LANCZOS)
    canvas = Image.new("RGB", CANVAS, (255,255,255))
    canvas.paste(crop, ((CANVAS[0]-crop.width)//2, BASELINE-TARGET_H))
    canvas.save(f"turnaround/{view}.png")
    out[view] = {"source": path, "bbox_xyxy": [int(x0),int(y0),int(x1),int(y1)], "scale": round(s,4), "figure_px": [crop.width, TARGET_H]}
    print(view, path, (x0,y0,x1,y1), "->", crop.size)
if MIRROR_LEFT_FROM_RIGHT:
    ImageOps.mirror(Image.open("turnaround/right.png")).save("turnaround/left.png")
    out["left"] = {"source": "mirror of right.png (character is bilaterally symmetric; tail drawn straight back in side views)"}
json.dump(out, open("turnaround/manifest.json", "w"), indent=2)
# contact sheet
views = ["front","left","back","right"]
th = 600; sheet = Image.new("RGB", (4*th, int(th*1.5)), (230,230,230))
for i, v in enumerate(views):
    t = Image.open(f"turnaround/{v}.png"); t.thumbnail((th, int(th*1.5))); sheet.paste(t, (i*th, 0))
sheet.save("turnaround/_contact_sheet.png"); print("sheet", sheet.size)
