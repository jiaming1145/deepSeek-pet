"""Export every v005 part at 1/4 scale with its draw order, plus the geometry a procedural rig
needs: per-part centroid, bbox and edge midpoints, and joint positions derived from where
neighbouring parts overlap (the elbow is literally the centroid of sleeve_upper's band under
sleeve_lower). No hand-placed numbers.

    python spikes/character/build_assets.py [v005]
"""
import json
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
REV = sys.argv[1] if len(sys.argv) > 1 else 'v005'
RUN = r'D:/ds/runs/deepseek_humanized_20260830_001'
REVD = f'{RUN}/03_parts/revisions/{REV}'
OUT = os.path.dirname(os.path.abspath(__file__))
S = 4

man = json.load(open(f'{RUN}/02_parts_plan/revisions/v001/part_manifest.json', encoding='utf-8'))
parts = [p for p in man['parts'] if p['imported']]
os.makedirs(os.path.join(OUT, 'parts'), exist_ok=True)

_alpha = {}


def alpha(pid, kind='final'):
    key = (pid, kind)
    if key not in _alpha:
        path = f'{REVD}/final/{pid}.png' if kind == 'final' else f'{REVD}/masks/{pid}_{kind}_mask.png'
        with Image.open(path) as im:
            a = np.asarray(im.getchannel('A') if im.mode == 'RGBA' else im)
        _alpha[key] = a[::S, ::S] > 8
    return _alpha[key]


def geom(mask):
    ys, xs = np.where(mask)
    if xs.size == 0:
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    def edge(sel):
        return [float(xs[sel].mean()), float(ys[sel].mean())] if sel.any() else None
    h, w = y1 - y0 + 1, x1 - x0 + 1
    return {
        'bbox': [x0, y0, x1, y1], 'centroid': [float(xs.mean()), float(ys.mean())], 'px': int(xs.size),
        'top': edge(ys <= y0 + max(2, h * 0.08)), 'bottom': edge(ys >= y1 - max(2, h * 0.08)),
        'left': edge(xs <= x0 + max(2, w * 0.08)), 'right': edge(xs >= x1 - max(2, w * 0.08)),
    }


manifest = {'canvas': [1024, 2048], 'scale': S, 'revision': REV, 'parts': {}, 'geometry': {}, 'joints': {}}
for p in sorted(parts, key=lambda p: p['z_index']):
    pid = p['id']
    with Image.open(f'{REVD}/final/{pid}.png') as im:
        im = im.convert('RGBA')
        bb = im.getbbox()
        if not bb:
            continue
        c = im.crop(bb).resize((max(1, (bb[2] - bb[0]) // S), max(1, (bb[3] - bb[1]) // S)), Image.LANCZOS)
        c.save(os.path.join(OUT, 'parts', pid + '.png'))
    manifest['parts'][pid] = {'file': pid + '.png', 'x': bb[0] // S, 'y': bb[1] // S, 'w': c.size[0], 'h': c.size[1],
                              'z': p['z_index'], 'generated': p['artwork_method'] == 'generated_expression_overlay',
                              'category': p.get('category'), 'motion_role': p.get('motion_role')}
    g = None if manifest['parts'][pid]['generated'] else geom(alpha(pid, 'visible'))
    if g is None or g['px'] < 50:      # hidden-only or nearly so: use the part's whole art (its band)
        g = geom(alpha(pid))
    if g:
        manifest['geometry'][pid] = g
    print(f'{pid:<26} z{p["z_index"]:>5}  {c.size[0]}x{c.size[1]}', file=sys.stderr)


def overlap_joint(name, lower, upper):
    """Centroid of the lower part's final art under the upper part's own art."""
    try:
        m = alpha(lower, 'final') & alpha(upper, 'visible')
    except FileNotFoundError:
        return
    if m.sum() < 8:
        return
    ys, xs = np.where(m)
    manifest['joints'][name] = [float(xs.mean()), float(ys.mean())]


for side in ('l', 'r'):
    overlap_joint(f'elbow_{side}', f'sleeve_upper_{side}', f'sleeve_lower_{side}')
    overlap_joint(f'wrist_{side}', f'sleeve_lower_{side}', f'cuff_{side}')
    overlap_joint(f'hand_{side}', f'cuff_{side}', f'hand_{side}')
    overlap_joint(f'ankle_{side}', f'stocking_{side}', f'shoe_{side}')
    overlap_joint(f'shoulder_{side}', f'dress_torso', f'sleeve_upper_{side}')
overlap_joint('tail_base', 'tail_root', 'tail_stock')
if 'tail_base' not in manifest['joints']:
    manifest['joints']['tail_base'] = manifest['geometry']['tail_root']['centroid']
overlap_joint('tail_fork_upper', 'tail_stock', 'tail_fluke_upper')
overlap_joint('tail_fork_lower', 'tail_stock', 'tail_fluke_lower')
overlap_joint('neck', 'head_base', 'collar_frill_l')

json.dump(manifest, open(os.path.join(OUT, 'parts', 'manifest.json'), 'w'), indent=1)
print(f'{len(manifest["parts"])} parts, {len(manifest["joints"])} derived joints:', {k: [round(v[0]), round(v[1])] for k, v in manifest['joints'].items()})
