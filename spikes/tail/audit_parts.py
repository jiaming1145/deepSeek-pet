"""Audit every extracted part for the two defect classes the tail spike exposed.

D2-class: a part containing a disconnected island of art that belongs to another part.
          Invisible at rest, flies off the moment the part moves.
D1-class: two parts that must deform together but share no overlapping pixels, so the
          seam between them tears open under rotation.

Neither is detectable by the current parts QA, which gates on reassembly error against
the canonical -- a check that is by construction blind to both.

Run:  python spikes/tail/audit_parts.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:
    sys.exit('needs scipy: pip install scipy')

Image.MAX_IMAGE_PIXELS = None
RUN = 'runs/deepseek_humanized_20260830_001'
REV = sys.argv[1] if len(sys.argv) > 1 else 'v001'   # parts revision to audit
FINAL = os.path.join(RUN, '03_parts/revisions/%s/final' % REV)

# Parts that must deform as a continuous surface. Each tuple is a chain; consecutive
# members need an overlap band or the seam tears. Taken from the deformer hierarchy in
# docs/INTERACTION_RIG.md, mapped onto the part names that actually shipped.
CHAINS = [
    ('spine',      ['hip_base', 'torso_base', 'neck', 'head_base']),
    ('arm_l',      ['shoulder_l', 'upper_arm_l', 'forearm_l', 'hand_l']),
    ('arm_r',      ['shoulder_r', 'upper_arm_r', 'forearm_r', 'hand_r']),
    ('sleeve_l',   ['sleeve_upper_l', 'sleeve_lower_l', 'cuff_l']),
    ('sleeve_r',   ['sleeve_upper_r', 'sleeve_lower_r', 'cuff_r']),
    ('leg_l',      ['hip_base', 'thigh_l', 'lower_leg_l', 'foot_l']),
    ('leg_r',      ['hip_base', 'thigh_r', 'lower_leg_r', 'foot_r']),
    ('hosiery_l',  ['stocking_l', 'shoe_l']),
    ('hosiery_r',  ['stocking_r', 'shoe_r']),
    ('tail',       ['tail_root', 'tail_stock', 'tail_fluke_upper']),
    ('tail_lower', ['tail_stock', 'tail_fluke_lower']),
]

ORPHAN_MIN = 300      # islands smaller than this are antialiasing crumbs
ALPHA_MIN = 8

_cache = {}


def mask(name):
    if name not in _cache:
        p = os.path.join(FINAL, name + '.png')
        if not os.path.exists(p):
            _cache[name] = None
        else:
            im = Image.open(p)
            _cache[name] = np.array(im.convert('RGBA'))[..., 3] > ALPHA_MIN
            im.close()
    return _cache[name]


def main():
    names = sorted(f[:-4] for f in os.listdir(FINAL) if f.endswith('.png'))
    print('auditing %d parts in %s\n' % (len(names), FINAL))

    orphans = []
    for n in names:
        m = mask(n)
        if m is None or not m.any():
            continue
        lab, count = ndimage.label(m)
        sizes = ndimage.sum(m, lab, range(1, count + 1))
        order = np.argsort(sizes)[::-1]
        main_size = sizes[order[0]]
        bad = [k for k in order[1:] if sizes[k] >= ORPHAN_MIN]
        if bad:
            ys, xs = np.where(lab == order[0] + 1)
            mb = (int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max()))
            for k in bad:
                ys, xs = np.where(lab == k + 1)
                orphans.append({
                    'part': n, 'components': int(count),
                    'main_px': int(main_size), 'main_bbox': mb,
                    'orphan_px': int(sizes[k]),
                    'orphan_bbox': (int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())),
                })

    seams = []
    for chain_name, chain in CHAINS:
        for a, b in zip(chain, chain[1:]):
            ma, mb_ = mask(a), mask(b)
            if ma is None or mb_ is None:
                seams.append({'chain': chain_name, 'a': a, 'b': b, 'status': 'MISSING PART'})
                continue
            overlap = int((ma & mb_).sum())
            ax = np.where(ma.any(axis=0))[0]
            bx = np.where(mb_.any(axis=0))[0]
            gap = 0
            if ax.max() < bx.min():
                gap = int(bx.min() - ax.max() - 1)
            elif bx.max() < ax.min():
                gap = int(ax.min() - bx.max() - 1)
            seams.append({
                'chain': chain_name, 'a': a, 'b': b,
                'overlap_px': overlap, 'x_gap_px': gap,
                'status': 'OK' if overlap > 0 else ('TORN (gap %d px)' % gap if gap else 'TORN (touching, 0 overlap)'),
            })

    print('=== D2: parts carrying disconnected art (>= %d px) ===' % ORPHAN_MIN)
    if not orphans:
        print('  none')
    for o in orphans:
        print('  %-22s %d components | main %7d px | ORPHAN %6d px at x%d-%d y%d-%d'
              % (o['part'], o['components'], o['main_px'], o['orphan_px'], *o['orphan_bbox']))

    print('\n=== D1: seams between parts that must deform together ===')
    torn = 0
    for s in seams:
        ok = s['status'] == 'OK'
        torn += 0 if ok else 1
        print('  %-11s %-16s -> %-16s %s%s'
              % (s['chain'], s['a'], s['b'],
                 ('overlap %6d px' % s['overlap_px']) if 'overlap_px' in s else '',
                 '' if ok else '   <-- ' + s['status']))

    print('\nsummary: %d parts with disconnected art, %d of %d seams torn'
          % (len({o['part'] for o in orphans}), torn, len(seams)))

    out = os.path.join('spikes', 'tail', 'evidence', 'part_continuity_audit_%s.json' % REV)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'orphans': orphans, 'seams': seams}, open(out, 'w'), indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()
