"""Parts revision v005: outline-following partition and motion-sized overlap bands.

Why this revision exists (see docs/spikes/2026-08-31-tail-rig-spike.md):

* v001 assigned every canonical pixel to the nearest hand-placed ellipse. Boundaries
  ignored the ink lines, so 48 parts carried islands of another part's art, and the
  tail root and stock were cut 80 px apart with nothing in between.
* v001 extended each part under its occluders by at most 112 source px with a flat
  median-colour fill, ignoring the plan's own motion_envelope (the tail is planned for
  256 px of warp). Eight articulated seams had zero overlap and tore under rotation.

This script keeps v001's zone polygons, anchors and explicit face rules verbatim by
importing them, and changes exactly two mechanisms:

1. Zone assignment runs a seeded watershed on the work-resolution image, so seams
   between parts fall on outlines where outlines exist and degrade to nearest-anchor
   where they do not. A neighbour-vote island cleanup then reassigns any small
   disconnected fragment to the part that surrounds it.
2. The hidden band under each occluder is sized from the manifest's motion_envelope
   and directed by its occlusion graph, and is filled by continuing the part's own
   nearest visible pixels instead of a flat colour.

Everything else (hidden-only anatomy proxies, generated overlays, provenance shape,
neutral composite QA seed) matches v001 so the downstream stages keep working.

Run from the repository root:
    python runs/deepseek_humanized_20260830_001/03_parts/revisions/v005/scripts/build_parts.py
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None

HERE = Path(__file__).resolve().parent
REVISION = HERE.parent.name                      # "v005"
RUN_ROOT = HERE.parents[3]
V1_SCRIPT = RUN_ROOT / "03_parts" / "revisions" / "v001" / "scripts" / "build_parts.py"

_spec = importlib.util.spec_from_file_location("build_parts_v001", V1_SCRIPT)
v1 = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
sys.modules[_spec.name] = v1          # dataclasses resolve annotations through sys.modules
_spec.loader.exec_module(v1)

WORK_WIDTH, WORK_HEIGHT, SCALE = v1.WORK_WIDTH, v1.WORK_HEIGHT, v1.SCALE
FULL_W, FULL_H = WORK_WIDTH * SCALE, WORK_HEIGHT * SCALE

# Band sizing (source px). The floor keeps trim parts with tiny envelopes riggable; the
# cap bounds the work for the big physics parts (hair, skirt, tail).
BAND_MIN_PX = 64
BAND_MAX_PX = 320

# Parts placed by v001's explicit colour-and-shape rules rather than a zone. They are
# small, precise and may legitimately be several islands (a lash is dashes), so the
# island cleanup leaves them alone.
CLEANUP_EXEMPT = {
    "head_base", "fin_ear_l", "fin_ear_r", "ahoge_tip", "hand_l", "hand_r",
    "apron_panel", "apron_emblem", "chest_gem", "nose",
    "eye_white_l", "eye_white_r", "iris_l", "iris_r", "pupil_l", "pupil_r",
    "iris_detail_l", "iris_detail_r", "upper_lash_l", "upper_lash_r",
    "lower_lash_l", "lower_lash_r", "eye_highlight_primary_l", "eye_highlight_primary_r",
    "eye_highlight_secondary_l", "eye_highlight_secondary_r", "brow_l", "brow_r",
    "mouth_cavity", "upper_teeth", "lower_teeth", "tongue", "upper_lip_line",
    "lower_lip_line", "mouth_corner_l", "mouth_corner_r", "mouth_highlight",
}
ISLAND_MAX_FRACTION = 0.25   # an island smaller than this share of the largest piece is a leak
ISLAND_EMBED_MIN = 0.5       # ...if at least this share of its border is one other part

GEODESIC_STRUCT = ndimage.generate_binary_structure(2, 2)   # 8-connected growth
# Zones whose parts are separated by drawn outlines. Any zone with none of these members
# keeps v001's nearest-anchor assignment.
WATERSHED_MEMBERS = {
    "tail_root", "tail_stock", "tail_fluke_upper", "tail_fluke_lower",
    "stocking_l", "shoe_l", "stocking_r", "shoe_r",
    "hair_back_base", "hair_back_outer_l", "hair_back_inner_l", "hair_back_strand_l",
    "hair_back_outer_r", "hair_back_inner_r", "hair_back_strand_r", "hair_front_base",
    "bang_l", "bang_center", "bang_r", "bang_strand_l", "bang_strand_r",
    "side_lock_root_l", "side_lock_tip_l", "side_lock_root_r", "side_lock_tip_r",
    "ahoge_root", "ahoge_tip",
}
# Parts whose own art is the wrong colour class get those pixels handed to their neighbours.
# The tail is navy; the white underskirt frill it touches is not tail.
COLOUR_GATED = {"tail_root": "blue_or_dark", "tail_stock": "blue_or_dark",
                "tail_fluke_upper": "blue_or_dark", "tail_fluke_lower": "blue_or_dark"}
# A part with too little art of its own continues its band from a named neighbour instead.
CONTINUATION_SOURCE = {"tail_root": "tail_stock"}
CONTINUATION_MIN_OWN_PX = 400      # work px; below this the part's own colours are not representative
FILL_FADE_PX = 12                  # work px over which the band fades from nearest-pixel to the part's median colour
SOLID_ALPHA = 200                  # alpha at or above this counts as solid for band growth and placement
# Parts that are one continuous surface. A part's band may travel through its chain-mates
# (it is only ever PLACED under higher-z parts, so the at-rest composite is unchanged), which
# lets the fluke continue under the hair past the strip of stock the partition put between them.
CHAIN_GROUPS = [
    {"tail_root", "tail_stock", "tail_fluke_upper", "tail_fluke_lower"},
]

# The navy sleeve bodies. v001's hair zone runs last over this region and its `blue` test
# accepts navy, so since v001 the hair parts have owned both arms and the sleeve parts held only
# their trim. Dark pixels inside these polygons are sleeves; bright hair draped over the shoulder
# stays hair. Work-resolution coordinates, character-left is the viewer's right.
ARM_POLYGONS = {
    "l": ([(455, 955), (560, 955), (605, 1060), (655, 1140), (640, 1215), (560, 1215), (500, 1130), (455, 1040)],
          ["sleeve_upper_l", "sleeve_lower_l", "cuff_l"]),
    "r": ([(327, 955), (222, 955), (177, 1060), (127, 1140), (142, 1215), (222, 1215), (282, 1130), (327, 1040)],
          ["sleeve_upper_r", "sleeve_lower_r", "cuff_r"]),
}

_WORK_BGR: np.ndarray | None = None   # set in main() before the owner map is built
_ISLAND_LOG: list[dict[str, Any]] = []


# --------------------------------------------------------------------------- partition

def watershed_assign(
    owner: np.ndarray,
    target: np.ndarray,
    ids: list[str],
    id_to_index: dict[str, int],
) -> None:
    """Drop-in for v001.nearest_assign: same signature, same override semantics.

    Seeds a marker inside each anchor, floods with cv2.watershed so fronts stop on
    outlines, then hands anything still unassigned (watershed boundaries, seedless
    parts) to v001's nearest-anchor rule.
    """
    valid = [p for p in ids if p in id_to_index and p in v1.ANCHORS]
    if not valid or not np.any(target):
        return
    if not any(p in WATERSHED_MEMBERS for p in valid):
        # One continuous fabric split into panels and sleeves has no outline for a flood
        # front to stop on; equal-speed flooding lets the biggest seed eat its neighbours.
        # v001's ellipse-normalised nearest-anchor rule is the right tool there.
        v1_nearest_assign(owner, target, ids, id_to_index)
        return
    assert _WORK_BGR is not None
    owner[target] = -1                                   # v001 overwrote the whole target too
    markers = np.zeros(owner.shape, dtype=np.int32)
    label_to_index: dict[int, int] = {}
    next_label = 1
    for part_id in valid:
        a = v1.ANCHORS[part_id]
        seed = None
        for divisor in (4, 8, 16):
            candidate = v1.ellipse(a.x, a.y, max(2, a.rx // divisor), max(2, a.ry // divisor)) & target
            if np.any(candidate):
                seed = candidate
                break
        if seed is None:
            continue
        markers[seed] = next_label
        label_to_index[next_label] = id_to_index[part_id]
        next_label += 1
    if next_label > 2:                                   # two or more seeds: flood
        markers[~target] = next_label                    # everything outside the zone is a wall
        flooded = cv2.watershed(_WORK_BGR, markers.copy())
        for label, index in label_to_index.items():
            owner[target & (flooded == label)] = index
    rest = target & (owner < 0)
    if np.any(rest):
        v1_nearest_assign(owner, rest, valid, id_to_index)


v1_nearest_assign = v1.nearest_assign     # keep a handle before patching
v1.nearest_assign = watershed_assign      # build_owner_map looks this name up at call time


def island_cleanup(owner: np.ndarray, canonical_parts: list[dict[str, Any]], id_to_index: dict[str, int]) -> None:
    index_to_id = {index: part_id for part_id, index in id_to_index.items()}
    exempt = {id_to_index[p] for p in CLEANUP_EXEMPT if p in id_to_index}
    for _ in range(4):
        changed = 0
        for index in np.unique(owner):
            if index < 0 or index in exempt:
                continue
            mask = owner == index
            labels, count = ndimage.label(mask)
            if count <= 1:
                continue
            sizes = ndimage.sum(mask, labels, range(1, count + 1))
            largest = float(sizes.max())
            for k in range(count):
                if sizes[k] >= ISLAND_MAX_FRACTION * largest:
                    continue
                island = labels == k + 1
                ring = ndimage.binary_dilation(island, iterations=1) & ~island
                neighbours = owner[ring]
                neighbours = neighbours[(neighbours >= 0) & (neighbours != index)]
                if neighbours.size == 0:
                    continue
                values, counts = np.unique(neighbours, return_counts=True)
                best = int(values[counts.argmax()])
                if counts.max() < ISLAND_EMBED_MIN * int(ring.sum()):
                    continue
                owner[island] = best
                changed += 1
                _ISLAND_LOG.append({
                    "from": index_to_id[int(index)], "to": index_to_id[best],
                    "work_px": int(sizes[k]),
                })
        if not changed:
            break


def reclaim_arms(owner: np.ndarray, work_rgba: np.ndarray, id_to_index: dict[str, int]) -> None:
    """Give the dark pixels inside each arm polygon to that arm's sleeve parts (v001 anchor rule)."""
    rgb = work_rgba[:, :, :3].astype(np.int16)
    dark = rgb.max(axis=2) < 112
    alpha = work_rgba[:, :, 3] > 0
    for side, (points, ids) in ARM_POLYGONS.items():
        target = alpha & dark & v1.polygon(points)
        before = {pid: int((owner == id_to_index[pid]).sum()) for pid in ids if pid in id_to_index}
        v1_nearest_assign(owner, target, ids, id_to_index)
        after = {pid: int((owner == id_to_index[pid]).sum()) for pid in ids if pid in id_to_index}
        print(f"[{REVISION}] arm {side}: sleeves {before} -> {after}", file=sys.stderr)


