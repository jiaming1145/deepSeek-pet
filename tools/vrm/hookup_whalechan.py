"""hookup_whalechan.py - one command from a generator's rigged GLB to a proven Whale-chan VRM.

  python tools/vrm/hookup_whalechan.py --glb spikes/model/generated/tripo/whalechan_rigged.glb

Everything lands in tools/vrm/out/whalechan/<timestamp>/ :

  probe.json / probe.log          what build_vrm.py will see (bbox, facing, pose, bones, materials)
  chains.resolved.json            chains.whalechan.json with every 'frac' box resolved to metres
  whalechan.vrm (+ .manifest.json, build.log)
  manifest.txt / manifest.json    vrm_manifest.py output
  renders/turn_{000,090,180,270}.png, renders/posed_{090,180}.png, renders/head_000_head.png
  compare_sheet.png               model render beside the accepted turnaround view, all 4 views
  sheet_posed.png                 posed-tail frames + head close-up
  summary.json / hookup.log       what ran, what was chosen, what to look at

Steps (each is a separate headless Blender run except the manifest and the sheets):
  1. probe_glb.py            -> abort early on missing humanoid bones; detect facing / pose / shape keys
  2. resolve chains          -> frac boxes (fractions of height) -> absolute bbox after --height scaling;
                                object / material hints promoted when the GLB actually has them
  3. build_vrm.py            -> --chains, face texture (face-bridge output if present, else neutral.png),
                                MToon, --height, --force-tpose, --auto-morphs
  4. vrm_manifest.py
  5. render_turnaround.py    -> 4-angle turnaround, posed-tail frames, head close-up
  6. compare sheet           -> PIL, next to spikes/model/turnaround/{front,right,back,left}.png

Plain Python 3 (PIL for the sheets). Blender path: --blender or BLENDER_EXE, default Blender 5.2.
Exit code 0 only when every step ran; the summary lists per-chain vertex counts and empty selectors.
"""

import argparse
import datetime as dt
import json
import os
import re
import hashlib
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
FACE_DIR = os.path.join(REPO, "spikes", "model", "face")
TURN_DIR = os.path.join(REPO, "spikes", "model", "turnaround")
VIEWS = [("front", 0), ("right", 90), ("back", 180), ("left", 270)]  # yaw as render_turnaround.py counts it

LOG_LINES = []


def log(msg):
    line = f"[hookup] {msg}"
    print(line, flush=True)
    LOG_LINES.append(line)


def file_sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def parse_args():
    p = argparse.ArgumentParser(prog="hookup_whalechan.py", description=__doc__.split("\n\n")[0])
    p.add_argument("--glb", required=True, help="rigged GLB/FBX from Tripo/Meshy (or the stock GLB)")
    p.add_argument("--out", default=os.path.join(HERE, "out", "whalechan"), help="output root (a timestamp folder is created inside)")
    p.add_argument("--run-name", default=None, help="folder name instead of the timestamp")
    p.add_argument("--chains", default=os.path.join(HERE, "chains.whalechan.json"))
    p.add_argument("--height", type=float, default=None, help="chibi height in metres (default: chains file 'height', else 1.0)")
    p.add_argument("--face-material", default=r"face|skin_face|head", help="regex for the face material")
    p.add_argument("--face-dir", default=FACE_DIR, help="where face_texture.png / face_atlas_states.json / neutral.png live")
    p.add_argument("--no-face", action="store_true", help="skip the face texture entirely")
    p.add_argument("--no-tpose", action="store_true", help="do not pass --force-tpose")
    p.add_argument("--no-auto-morphs", action="store_true")
    p.add_argument("--name", default="Whale-chan")
    p.add_argument("--author", default="owner")
    p.add_argument("--pose-tail", type=float, default=35.0, help="degrees for the posed-tail render")
    p.add_argument("--render-size", default="640x900")
    p.add_argument("--skip-renders", action="store_true")
    p.add_argument("--skip-window", action="store_true", help="do not run the Electron action-lab capture on the produced VRM")
    p.add_argument("--blender", default=os.environ.get("BLENDER_EXE", DEFAULT_BLENDER))
    return p.parse_args()


