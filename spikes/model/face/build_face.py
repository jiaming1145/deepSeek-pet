"""Build Whale-chan's drawn face as a 3D face-texture kit.

Inputs : v005 parts (final PNGs + visible masks) and canonical_v005.png (read only).
Outputs: face/neutral.png, face/base_no_eyes_mouth.png, face/head_base_clean.png,
         face/atlas_eyes.png, face/atlas_mouth.png, face/atlas_brows.png, face/atlas_fx.png,
         face/atlas.json, face/preview_expressions.png, face/preview_atlases.png

Everything is derived; nothing under runs/ is written.
"""
import json, math, os, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

RUN = 'D:/ds/runs/deepseek_humanized_20260830_001/'
FINAL = RUN + '03_parts/revisions/v005/final/'
MASKS = RUN + '03_parts/revisions/v005/masks/'
CANON = RUN + '01_design/canonical/revisions/v005/canonical_v005.png'
REF_SHEET = ('C:/Users/jiami/AppData/Local/Temp/claude/D--ds/6937fa24-7aae-458e-9817-d81b1ced4b57/scratchpad/'
             'whalechan/assets/readme/en/character-samples/whalechan-character-expression-guide-reference-sheet.webp')
OUT = os.path.dirname(os.path.abspath(__file__)) + '/'

# Face crop in canonical (4096x8192) coordinates: brows to chin, cheek to cheek, with margin.
FACE_BOX = (864, 2688, 2224, 3840)
FX0, FY0 = FACE_BOX[0], FACE_BOX[1]
FW, FH = FACE_BOX[2] - FACE_BOX[0], FACE_BOX[3] - FACE_BOX[1]

LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s); LOG.append(s)

# ----------------------------------------------------------------------------- loading
canon_full = Image.open(CANON).convert('RGBA')
CANON_RGBA = np.array(canon_full.crop(FACE_BOX)).astype(np.float32)   # H,W,4  0..255

def part(pid):
    """Final part PNG cropped to the face box, float RGBA."""
    return np.array(Image.open(FINAL + pid + '.png').convert('RGBA').crop(FACE_BOX)).astype(np.float32)

def vis(pid):
    """Visible (verbatim canonical) mask of a part inside the face box, bool."""
    m = np.array(Image.open(MASKS + pid + '_visible_mask.png').convert('L').crop(FACE_BOX))
    return m > 127

def verbatim(mask):
    """Canonical RGBA under a bool mask."""
    out = CANON_RGBA.copy()
    out[..., 3] = np.where(mask, out[..., 3], 0)
    return out

def over(dst, src, alpha_scale=1.0):
    """Porter-Duff over, float RGBA arrays 0..255, returns new array."""
    sa = (src[..., 3:4] / 255.0) * alpha_scale
    da = dst[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    out = np.concatenate([rgb, oa * 255.0], axis=-1)
    out[..., :3] = np.where(oa > 0, out[..., :3], 0)
    return out

def masked(img, mask):
    out = img.copy(); out[..., 3] = out[..., 3] * mask
    return out

def dilate(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0

def erode(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(mask.astype(np.uint8), k) > 0

def bbox(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0: return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]

def save(img, name):
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGBA').save(OUT + name)

def translate(img, dx, dy):
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))

def affine_about(img, cx, cy, scale=1.0, angle_deg=0.0, dx=0.0, dy=0.0):
    M = cv2.getRotationMatrix2D((float(cx), float(cy)), angle_deg, scale)
    M[0, 2] += dx; M[1, 2] += dy
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))

