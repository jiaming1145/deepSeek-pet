"""Assemble the capture into three contact sheets: actions (one row per action, four phases),
expressions (face crops), and gaze (three looks)."""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
OUT = os.path.join(HERE, 'evidence')
os.makedirs(OUT, exist_ok=True)
BG = (242, 242, 240, 255)


def comp(name):
    im = Image.open(os.path.join(SHOTS, name + '.png')).convert('RGBA')
    bg = Image.new('RGBA', im.size, BG)
    bg.alpha_composite(im)
    return bg.convert('RGB')


def grid(tiles, cols, label_h=22, pad=6):
    w, h = tiles[0][0].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w + pad) + pad, rows * (h + label_h + pad) + pad), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (im, label) in enumerate(tiles):
        x = pad + (i % cols) * (w + pad)
        y = pad + (i // cols) * (h + label_h + pad)
        d.text((x + 4, y + 5), label, fill=(0, 0, 0))
        sheet.paste(im, (x, y + label_h))
    return sheet


report = json.load(open(os.path.join(SHOTS, 'report.json')))
body_box = (60, 90, 900, 1330)     # character in the 960x1350 capture
face_box = (300, 250, 700, 620)

tiles = []
for a in report['actions']:
    for k in range(4):
        im = comp(f'action_{a}_{k}').crop(body_box)
        im = im.resize((im.size[0] // 3, im.size[1] // 3), Image.LANCZOS)
        tiles.append((im, f'{a}  phase {k + 1}/4'))
grid(tiles, 4).save(os.path.join(OUT, 'sheet_actions.png'))

tiles = []
for e in report['expressions'] + ['talking_a', 'talking_b']:
    im = comp(f'expr_{e}').crop(face_box)
    im = im.resize((im.size[0] * 2 // 3, im.size[1] * 2 // 3), Image.LANCZOS)
    tiles.append((im, e))
grid(tiles, 5).save(os.path.join(OUT, 'sheet_expressions.png'))

tiles = [(comp(f'gaze_{i}').crop(face_box).resize((300, 277), Image.LANCZOS), f'gaze {["left-up", "centre", "right-down"][i]}') for i in range(3)]
grid(tiles, 3).save(os.path.join(OUT, 'sheet_gaze.png'))
print('sheets written to', OUT, '| actions', len(report['actions']), '| expressions', len(report['expressions']), '| stats', report['stats'])