# ----------------------------------------------------------------------------------------------
# blender runner
# ----------------------------------------------------------------------------------------------
def run_blender(blender, script, script_args, log_path, label):
    cmd = [blender, "--background", "--python", os.path.join(HERE, script), "--"] + [str(a) for a in script_args]
    log(f"{label}: {' '.join(cmd)}")
    t0 = time.time()
    with open(log_path, "w", encoding="utf-8", errors="replace") as f:
        f.write("$ " + " ".join(cmd) + "\n\n")
        f.flush()
        p = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=REPO)
    dtime = time.time() - t0
    with open(log_path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    tagged = [ln for ln in text.splitlines() if re.match(r"^\[(probe|build_vrm|render|stock)\]", ln)]
    log(f"{label}: exit {p.returncode} in {dtime:.1f} s, {len(tagged)} tagged log lines -> {os.path.relpath(log_path, REPO)}")
    if p.returncode != 0:
        tail = "\n".join(text.splitlines()[-30:])
        log(f"{label} FAILED; log tail:\n{tail}")
        raise SystemExit(f"{label} failed (exit {p.returncode}); see {log_path}")
    return text


# ----------------------------------------------------------------------------------------------
# chain resolution
# ----------------------------------------------------------------------------------------------
def resolve_chains(spec, probe, height):
    """Turn every 'frac' box (fractions of height) into an absolute Blender-world bbox for build_vrm.py."""
    lo, hi = probe["bbox"]["min"], probe["bbox"]["max"]
    h0 = hi[2] - lo[2]
    s = height / h0 if h0 > 0 else 1.0  # build_vrm scales about the world origin, so bbox' = bbox * s
    lo = [v * s for v in lo]
    hi = [v * s for v in hi]
    # symmetry centre: the hips bone (a raised or asymmetric arm skews the bbox centre; the stock
    # Seed-san's mechanical arm shifts it by 0.25 m), bbox centre if the rig has none
    hips = probe.get("humanoid", {}).get("world_head_positions", {}).get("hips")
    if hips:
        cx, centre_src = hips[0] * s, "hips bone"
    else:
        cx, centre_src = (lo[0] + hi[0]) / 2, "bbox centre"
    facing = probe.get("facing") or "-Y"
    H = height
    mesh_names = [m["name"] for m in probe["meshes"]]
    mat_names = [m["name"] for m in probe["materials"]]
    resolved = {"colliders": spec.get("colliders", True), "chains": [], "_resolution": []}
    for c in spec["chains"]:
        c = dict(c)
        prefer = c.pop("prefer", {}) or {}
        frac = c.pop("frac", None)
        frac_mat = c.pop("frac_material", None)
        c.pop("_why", None)
        route = "bbox"
        obj_hits = [n for n in mesh_names if prefer.get("object") and re.search(prefer["object"], n, re.I)]
        mat_hits = [n for n in mat_names if prefer.get("material") and re.search(prefer["material"], n, re.I)]
        box_src = frac
        sel = {}
        if obj_hits:
            route = "object"
            sel["object"] = prefer["object"]
        elif mat_hits:
            route = "material+bbox"
            sel["material"] = prefer["material"]
            box_src = frac_mat or frac
        if route != "object" and box_src:
            fx, fd, fz = box_src["x"], box_src["depth"], box_src["z"]
            x0, x1 = cx + fx[0] * H, cx + fx[1] * H
            z0, z1 = lo[2] + fz[0] * H, lo[2] + fz[1] * H
            if facing == "+Y":  # front plane is the bbox max y; depth grows towards -Y
                y0, y1 = hi[1] - fd[1] * H, hi[1] - fd[0] * H
            else:  # facing -Y (glTF +Z forward): front plane is the bbox min y
                y0, y1 = lo[1] + fd[0] * H, lo[1] + fd[1] * H
            sel["bbox"] = {"min": [round(x0, 4), round(y0, 4), round(z0, 4)], "max": [round(x1, 4), round(y1, 4), round(z1, 4)]}
        c["select"] = sel
        resolved["chains"].append(c)
        resolved["_resolution"].append({"name": c["name"], "route": route, "object_hits": obj_hits, "material_hits": mat_hits,
                                        "frac_used": box_src if route != "object" else None, "select": sel})
    resolved["_frame"] = {"height_target": H, "scale_applied": round(s, 5), "bbox_scaled_min": [round(v, 4) for v in lo],
                          "bbox_scaled_max": [round(v, 4) for v in hi], "centre_x": round(cx, 4), "centre_source": centre_src, "facing": facing}
    return resolved


# ----------------------------------------------------------------------------------------------
# face inputs
# ----------------------------------------------------------------------------------------------
def pick_face(face_dir):
    """Prefer the face-bridge output (face_texture.png + face_atlas_states.json); else neutral.png."""
    tex = os.path.join(face_dir, "face_texture.png")
    atlas = os.path.join(face_dir, "face_atlas_states.json")
    if os.path.exists(tex) and os.path.exists(atlas):
        return {"texture": tex, "atlas": atlas, "mode": "bridge"}
    if os.path.exists(tex):
        return {"texture": tex, "atlas": None, "mode": "bridge-texture-only"}
    neutral = os.path.join(face_dir, "neutral.png")
    if os.path.exists(neutral):
        return {"texture": neutral, "atlas": None, "mode": "fallback-neutral"}
    return {"texture": None, "atlas": None, "mode": "none"}


# ----------------------------------------------------------------------------------------------
# sheets
# ----------------------------------------------------------------------------------------------
def load_font(size):
    from PIL import ImageFont

    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:  # noqa: BLE001
            continue
    return ImageFont.load_default()


def compare_sheet(renders_dir, out_path, title):
    from PIL import Image, ImageDraw

    tiles = []
    for view, yaw in VIEWS:
        ref_p = os.path.join(TURN_DIR, f"{view}.png")
        ren_p = os.path.join(renders_dir, f"turn_{yaw:03d}.png")
        ref = Image.open(ref_p).convert("RGB") if os.path.exists(ref_p) else None
        ren = Image.open(ren_p).convert("RGB") if os.path.exists(ren_p) else None
        tiles.append((view, yaw, ref, ren))
    tile_h = 900
    pad, label_h = 24, 54
    font, small = load_font(30), load_font(20)
    sized = []
    for view, yaw, ref, ren in tiles:
        parts = []
        for img, tag in ((ref, "reference"), (ren, f"model render yaw {yaw}")):
            if img is None:
                blank = Image.new("RGB", (int(tile_h * 0.7), tile_h), (230, 230, 230))
                ImageDraw.Draw(blank).text((20, 20), f"missing {tag}", fill=(120, 0, 0), font=small)
                parts.append((blank, tag))
            else:
                w = int(img.width * tile_h / img.height)
                parts.append((img.resize((w, tile_h), Image.LANCZOS), tag))
        sized.append((view, parts))
    tile_w = max(sum(p.width for p, _ in parts) + pad for _, parts in sized)
    cols, rows = 2, 2
    W = cols * tile_w + (cols + 1) * pad
    Hh = rows * (tile_h + label_h) + (rows + 1) * pad + 70
    sheet = Image.new("RGB", (W, Hh), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.text((pad, pad), title, fill=(20, 20, 20), font=font)
    for i, (view, parts) in enumerate(sized):
        cx = pad + (i % cols) * (tile_w + pad)
        cy = 70 + pad + (i // rows) * (tile_h + label_h + pad)
        d.text((cx, cy), f"{view.upper()}  -  reference (left) vs model render (right)", fill=(30, 30, 30), font=small)
        x = cx
        for img, tag in parts:
            sheet.paste(img, (x, cy + label_h - 20))
            d.text((x + 6, cy + label_h - 20 + tile_h - 28), tag, fill=(90, 90, 90), font=small)
            x += img.width
    sheet.save(out_path)
    return out_path


def posed_sheet(renders_dir, out_path, title):
    from PIL import Image, ImageDraw

    names = [("posed_090.png", "posed tail, right side"), ("posed_180.png", "posed tail, back"), ("head_000_head.png", "head close-up (face material)")]
    imgs = []
    for fn, tag in names:
        pth = os.path.join(renders_dir, fn)
        if os.path.exists(pth):
            im = Image.open(pth).convert("RGB")
            im = im.resize((int(im.width * 900 / im.height), 900), Image.LANCZOS)
            imgs.append((im, tag))
    if not imgs:
        return None
    pad = 24
    W = sum(i.width for i, _ in imgs) + pad * (len(imgs) + 1)
    sheet = Image.new("RGB", (W, 900 + 120), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.text((pad, pad), title, fill=(20, 20, 20), font=load_font(30))
    x = pad
    for im, tag in imgs:
        sheet.paste(im, (x, 90))
        d.text((x + 6, 90 + 900 - 28), tag, fill=(90, 90, 90), font=load_font(20))
        x += im.width + pad
    sheet.save(out_path)
    return out_path


# ----------------------------------------------------------------------------------------------
def run_window_capture(run, vrm, summary):
    """Load the produced VRM in the action lab (real transparent Electron window), capture every
    action and emotion, build the sheets, and copy them into the run folder."""
    desktop = os.path.join(REPO, "apps", "desktop")
    lab = os.path.join(REPO, "spikes", "vrm", "actions")
    log_path = os.path.join(run, "window.log")
    cmd = ["npx", "electron", os.path.relpath(os.path.join(lab, "main.js"), desktop), "--capture", "--vrm", os.path.abspath(vrm)]
    log("window: " + " ".join(cmd))
    with open(log_path, "w", encoding="utf-8") as f:
        p = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=desktop, shell=(os.name == "nt"))
    out = open(log_path, encoding="utf-8", errors="replace").read()
    if p.returncode != 0:
        raise SystemExit(f"window capture failed (exit {p.returncode}); see {log_path}")
    sheets = []
    try:
        subprocess.run([sys.executable, os.path.join(lab, "make_sheet.py")], check=True, cwd=lab,
                       stdout=open(log_path, "a", encoding="utf-8"), stderr=subprocess.STDOUT)
        for name in ("sheet_actions.png", "sheet_emotions.png"):
            src = os.path.join(lab, "evidence", name)
            if os.path.exists(src):
                dst = os.path.join(run, "window_" + name)
                shutil.copyfile(src, dst)
                sheets.append(dst)
    except Exception as e:  # noqa: BLE001
        log(f"window: sheet build failed: {e}")
    report = os.path.join(lab, "shots", "report.json")
    if os.path.exists(report):
        shutil.copyfile(report, os.path.join(run, "window_report.json"))
    summary["steps"]["window"] = {"log": log_path, "sheets": sheets, "renderer_error": ("RENDERER ERROR" in out)}
    log(f"window: {len(sheets)} sheets copied; renderer error: {'RENDERER ERROR' in out}")


def main():
    a = parse_args()
    glb = os.path.abspath(a.glb)
    if not os.path.exists(glb):
        raise SystemExit(f"input not found: {glb}")
    if not os.path.exists(a.blender):
        raise SystemExit(f"Blender not found: {a.blender} (pass --blender or set BLENDER_EXE)")
    with open(a.chains, encoding="utf-8") as f:
        chain_spec = json.load(f)
    height = a.height or float(chain_spec.get("height", 1.0))

    stamp = a.run_name or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run = os.path.abspath(os.path.join(a.out, stamp))
    renders = os.path.join(run, "renders")
    os.makedirs(renders, exist_ok=True)
    summary = {"input": glb, "run_dir": run, "started": dt.datetime.now().isoformat(timespec="seconds"),
               "height": height, "steps": {}, "warnings": []}
    log(f"input {glb}")
    log(f"run folder {run}")
    t_all = time.time()

    # 1. probe -------------------------------------------------------------------------------
    probe_json = os.path.join(run, "probe.json")
    run_blender(a.blender, "probe_glb.py", ["--input", glb, "--out", probe_json], os.path.join(run, "probe.log"), "probe")
    with open(probe_json, encoding="utf-8") as f:
        probe = json.load(f)
    summary["steps"]["probe"] = {"height": probe["height"], "width": probe["width"], "depth": probe["depth"],
                                 "facing": probe["facing"], "rest_pose": probe["rest_pose"],
                                 "bones": probe["armature"]["bone_count"], "humanoid_mapped": probe["humanoid"]["mapped_count"],
                                 "missing_required": probe["humanoid"]["missing_required"], "meshes": len(probe["meshes"]),
                                 "materials": len(probe["materials"]), "triangles": probe["triangles"],
                                 "shape_keys": sorted({k for m in probe["meshes"] for k in m["shape_keys"]})[:20],
                                 "warnings": probe["warnings"]}
    for w in probe["warnings"]:
        log(f"probe warning: {w}")
        summary["warnings"].append("probe: " + w)
    if probe["humanoid"]["missing_required"]:
        raise SystemExit(f"required humanoid bones missing: {probe['humanoid']['missing_required']} - fix the rig first (see CHECKLIST_incoming_glb.md)")
    log(f"probe: height {probe['height']} (w/h {probe['width_over_height']}, d/h {probe['depth_over_height']}), facing {probe['facing']}, "
        f"rest pose {probe['rest_pose']} {probe['upper_arm_angles_deg']}, {probe['armature']['bone_count']} bones, "
        f"{probe['humanoid']['mapped_count']} mapped, {len(probe['meshes'])} meshes, {len(probe['materials'])} materials")

    # 2. chains ------------------------------------------------------------------------------
    resolved = resolve_chains(chain_spec, probe, height)
    chains_path = os.path.join(run, "chains.resolved.json")
    with open(chains_path, "w", encoding="utf-8") as f:
        json.dump(resolved, f, indent=2)
    for r in resolved["_resolution"]:
        log(f"chain {r['name']:12s} route={r['route']:14s} object_hits={r['object_hits']} material_hits={r['material_hits']}")
    summary["steps"]["chains"] = {"file": chains_path, "frame": resolved["_frame"],
                                  "routes": {r["name"]: r["route"] for r in resolved["_resolution"]}}

    # 3. face --------------------------------------------------------------------------------
    face = pick_face(a.face_dir) if not a.no_face else {"texture": None, "atlas": None, "mode": "disabled"}
    face_mats = [m["name"] for m in probe["materials"] if re.search(a.face_material, m["name"], re.I)]
    face_args = []
    if face["texture"]:
        if not face_mats:
            msg = f"no material matches --face-material {a.face_material!r} ({[m['name'] for m in probe['materials']]}); face texture skipped"
            log("WARNING " + msg)
            summary["warnings"].append(msg)
            face["mode"] += "+skipped-no-material"
        else:
            if len(face_mats) > 1:
                msg = f"--face-material {a.face_material!r} matches {face_mats}; build_vrm.py applies the FIRST ({face_mats[0]}). Pass a stricter regex if that is not her face."
                log("WARNING " + msg)
                summary["warnings"].append(msg)
            face_args = ["--face-material", a.face_material, "--face-texture", face["texture"]]
            if face["atlas"]:
                face_args += ["--face-atlas", face["atlas"]]
            if face["mode"] == "fallback-neutral":
                msg = ("face-bridge output (face_texture.png + face_atlas_states.json) not found in "
                       f"{a.face_dir}; using neutral.png as a plain face texture (no atlas expressions)")
                log("NOTE " + msg)
                summary["warnings"].append(msg)
    else:
        log(f"face: {face['mode']}")
    face["material_matches"] = face_mats
    face["applied_material"] = face_mats[0] if face_args else None  # build_vrm takes the first match
    summary["steps"]["face"] = face
    log(f"face: mode={face['mode']} texture={face['texture']} atlas={face['atlas']} material={face['applied_material']}")

    # 4. build -------------------------------------------------------------------------------
    vrm = os.path.join(run, "whalechan.vrm")
    # MToon outline width is in world metres; 1.2 mm suits a 1.6 m figure, so scale it with the
    # chibi's height or the outline thickens relative to the face and brackets the lips.
    outline_m = 0.0012 * (float(height) / 1.6)
    build_args = ["--input", glb, "--output", vrm, "--chains", chains_path, "--height", height,
                  "--outline-width", f"{outline_m:.5f}",
                  "--name", a.name, "--author", a.author] + face_args
    if not a.no_tpose:
        build_args.append("--force-tpose")
    if not a.no_auto_morphs:
        build_args.append("--auto-morphs")
    build_log = run_blender(a.blender, "build_vrm.py", build_args, os.path.join(run, "build.log"), "build")
    chain_counts = {}
    for m in re.finditer(r"\[build_vrm\] chain (\S+): (\d+) verts, axis=\(([^)]*)\), length=([\d.]+)", build_log):
        chain_counts[m.group(1)] = {"verts": int(m.group(2)), "axis": [float(x) for x in m.group(3).split(",")], "length_m": float(m.group(4))}
    for m in re.finditer(r"\[build_vrm\] chain (\S+): (selector matched no vertices|parent bone .* not found); skipping", build_log):
        chain_counts[m.group(1)] = {"verts": 0, "skipped": m.group(2)}
        summary["warnings"].append(f"chain {m.group(1)} skipped: {m.group(2)}")
    tpose_line = next((ln for ln in build_log.splitlines() if ln.startswith("[build_vrm] force-tpose")), None)
    if not a.no_tpose and tpose_line is None:
        tpose_line = "force-tpose: no log line from build_vrm.py (unexpected)"
    face_line = next((ln for ln in build_log.splitlines() if "face texture ->" in ln or "face material:" in ln), None)
    height_line = next((ln for ln in build_log.splitlines() if "height normalised" in ln), None)
    summary["steps"]["build"] = {"vrm": vrm, "bytes": os.path.getsize(vrm), "chains": chain_counts,
                                 "build_vrm_py_sha1": file_sha1(os.path.join(HERE, "build_vrm.py")),
                                 "force_tpose": tpose_line, "face": face_line, "height": height_line}
    for name, info in chain_counts.items():
        log(f"build chain {name:12s} {info}")
    if tpose_line:
        log("build " + tpose_line.replace("[build_vrm] ", ""))
        if "skipped" in tpose_line:
            summary["warnings"].append(tpose_line.replace("[build_vrm] ", ""))

    # 5. manifest ----------------------------------------------------------------------------
    man_json = os.path.join(run, "manifest.json")
    r = subprocess.run([sys.executable, os.path.join(HERE, "vrm_manifest.py"), vrm, "--json", man_json],
                       capture_output=True, text=True, cwd=REPO)
    with open(os.path.join(run, "manifest.txt"), "w", encoding="utf-8") as f:
        f.write(r.stdout + (("\n[stderr]\n" + r.stderr) if r.stderr else ""))
    if r.returncode != 0:
        raise SystemExit(f"vrm_manifest.py failed: {r.stderr}")
    with open(man_json, encoding="utf-8") as f:
        man = json.load(f)
    summary["steps"]["manifest"] = {"spec": man["vrmSpecVersion"], "bones": man["boneCount"], "humanoid": man["humanoidCount"],
                                    "springs": [(s["name"], len(s["joints"])) for s in man["springs"]],
                                    "colliders": man["springColliders"], "expressions_preset": len(man["expressions"]["preset"]),
                                    "expressions_custom": len(man["expressions"]["custom"]),
                                    "materials_mtoon": sum(1 for m in man["materials"] if m["mtoon"]), "materials": len(man["materials"]),
                                    "triangles": man["triangleCount"]}
    log(f"manifest: VRM {man['vrmSpecVersion']}, {man['boneCount']} joints, {man['humanoidCount']} humanoid, "
        f"{len(man['springs'])} springs {[(s['name'], len(s['joints'])) for s in man['springs']]}, "
        f"{len(man['expressions']['preset'])} preset expr, mtoon {sum(1 for m in man['materials'] if m['mtoon'])}/{len(man['materials'])}")

    # 6. renders -----------------------------------------------------------------------------
    if not a.skip_renders:
        run_blender(a.blender, "render_turnaround.py", ["--vrm", vrm, "--outdir", renders, "--prefix", "turn", "--size", a.render_size],
                    os.path.join(run, "render_turn.log"), "render turnaround")
        run_blender(a.blender, "render_turnaround.py", ["--vrm", vrm, "--outdir", renders, "--prefix", "posed", "--pose-tail", a.pose_tail,
                                                       "--angles", "90,180", "--size", a.render_size],
                    os.path.join(run, "render_posed.log"), "render posed tail")
        run_blender(a.blender, "render_turnaround.py", ["--vrm", vrm, "--outdir", renders, "--prefix", "head", "--angles", "0",
                                                       "--focus", "head", "--size", "640x640"],
                    os.path.join(run, "render_head.log"), "render head")
        summary["steps"]["renders"] = sorted(os.listdir(renders))
        # 7. sheets
        sheet = compare_sheet(renders, os.path.join(run, "compare_sheet.png"),
                              f"{a.name} hookup {stamp}  -  {os.path.basename(glb)}  vs  spikes/model/turnaround")
        posed = posed_sheet(renders, os.path.join(run, "sheet_posed.png"), f"{a.name} hookup {stamp}  -  posed tail {a.pose_tail} deg, head close-up")
        summary["steps"]["sheets"] = {"compare": sheet, "posed": posed}
        log(f"compare sheet {sheet}")
    else:
        summary["steps"]["renders"] = "skipped"

    summary["elapsed_s"] = round(time.time() - t_all, 1)
    summary["finished"] = dt.datetime.now().isoformat(timespec="seconds")
    # 6. show it moving in the real window --------------------------------------------------
    if not a.skip_window:
        try:
            run_window_capture(run, vrm, summary)
        except SystemExit as e:
            log(f"WARNING {e}")
            summary["warnings"].append(str(e))
    with open(os.path.join(run, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    with open(os.path.join(run, "hookup.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(LOG_LINES) + "\n")
    # convenience: latest pointer
    try:
        latest = os.path.join(a.out, "LATEST.txt")
        with open(latest, "w", encoding="utf-8") as f:
            f.write(run + "\n")
    except OSError:
        pass
    log(f"DONE in {summary['elapsed_s']} s. Look at: {os.path.join(run, 'compare_sheet.png')}")
    if summary["warnings"]:
        log(f"{len(summary['warnings'])} warning(s):")
        for w in summary["warnings"]:
            log("  - " + w)


if __name__ == "__main__":
    main()
