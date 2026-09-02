"""measure_turnaround.py - derive Whale-chan's chain-selector fractions from the accepted turnaround.

  python tools/vrm/measure_turnaround.py [--out tools/vrm/evidence/turnaround_landmarks.json]

Reads spikes/model/turnaround/{front,right,back}.png (white background, same height and baseline),
finds the figure bounding box automatically (non-white pixels) and converts a set of landmark
pixel coordinates into fractions of the figure HEIGHT. Two kinds of numbers are reported:

  auto      scanned from the pixels (figure bbox, tail fluke extent in the side view, ahoge tip,
            widest hair span) - reproducible without a human
  read      pixel coordinates read off the images by eye (ear roots/tips, skirt hem, waist, ...);
            the numbers are in LANDMARKS below, the script only converts them to fractions

All fractions are of the figure height H (ground = 0, top of the ahoge = 1); x is measured from
the figure's horizontal centre (character's left = +x, matching Blender +X after a glTF import);
depth is measured from the FRONT-most plane of the figure (face / skirt front) backwards. Those
three references (height, symmetry centre, front plane) are the ones that survive a T-pose bake
and a curled-vs-straight tail; the bbox width and depth do not (see REPORT_hookup.md).
"""

import argparse
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TURN = os.path.join(HERE, "..", "..", "spikes", "model", "turnaround")

# pixel coordinates in the 2560x3072 PNGs (read off the images; thumbnail coords x4)
LANDMARKS = {
    "front": {
        "ear_R_tip_x": 660, "ear_R_root_x": 860, "ear_L_root_x": 1820, "ear_L_tip_x": 2100,
        "ear_top_y": 960, "ear_bottom_y": 1150,
        "headdress_top_y": 380, "chin_y": 1240, "eye_y": 1040, "brow_y": 960,
        "bangs_top_y": 520, "bangs_bottom_y": 1080,
        "sidelock_top_y": 800, "sidelock_bottom_y": 1920, "sidelock_R_x0": 680, "sidelock_R_x1": 960,
        "shoulder_y": 1380, "hand_R_x": 600, "hand_R_y": 1900, "shoulder_R_x": 1000,
        "waist_y": 1600, "skirt_top_y": 1680, "skirt_hem_y": 2360, "skirt_x0": 800, "skirt_x1": 1880,
        "tail_exit_x": 1160, "tail_exit_y": 2400, "fluke_x": 480, "fluke_y": 2640,
        "sock_top_y": 2360, "shoe_bottom_y": 2888,
    },
    "right": {  # character faces viewer-right; +x on screen = character's front
        "face_front_x": 2300, "skirt_front_x": 2320, "shoe_front_x": 2000,
        "hair_back_x": 860, "skirt_back_x": 1320, "upper_back_x": 1440,
        "skull_back_x_under_hair": 960,
        "ahoge_x0": 1760, "ahoge_x1": 2080,
        "ear_x0": 1200, "ear_x1": 1680, "ear_y0": 1080, "ear_y1": 1360,
        "sidelock_x0": 1600, "sidelock_x1": 1880,
        "bangs_x0": 1920, "bangs_x1": 2320,
        "hair_bottom_y": 2240, "hair_top_y": 520,
        "tail_root_x": 1360, "tail_root_y": 2400, "tail_centre_y_at_root": 2400,
        "fluke_top_y": 1920, "fluke_bottom_y": 2560,
        "hips_y": 2040, "skirt_top_y": 1760, "skirt_hem_y": 2560,
    },
    "back": {
        "tail_root_x": 1200, "tail_root_y": 2160, "fluke_x": 2120, "fluke_y0": 2240, "fluke_y1": 2800,
        "hair_bottom_y": 1920, "hair_x0": 520, "hair_x1": 1880,
    },
}


