"""The 1280x640 social preview card for the GitHub repository (Settings -> Social preview).

Her picture is a frame from the hero recording, so it is the real renderer's output, not a mock-up.

    python tools/media/social.py --frame .cache/media/hero/frame_0120.png --out media/social-preview.png

Needs Pillow. Fonts: Noto Sans (bundled with Windows 11) for Latin, Microsoft YaHei for the Chinese name;
both fall back to whatever Pillow can find.
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 640
INK = (22, 35, 58)          # the chat panel's text colour
NAVY = (31, 61, 120)        # the chat panel's header
MUTED = (96, 112, 140)
FONTS = "C:/Windows/Fonts"


def font(names, size):
    for n in names:
        p = os.path.join(FONTS, n)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wallpaper():
    """The same soft diagonal the GIFs stand on, so the card and the README read as one thing."""
    c0, c1 = (238, 242, 249), (217, 225, 239)
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W * 0.6 + y / H * 0.4)
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(c0, c1))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", required=True, help="an RGBA frame from record.js")
    ap.add_argument("--out", default="media/social-preview.png")
    a = ap.parse_args()

    card = wallpaper()
    her = Image.open(a.frame).convert("RGBA")
    her = her.crop(her.getbbox())
    target_h = 540
    her = her.resize((round(her.width * target_h / her.height), target_h), Image.LANCZOS)
    card.paste(her, (W - her.width - 64, H - her.height - 8), her)

    d = ImageDraw.Draw(card)
    title = font(["NotoSans-Bold.ttf", "segoeuib.ttf", "arialbd.ttf"], 82)
    zh = font(["msyhbd.ttc", "NotoSansSC-VF.ttf", "msyh.ttc"], 40)
    lead = font(["NotoSans-Bold.ttf", "segoeuib.ttf", "arialbd.ttf"], 30)
    body = font(["NotoSans-Regular.ttf", "segoeui.ttf", "arial.ttf"], 26)
    small = font(["NotoSans-Regular.ttf", "segoeui.ttf", "arial.ttf"], 20)

    # everything on the left stays under x = 800 so nothing runs into her
    x, y = 84, 96
    d.text((x, y), "Whale-chan", font=title, fill=INK)
    y += 108
    d.text((x, y), "鲸鱼娘", font=zh, fill=NAVY)
    y += 74
    d.text((x, y), "A desktop pet with a mind of her own.", font=lead, fill=INK)
    y += 54
    for line in ("She wants things, decides for herself,",
                 "talks back in character, and you can",
                 "pick her up and throw her."):
        d.text((x, y), line, font=body, fill=INK)
        y += 38
    y += 26
    d.text((x, y), "Electron · three.js · optional DeepSeek brain", font=small, fill=MUTED)
    y += 30
    d.text((x, y), "rigged from one drawing · github.com/jiaming1145/deepSeek-pet", font=small, fill=MUTED)

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    card.save(a.out, optimize=True)
    print("wrote", a.out, card.size)


if __name__ == "__main__":
    main()
