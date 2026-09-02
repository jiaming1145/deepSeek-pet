"""Contact sheet of the face_check captures (evidence_runtime/*.png) -> evidence_runtime/sheet_face_check.png.

  python make_runtime_sheet.py [evidence_dir]
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence_runtime")
ORDER = ["expr_neutral", "expr_happy", "expr_blink", "expr_aa", "xfade_binary_50_happy_surprised", "xfade_overlay_50_neutral_happy",
         "expr_surprised", "expr_cheerful", "expr_affection", "expr_shy", "expr_sleepy", "expr_lookLeft"]
report = json.load(open(os.path.join(D, "report.json"), encoding="utf-8"))
try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
except Exception:  # noqa: BLE001
    font = ImageFont.load_default()
tiles = [n for n in ORDER if os.path.exists(os.path.join(D, n + ".png"))]
TW = 300
cols = 6
rows = (len(tiles) + cols - 1) // cols
first = Image.open(os.path.join(D, tiles[0] + ".png"))
TH = int(TW * first.height / first.width)
sheet = Image.new("RGB", (cols * (TW + 8) + 8, rows * (TH + 40) + 8), (246, 243, 236))
dr = ImageDraw.Draw(sheet)
for i, n in enumerate(tiles):
    im = Image.open(os.path.join(D, n + ".png")).convert("RGBA")
    # checkerboard behind the alpha so the transparent window reads as such
    bg = Image.new("RGBA", im.size, (200, 200, 200, 255))
    step = 32
    d2 = ImageDraw.Draw(bg)
    for y in range(0, im.height, step):
        for x in range(0, im.width, step):
            if (x // step + y // step) % 2:
                d2.rectangle((x, y, x + step, y + step), fill=(235, 235, 235, 255))
    bg.alpha_composite(im)
    tile = bg.convert("RGB").resize((TW, TH), Image.LANCZOS)
    x, y = 8 + (i % cols) * (TW + 8), 8 + (i // cols) * (TH + 40)
    sheet.paste(tile, (x, y + 32))
    shot = report["shots"].get(n, {})
    dr.text((x, y), n.replace("expr_", ""), fill=(30, 40, 80), font=font)
    dr.text((x, y + 16), f"offset {shot.get('mapOffset')} w {shot.get('weights')}"[:44], fill=(110, 110, 110), font=font)
out = os.path.join(D, "sheet_face_check.png")
sheet.save(out)
print("wrote", out, sheet.size)
