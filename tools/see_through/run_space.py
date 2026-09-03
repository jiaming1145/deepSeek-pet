"""Run See-through (single-image anime layer decomposition) through its Hugging Face Space, raw HTTP API.

    python tools/see_through/run_space.py --image <png> [--resolution 768] [--seed 42] [--tblr] --out <dir>

Why raw HTTP: the Space runs Gradio 6.x and the Python gradio_client on this machine sends the file in a
shape the server rejects with a hidden exception; the documented HTTP flow (upload -> call -> event stream)
works. The Space (24yearsold/see-through-demo, Apache-2.0 model by shitagaki-lab) runs on ZeroGPU and only
serves signed-in users, one or two extractions a day per account. The token is read from ~/.ds/hf.token or
HF_TOKEN and is never printed. Outputs: <out>/<stem>_<res>.psd, the gallery PNGs, and a .json with timings.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import requests

TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".ds", "hf.token")
BASE = "https://24yearsold-see-through-demo.hf.space"


def token() -> str | None:
    t = os.environ.get("HF_TOKEN")
    if not t and os.path.exists(TOKEN_FILE):
        t = open(TOKEN_FILE, encoding="utf-8").read().strip()
    return t or None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--resolution", type=int, default=768, help="768..1280, multiple of 64; the Space allows 120 s of GPU per call")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--tblr", action="store_true", help="left/right stratification instead of depth-based")
    p.add_argument("--out", required=True)
    p.add_argument("--base", default=BASE)
    a = p.parse_args()
    tok = token()
    H = {"Authorization": f"Bearer {tok}"} if tok else {}
    print(f"token: {'present' if tok else 'none (the Space rejects anonymous calls)'}", file=sys.stderr)
    t0 = time.time()
    with open(a.image, "rb") as f:
        up = requests.post(a.base + "/gradio_api/upload", headers=H, files={"files": (os.path.basename(a.image), f, "image/png")}, timeout=180)
    up.raise_for_status()
    remote = up.json()[0]
    payload = {"data": [{"path": remote, "meta": {"_type": "gradio.FileData"}, "orig_name": os.path.basename(a.image)}, a.resolution, a.seed, a.tblr]}
    r = requests.post(a.base + "/gradio_api/call/inference", headers={**H, "Content-Type": "application/json"}, data=json.dumps(payload), timeout=60)
    r.raise_for_status()
    eid = r.json()["event_id"]
    result, error = None, None
    with requests.get(f"{a.base}/gradio_api/call/inference/{eid}", headers=H, stream=True, timeout=900) as s:
        event = None
        for line in s.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line.split(":", 1)[1].strip()
                if event == "complete":
                    result = json.loads(data)
                    break
                if event == "error":
                    error = data
                    break
    if error is not None or result is None:
        sys.exit(f"Space error after {time.time() - t0:.0f} s: {error or 'no result'} (quota is 1-2 runs/day; retry tomorrow or use Colab)")
    os.makedirs(a.out, exist_ok=True)
    stem = f"{os.path.splitext(os.path.basename(a.image))[0]}_{a.resolution}"
    psd_entry, gallery = result[0], result[1] or []
    psd_path = os.path.join(a.out, stem + ".psd")
    open(psd_path, "wb").write(requests.get(psd_entry["url"], headers=H, timeout=300).content)
    layers = []
    for i, g in enumerate(gallery):
        img = g.get("image") if isinstance(g, dict) else None
        url = (img or {}).get("url") if isinstance(img, dict) else None
        cap = (g.get("caption") if isinstance(g, dict) else None) or f"layer{i:02d}"
        if url:
            name = f"{stem}_L{i:02d}_{''.join(ch if ch.isalnum() else '_' for ch in cap)[:28]}.png"
            open(os.path.join(a.out, name), "wb").write(requests.get(url, headers=H, timeout=300).content)
            layers.append({"index": i, "caption": cap, "file": name})
    json.dump({"image": a.image, "resolution": a.resolution, "seed": a.seed, "tblr": a.tblr, "seconds": round(time.time() - t0, 1),
               "psd": os.path.basename(psd_path), "psd_bytes": os.path.getsize(psd_path), "layers": layers},
              open(os.path.join(a.out, stem + ".json"), "w", encoding="utf-8"), indent=1)
    print(f"done in {time.time() - t0:.0f} s: {psd_path} ({os.path.getsize(psd_path) / 1e6:.1f} MB), {len(layers)} gallery layers")


if __name__ == "__main__":
    main()
