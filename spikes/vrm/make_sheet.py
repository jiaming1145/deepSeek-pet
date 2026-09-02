"""Contact sheet of the capture shots, composited over a checkerboard so the alpha is visible.
Run: python make_sheet.py  (cwd D:\\ds\\spikes\\vrm)  -> evidence/sheet_motion.png (+ sheet_*.png)"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); OUT = os.path.join(HERE, 'evidence'); os.makedirs(OUT, exist_ok=True)
try: FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 18)
except Exception: FONT = ImageFont.load_default()

def checker(w, h, s=24):
    im = Image.new('RGB', (w, h), (58, 58, 62)); d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2: d.rectangle([x, y, x + s - 1, y + s - 1], fill=(74, 74, 80))
    return im

def tile(name, label, w=320, h=450, crop=None):
    p = os.path.join(SHOTS, name + '.png')
    bg = checker(w, h)
    if os.path.exists(p):
        im = Image.open(p).convert('RGBA')
        if crop: im = im.crop(crop)
        im = im.resize((w, h), Image.LANCZOS)
        bg.paste(im, (0, 0), im)
    d = ImageDraw.Draw(bg)
    d.rectangle([0, h - 26, w, h], fill=(0, 0, 0)); d.text((6, h - 24), label, fill=(190, 240, 255), font=FONT)
    return bg

def sheet(rows, fname, title, w=320, h=450, crop=None):
    cols = max(len(r) for r in rows)
    S = Image.new('RGB', (cols * w, len(rows) * h + 34), (16, 16, 18))
    ImageDraw.Draw(S).text((8, 8), title, fill=(255, 255, 255), font=FONT)
    for j, r in enumerate(rows):
        for i, (n, l) in enumerate(r): S.paste(tile(n, l, w, h, crop), (i * w, 34 + j * h))
    S.save(os.path.join(OUT, fname)); print('wrote', fname, S.size)

FACE = (300, 150, 660, 560)  # head crop in the 960x1350 capture
sheet([
    [('idle_0', 'idle (capturePage, alpha)'), ('desktop_composite', 'real desktop screenshot'), ('breath_0', 'breathe t=0.0s'), ('breath_1', 'breathe t=0.9s'), ('breath_2', 'breathe t=1.8s')],
    [('look_left', 'look-at: left'), ('look_right', 'look-at: right'), ('look_up', 'look-at: up'), ('look_down', 'look-at: down'), ('hud_idle', 'interactive HUD')],
    [('spring_rest', 'spring: rest'), ('spring_nudge_0', 'spring: nudge +60ms'), ('spring_nudge_1', 'spring: +190ms'), ('spring_nudge_2', 'spring: +320ms'), ('spring_nudge_3', 'spring: +450ms')],
    [('wave_0', 'wave 20%'), ('wave_1', 'wave 42%'), ('wave_2', 'wave 55%'), ('wave_3', 'wave 70%'), ('ik_reach_3', 'IK reach: out of range (clamped)')],
    [('ik_reach_0', 'IK reach: forward'), ('ik_reach_1', 'IK reach: across/low'), ('ik_reach_2', 'IK reach: up/out'), ('hop_0', 'hop: anticipation squash'), ('hop_1', 'hop: launch stretch')],
    [('hop_2', 'hop: apex'), ('hop_3', 'hop: landing squash'), ('vrma_0', 'VRMA clip (three-vrm test.vrma)'), ('vrma_1', 'VRMA +0.35s'), ('vrma_2', 'VRMA +0.7s')],
    [('mixamo_0', 'Mixamo FBX retarget 0.4s'), ('mixamo_1', 'Mixamo 0.8s'), ('mixamo_2', 'Mixamo 1.2s'), ('mixamo_3', 'Mixamo 1.6s'), ('expr_happy', 'expression: happy')],
], 'sheet_motion.png', 'VRM lab - motion (stock VRM1_Constraint_Twist_Sample, pixiv, VRM Public License 1.0) in the transparent 640x900 pet window @1.5 dpr')
sheet([
    [('blink_open', 'blink 0'), ('blink_half', 'blink 0.5'), ('blink_closed', 'blink 1'), ('lip_aa', 'viseme aa'), ('lip_ih', 'viseme ih'), ('lip_ou', 'viseme ou')],
    [('expr_happy', 'happy'), ('expr_angry', 'angry'), ('expr_sad', 'sad'), ('expr_relaxed', 'relaxed'), ('expr_surprised', 'surprised'), ('expr_xfade_happy_to_surprised', 'crossfade happy->surprised @70ms')],
    [('look_left', 'look left (face)'), ('look_right', 'look right (face)'), ('look_up', 'look up (face)'), ('look_down', 'look down (face)'), ('lip_talk_a', 'talk flap a'), ('lip_talk_b', 'talk flap b')],
], 'sheet_face.png', 'VRM lab - face (head crops of the same captures)', w=300, h=340, crop=FACE)