def colour_gate(owner: np.ndarray, work_rgba: np.ndarray, id_to_index: dict[str, int]) -> None:
    """Hand a part's off-colour pixels to whichever neighbour surrounds them (v001 colour tests)."""
    rgb = work_rgba[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    classes = {"blue_or_dark": ((b > r + 12) & (b > g - 20)) | (rgb.max(axis=2) < 112)}
    for part_id, cls in COLOUR_GATED.items():
        if part_id not in id_to_index:
            continue
        index = id_to_index[part_id]
        wrong = (owner == index) & ~classes[cls]
        if not np.any(wrong):
            continue
        labels, count = ndimage.label(wrong)
        for k in range(1, count + 1):
            blob = labels == k
            ring = ndimage.binary_dilation(blob, iterations=2) & ~blob
            neighbours = owner[ring]
            neighbours = neighbours[(neighbours >= 0) & (neighbours != index)]
            if neighbours.size == 0:
                continue
            values, counts = np.unique(neighbours, return_counts=True)
            owner[blob] = int(values[counts.argmax()])
            _ISLAND_LOG.append({"from": part_id, "to": "colour-gate:" + str(int(values[counts.argmax()])), "work_px": int(blob.sum())})


# --------------------------------------------------------------------------- hidden band

def band_px_for(part: dict[str, Any]) -> int:
    env = part.get("motion_envelope") or {}
    wanted = max(
        int(env.get("warp_px", 0) or 0),
        int(env.get("translate_x_px", 0) or 0),
        int(env.get("translate_y_px", 0) or 0),
        int(part.get("overlap_px", 0) or 0),
        BAND_MIN_PX,
    )
    return min(wanted, BAND_MAX_PX)


def continuation_rgb(work_rgba: np.ndarray, visible_work: np.ndarray, hidden_full: np.ndarray) -> np.ndarray | None:
    """RGB for the hidden band: each hidden pixel takes its nearest visible pixel's colour."""
    if not np.any(visible_work):
        return None
    dist, (iy, ix) = ndimage.distance_transform_edt(~visible_work, return_indices=True)
    nearest = work_rgba[iy, ix, :3].astype(np.float32)
    median = np.median(work_rgba[visible_work][:, :3], axis=0).astype(np.float32)
    # Continue outlines and shading for the first few pixels, then settle on the part's own
    # dominant colour so a pale edge pixel cannot smear across a large band.
    w = np.clip(dist / FILL_FADE_PX, 0.0, 1.0)[..., None]
    fill_work = (nearest * (1.0 - w) + median * w).astype(np.uint8)
    fill_work = cv2.GaussianBlur(fill_work, (0, 0), 1.5)
    return cv2.resize(fill_work, (FULL_W, FULL_H), interpolation=cv2.INTER_LINEAR)


def upscale(mask_work: np.ndarray) -> np.ndarray:
    return cv2.resize(mask_work.astype(np.uint8), (FULL_W, FULL_H), interpolation=cv2.INTER_NEAREST).astype(bool)


# --------------------------------------------------------------------------- main

def main() -> int:
    global _WORK_BGR
    parser = argparse.ArgumentParser(description=f"Build parts revision {REVISION}.")
    parser.add_argument("--force", action="store_true", help="rebuild even if the index exists")
    args = parser.parse_args()

    run_root = RUN_ROOT
    output_root = run_root / "03_parts" / "revisions" / REVISION
    index_path = output_root / "parts_index.json"
    if index_path.exists() and not args.force:
        print(json.dumps({"status": "no_op", "reason": f"{REVISION} already built", "index": str(index_path)}))
        return 0

    canonical_path = run_root / "01_design" / "canonical" / "revisions" / "v005" / "canonical_v005.png"
    manifest_path = run_root / "02_parts_plan" / "revisions" / "v001" / "part_manifest.json"
    if v1.sha256(canonical_path) != v1.CANONICAL_SHA256:
        raise RuntimeError("Locked canonical SHA-256 mismatch; refusing image production.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    imported_parts = [p for p in manifest["parts"] if p["imported"]]
    canonical_parts = [p for p in imported_parts if p["artwork_method"] == "canonical_visible_pixel_extraction"]
    generated_parts = [p for p in imported_parts if p["artwork_method"] == "generated_expression_overlay"]

    final_dir, masks_dir, provenance_dir, qa_dir = (output_root / d for d in ("final", "masks", "provenance", "qa"))
    for directory in (final_dir, masks_dir, provenance_dir, qa_dir):
        directory.mkdir(parents=True, exist_ok=True)

    with Image.open(canonical_path) as source_image:
        canonical_image = source_image.convert("RGBA")
        icc_profile = source_image.info.get("icc_profile")
    if canonical_image.size != (FULL_W, FULL_H):
        raise RuntimeError(f"Unexpected canonical size: {canonical_image.size}")
    work_image = canonical_image.resize((WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
    work_rgba = np.asarray(work_image, dtype=np.uint8)
    canonical_rgba = np.asarray(canonical_image, dtype=np.uint8)
    _WORK_BGR = cv2.GaussianBlur(cv2.cvtColor(work_rgba[:, :, :3], cv2.COLOR_RGB2BGR), (3, 3), 0)

    owner, id_to_index = v1.build_owner_map(work_rgba, canonical_parts)
    reclaim_arms(owner, work_rgba, id_to_index)
    colour_gate(owner, work_rgba, id_to_index)
    island_cleanup(owner, canonical_parts, id_to_index)
    print(f"[{REVISION}] island cleanup reassigned {len(_ISLAND_LOG)} fragments", file=sys.stderr)

    work_alpha_opaque = work_rgba[:, :, 3] == 255
    # Growth passes through any solid pixel; an exact-255 test turns every hairline of
    # alpha 254 (2% of the interior after resampling) into a wall across a seam.
    work_alpha_solid = work_rgba[:, :, 3] >= SOLID_ALPHA
    canonical_opaque = canonical_rgba[:, :, 3] == 255
    canonical_solid = canonical_rgba[:, :, 3] >= SOLID_ALPHA
    z_by_index = np.asarray([p["z_index"] for p in canonical_parts], dtype=np.int32)
    owner_z = np.full_like(owner, -1, dtype=np.int32)
    occupied = owner >= 0
    owner_z[occupied] = z_by_index[owner[occupied]]

    records: list[dict[str, Any]] = []
    neutral_work = np.zeros_like(work_rgba)
    rel = lambda p: str(p.relative_to(run_root)).replace("\\", "/")   # noqa: E731

    for part in sorted(canonical_parts, key=lambda item: item["z_index"]):
        part_id = part["id"]
        part_index = id_to_index[part_id]
        visible_work = owner == part_index
        band_px = band_px_for(part)
        radius = max(2, band_px // SCALE)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
        dilated = cv2.dilate(visible_work.astype(np.uint8), kernel).astype(bool)

        occluders = [id_to_index[o] for o in (part.get("occluded_by") or []) if o in id_to_index]
        allowed = owner_z > int(part["z_index"])
        if occluders:
            allowed |= np.isin(owner, occluders)
        # Geodesic growth: the band may only spread through pixels it is allowed to sit
        # under, one pixel at a time, so it can never jump across a lower-z part and land
        # as a detached blob on the far side (the first v005 build did exactly that).
        passable = visible_work | (work_alpha_solid & allowed)
        for group in CHAIN_GROUPS:
            if part_id in group:
                mates = [id_to_index[m] for m in group if m != part_id and m in id_to_index]
                passable |= work_alpha_solid & np.isin(owner, mates)
        reach = visible_work.copy()
        for _ in range(radius):
            grown = ndimage.binary_dilation(reach, structure=GEODESIC_STRUCT) & passable
            if np.array_equal(grown, reach):
                break
            reach = grown
        hidden_work = reach & work_alpha_solid & allowed & ~visible_work
        # A band is a continuation of the part's art. Any band piece not connected to that art
        # (possible once growth may tunnel through a chain-mate) would move with the part as a
        # detached patch, which is the defect class this revision exists to remove.
        if np.any(hidden_work) and np.any(visible_work):
            labels, _ = ndimage.label(visible_work | hidden_work, structure=GEODESIC_STRUCT)
            keep = np.unique(labels[visible_work])
            hidden_work &= np.isin(labels, keep[keep > 0])
        proxy_hidden_work = np.zeros_like(hidden_work)
        method = "seeded_watershed_extraction_with_motion_envelope_continuation"
        if part_id in v1.DEFAULT_ZERO_OPACITY:                      # v001 behaviour, verbatim
            if part_id == "eyelid_fill_l":
                hidden_work = v1.ellipse(458, 812, 54, 48) & work_alpha_opaque
            elif part_id == "eyelid_fill_r":
                hidden_work = v1.ellipse(325, 812, 54, 48) & work_alpha_opaque
            else:
                hidden_work = v1.ellipse(391, 876, 36, 25) & work_alpha_opaque
        elif part["needs_hidden_reconstruction"] and not np.any(hidden_work):
            proxy_hidden_work = dilated & work_alpha_opaque & (owner >= 0) & (owner != part_index)
            if not np.any(proxy_hidden_work):
                proxy_hidden_work = v1.hidden_seed(part_id, work_alpha_opaque) & (owner >= 0) & (owner != part_index)
            hidden_work = proxy_hidden_work
            method = "v001_hidden_only_proxy"
        if not part["needs_hidden_reconstruction"]:
            hidden_work[:] = False
            proxy_hidden_work[:] = False

        visible_full = upscale(visible_work)
        hidden_full = upscale(hidden_work) & canonical_solid
        proxy_hidden_full = upscale(proxy_hidden_work) & hidden_full
        overlap_full = cv2.resize(((dilated | hidden_work) & (work_rgba[:, :, 3] > 0)).astype(np.uint8),
                                  (FULL_W, FULL_H), interpolation=cv2.INTER_NEAREST)

        part_rgba = np.zeros_like(canonical_rgba)
        part_rgba[visible_full] = canonical_rgba[visible_full]
        fill_color = v1.part_fill_color(part, work_rgba[:, :, :3][visible_work])
        source_work = visible_work
        if part_id in CONTINUATION_SOURCE and int(visible_work.sum()) < CONTINUATION_MIN_OWN_PX:
            donor = CONTINUATION_SOURCE[part_id]
            if donor in id_to_index:
                source_work = owner == id_to_index[donor]      # donor only: the part's few own pixels are not representative
        band_fill = None if part_id in v1.DEFAULT_ZERO_OPACITY else continuation_rgb(work_rgba, source_work, hidden_full)
        if band_fill is not None:
            part_rgba[hidden_full, :3] = band_fill[hidden_full]
            fill_policy = "nearest visible pixel continuation, lightly blurred"
        else:
            part_rgba[hidden_full, :3] = fill_color
            fill_policy = "median-colour fill (no visible pixels to continue)"
        part_rgba[hidden_full, 3] = canonical_rgba[hidden_full, 3]     # never more opaque than the canonical was there
        part_rgba[proxy_hidden_full] = canonical_rgba[proxy_hidden_full]

        paths = {
            "visible_mask": masks_dir / f"{part_id}_visible_mask.png",
            "hidden_mask": masks_dir / f"{part_id}_hidden_mask.png",
            "overlap_mask": masks_dir / f"{part_id}_overlap_mask.png",
            "final": final_dir / f"{part_id}.png",
        }
        Image.fromarray((visible_full * 255).astype(np.uint8), "L").save(paths["visible_mask"], compress_level=6)
        Image.fromarray((hidden_full * 255).astype(np.uint8), "L").save(paths["hidden_mask"], compress_level=6)
        Image.fromarray((overlap_full * 255).astype(np.uint8), "L").save(paths["overlap_mask"], compress_level=6)
        Image.fromarray(part_rgba, "RGBA").save(paths["final"], compress_level=6, icc_profile=icc_profile)

        work_part = cv2.resize(part_rgba, (WORK_WIDTH, WORK_HEIGHT), interpolation=cv2.INTER_AREA)
        if part_id not in v1.DEFAULT_ZERO_OPACITY:
            neutral_work = v1.alpha_composite_np(neutral_work, work_part)
        provenance = {
            "schema_version": "1.0",
            "run_id": v1.RUN_ID,
            "revision": REVISION,
            "part_id": part_id,
            "method": method,
            "canonical": {"path": rel(canonical_path), "sha256": v1.CANONICAL_SHA256},
            "visible_pixel_policy": "verbatim canonical RGBA under a zone-constrained seeded-watershed ownership mask with island cleanup",
            "hidden_pixel_policy": f"band of {band_px} px (from motion_envelope / occlusion graph) under higher-z occluders; {fill_policy}",
            "band_px": band_px,
            "default_opacity": 0 if part_id in v1.DEFAULT_ZERO_OPACITY else 1,
            "proxy_hidden_pixel_count": int(np.count_nonzero(proxy_hidden_full)),
            "visible_pixel_count": int(np.count_nonzero(visible_full)),
            "hidden_pixel_count": int(np.count_nonzero(hidden_full)),
            "fill_rgb": list(fill_color),
            "files": {k: rel(p) for k, p in paths.items()},
            "created_at": v1.utc_now(),
        }
        (provenance_dir / f"{part_id}.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        records.append(provenance)
        print(f"[{REVISION}] {part_id:<26} visible {provenance['visible_pixel_count']:>8} hidden {provenance['hidden_pixel_count']:>8} band {band_px}", file=sys.stderr)

    for part in sorted(generated_parts, key=lambda item: item["z_index"]):   # v001 overlays, verbatim
        part_id = part["id"]
        overlay_full = v1.draw_expression(part_id).resize((FULL_W, FULL_H), Image.Resampling.LANCZOS)
        paths = {
            "visible_mask": masks_dir / f"{part_id}_visible_mask.png",
            "hidden_mask": masks_dir / f"{part_id}_hidden_mask.png",
            "overlap_mask": masks_dir / f"{part_id}_overlap_mask.png",
            "final": final_dir / f"{part_id}.png",
        }
        overlay_full.save(paths["final"], compress_level=6, icc_profile=icc_profile)
        alpha_full = np.asarray(overlay_full.getchannel("A"), dtype=np.uint8)
        Image.fromarray(alpha_full, "L").save(paths["visible_mask"], compress_level=6)
        Image.new("L", (FULL_W, FULL_H), 0).save(paths["hidden_mask"], compress_level=6)
        Image.fromarray(alpha_full, "L").save(paths["overlap_mask"], compress_level=6)
        provenance = {
            "schema_version": "1.0", "run_id": v1.RUN_ID, "revision": REVISION, "part_id": part_id,
            "method": "deterministic_vector_expression_overlay",
            "canonical_sha256": v1.CANONICAL_SHA256,
            "identity_policy": "additive overlay only; canonical geometry and visible pixels are unchanged",
            "visible_pixel_count": int(np.count_nonzero(alpha_full)), "hidden_pixel_count": 0,
            "files": {k: rel(p) for k, p in paths.items()}, "created_at": v1.utc_now(),
        }
        (provenance_dir / f"{part_id}.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        records.append(provenance)

    neutral_path = qa_dir / "neutral_composite.png"
    Image.fromarray(neutral_work, "RGBA").save(neutral_path, compress_level=6, icc_profile=icc_profile)
    diff = np.abs(neutral_work.astype(np.int16) - work_rgba.astype(np.int16))
    diff_path = qa_dir / "neutral_diff_x8.png"
    Image.fromarray(np.dstack((np.clip(diff[:, :, :3] * 8, 0, 255).astype(np.uint8),
                               np.maximum(work_rgba[:, :, 3], neutral_work[:, :, 3]))), "RGBA"
                    ).save(diff_path, compress_level=6, icc_profile=icc_profile)
    (qa_dir / "island_cleanup_log.json").write_text(json.dumps(_ISLAND_LOG, indent=1) + "\n", encoding="utf-8")

    index = {
        "schema_version": "1.0",
        "run_id": v1.RUN_ID,
        "revision": REVISION,
        "status": "built_pending_qa",
        "base_revision": "03_parts/revisions/v001/parts_index.json",
        "canonical": {"path": rel(canonical_path), "sha256": v1.CANONICAL_SHA256, "width": FULL_W, "height": FULL_H, "mode": "RGBA"},
        "production": {
            "visible_pixel_method": "zone_constrained_seeded_watershed_with_island_cleanup",
            "hidden_region_method": "occlusion_graph_motion_envelope_band_with_nearest_pixel_continuation",
            "expression_method": "deterministic_vector_overlays",
            "work_resolution": [WORK_WIDTH, WORK_HEIGHT],
            "full_canvas_registration": True,
            "side_convention": "character_perspective",
            "band_px_range": [BAND_MIN_PX, BAND_MAX_PX],
        },
        "counts": {
            "imported_parts": len(imported_parts),
            "canonical_extractions": len(canonical_parts),
            "generated_expression_overlays": len(generated_parts),
            "nonempty_visible_parts": sum(r["visible_pixel_count"] > 0 for r in records),
            "hidden_reconstructions": sum(r["hidden_pixel_count"] > 0 for r in records),
            "island_reassignments": len(_ISLAND_LOG),
        },
        "qa_seed": {
            "neutral_composite": rel(neutral_path),
            "neutral_diff_x8": rel(diff_path),
            "mean_absolute_rgba_error_at_work_resolution": float(diff.mean()),
            "max_absolute_rgba_error_at_work_resolution": int(diff.max()),
            "unassigned_canonical_work_pixels": int(np.count_nonzero((work_rgba[:, :, 3] > 0) & (owner < 0))),
        },
        "parts": [
            {
                "id": r["part_id"], "method": r["method"], "final": r["files"]["final"],
                "final_sha256": v1.sha256(run_root / r["files"]["final"]),
                "visible_mask": r["files"]["visible_mask"],
                "visible_mask_sha256": v1.sha256(run_root / r["files"]["visible_mask"]),
                "hidden_mask": r["files"]["hidden_mask"],
                "hidden_mask_sha256": v1.sha256(run_root / r["files"]["hidden_mask"]),
                "overlap_mask": r["files"]["overlap_mask"],
                "overlap_mask_sha256": v1.sha256(run_root / r["files"]["overlap_mask"]),
                "visible_pixel_count": r["visible_pixel_count"],
                "hidden_pixel_count": r["hidden_pixel_count"],
                "band_px": r.get("band_px"),
            }
            for r in records
        ],
        "created_at": v1.utc_now(),
    }
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "built", "index": rel(index_path), "counts": index["counts"], "qa_seed": index["qa_seed"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