def crop_cell(img, cx, cy, cw, ch):
    """Cut a cw x ch window whose centre is (cx,cy) (anchor at cell centre); pads with transparent."""
    x0 = int(round(cx - cw / 2)); y0 = int(round(cy - ch / 2))
    cell = np.zeros((ch, cw, 4), np.float32)
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + cw, img.shape[1]), min(y0 + ch, img.shape[0])
    cell[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = img[sy0:sy1, sx0:sx1]
    return cell, (x0, y0)

# ----------------------------------------------------------------------------- vector strokes
def draw_stroke(shape_hw, pts, width_fn, color, ss=4):
    """Anti-aliased tapered stroke through pts [(x,y)...] (float px). width_fn(t)->px width."""
    H, W = shape_hw
    big = np.zeros((H * ss, W * ss), np.uint8)
    # densify to <= 1 px spacing so thin strokes do not bead
    dense = []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        k = max(int(math.hypot(x1 - x0, y1 - y0)) + 1, 1)
        for j in range(k):
            f = j / k; dense.append((x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))
    dense.append(pts[-1]); pts = dense
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        t = i / max(n - 1, 1)
        r = max(width_fn(t) * ss / 2.0, 0.5)
        cv2.circle(big, (int(round(x * ss)), int(round(y * ss))), int(round(r)), 255, -1, lineType=cv2.LINE_AA)
    a = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = np.array(color, np.float32)
    out[..., 3] = a
    return out

def draw_poly_fill(shape_hw, poly, color, ss=4):
    H, W = shape_hw
    big = np.zeros((H * ss, W * ss), np.uint8)
    p = np.array([[x * ss, y * ss] for x, y in poly], np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(big, [p], 255, lineType=cv2.LINE_AA)
    a = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = np.array(color, np.float32); out[..., 3] = a
    return out

def arc_points(cx, cy, half_w, bulge, n=64, y_of_t=None):
    """Points along a quadratic arc from (cx-half_w,cy) to (cx+half_w,cy); bulge>0 = ends higher than middle (smile)."""
    pts = []
    for i in range(n):
        t = i / (n - 1); x = cx - half_w + 2 * half_w * t
        b = 4 * t * (1 - t)          # 0 at ends, 1 at middle
        pts.append((x, cy + bulge * b))
    return pts

# ============================================================================= 1. base skin
log('face box', FACE_BOX, 'size', FW, FH)
hb = part('head_base')
hb_vis_raw = vis('head_base')
C = CANON_RGBA
# v005 "visible" masks of head_base / eye whites / lashes carry the bang pixels that overlap the face
# (the partition never assigned them to the hair parts). Classify them out by colour.
hair_like = (C[..., 2] - C[..., 0] > 35) & (C[..., 2] > 60)
hair_strong = (C[..., 2] - C[..., 0] > 50) & (C[..., 2] > 90)
dark_like = C[..., :3].sum(-1) < 300
hb_vis = hb_vis_raw & ~hair_like
log('head_base visible raw', int(hb_vis_raw.sum()), 'hair-classified', int((hb_vis_raw & hair_like).sum()))

eye_parts = {}
for s in 'lr':
    ep = dict(white=vis(f'eye_white_{s}') & ~hair_like, iris=vis(f'iris_{s}'), pupil=vis(f'pupil_{s}'), detail=vis(f'iris_detail_{s}'),
              hl1=vis(f'eye_highlight_primary_{s}'), hl2=vis(f'eye_highlight_secondary_{s}'),
              ulash=vis(f'upper_lash_{s}') & ~hair_strong, llash=vis(f'lower_lash_{s}') & ~hair_strong)
    ep['aperture'] = ep['white'] | ep['iris'] | ep['pupil'] | ep['detail'] | ep['hl1'] | ep['hl2']
    ep['irisz'] = ep['iris'] | ep['pupil'] | ep['detail'] | ep['hl1'] | ep['hl2']
    ep['lash'] = ep['ulash'] | ep['llash']
    ep['region'] = ep['aperture'] | ep['lash']
    eye_parts[s] = ep
    log(f'eye_{s}: aperture bbox', bbox(ep['aperture']), 'region bbox', bbox(ep['region']),
        'aperture px', int(ep['aperture'].sum()), 'lash px', int(ep['lash'].sum()),
        'hair px removed from white', int((vis(f'eye_white_{s}') & hair_like).sum()))

# the drawn mouth: red strokes inside a search window (the watershed gave them to head_base)
mwin = np.zeros((FH, FW), bool); mwin[760:912, 570:840] = True
lip_like = mwin & (C[..., 0] - C[..., 1] > 45) & (C[..., 0] > 140) & (C[..., 3] > 0)
lip_like = erode(dilate(lip_like, 2), 1)
mouth_vis = vis('mouth_cavity') | vis('upper_lip_line') | vis('lower_lip_line') | vis('mouth_corner_l') | vis('mouth_corner_r')
log('mouth visible-mask union bbox', bbox(mouth_vis), 'px', int(mouth_vis.sum()), '| lip-colour strokes bbox', bbox(lip_like), 'px', int(lip_like.sum()))
mouth_zone = dilate(lip_like, 14)
brow_vis = {s: vis(f'brow_{s}') & dark_like for s in 'lr'}      # the mask also holds hair-blue pixels; keep the strokes only
nose_vis = vis('nose')
for s in 'lr': log(f'brow_{s} visible bbox', bbox(brow_vis[s]), 'px', int(brow_vis[s].sum()))
log('nose visible bbox', bbox(nose_vis), 'px', int(nose_vis.sum()))

# Trusted skin = verbatim head_base pixels that are neither hair nor dark residue near the eyes nor part of
# eyes / mouth / nose / brows. Everything else in the head ellipse is re-synthesised from trusted skin by a
# multi-scale normalised convolution (a smooth skin model: keeps blush and chin shading, no lash bleed).
near_eyes = np.zeros((FH, FW), bool)
for s in 'lr': near_eyes |= dilate(eye_parts[s]['region'], 60)
R_, G_, B_ = C[..., 0], C[..., 1], C[..., 2]
skin_like = (R_ > 185) & (B_ > 110) & (G_ > 165) & (R_ - B_ < 70) & (R_ >= G_ + 4) & (B_ <= G_ + 15)   # skin, blush, warm shading; not hair, highlights, frill, collar, ear
CHIN_Y = 950                                                                                          # the jaw line; below it head_base's mask is neck and collar
hair_rim = dilate(hair_like, 16)                                                                      # the warm glow the bangs cast on the skin next to them
trusted = hb_vis & skin_like & ~dark_like & ~hair_rim & ~mouth_zone & ~dilate(nose_vis, 3) & (np.arange(FH)[:, None] < CHIN_Y)
for s in 'lr':
    trusted &= ~dilate(eye_parts[s]['region'], 10)
    trusted &= ~dilate(brow_vis[s], 4)
alpha_head = hb[..., 3] > 0
log('head_base pixels', int(alpha_head.sum()), 'trusted skin', int(trusted.sum()), 'synthesised', int((alpha_head & ~trusted).sum()))

def skin_model(rgb, trusted, sigmas=(12, 30, 80, 200)):
    t = trusted.astype(np.float32)
    fill = np.zeros_like(rgb); have = np.zeros((rgb.shape[0], rgb.shape[1]), bool)
    for sg in sigmas:
        num = cv2.GaussianBlur(rgb * t[..., None], (0, 0), sg); den = cv2.GaussianBlur(t, (0, 0), sg)
        ok = (den > 0.02) & ~have
        fill[ok] = (num[ok] / den[ok][:, None]); have |= ok
    med = np.median(rgb[trusted], axis=0)
    fill[~have] = med
    return fill

fill = skin_model(C[..., :3], trusted)
tf = cv2.GaussianBlur(trusted.astype(np.float32), (0, 0), 1.5)[..., None]
base_clean = hb.copy()
base_clean[..., :3] = C[..., :3] * tf + fill * (1 - tf)
base_clean[..., :3] = np.where(alpha_head[..., None], base_clean[..., :3], 0)
holes = alpha_head & ~trusted
save(base_clean, 'head_base_clean.png')

base_skin_nose = over(base_clean, verbatim(nose_vis))       # the base to use under the brow atlas
save(base_skin_nose, 'base_skin_nose.png')
base_nem = base_skin_nose.copy()
for s in 'lr':
    base_nem = over(base_nem, verbatim(brow_vis[s]))
save(base_nem, 'base_no_eyes_mouth.png')                      # skin + nose + the drawn brow fragments (spec)

# ============================================================================= 2. eyes
EYE_CELL = (640, 704)     # w,h ; anchor = cell centre
closed_line_part = {s: part(f'closed_eye_line_{s}') for s in 'lr'}
heart_part = {s: part(f'pupil_heart_{s}') for s in 'lr'}
spiral_part = {s: part(f'pupil_spiral_{s}') for s in 'lr'}
LASH_COLOR = None

eye_states = {}
eye_anchor = {}
for s in 'lr':
    ep = eye_parts[s]
    A, R, L = ep['aperture'], ep['region'], ep['lash']
    ab = bbox(A); ax, ay = (ab[0] + ab[2]) / 2, (ab[1] + ab[3]) / 2
    aw, ah = ab[2] - ab[0], ab[3] - ab[1]
    eye_anchor[s] = (ax, ay)
    # sclera: eye-white pixels continued under the iris (needed when the iris moves)
    A_solid = A | erode(dilate(A, 6), 6)
    scl8 = np.clip(CANON_RGBA[..., :3], 0, 255).astype(np.uint8)
    m = (~ep['white']).astype(np.uint8) * 255          # only clean eye-white pixels may seed the sclera
    scl = cv2.cvtColor(cv2.inpaint(cv2.cvtColor(scl8, cv2.COLOR_RGB2BGR), m, 7, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB).astype(np.float32)
    sclera = np.zeros_like(CANON_RGBA); sclera[..., :3] = scl; sclera[..., 3] = A_solid * 255.0
    iris = verbatim(ep['irisz'])
    lashes = verbatim(L)
    if LASH_COLOR is None:
        lp = CANON_RGBA[L][:, :3]; LASH_COLOR = np.median(lp[lp.sum(1) < 300], axis=0)
        log('lash colour', LASH_COLOR.round(1))
    open_eye = over(over(sclera, iris), lashes)   # == verbatim canonical inside R (plus sclera under iris)
    skin_fill_mask = dilate(R, 8)
    skin_fill = masked(base_clean, skin_fill_mask)

    def gaze(dx, dy):
        ir = translate(iris, dx, dy)
        ir[..., 3] *= A_solid          # clipped to the eye white
        return over(over(sclera, ir), lashes)

    st = {}
    st['open'] = open_eye
    st['half'] = over(open_eye, skin_fill, 0.55)
    # geometric half-lid: upper 45 % of the aperture covered by skin plus a lid line
    lid_mask = skin_fill_mask & (np.arange(FH)[:, None] < ab[1] + 0.47 * ah)
    lid = masked(base_clean, lid_mask)
    lid_pts = arc_points(ax, ab[1] + 0.47 * ah, aw * 0.55, 10, y_of_t=None)
    lid_line = draw_stroke((FH, FW), lid_pts, lambda t: 14 * (0.35 + 0.65 * math.sin(math.pi * t)), LASH_COLOR)
    lid_line[..., 3] *= dilate(A_solid, 12)
    st['half_lid'] = over(over(over(open_eye, lid), lid_line), masked(lashes, ep['llash']))
    # closed: skin over everything, then a downward (sleeping) curve = the given upward arc flipped
    cl = closed_line_part[s]
    cb = bbox(cl[..., 3] > 0)
    flipped = cl.copy(); flipped[cb[1]:cb[3]] = cl[cb[1]:cb[3]][::-1]
    flipped = translate(flipped, 0, (ab[1] + 0.40 * ah) - (cb[1] + cb[3]) / 2)   # sit at ~40 % down the eye
    st['closed'] = over(skin_fill, flipped)
    st['happy'] = over(skin_fill, cl)
    st['surprised'] = affine_about(open_eye, ax, ay, scale=1.15)
    hp = heart_part[s].copy(); hp[..., 3] *= A_solid
    sp = spiral_part[s].copy(); sp[..., 3] *= A_solid
    st['heart'] = over(over(over(sclera, iris), hp), lashes)
    st['spiral'] = over(over(over(sclera, iris), sp), lashes)
    off = 0.08 * aw
    # character-perspective: 'left' = her left = screen +x (the side eye_*_l sits on)
    st['look_left'] = gaze(+off, 0)
    st['look_right'] = gaze(-off, 0)
    st['look_up'] = gaze(0, -off)
    st['look_down'] = gaze(0, +off)
    st['look_down_left'] = gaze(+off * 0.7, +off * 0.7)
    st['look_down_right'] = gaze(-off * 0.7, +off * 0.7)
    eye_states[s] = st
    log(f'eye_{s} anchor', (round(ax, 1), round(ay, 1)), 'aperture', aw, 'x', ah, 'gaze offset px', round(off, 1))
    rb = bbox(skin_fill_mask)
    if rb[2] - rb[0] > EYE_CELL[0] or rb[3] - rb[1] > EYE_CELL[1]:
        log('WARNING eye region larger than cell', rb)

EYE_ORDER = ['open', 'half', 'half_lid', 'closed', 'happy', 'surprised', 'heart', 'spiral',
             'look_left', 'look_right', 'look_up', 'look_down', 'look_down_left', 'look_down_right']

# ============================================================================= 3. mouth
MOUTH_CELL = (320, 288); MOUTH_ANCHOR_IN_CELL = (160, 100)
mz = mouth_zone
diff = np.abs(CANON_RGBA[..., :3] - base_clean[..., :3]).max(axis=-1)
stroke_a = np.clip((diff - 18) / 40.0, 0, 1) * mz
stroke_a = np.maximum(stroke_a, lip_like.astype(np.float32))
stroke_a = cv2.GaussianBlur(stroke_a, (0, 0), 0.6)
closed_mouth = CANON_RGBA.copy(); closed_mouth[..., 3] = stroke_a * 255
sb = bbox(stroke_a > 0.3)
mx, my = (sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2
lip_px = CANON_RGBA[stroke_a > 0.6][:, :3]
redness = lip_px[:, 0] - lip_px[:, 1]
lip_px = lip_px[redness >= np.percentile(redness, 70)]           # the stroke core, not its anti-aliased rim
LIP_COLOR = np.median(lip_px, axis=0) if len(lip_px) else np.array([200, 90, 90.0])
CAVITY = np.array([118, 44, 58.0]); TEETH = np.array([255, 250, 246.0]); TONGUE = np.array([232, 122, 132.0])
log('mouth stroke bbox', sb, 'anchor', (round(mx, 1), round(my, 1)), 'lip colour', LIP_COLOR.round(1), 'stroke px', int((stroke_a > 0.3).sum()))
mw = sb[2] - sb[0]

def mouth_open_shape(w, h, top_bulge, teeth=0.0, tongue=0.0, outline=6.0, corner_lift=0.0):
    """A rounded open mouth: top edge is an arc (smile if top_bulge<0), bottom a deeper arc. Top edge at anchor."""
    cx, cy = mx, my - 6
    n = 48
    top = [(cx - w / 2 + w * t, cy + top_bulge * 4 * t * (1 - t) - corner_lift * (1 - 4 * t * (1 - t))) for t in np.linspace(0, 1, n)]
    bot = [(cx - w / 2 + w * t, cy + h * math.sin(math.pi * t) ** 0.5 - corner_lift * (1 - 4 * t * (1 - t))) for t in np.linspace(1, 0, n)]
    poly = top + bot
    cav = draw_poly_fill((FH, FW), poly, CAVITY)
    inner = cav[..., 3] / 255.0
    out = cav
    if teeth > 0:
        band = draw_poly_fill((FH, FW), top + [(x, y + h * teeth) for (x, y) in bot], TEETH)
        band[..., 3] *= inner
        out = over(out, band)
    if tongue > 0:
        tw, th = w * 0.55 * tongue, h * 0.5 * tongue
        tg = draw_poly_fill((FH, FW), [(cx + tw / 2 * math.cos(a), cy + h * 0.92 + th * 0.9 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)], TONGUE)
        tg[..., 3] *= inner
        out = over(out, tg)
    line = draw_stroke((FH, FW), poly + [poly[0]], lambda t: outline, LIP_COLOR)
    return over(out, line)

mouth_states = {}
mouth_states['closed'] = closed_mouth
# smile: the closed line re-drawn wider and with more upward curve (synthesised; the v005 closed_mouth_line is
# a 214 px navy arc in a different style from the drawn mouth)
sm = draw_stroke((FH, FW), arc_points(mx, my - 14, mw * 0.85, 30), lambda t: 9 * (0.25 + 0.75 * math.sin(math.pi * t)), LIP_COLOR)
mouth_states['smile'] = sm
mouth_states['open_small'] = mouth_open_shape(mw * 0.55, 42, -4)
mouth_states['open_wide'] = mouth_open_shape(mw * 1.25, 120, -22, teeth=0.22, tongue=0.9)
mouth_states['aa'] = mouth_open_shape(mw * 0.95, 105, -8, teeth=0.18, tongue=0.8)
mouth_states['ih'] = mouth_open_shape(mw * 1.25, 46, -6, teeth=0.55)
mouth_states['ou'] = mouth_open_shape(mw * 0.42, 66, 8)
mouth_states['ee'] = mouth_open_shape(mw * 1.35, 40, -10, teeth=0.9)
mouth_states['oh'] = mouth_open_shape(mw * 0.62, 96, 6, tongue=0.4)
mouth_states['chew'] = mouth_open_shape(mw * 0.8, 60, -10, teeth=0.35)
# extra states the moods need: a straight/flat line and a small frown
mouth_states['flat'] = draw_stroke((FH, FW), arc_points(mx, my, mw * 0.5, 2), lambda t: 8 * (0.3 + 0.7 * math.sin(math.pi * t)), LIP_COLOR)
mouth_states['frown'] = draw_stroke((FH, FW), arc_points(mx, my + 8, mw * 0.55, -16), lambda t: 8 * (0.3 + 0.7 * math.sin(math.pi * t)), LIP_COLOR)
mouth_states['wavy'] = draw_stroke((FH, FW), [(mx - mw * 0.5 + mw * t, my + 7 * math.sin(3 * math.pi * t)) for t in np.linspace(0, 1, 48)],
                                   lambda t: 8 * (0.3 + 0.7 * math.sin(math.pi * t)), LIP_COLOR)
mouth_states['pout'] = over(mouth_open_shape(mw * 0.30, 26, 4, outline=6), np.zeros_like(closed_mouth))
MOUTH_ORDER = ['closed', 'smile', 'open_small', 'open_wide', 'aa', 'ih', 'ou', 'ee', 'oh', 'chew', 'flat', 'frown', 'wavy', 'pout']

# ============================================================================= 4. brows
BROW_CELL = (384, 256)
brow_states = {}; brow_anchor = {}; brow_synth_info = {}
for s in 'lr':
    m = brow_vis[s]
    px = CANON_RGBA[m][:, :3]
    dark = px.sum(1) < 300                          # the actual brow strokes, not hair-blue fragments
    ys, xs = np.nonzero(m)
    xs_d, ys_d = xs[dark], ys[dark]
    color = np.median(px[dark], axis=0)
    cx, cy = xs_d.mean(), ys_d.mean()
    cov = np.cov(np.stack([xs_d - cx, ys_d - cy]))
    evals, evecs = np.linalg.eigh(cov); d = evecs[:, np.argmax(evals)]
    if d[0] < 0: d = -d
    ang = math.degrees(math.atan2(d[1], d[0]))
    inner_sign = -1 if s == 'l' else +1            # x direction toward the nose
    brow_anchor[s] = (cx, cy)
    half_len = 150
    # gentle arch, drawn along the fitted axis: outer end tapers, inner end slightly thicker
    pts = []
    for t in np.linspace(0, 1, 64):
        u = (t - 0.5) * 2 * half_len
        arch = -14 * math.sin(math.pi * t)
        x = cx + u * d[0] - arch * d[1]; y = cy + u * d[1] + arch * d[0]
        pts.append((x, y))
    if inner_sign > 0: pts = pts[::-1]              # make t=0 the outer end for both sides
    width = lambda t: 15 * (0.35 + 0.65 * math.sin(math.pi * (0.25 + 0.75 * t)))
    neutral = draw_stroke((FH, FW), pts, width, color)
    outer_x, outer_y = pts[0]
    st = {'neutral': neutral, 'neutral_verbatim': verbatim(m)}
    st['up'] = translate(neutral, 0, -34)
    # angry: inner end down -> rotate about the outer end so that the inner end drops
    st['down_inner'] = affine_about(neutral, outer_x, outer_y, angle_deg=-14 * inner_sign, dy=8)
    # sad: inner end up
    st['up_inner'] = affine_about(neutral, outer_x, outer_y, angle_deg=+12 * inner_sign, dy=-6)
    # question: raised and tilted (outer end higher)
    st['tilted'] = affine_about(neutral, cx, cy, angle_deg=+9 * inner_sign, dy=-26)
    st['down'] = translate(neutral, 0, +14)
    brow_states[s] = st
    brow_synth_info[s] = dict(color=[int(v) for v in color], axis_deg=round(ang, 2), anchor=[round(cx, 1), round(cy, 1)],
                              verbatim_px=int(m.sum()), dark_px=int(dark.sum()))
    log(f'brow_{s} anchor', (round(cx, 1), round(cy, 1)), 'axis deg', round(ang, 1), 'colour', color.round(0), 'dark px', int(dark.sum()))
BROW_ORDER = ['neutral', 'neutral_verbatim', 'up', 'down', 'down_inner', 'up_inner', 'tilted']

# ============================================================================= 5. FX
FX_IDS = ['blush_l', 'blush_r', 'tear_l', 'tear_r', 'tear_drop_l', 'tear_drop_r', 'sweat_drop', 'anger_mark',
          'question_mark', 'sparkle_l', 'sparkle_r', 'sleepy_marks', 'heart_fx', 'face_shadow', 'panic_shadow']
fx_parts = {}      # face-box-sized where possible; FX that leave the box are kept as tight full-canvas crops
fx_full = {}
hb_full_alpha = np.array(Image.open(FINAL + 'head_base.png').getchannel('A')) > 0
for f in FX_IDS:
    full = np.array(Image.open(FINAL + f + '.png').convert('RGBA')).astype(np.float32)
    if f in ('face_shadow', 'panic_shadow', 'blush_l', 'blush_r'):
        full[..., 3] *= hb_full_alpha   # clipped_to head_base in the manifest
    gb = bbox(full[..., 3] > 0)
    fx_full[f] = (full[gb[1]:gb[3], gb[0]:gb[2]], [gb[0] - FX0, gb[1] - FY0, gb[2] - FX0, gb[3] - FY0])
    fx_parts[f] = full[FY0:FY0 + FH, FX0:FX0 + FW]

# ============================================================================= 6. neutral composite
neutral = base_clean.copy()
neutral = over(neutral, verbatim(nose_vis))
for s in 'lr': neutral = over(neutral, verbatim(brow_vis[s]))
for s in 'lr': neutral = over(neutral, eye_states[s]['open'])
neutral = over(neutral, closed_mouth)
save(neutral, 'neutral.png')
# sanity: how far is the neutral composite from the canonical where the canonical is face (not hair)?
face_zone = hb_vis | mouth_vis | nose_vis
for s in 'lr': face_zone |= eye_parts[s]['region'] | brow_vis[s]
err = np.abs(neutral[..., :3] - CANON_RGBA[..., :3]).mean(axis=-1)[face_zone & ~holes]
log('neutral vs canonical (verbatim zone, excl. inpainted): mean abs err', round(float(err.mean()), 3), 'p99', round(float(np.percentile(err, 99)), 2))

# ============================================================================= 7. atlases
def build_atlas(states_by_row, order, cell, anchor_of_row, anchor_in_cell=None):
    """Rows = (row_key, states dict); every cell is `cell` px, anchored at anchor_in_cell (default centre)."""
    cw, ch = cell
    aic = anchor_in_cell or (cw / 2, ch / 2)
    rows = len(states_by_row); cols = len(order)
    atlas = np.zeros((rows * ch, cols * cw, 4), np.float32)
    meta = {}
    for ri, (rk, st) in enumerate(states_by_row):
        ax, ay = anchor_of_row[rk]
        meta[rk] = {}
        for ci, name in enumerate(order):
            img = st[name]
            cellimg, _ = crop_cell(img, ax - aic[0] + cw / 2, ay - aic[1] + ch / 2, cw, ch)
            atlas[ri * ch:(ri + 1) * ch, ci * cw:(ci + 1) * cw] = cellimg
            meta[rk][name] = dict(u=ci * cw / (cols * cw), v=ri * ch / (rows * ch), w=1.0 / cols, h=1.0 / rows,
                                  px=[ci * cw, ri * ch, cw, ch])
    return atlas, meta

eye_atlas, eye_meta = build_atlas([('eye_l', eye_states['l']), ('eye_r', eye_states['r'])], EYE_ORDER, EYE_CELL,
                                  {'eye_l': eye_anchor['l'], 'eye_r': eye_anchor['r']})
save(eye_atlas, 'atlas_eyes.png')
mouth_atlas, mouth_meta = build_atlas([('mouth', mouth_states)], MOUTH_ORDER, MOUTH_CELL, {'mouth': (mx, my)}, MOUTH_ANCHOR_IN_CELL)
save(mouth_atlas, 'atlas_mouth.png')
brow_atlas, brow_meta = build_atlas([('brow_l', brow_states['l']), ('brow_r', brow_states['r'])], BROW_ORDER, BROW_CELL,
                                    {'brow_l': brow_anchor['l'], 'brow_r': brow_anchor['r']})
save(brow_atlas, 'atlas_brows.png')

# FX: variable-size tight cells, shelf packed
fx_meta = {}; shelves = []; PAD = 8; AW = 1536
x, y, shelf_h = PAD, PAD, 0
cells = []
for f in FX_IDS:
    p, b = fx_full[f]
    w, h = b[2] - b[0], b[3] - b[1]
    if x + w + PAD > AW:
        x = PAD; y += shelf_h + PAD; shelf_h = 0
    cells.append((f, b, x, y)); x += w + PAD; shelf_h = max(shelf_h, h)
AH = y + shelf_h + PAD
fx_atlas = np.zeros((AH, AW, 4), np.float32)
for f, b, cx_, cy_ in cells:
    w, h = b[2] - b[0], b[3] - b[1]
    fx_atlas[cy_:cy_ + h, cx_:cx_ + w] = fx_full[f][0]
    fx_meta[f] = dict(u=cx_ / AW, v=cy_ / AH, w=w / AW, h=h / AH, px=[cx_, cy_, w, h],
                      face_bbox_px=b, anchor_px=[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
                      anchor_uv=[(b[0] + b[2]) / 2 / FW, (b[1] + b[3]) / 2 / FH],
                      max_alpha=int(fx_parts[f][..., 3].max()),
                      kind='decal' if f in ('blush_l', 'blush_r', 'face_shadow', 'panic_shadow') else 'billboard',
                      inside_face_png=bool(b[0] >= 0 and b[1] >= 0 and b[2] <= FW and b[3] <= FH))
save(fx_atlas, 'atlas_fx.png')

# ============================================================================= 8. atlas.json
def region(name, anchor, cell, aic=None):
    aic = aic or (cell[0] / 2, cell[1] / 2)
    return dict(anchor_px=[round(anchor[0], 2), round(anchor[1], 2)], anchor_uv=[round(anchor[0] / FW, 5), round(anchor[1] / FH, 5)],
                cell_px=[cell[0], cell[1]], cell_uv_on_face=[round(cell[0] / FW, 5), round(cell[1] / FH, 5)],
                anchor_in_cell_px=[aic[0], aic[1]],
                cell_origin_on_face_px=[round(anchor[0] - aic[0], 2), round(anchor[1] - aic[1], 2)])

atlas_json = dict(
    schema='whalechan.face_atlas/1',
    source=dict(canonical='01_design/canonical/revisions/v005/canonical_v005.png', parts='03_parts/revisions/v005/final', masks='03_parts/revisions/v005/masks'),
    face=dict(file='neutral.png', base_no_eyes_mouth='base_no_eyes_mouth.png', base_skin_nose='base_skin_nose.png', head_base_clean='head_base_clean.png',
              size_px=[FW, FH], canonical_crop_box=list(FACE_BOX),
              note='UV (0,0) is the top-left of neutral.png; v grows downward. To use as a GL texture flip v = 1 - v. base_no_eyes_mouth.png has the drawn brow fragments baked in (use it with brows=neutral_verbatim or no brow layer); base_skin_nose.png is the same without them, for use under the brow atlas.'),
    conventions=dict(sides='character perspective: *_l is HER left, which is on screen-right (x larger). look_left = she looks to her left = iris moves +x.',
                     cell_anchor='every cell of an atlas is the same size and its anchor pixel (anchor_in_cell_px) lands on the region anchor of the face (anchor_px on neutral.png).',
                     uv_rects='u,v = top-left of the cell in atlas UV; w,h = cell size in atlas UV.'),
    regions=dict(eye_l=region('eye_l', eye_anchor['l'], EYE_CELL), eye_r=region('eye_r', eye_anchor['r'], EYE_CELL),
                 mouth=region('mouth', (mx, my), MOUTH_CELL, MOUTH_ANCHOR_IN_CELL),
                 brow_l=region('brow_l', brow_anchor['l'], BROW_CELL), brow_r=region('brow_r', brow_anchor['r'], BROW_CELL)),
    atlases=dict(
        eyes=dict(file='atlas_eyes.png', size_px=[eye_atlas.shape[1], eye_atlas.shape[0]], cell_px=list(EYE_CELL), anchor_in_cell_px=[EYE_CELL[0] / 2, EYE_CELL[1] / 2],
                  rows=['eye_l', 'eye_r'], states=EYE_ORDER, cells=eye_meta,
                  notes={'half': 'skin at 55 % alpha over the open eye (spec)', 'half_lid': 'upper 47 % of the aperture covered by skin plus a lid line (reads better)',
                         'closed': 'skin fill + the closed_eye_line arc flipped to a downward curve', 'happy': 'skin fill + closed_eye_line as drawn (upward arc)',
                         'surprised': 'open scaled 1.15 about the anchor', 'look_*': 'iris group offset 8 % of the aperture width, clipped to the eye white'}),
        mouth=dict(file='atlas_mouth.png', size_px=[mouth_atlas.shape[1], mouth_atlas.shape[0]], cell_px=list(MOUTH_CELL), anchor_in_cell_px=list(MOUTH_ANCHOR_IN_CELL),
                   rows=['mouth'], states=MOUTH_ORDER, cells=mouth_meta, lip_color=[int(v) for v in LIP_COLOR],
                   notes={'closed': 'the canonical drawn mouth, colour-keyed from the skin (verbatim pixels)',
                          'others': 'vector-synthesised in the canonical lip colour; v005 mouth_cavity/teeth/tongue hold no cavity art (they are skin-filled proxies)'}),
        brows=dict(file='atlas_brows.png', size_px=[brow_atlas.shape[1], brow_atlas.shape[0]], cell_px=list(BROW_CELL), anchor_in_cell_px=[BROW_CELL[0] / 2, BROW_CELL[1] / 2],
                   rows=['brow_l', 'brow_r'], states=BROW_ORDER, cells=brow_meta, synth=brow_synth_info,
                   notes={'neutral_verbatim': 'the canonical brow fragments (most of each brow is under the bangs)',
                          'neutral': 'a full stroke fitted to those fragments (axis, colour, centre) so the transformed states have something to move',
                          'transforms': 'up: dy -34; down: dy +14; down_inner: -14 deg about the outer end, dy +8; up_inner: +12 deg about the outer end, dy -6; tilted: +9 deg about centre, dy -26 (signs mirrored per side)'}),
        fx=dict(file='atlas_fx.png', size_px=[AW, AH], cells=fx_meta,
                notes='tight variable-size cells; anchor_px / face_bbox_px are in neutral.png pixel space and may lie outside it (inside_face_png=false) for FX that float beside the head. decal = clipped to head_base in the manifest (project onto the face mesh); billboard = floats beside the head.')),
)
json.dump(atlas_json, open(OUT + 'atlas.json', 'w'), indent=1)

# ============================================================================= 9. mood compose
def compose(eye_l='open', eye_r='open', brow_l='neutral', brow_r='neutral', mouth='closed', fx=(), use_verbatim_brows=False):
    if use_verbatim_brows:
        img = base_nem.copy()
    else:
        img = base_skin_nose.copy()
        img = over(img, brow_states['l'][brow_l]); img = over(img, brow_states['r'][brow_r])
    img = over(img, eye_states['l'][eye_l]); img = over(img, eye_states['r'][eye_r])
    img = over(img, mouth_states[mouth])
    for f in fx: img = over(img, fx_parts[f])
    return img

MOODS = [
    ('neutral',   dict(use_verbatim_brows=True)),
    ('cheerful',  dict(brow_l='up', brow_r='up', mouth='open_wide', fx=('blush_l', 'blush_r'))),
    ('smug',      dict(eye_l='half_lid', eye_r='half_lid', brow_l='down', brow_r='down', mouth='smile')),
    ('shy',       dict(eye_l='look_down_right', eye_r='look_down_right', brow_l='up_inner', brow_r='up_inner', mouth='wavy', fx=('blush_l', 'blush_r'))),
    ('hurt',      dict(brow_l='up_inner', brow_r='up_inner', mouth='frown', fx=('tear_l', 'tear_r'))),
    ('pouty',     dict(eye_l='look_left', eye_r='look_left', brow_l='down_inner', brow_r='down_inner', mouth='pout', fx=('blush_l', 'blush_r'))),
    ('confused',  dict(eye_l='look_up', eye_r='look_up', brow_l='tilted', brow_r='neutral', mouth='flat', fx=('question_mark',))),
    ('shocked',   dict(eye_l='surprised', eye_r='surprised', brow_l='up', brow_r='up', mouth='oh', fx=('sweat_drop',))),   # panic_shadow is a plain rectangle in v005; left out of the preview
    ('focused',   dict(eye_l='half_lid', eye_r='half_lid', brow_l='down_inner', brow_r='down_inner', mouth='flat')),
    ('sleepy',    dict(eye_l='closed', eye_r='closed', mouth='ou', fx=('sleepy_marks',))),
    ('gentle',    dict(mouth='smile', fx=('blush_l', 'blush_r'))),
    ('affection', dict(eye_l='heart', eye_r='heart', brow_l='up', brow_r='up', mouth='smile', fx=('blush_l', 'blush_r', 'heart_fx'))),
]
# reference tiles on the 1448x1086 sheet (x0,y0,x1,y1); neutral/affection have no tile
REF_TILES = {
    'cheerful': (505, 60, 775, 300), 'smug': (850, 95, 1105, 335), 'shy': (1120, 265, 1370, 500),
    'hurt': (1150, 525, 1385, 760), 'pouty': (1010, 745, 1270, 1010), 'confused': (730, 790, 990, 1040),
    'shocked': (430, 790, 690, 1040), 'focused': (170, 700, 425, 950), 'sleepy': (60, 445, 320, 700),
    'gentle': (195, 205, 415, 435), 'neutral': None, 'affection': None,
}
ref = Image.open(REF_SHEET).convert('RGB')
TILE = 360
try:
    font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 22)
    font_s = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 15)
except Exception:
    font = font_s = ImageFont.load_default()
cols = 4; rows = 3
sheet = Image.new('RGB', (cols * (2 * TILE + 24), rows * (TILE + 44)), (246, 243, 236))
d = ImageDraw.Draw(sheet)
mood_files = {}
for i, (name, kw) in enumerate(MOODS):
    img = compose(**kw)
    # show the face on a soft background, crop the face box to a square-ish window around the features
    win = (int(mx - 540), 20, int(mx + 540), 1100)
    face = np.clip(img, 0, 255).astype(np.uint8)
    pil = Image.new('RGBA', (FW, FH), (226, 236, 246, 255)); pil.alpha_composite(Image.fromarray(face))
    pil = pil.crop(win).resize((TILE, TILE), Image.LANCZOS).convert('RGB')
    Image.fromarray(face).save(OUT + f'_scratch/mood_{name}.png')
    mood_files[name] = f'_scratch/mood_{name}.png'
    cx0 = (i % cols) * (2 * TILE + 24) + 12; cy0 = (i // cols) * (TILE + 44) + 34
    sheet.paste(pil, (cx0, cy0))
    t = REF_TILES.get(name)
    if t:
        rt = ref.crop(t); rw, rh = rt.size; sc = TILE / max(rw, rh)
        rt = rt.resize((int(rw * sc), int(rh * sc)), Image.LANCZOS)
        sheet.paste(rt, (cx0 + TILE + 4, cy0 + (TILE - rt.height) // 2))
        d.text((cx0 + TILE + 4, cy0 - 26), 'reference sheet', fill=(120, 120, 120), font=font_s)
    else:
        d.rectangle((cx0 + TILE + 4, cy0, cx0 + 2 * TILE + 4, cy0 + TILE), fill=(235, 232, 225))
        d.text((cx0 + TILE + 24, cy0 + TILE // 2 - 12), 'no tile on the community sheet', fill=(120, 120, 120), font=font_s)
    d.text((cx0, cy0 - 30), name.upper(), fill=(30, 40, 80), font=font)
    d.text((cx0 + 120, cy0 - 26), ' '.join(f'{k}={v}' for k, v in kw.items() if k != 'fx' and k != 'use_verbatim_brows')[:70], fill=(120, 120, 120), font=font_s)
sheet.save(OUT + 'preview_expressions.png')

# atlas contact sheet for the report
def contact(atlas, order, rows, cell, scale, label):
    cw, ch = cell
    a = Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8), 'RGBA')
    bg = Image.new('RGBA', a.size, (200, 208, 216, 255)); bg.alpha_composite(a)
    bg = bg.resize((int(a.width * scale), int(a.height * scale)), Image.LANCZOS).convert('RGB')
    dd = ImageDraw.Draw(bg)
    for ci, n in enumerate(order):
        dd.text((ci * cw * scale + 4, 2), n, fill=(20, 20, 60), font=font_s)
        dd.line([(ci * cw * scale, 0), (ci * cw * scale, bg.height)], fill=(150, 150, 150))
    for ri in range(1, rows): dd.line([(0, ri * ch * scale), (bg.width, ri * ch * scale)], fill=(150, 150, 150))
    return bg
c1 = contact(eye_atlas, EYE_ORDER, 2, EYE_CELL, 0.25, 'eyes')
c2 = contact(mouth_atlas, MOUTH_ORDER, 1, MOUTH_CELL, 0.5, 'mouth')
c3 = contact(brow_atlas, BROW_ORDER, 2, BROW_CELL, 0.5, 'brows')
fxi = Image.fromarray(np.clip(fx_atlas, 0, 255).astype(np.uint8), 'RGBA'); fxbg = Image.new('RGBA', fxi.size, (200, 208, 216, 255)); fxbg.alpha_composite(fxi)
c4 = fxbg.resize((int(fxi.width * 0.5), int(fxi.height * 0.5)), Image.LANCZOS).convert('RGB')
Wc = max(c1.width, c2.width, c3.width, c4.width); Hc = c1.height + c2.height + c3.height + c4.height + 40
cs = Image.new('RGB', (Wc, Hc), (246, 243, 236)); yy = 0
for c in (c1, c2, c3, c4): cs.paste(c, (0, yy)); yy += c.height + 10
cs.save(OUT + 'preview_atlases.png')

open(OUT + '_build_log.txt', 'w').write('\n'.join(LOG))
print('DONE')
