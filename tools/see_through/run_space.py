"""Run See-through (single-image anime layer decomposition) through its Hugging Face Space.

    python tools/see_through/run_space.py --image <png> [--resolution 1024] [--seed 42] [--tblr] --out <dir>

The Space (24yearsold/see-through-demo, Apache-2.0 model by shitagaki-lab) runs on ZeroGPU and only accepts
signed-in users: one or two extractions per day per account. The token is read from ~/.ds/hf.token or
HF_TOKEN and is never printed or written anywhere. Outputs: <out>/<stem>.psd plus one PNG per layer from the
gallery and a layers.json with the captions.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time

TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".ds", "hf.token")


def token() -> str | None:
    t = os.environ.get("HF_TOKEN")
    if not t and os.path.exists(TOKEN_FILE):
        t = open(TOKEN_FILE, encoding="utf-8").read().strip()
    return t or None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--resolution", type=int, default=1024)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--tblr", action="store_true", help="left/right stratification instead of depth-based")
    p.add_argument("--out", required=True)
    p.add_argument("--space", default="24yearsold/see-through-demo")
    a = p.parse_args()
    from gradio_client import Client

    tok = token()
    print(f"token: {'present' if tok else 'none (anonymous; the Space rejects this)'}", file=sys.stderr)
    if tok:
        try:
            client = Client(a.space, token=tok)          # gradio_client >= 1.x
        except TypeError:
            client = Client(a.space, hf_token=tok)       # older releases
    else:
        client = Client(a.space)
    t0 = time.time()
    psd, gallery = client.predict(os.path.abspath(a.image), a.resolution, a.seed, a.tblr, api_name="/inference")
    os.makedirs(a.out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(a.image))[0]
    dst = os.path.join(a.out, stem + ".psd")
    shutil.copy(psd, dst)
    layers = []
    for i, g in enumerate(gallery or []):
        path = g.get("image") if isinstance(g, dict) else None
        if isinstance(path, dict):
            path = path.get("path")
        cap = (g.get("caption") if isinstance(g, dict) else None) or f"layer{i:02d}"
        if path and os.path.exists(path):
            name = f"{stem}_L{i:02d}_{''.join(ch if ch.isalnum() else '_' for ch in cap)[:28]}.png"
            shutil.copy(path, os.path.join(a.out, name))
            layers.append({"index": i, "caption": cap, "file": name})
    json.dump({"image": a.image, "resolution": a.resolution, "seed": a.seed, "tblr": a.tblr, "seconds": round(time.time() - t0, 1),
               "psd": os.path.basename(dst), "psd_bytes": os.path.getsize(dst), "layers": layers},
              open(os.path.join(a.out, stem + ".layers.json"), "w", encoding="utf-8"), indent=1)
    print(f"done in {time.time() - t0:.0f} s: {dst} ({os.path.getsize(dst) / 1e6:.1f} MB), {len(layers)} layer previews")


if __name__ == "__main__":
    main()
