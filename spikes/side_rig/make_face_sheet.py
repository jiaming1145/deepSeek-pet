"""Compose shots_face/*.png (face_main.js --capture) into evidence/sheet_face.png."""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots_face")
OUT = os.path.join(HERE, "evidence")
os.makedirs(OUT, exist_ok=True)
rep = json.load(open(os.path.join(SHOTS, "report.json"), encoding="utf-8"))   # her log is Chinese now
names = [("mood_" + m, m) for m in rep["moods"]] + [("viseme_" + v, "viseme " + v) for v in rep["visemes"]] + \
        [("look_" + d, "look " + d) for d in rep["looks"]] + [(f"fade_{i}", f"fade {s}s") for i, s in enumerate(rep["fade"])] + [("blink", "blink")]
cell = (350, 300)
cols = 8
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell[0], rows * (cell[1] + 16) + 18), (24, 24, 28))
d = ImageDraw.Draw(sheet)
d.text((6, 3), f"face kit lab - {len(rep['moods'])} moods from the expression atlases, visemes, looks, crossfade, blink; {rep.get('fps')} fps; errors {len(rep['errors'])}", fill=(255, 255, 255))
for i, (f, label) in enumerate(names):
    p = os.path.join(SHOTS, f + ".png")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    # crop the central face area of the 700x600 window
    w, h = im.size
    box = (int(w * 0.18), int(h * 0.05), int(w * 0.82), int(h * 0.75))
    im = im.crop(box)
    bg = Image.new("RGBA", im.size, (40, 40, 48, 255)); bg.alpha_composite(im)
    tile = bg.convert("RGB").resize(cell, Image.LANCZOS)
    x, y = (i % cols) * cell[0], 18 + (i // cols) * (cell[1] + 16)
    sheet.paste(tile, (x, y)); d.text((x + 4, y + cell[1] + 2), label, fill=(200, 230, 255))
sheet.save(os.path.join(OUT, "sheet_face.png"))
print("sheet:", os.path.join(OUT, "sheet_face.png"), "errors:", rep["errors"])
