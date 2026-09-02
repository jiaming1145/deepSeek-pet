"""Contact sheets of the actions-lab captures over a checkerboard (alpha visible).
Run: python make_sheet.py  (cwd D:\\ds\\spikes\\vrm\\actions) -> evidence/sheet_actions.png, evidence/sheet_emotions.png"""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); OUT = os.path.join(HERE, 'evidence'); os.makedirs(OUT, exist_ok=True)
try: FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 16)
except Exception: FONT = ImageFont.load_default()
REPORT = json.load(open(os.path.join(SHOTS, 'report.json'), encoding='utf-8')) if os.path.exists(os.path.join(SHOTS, 'report.json')) else {}

def checker(w, h, s=24):
    im = Image.new('RGB', (w, h), (58, 58, 62)); d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2: d.rectangle([x, y, x + s - 1, y + s - 1], fill=(74, 74, 80))
    return im

def tile(name, label, w, h, crop=None):
    p = os.path.join(SHOTS, name + '.png'); bg = checker(w, h)
    if os.path.exists(p):
        im = Image.open(p).convert('RGBA')
        if crop: im = im.crop(crop)
        im = im.resize((w, h), Image.LANCZOS); bg.paste(im, (0, 0), im)
    else:
        ImageDraw.Draw(bg).text((8, 8), 'MISSING', fill=(255, 80, 80), font=FONT)
    d = ImageDraw.Draw(bg); d.rectangle([0, h - 22, w, h], fill=(0, 0, 0)); d.text((5, h - 20), label[:34], fill=(190, 240, 255), font=FONT)
    return bg

def sheet(rows, fname, title, w, h, crop=None):
    cols = max(len(r) for r in rows)
    S = Image.new('RGB', (cols * w, len(rows) * h + 30), (16, 16, 18))
    ImageDraw.Draw(S).text((8, 7), title, fill=(255, 255, 255), font=FONT)
    for j, r in enumerate(rows):
        for i, (n, l) in enumerate(r): S.paste(tile(n, l, w, h, crop), (i * w, 30 + j * h))
    S.save(os.path.join(OUT, fname)); print('wrote', fname, S.size)

ACTS = ['idle', 'walk', 'hop', 'sit', 'sleep', 'wake', 'stretch', 'stumble', 'recover', 'reach', 'inspect', 'wave', 'eat', 'drink', 'celebrate', 'tail_react']
def src(a):
    s = REPORT.get('actions', {}).get(a, {}).get('source', '?')
    if s in (None, '?'): return 'P'   # overlays (tail_react) report no source
    return {'clip': 'C', 'procedural': 'P'}.get(s, 'C:' + s.split(':', 1)[-1][:10])
tiles = []
for a in ACTS:
    for k, pct in enumerate((20, 50, 80)): tiles.append((f'act_{a}_{k}', f'{a} {pct}% [{src(a)}]'))
rows = [tiles[i:i + 8] for i in range(0, len(tiles), 8)]
rows.append([(f'look_{p}', f'look {p}') for p in ['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none']])
sheet(rows, 'sheet_actions.png', 'actions lab - every action at 20/50/80% ([C]=clip via AnimationMixer, [P]=procedural) + look patterns; stock VRM1_Constraint_Twist_Sample in the 640x900 pet window', 250, 352)

EMO = ['neutral', 'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious']
FACE = (300, 150, 660, 560)
sheet([[(f'emo_{e}', e) for e in EMO] + [('emo_xfade_happy_to_surprised', 'happy->surprised @70ms')],
       [(f'emo_{e}', e + ' (face)') for e in EMO] + [('emo_xfade_happy_to_surprised', 'xfade (face)')]],
      'sheet_emotions.png', 'actions lab - nine @ds/protocol emotions -> VRM preset recipes (+ head posture); second row = head crops', 250, 300, None)
# the second row wants crops: rebuild with crop for that row only
S = Image.open(os.path.join(OUT, 'sheet_emotions.png'))
for i, (n, l) in enumerate([(f'emo_{e}', e + ' (face)') for e in EMO] + [('emo_xfade_happy_to_surprised', 'xfade (face)')]):
    S.paste(tile(n, l, 250, 300, FACE), (i * 250, 30 + 300))
S.save(os.path.join(OUT, 'sheet_emotions.png')); print('wrote sheet_emotions.png (face row cropped)', S.size)
