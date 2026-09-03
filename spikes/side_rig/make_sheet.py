"""Compose shots/*.png from main.js --capture into evidence/sheet_actions.png and sheet_emotions.png."""
import glob
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUT = os.path.join(HERE, "evidence")
os.makedirs(OUT, exist_ok=True)
rep = json.load(open(os.path.join(SHOTS, "report.json")))
acts = list(rep["actions"].keys())
cell = (240, 338)


def tile(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (40, 40, 48, 255))
    bg.alpha_composite(im)
    return bg.convert("RGB").resize(cell, Image.LANCZOS)


cols = 6
rows = (len(acts) * 3 + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell[0], rows * (cell[1] + 16) + 18), (20, 20, 24))
d = ImageDraw.Draw(sheet)
d.text((6, 3), f"side rig lab - every action at 20/50/80 %; {rep.get('fps')} fps; errors {len(rep['errors'])}", fill=(255, 255, 255))
i = 0
for a in acts:
    for k in range(3):
        p = os.path.join(SHOTS, f"act_{a}_{k}.png")
        if not os.path.exists(p):
            continue
        x, y = (i % cols) * cell[0], 18 + (i // cols) * (cell[1] + 16)
        sheet.paste(tile(p), (x, y)); d.text((x + 4, y + cell[1] + 2), f"{a} {[20, 50, 80][k]}%", fill=(200, 230, 255)); i += 1
sheet.save(os.path.join(OUT, "sheet_actions.png"))
emos = rep["emotions"]
es = Image.new("RGB", (len(emos) * cell[0], cell[1] + 34), (20, 20, 24))
d = ImageDraw.Draw(es)
for i, e in enumerate(emos):
    p = os.path.join(SHOTS, f"emo_{e}.png")
    if os.path.exists(p):
        es.paste(tile(p), (i * cell[0], 18)); d.text((i * cell[0] + 4, cell[1] + 20), e, fill=(200, 230, 255))
es.save(os.path.join(OUT, "sheet_emotions.png"))
print("sheets:", os.path.join(OUT, "sheet_actions.png"), os.path.join(OUT, "sheet_emotions.png"), "errors:", rep["errors"])
