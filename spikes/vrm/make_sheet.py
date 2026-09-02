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
    [('idle_0', 'idle = Idle_Loop clip (capturePage, alpha)'), ('desktop_composite', 'real desktop screenshot'), ('clip_idle_0', 'Idle_Loop t=0.3s'), ('clip_idle_1', 'Idle_Loop t=1.5s'), ('hud_idle', 'interactive HUD')],
    [('look_left', 'look-at: left (head + eyes)'), ('look_right', 'look-at: right'), ('look_up', 'look-at: up'), ('look_down', 'look-at: down'), ('look_left_eyesonly', 'look-at: left, head-turn OFF')],
    [('clip_walk_0', 'Walk_Loop in place t=0.2s'), ('clip_walk_1', 'Walk_Loop t=0.55s'), ('clip_walk_2', 'Walk_Loop t=0.9s'), ('xfade_walk_idle', 'crossfade walk->idle midpoint'), ('clip_sit_enter', 'Sitting_Enter mid')],
    [('clip_sit_0', 'Sitting_Idle_Loop t=0.3s'), ('clip_sit_1', 'Sitting_Idle_Loop t=1.1s'), ('clip_jump_0', 'Jump_Start +0.45s'), ('clip_jump_1', 'Jump_Start +0.9s'), ('clip_jump_land', 'Jump_Land +0.3s')],
    [('wave_0', '"wave" = Interact clip t=0.4s'), ('wave_1', 'Interact t=0.8s'), ('wave_2', 'Interact t=1.2s'), ('wave_3', 'Interact t=1.6s'), ('vrma_1', 'VRMA clip (shared loader)')],
    [('walk_across_0', 'walk across: -> right edge'), ('walk_across_1', 'walk across: turning at the edge'), ('walk_across_2', 'walk across: <- to left edge'), ('walk_across_3', 'walk across: -> back to centre'), ('walk_across_4', 'walk across: turning to face camera')],
    [('spring_rest', 'spring: rest'), ('spring_nudge_0', 'spring: nudge +60ms'), ('spring_nudge_1', 'spring: +190ms'), ('hop_1', 'hop: launch stretch (procedural)'), ('hop_2', 'hop: apex')],
    [('ik_reach_0', 'IK reach: forward'), ('ik_reach_2', 'IK reach: up/out'), ('mixamo_0', 'Mixamo FBX (shared loader) 0.4s'), ('mixamo_1', 'Mixamo 0.8s'), ('expr_happy', 'expression: happy')],
], 'sheet_motion.png', 'VRM lab - motion, unified runtime (stock VRM1_Constraint_Twist_Sample, pixiv, VRM Public License 1.0; clips: Quaternius CC0) in the transparent 640x900 pet window @1.5 dpr')
sheet([
    [('blink_open', 'blink 0'), ('blink_half', 'blink 0.5'), ('blink_closed', 'blink 1'), ('lip_aa', 'viseme aa'), ('lip_ih', 'viseme ih'), ('lip_ou', 'viseme ou')],
    [('expr_happy', 'happy'), ('expr_angry', 'angry'), ('expr_sad', 'sad'), ('expr_relaxed', 'relaxed'), ('expr_surprised', 'surprised'), ('expr_xfade_happy_to_surprised', 'crossfade happy->surprised @70ms')],
    [('look_left', 'look left (head+eyes)'), ('look_right', 'look right (head+eyes)'), ('look_up', 'look up (head+eyes)'), ('look_down', 'look down (head+eyes)'), ('look_left_eyesonly', 'look left, eyes only'), ('lip_talk_a', 'talk flap a')],
], 'sheet_face.png', 'VRM lab - face (head crops of the same captures)', w=300, h=340, crop=FACE)
