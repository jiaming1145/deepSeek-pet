"""Round-trip check: rebuild faces from atlas.json + the atlas PNGs only (no access to the parts), the way a
texture-transform shader would, and compare against build_face.py's own composites.

usage: python verify_atlas.py
"""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
A = json.load(open(HERE + 'atlas.json'))

def load(name):
    return np.array(Image.open(HERE + name).convert('RGBA')).astype(np.float32)

def over(dst, src):
    sa = src[..., 3:4] / 255.0; da = dst[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa * 255.0], -1)

atlases = {k: load(v['file']) for k, v in A['atlases'].items()}
FW, FH = A['face']['size_px']

def blit_cell(face, atlas_key, row, state):
    """Cut the cell with its UV rect and place it so its anchor pixel lands on the region anchor."""
    at = A['atlases'][atlas_key]; img = atlases[atlas_key]
    cell = at['cells'][row][state]
    AW, AH = at['size_px']
    x0, y0 = int(round(cell['u'] * AW)), int(round(cell['v'] * AH))
    w, h = int(round(cell['w'] * AW)), int(round(cell['h'] * AH))
    sprite = img[y0:y0 + h, x0:x0 + w]
    ax, ay = at['anchor_in_cell_px']
    rx, ry = A['regions'][row]['anchor_px']
    px, py = int(round(rx - ax)), int(round(ry - ay))
    layer = np.zeros((FH, FW, 4), np.float32)
    sx0, sy0 = max(px, 0), max(py, 0); sx1, sy1 = min(px + w, FW), min(py + h, FH)
    layer[sy0:sy1, sx0:sx1] = sprite[sy0 - py:sy1 - py, sx0 - px:sx1 - px]
    return over(face, layer)

def blit_fx(face, name):
    c = A['atlases']['fx']['cells'][name]; img = atlases['fx']
    x0, y0, w, h = c['px']; sprite = img[y0:y0 + h, x0:x0 + w]
    bx0, by0 = c['face_bbox_px'][:2]
    layer = np.zeros((FH, FW, 4), np.float32)
    sx0, sy0 = max(bx0, 0), max(by0, 0); sx1, sy1 = min(bx0 + w, FW), min(by0 + h, FH)
    if sx1 > sx0 and sy1 > sy0:
        layer[sy0:sy1, sx0:sx1] = sprite[sy0 - by0:sy1 - by0, sx0 - bx0:sx1 - bx0]
    return over(face, layer)

base = load(A['face']['base_no_eyes_mouth'])

# 1. neutral round trip: base + verbatim brows already in base -> eyes open + mouth closed must equal neutral.png
face = base.copy()
face = blit_cell(face, 'eyes', 'eye_l', 'open'); face = blit_cell(face, 'eyes', 'eye_r', 'open')
face = blit_cell(face, 'mouth', 'mouth', 'closed')
ref = load('neutral.png')
d = np.abs(face - ref)
inside = ref[..., 3] > 0
print('neutral round trip: mean |diff| rgba = %.3f, p99.9 = %.2f, max = %.1f (over %d px)' % (d[inside].mean(), np.percentile(d[inside], 99.9), d[inside].max(), inside.sum()))
Image.fromarray(np.clip(face, 0, 255).astype(np.uint8), 'RGBA').save(HERE + '_scratch/roundtrip_neutral.png')

# 2. a mood built only from the atlas (cheerful) and one with FX outside the face png (confused: question mark)
face = load(A['face']['base_skin_nose'])
for s in ('l', 'r'):
    face = blit_cell(face, 'brows', f'brow_{s}', 'up'); face = blit_cell(face, 'eyes', f'eye_{s}', 'open')
face = blit_cell(face, 'mouth', 'mouth', 'open_wide')
face = blit_fx(face, 'blush_l'); face = blit_fx(face, 'blush_r')
Image.fromarray(np.clip(face, 0, 255).astype(np.uint8), 'RGBA').save(HERE + '_scratch/roundtrip_cheerful.png')
ref = load('_scratch/mood_cheerful.png')
d = np.abs(face - ref); inside = ref[..., 3] > 0
print('cheerful vs build composite: mean |diff| = %.3f, p99.9 = %.2f' % (d[inside].mean(), np.percentile(d[inside], 99.9)))
for k, c in A['atlases']['fx']['cells'].items():
    print('  fx %-14s cell %s anchor_px %s inside_face_png=%s kind=%s' % (k, c['px'], [round(v) for v in c['anchor_px']], c['inside_face_png'], c['kind']))
print('OK')
