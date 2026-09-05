"""Compose shots_pet/*.png (main.js --pet --selftest) into evidence/sheet_pet.png: each full-screen shot cropped around her hit box."""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots_pet")
OUT = os.path.join(HERE, "evidence")
os.makedirs(OUT, exist_ok=True)
rep = json.load(open(os.path.join(SHOTS, "report.json")))
cell = (300, 340)
cols = 7
shots = rep["shots"]
rows = (len(shots) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell[0], rows * (cell[1] + 30) + 18), (20, 20, 24))
d = ImageDraw.Draw(sheet)
states = ",".join(sorted(set(l["state"] for l in rep.get("log", []))))
d.text((6, 3), f"pet selftest - autopilot 100 s then hover/click/drag/throw; {rep.get('fps')} fps; errors {len(rep['errors'])}; states seen: {states}", fill=(255, 255, 255))
for i, s in enumerate(shots):
    p = os.path.join(SHOTS, s["name"] + ".png")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    dpr = rep.get("dpr") or im.width / rep["window"]["width"]          # captures are physical px; hit boxes are window (DIP) px
    b = {k: v * dpr for k, v in s["bbox"].items()}
    cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
    w, h = max(b["x1"] - b["x0"], 100) * 1.9, max(b["y1"] - b["y0"], 100) * 1.35
    box = (int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2))
    crop = im.crop(box)
    bg = Image.new("RGBA", crop.size, (40, 40, 48, 255)); bg.alpha_composite(crop)
    tile = bg.convert("RGB"); tile.thumbnail(cell)
    x, y = (i % cols) * cell[0], 18 + (i // cols) * (cell[1] + 30)
    sheet.paste(tile, (x + (cell[0] - tile.width) // 2, y))
    pos = s["pos"]
    d.text((x + 4, y + cell[1] + 2), f"{s['name']}  {pos['action']} [{pos['view']}] x={pos['x']:.2f} y={pos['y']:.2f} f={pos['facing']:+d}", fill=(200, 230, 255))
    d.text((x + 4, y + cell[1] + 15), f"pet: {s['pet']['state']}  over={s['pet']['over']}", fill=(180, 200, 180))
sheet.save(os.path.join(OUT, "sheet_pet.png"))
print("sheet:", os.path.join(OUT, "sheet_pet.png"), "errors:", rep["errors"])