def figure_bbox(img, thresh=245):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    mask = (a < thresh).any(axis=2)
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1]), int(ys[-1]), mask


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=os.path.join(HERE, "evidence", "turnaround_landmarks.json"))
    a = p.parse_args()

    views = {}
    for v in ("front", "right", "back"):
        img = Image.open(os.path.join(TURN, v + ".png"))
        x0, y0, x1, y1, mask = figure_bbox(img)
        views[v] = {"size": img.size, "bbox_xyxy": [x0, y0, x1, y1], "mask": mask}
    H = {v: d["bbox_xyxy"][3] - d["bbox_xyxy"][1] for v, d in views.items()}
    ground = {v: d["bbox_xyxy"][3] for v, d in views.items()}

    def zf(v, y):  # pixel row -> fraction of height above ground
        return round((ground[v] - y) / H[v], 3)

    def xf(v, x):  # pixel column -> fraction of height from the figure centre (front/back views)
        cx = (views[v]["bbox_xyxy"][0] + views[v]["bbox_xyxy"][2]) / 2
        sgn = 1.0 if v == "front" else -1.0  # back view is mirrored: viewer-right = character's right
        return round(sgn * (x - cx) / H[v], 3)

    def df(x):  # side view column -> depth fraction of height behind the front-most plane
        front = views["right"]["bbox_xyxy"][2]
        return round((front - x) / H["right"], 3)

    out = {"units": "fractions of figure height H; x from centre (+ = character's left); depth from front plane",
           "auto": {}, "read": {}}
    fb, rb, bb = (views[v]["bbox_xyxy"] for v in ("front", "right", "back"))
    out["auto"]["height_px"] = H
    out["auto"]["front_width_over_H"] = round((fb[2] - fb[0]) / H["front"], 3)
    out["auto"]["back_width_over_H"] = round((bb[2] - bb[0]) / H["back"], 3)
    out["auto"]["side_depth_over_H"] = round((rb[2] - rb[0]) / H["right"], 3)
    # side view: tail flukes are the left-most 20 % of the figure -> their vertical extent
    m = views["right"]["mask"]
    x_lim = rb[0] + int(0.2 * (rb[2] - rb[0]))
    rows = np.where(m[:, rb[0]:x_lim].any(axis=1))[0]
    out["auto"]["tail_fluke_z_range"] = [zf("right", int(rows[-1])), zf("right", int(rows[0]))]
    out["auto"]["tail_tip_depth"] = df(rb[0])
    # ahoge: rows near the top where the figure is narrower than 8 % of H
    mf = views["front"]["mask"]
    widths = mf.sum(axis=1)
    thin = [y for y in range(fb[1], fb[1] + int(0.15 * H["front"])) if 0 < widths[y] < 0.08 * H["front"]]
    out["auto"]["ahoge_z_range"] = [zf("front", max(thin)), zf("front", min(thin))] if thin else None
    # widest hair/hand span in the front view (excluding the tail rows: upper 60 % only)
    top_rows = mf[fb[1]: fb[1] + int(0.6 * H["front"])]
    cols = np.where(top_rows.any(axis=0))[0]
    out["auto"]["upper_body_half_width_over_H"] = round((cols[-1] - cols[0]) / 2 / H["front"], 3)

    L = LANDMARKS
    f, r, b = L["front"], L["right"], L["back"]
    out["read"] = {
        "head": {"top_z": zf("front", f["headdress_top_y"]), "chin_z": zf("front", f["chin_y"]),
                 "eye_z": zf("front", f["eye_y"]), "brow_z": zf("front", f["brow_y"]),
                 "skull_back_depth": df(r["skull_back_x_under_hair"])},
        "ahoge": {"x": [xf("front", 1300), xf("front", 1420)], "depth": [df(r["ahoge_x1"]), df(r["ahoge_x0"])]},
        "ears": {"z": [zf("front", f["ear_bottom_y"]), zf("front", f["ear_top_y"])],
                 "x_L": [xf("front", f["ear_L_root_x"]), xf("front", f["ear_L_tip_x"])],
                 "x_R": [xf("front", f["ear_R_tip_x"]), xf("front", f["ear_R_root_x"])],
                 "depth": [df(r["ear_x1"]), df(r["ear_x0"])]},
        "bangs": {"z": [zf("front", f["bangs_bottom_y"]), zf("front", f["bangs_top_y"])],
                  "depth": [df(r["bangs_x1"]), df(r["bangs_x0"])]},
        "sidelocks": {"z": [zf("front", f["sidelock_bottom_y"]), zf("front", f["sidelock_top_y"])],
                      "x_R": [xf("front", f["sidelock_R_x0"]), xf("front", f["sidelock_R_x1"])],
                      "depth": [df(r["sidelock_x1"]), df(r["sidelock_x0"])]},
        "hair_back": {"z": [zf("right", r["hair_bottom_y"]), zf("right", r["hair_top_y"])],
                      "depth": [df(r["upper_back_x"]), df(r["hair_back_x"])],
                      "x": [xf("back", b["hair_x0"]), xf("back", b["hair_x1"])]},
        "arms": {"shoulder_z": zf("front", f["shoulder_y"]), "hand_z": zf("front", f["hand_R_y"]),
                 "shoulder_x": xf("front", f["shoulder_R_x"]), "hand_x": xf("front", f["hand_R_x"]),
                 "arm_len_over_H": round(((f["hand_R_x"] - f["shoulder_R_x"]) ** 2 + (f["hand_R_y"] - f["shoulder_y"]) ** 2) ** 0.5 / H["front"], 3)},
        "skirt": {"z": [zf("front", f["skirt_hem_y"]), zf("front", f["skirt_top_y"])],
                  "x": [xf("front", f["skirt_x0"]), xf("front", f["skirt_x1"])],
                  "front_depth": df(r["skirt_front_x"]), "back_depth": df(r["skirt_back_x"]),
                  "leg_front_depth": df(r["shoe_front_x"])},
        "tail": {"root_z_side": zf("right", r["tail_root_y"]), "hips_z": zf("right", r["hips_y"]),
                 "root_depth": df(r["tail_root_x"]), "exit_z_front": zf("front", f["tail_exit_y"]),
                 "exit_x_front": xf("front", f["tail_exit_x"]), "fluke_x_front": xf("front", f["fluke_x"]),
                 "root_x_back": xf("back", b["tail_root_x"]), "fluke_x_back": xf("back", b["fluke_x"]),
                 "fluke_z_back": [zf("back", b["fluke_y1"]), zf("back", b["fluke_y0"])]},
        "legs": {"sock_top_z": zf("front", f["sock_top_y"])},
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(out, indent=2))
    print(f"written {a.out}")


if __name__ == "__main__":
    main()
