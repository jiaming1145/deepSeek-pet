"""Continuity QA for a parts revision: the two gates the v001 QA could not express.

The v001 gate is reassembly error against the canonical. That check is blind, by
construction, to a pixel sitting on the wrong layer in the right place, and to two
parts that meet edge-to-edge with nothing painted underneath. Both are invisible at
rest and both tear the character apart the moment a part moves.

Gate 1  leaks        no zone-assigned canonical part carries a fragment of another
                     part's art: a piece under 25% of the main piece, mostly surrounded
                     by one other part (crumbs and explicitly-placed face parts exempt)
Gate 2  seams        every pair of parts whose visible art touches has a painted
                     overlap band at least MIN_SEAM_PX wide, measured as the pixels
                     the lower-z part's final PNG places under the higher-z part
Gate 3  inventory    produced parts == planned parts, reassembly error unchanged

Run from the repository root:
    python runs/<run>/03_parts/revisions/<rev>/scripts/qa_continuity.py [--min-seam 48]
Writes <rev>/qa/continuity_report.json and exits 1 on any failed error-severity gate.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None

HERE = Path(__file__).resolve().parent
REVISION = HERE.parent.name
RUN_ROOT = HERE.parents[3]
REV_ROOT = RUN_ROOT / "03_parts" / "revisions" / REVISION

ISLAND_MIN_PX = 300          # below this a second component is an antialiasing crumb
ISLAND_LEAK_FRACTION = 0.25  # a fragment this small relative to the main piece...
ISLAND_EMBED_MIN = 0.5       # ...that is mostly surrounded by ONE other part is a leak
SCALE = 4                    # analyse at 1024x2048 for speed; report in source px

# Parts placed by explicit shape-and-colour rules; legitimately fragmentary.
# Parts placed by v001's explicit shape-and-colour rules. Face detail inside face detail (skin
# in the eye corner, apron white inside the emblem) is drawn that way, not leaked.
EXPLICIT_CLAIM = {
    "head_base", "fin_ear_l", "fin_ear_r", "ahoge_tip", "hand_l", "hand_r",
    "apron_panel", "apron_emblem", "chest_gem", "nose",
    "eye_white_l", "eye_white_r", "iris_l", "iris_r", "pupil_l", "pupil_r",
    "iris_detail_l", "iris_detail_r", "upper_lash_l", "upper_lash_r",
    "lower_lash_l", "lower_lash_r", "eye_highlight_primary_l", "eye_highlight_primary_r",
    "eye_highlight_secondary_l", "eye_highlight_secondary_r", "brow_l", "brow_r",
    "mouth_cavity", "upper_teeth", "lower_teeth", "tongue", "upper_lip_line",
    "lower_lip_line", "mouth_corner_l", "mouth_corner_r", "mouth_highlight",
}
SEAM_COVERAGE_MIN = 0.9      # share of the neighbour's near-seam pixels the band must sit under
# Small details that ride on a surface: a rig moves them with their carrier, so detail-on-detail
# seams (nose over teeth, gem over bow knot) reveal nothing. The surfaces they sit on are not
# details: head_base must still be painted under a brow.
FACE_DETAIL = EXPLICIT_CLAIM - {"head_base", "hand_l", "hand_r", "fin_ear_l", "fin_ear_r", "apron_panel"}
SURFACES = {"head_base", "eye_white_l", "eye_white_r"}

ISLAND_EXEMPT = {
    "upper_lash_l", "upper_lash_r", "lower_lash_l", "lower_lash_r",
    "eye_highlight_primary_l", "eye_highlight_primary_r",
    "eye_highlight_secondary_l", "eye_highlight_secondary_r",
    "mouth_corner_l", "mouth_corner_r", "upper_lip_line", "lower_lip_line",
    "mouth_highlight", "iris_detail_l", "iris_detail_r", "nose",
}


def load_alpha(path: Path) -> np.ndarray:
    """Subsampled alpha mask, cached as .npy so re-runs skip the 4096x8192 PNG decode."""
    cache_dir = REV_ROOT / "qa" / "_alpha_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    stat = path.stat()
    cache = cache_dir / f"{path.stem}.{int(stat.st_mtime)}.{stat.st_size}.npy"
    if cache.exists():
        return np.load(cache)
    with Image.open(path) as im:
        if im.mode == "L":
            a = np.asarray(im)
        else:
            a = np.asarray(im.getchannel("A"))
    m = a[::SCALE, ::SCALE] > 8
    np.save(cache, m)
    return m


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-seam", type=int, default=48, help="minimum overlap band in source px")
    args = parser.parse_args()

    index = json.loads((REV_ROOT / "parts_index.json").read_text(encoding="utf-8"))
    manifest = json.loads((RUN_ROOT / "02_parts_plan/revisions/v001/part_manifest.json").read_text(encoding="utf-8"))
    planned = {p["id"]: p for p in manifest["parts"] if p["imported"]}
    canonical_ids = [p["id"] for p in manifest["parts"] if p["imported"] and p["artwork_method"] == "canonical_visible_pixel_extraction"]
    hidden_only = {p for p in canonical_ids if index_part(index, p)["visible_pixel_count"] == 0}

    checks: list[dict[str, Any]] = []

    # ---- gate 3: inventory + reassembly ------------------------------------------------
    produced = {p["id"] for p in index["parts"]}
    checks.append(check("inventory_matches_plan", produced == set(planned), "error",
                        {"missing": sorted(set(planned) - produced), "unexpected": sorted(produced - set(planned))}))
    err = index["qa_seed"]["mean_absolute_rgba_error_at_work_resolution"]
    checks.append(check("reassembly_error_bounded", err < 1.0, "error",
                        {"mean_abs_error": err, "unassigned": index["qa_seed"]["unassigned_canonical_work_pixels"]}))

    # ---- load visible (own art) and final (art + band) masks ----------------------------
    visible: dict[str, np.ndarray] = {}
    final: dict[str, np.ndarray] = {}
    for pid in canonical_ids:
        visible[pid] = load_alpha(REV_ROOT / "masks" / f"{pid}_visible_mask.png")
        final[pid] = load_alpha(REV_ROOT / "final" / f"{pid}.png")
    # A mask that covers most of the canvas is a loader fault, not art (a greyscale mask read
    # as RGBA has alpha 255 everywhere). That failure once made every gate pass vacuously.
    oversized = {pid: float(m.mean()) for pid, m in visible.items() if m.mean() > 0.6}
    checks.append(check("masks_loaded_sanely", not oversized, "error",
                        {"visible_masks_covering_over_60pct_of_canvas": oversized}))
    if oversized:
        sys.exit(_finish(checks, [], [], index, hidden_only))

    # ---- gate 1: islands --------------------------------------------------------------
    # A leak is a small fragment embedded in ONE other part. A back layer that shows on
    # both sides of a foreground occluder (hair_back_base, skirt_back) is legitimately two
    # pieces, and each piece borders the occluder AND open canvas, so it is not embedded.
    owner = np.full(next(iter(visible.values())).shape, -1, dtype=np.int16)
    pid_index = {pid: i for i, pid in enumerate(canonical_ids)}
    for pid in sorted(canonical_ids, key=lambda p: planned[p]["z_index"]):
        owner[visible[pid]] = pid_index[pid]
    islands: list[dict[str, Any]] = []
    for pid in canonical_ids:
        if pid in ISLAND_EXEMPT or pid in hidden_only:
            continue
        m = visible[pid]
        labels, n = ndimage.label(m)
        if n <= 1:
            continue
        sizes = ndimage.sum(m, labels, range(1, n + 1)) * SCALE * SCALE
        order = np.argsort(sizes)[::-1]
        for k in order[1:]:
            if sizes[k] < ISLAND_MIN_PX or sizes[k] >= ISLAND_LEAK_FRACTION * sizes[order[0]]:
                continue
            island = labels == k + 1
            ring = ndimage.binary_dilation(island, iterations=1) & ~island
            neighbours = owner[ring]
            neighbours = neighbours[(neighbours >= 0) & (neighbours != pid_index[pid])]
            embedded = neighbours.size and np.bincount(neighbours).max() >= ISLAND_EMBED_MIN * ring.sum()
            if not embedded:
                continue
            host = canonical_ids[int(np.bincount(neighbours).argmax())]
            if pid in EXPLICIT_CLAIM or host in EXPLICIT_CLAIM:
                continue
            ys, xs = np.where(island)
            islands.append({"part": pid, "island_px": int(sizes[k]), "main_px": int(sizes[order[0]]), "embedded_in": host,
                            "bbox": [int(xs.min()) * SCALE, int(xs.max()) * SCALE, int(ys.min()) * SCALE, int(ys.max()) * SCALE]})
    checks.append(check("no_leaked_art_fragments", not islands, "error",
                        {"count": len(islands), "parts": sorted({i["part"] for i in islands}), "islands": islands}))

    # ---- gate 2: seams ----------------------------------------------------------------
    # Touching pairs are derived from the art, not from a hand list: two visible masks
    # whose 1-px dilations intersect share a boundary. For each such pair the lower-z
    # part must place painted pixels under the higher-z part's visible art.
    z = {pid: planned[pid]["z_index"] for pid in canonical_ids}
    grown = {pid: ndimage.binary_dilation(visible[pid], iterations=2) for pid in canonical_ids if visible[pid].any()}
    ids = [pid for pid in canonical_ids if pid in grown]
    # Distance from each part's own art, so "within R of the seam" needs no boundary crop.
    struct8 = ndimage.generate_binary_structure(2, 2)
    # A band is only ever placed on solid canonical pixels (alpha >= 200 at work resolution),
    # so only those count as coverable. Two parts meeting along the character's outline share
    # a contact of soft-edged pixels that no band can or should fill.
    canonical_path = RUN_ROOT / index["canonical"]["path"]
    with Image.open(canonical_path) as cim:
        work_alpha = np.asarray(cim.convert("RGBA").resize((cim.width // SCALE, cim.height // SCALE), Image.Resampling.LANCZOS))[..., 3]
    solid = work_alpha >= 200
    # The last solid pixels along the outline border only background; a band that reaches to
    # within two pixels of the silhouette has reached as far as a band can.
    interior = ndimage.binary_erosion(solid, iterations=2)
    seams: list[dict[str, Any]] = []
    min_seam_work = max(1, args.min_seam // SCALE)
    min_contact_work = 30      # shorter shared boundaries are corner contacts, not seams
    min_zone_work = 20         # fewer coverable pixels than this cannot tear visibly
    # Documented waivers: pairs the owner has reviewed and accepted, with a reason each.
    waivers_path = REV_ROOT / "qa" / "accepted_seams.json"
    waivers = json.loads(waivers_path.read_text(encoding="utf-8")) if waivers_path.exists() else {}

    def articulates(pid: str) -> bool:
        env = planned[pid].get("motion_envelope") or {}
        return int(env.get("rotate_deg") or 0) > 0

    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            contact = grown[a] & grown[b]
            if int(contact.sum()) < min_contact_work:
                continue
            lower, upper = (a, b) if z[a] < z[b] else (b, a)
            # A part clipped to its neighbour, or one that never rotates (blink, gaze, mouth,
            # toggle overlays), cannot reveal what is under the seam.
            if planned[upper].get("clipped_to") == lower or not (articulates(lower) or articulates(upper)):
                continue
            if upper in FACE_DETAIL and (lower in FACE_DETAIL or lower not in SURFACES):
                continue
            # Neighbour pixels reachable from the lower part's own art through solid pixels within
            # R steps. Euclidean nearness would also count a neighbour lying BESIDE the part along
            # the silhouette, over background, where nothing can or should be painted.
            reach = visible[lower]
            for _ in range(min_seam_work):
                reach = ndimage.binary_dilation(reach, structure=struct8) & solid
            zone = visible[upper] & reach & interior
            if int(zone.sum()) < min_zone_work:
                continue
            covered = final[lower] & zone
            coverage = float(covered.sum()) / float(zone.sum())
            key = f"{lower} -> {upper}"
            seams.append({"lower": lower, "upper": upper,
                          "near_seam_px": int(zone.sum()) * SCALE * SCALE,
                          "covered_px": int(covered.sum()) * SCALE * SCALE,
                          "coverage": round(coverage, 3), "ok": coverage >= SEAM_COVERAGE_MIN,
                          "waived": waivers.get(key) if coverage < SEAM_COVERAGE_MIN else None})
    torn = [s for s in seams if not s["ok"] and not s["waived"]]
    waived = [s for s in seams if not s["ok"] and s["waived"]]
    checks.append(check("every_touching_seam_has_band", not torn, "error",
                        {"min_seam_px": args.min_seam, "coverage_min": SEAM_COVERAGE_MIN, "pairs": len(seams), "torn": len(torn),
                         "torn_pairs": [f'{s["lower"]} -> {s["upper"]} ({s["coverage"]:.0%})' for s in torn],
                         "waived": {f'{s["lower"]} -> {s["upper"]}': {"coverage": s["coverage"], "reason": s["waived"]} for s in waived}}))

    return _finish(checks, seams, islands, index, hidden_only)


def _finish(checks, seams, islands, index, hidden_only) -> int:
    torn = [s for s in seams if not s["ok"] and not s.get("waived")]
    waived = [s for s in seams if not s["ok"] and s.get("waived")]
    failed = [c["id"] for c in checks if not c["passed"] and c["severity"] == "error"]
    report = {
        "schema_version": "1.0", "run_id": index["run_id"], "revision": REVISION,
        "stage": "03_parts", "status": "pass" if not failed else "fail",
        "checks": checks, "seams": seams,
        "hidden_only_parts": sorted(hidden_only),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    out = REV_ROOT / "qa" / "continuity_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")

    print(f"revision {REVISION}: {'PASS' if not failed else 'FAIL'}  ({len(seams)} touching pairs, {len(torn)} torn, {len(islands)} islands)")
    for c in checks:
        print(f"  [{'ok' if c['passed'] else 'FAIL'}] {c['id']}")
    for s in waived:
        print(f"      waived {s['lower']:<21} -> {s['upper']:<22} {s['coverage']:.0%}: {s['waived']}")
    for s in torn[:40]:
        print(f"      torn  {s['lower']:<22} -> {s['upper']:<22} covered {s['coverage']:.0%} of {s['near_seam_px']} px near the seam")
    for i in islands[:40]:
        print(f"      leak  {i['part']:<22} {i['island_px']} px inside {i['embedded_in']} at x{i['bbox'][0]}-{i['bbox'][1]} y{i['bbox'][2]}-{i['bbox'][3]}")
    print("wrote", out)
    return 1 if failed else 0


def index_part(index: dict[str, Any], pid: str) -> dict[str, Any]:
    for p in index["parts"]:
        if p["id"] == pid:
            return p
    raise KeyError(pid)


def check(check_id: str, passed: bool, severity: str, details: dict[str, Any]) -> dict[str, Any]:
    return {"id": check_id, "passed": bool(passed), "severity": severity, "details": details}


if __name__ == "__main__":
    sys.exit(main())
