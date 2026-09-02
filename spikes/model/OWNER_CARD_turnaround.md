> **Status 2026-09-01:** the four views were generated and accepted (`turnaround/front|left|back|right.png`, contact sheet `turnaround/_contact_sheet.png`). Use this card only to REGENERATE a view that fails the checklist.

# OWNER CARD — Whale-chan A-pose turnaround (front / left / back / right)

Purpose: four consistent orthographic views of Whale-chan that Tripo or Meshy can turn into one mesh.
A first set already exists in `D:\ds\spikes\model\turnaround\` (made with Gemini 3.1 Flash Image through
our tool chain; see `REPORT.md` for what is weak about it). Use this card if you want a better set from
ChatGPT Images, Nano Banana (Gemini), Seedream or Midjourney, or to regenerate a single failed view.

## Attach these reference images (same three for every view)

1. `D:\ds\spikes\model\reference\canonical_front_2048_white.png` — our canonical front (the face/outfit truth)
2. `D:\ds\spikes\model\reference\overview_side.png` — community side profile (silhouette of hair, ears, tail)
3. `D:\ds\spikes\model\reference\overview_back.png` — community back view (apron bow, hair, tail root)

Optional extra anchors when a generator allows more than three: `reference\costume_full_pose.png`,
`reference\overview_tail_attachment.png`, and once the front is accepted, the accepted `turnaround\front.png`
itself as reference 1 for the other three views (this is what keeps the views consistent).

Palette to quote if the generator takes hex codes: navy #122e62, deep navy #0a1f49, mid blue #2e57ab,
tail blue #22498c, cyan tips #54a2db, white #fdf9f6, gold #ce9d66, skin #f9c9b8 (`reference\palette.json`).

## Settings

- Resolution: at least 1024 x 1536 (2:3 portrait). Meshy needs 1040 px minimum; 2048 tall is better.
- Style: 2D anime cel illustration, flat colours, thin clean lines. Do NOT ask for 3D render, shading
  realism, or "concept art" (the 3D tool builds the shading itself).
- Background: pure flat white. Transparent PNG is also fine for both 3D services.
- One image per view, one view per prompt. Never ask for a 4-up sheet: the views come out at different
  scales and drift.
- Midjourney: add `--ar 2:3 --style raw --no text, watermark, shadow, props, bubbles, water` and use
  `--cref <url of front.png> --cw 100` for the three non-front views.

## Prompts

Shared block (paste before every view prompt):

> Exactly the same chibi whale-girl maid as in the attached references: about 2.8 heads tall, big head,
> short body. Long wavy blue hair, royal blue at the roots fading to cyan at the tips, reaching the waist,
> one curled ahoge on top. White frilled maid headband. Two small cyan hair bows. Navy whale-fin ears with
> white rims on the sides of the head. Navy long-sleeved maid dress with white frilled cuffs; white bib with
> a navy bow and a small jewel brooch; white frilled apron with a small blue whale emblem; navy skirt with
> thin gold trim lines and two small gold bows, white underskirt frill; white tights with small frilled
> socks; navy mary-jane shoes. One big navy whale tail growing from the lower back. Strict A-pose: both
> arms straight, angled about 35 degrees out from the body, elbows locked, palms toward the body, hands
> open; legs straight, feet flat, shoulder-width apart. Neutral calm expression, mouth closed, eyes open.
> Clean 2D anime cel style, flat colours, soft shading, thin clean lines. Orthographic view, no
> perspective, camera at chest height, character centred, feet at the bottom with a small margin.
> Pure flat white background. No ground shadow, no ground line, no props, no bubbles, no water, no motion
> lines, no text, no labels, no watermark, no second figure.

FRONT:
> FRONT VIEW, facing the camera. The tail curls around to her right side, so its two flukes show only on
> the viewer's left of the skirt hem, low near the ground; nothing on the viewer's right of the skirt.

LEFT:
> LEFT SIDE VIEW, true 90-degree profile, camera on her left, she faces the viewer's left. Only her left
> arm is visible, the far arm hidden behind the body. The tail extends horizontally backward to the
> viewer's right, flukes at the end, tail about as long as the skirt is wide. One hair bow and one fin-ear
> visible, the ear pointing backward.

BACK:
> BACK VIEW, camera directly behind her, no face visible. Both arms visible on either side in front of the
> hair, backs of the hands showing. From behind: top of the headband and the ahoge, hair covering the
> back to the waist, both fin-ears, both hair bows, a large white apron bow at the small of the back, the
> tail emerging just below that bow, hanging down and curling out to the viewer's right, flukes near the
> ground, heels of the shoes visible.

RIGHT:
> RIGHT SIDE VIEW, true 90-degree profile, camera on her right, she faces the viewer's right. Only her
> right arm is visible. The tail extends horizontally backward to the viewer's left, flukes at the end.
> (If the generator refuses to keep the right view consistent, mirror the accepted LEFT view instead: the
> design is bilaterally symmetric and the side-view tail is drawn straight back.)

Negative constraints for all views (if the tool has a negative field): text, watermark, signature, label,
sketch lines, ground shadow, ground line, floor, props, plush whale, bubbles, water splash, motion lines,
second character, cropped limbs, 3D render, photorealistic, hands on hips, arms down at the sides, arms
horizontal, open mouth, smile with teeth, extra tail, two tails.

## Acceptance checklist (compare the four images side by side before uploading)

Reject the view and regenerate if any line fails:

- [ ] Same character height in every view (measure ahoge tip to shoe sole in pixels; within 5 percent).
- [ ] Head to body ratio the same in every view (about 2.8 heads; the 3.5-head "portrait" form is wrong).
- [ ] Arm angle the same in every view (about 35 degrees from the body; the back view is the usual
      offender, it likes to go horizontal).
- [ ] Hair length the same (waist) and the cyan gradient starts at the same height (about the shoulders).
- [ ] Exactly one tail. Front: flukes on the viewer's left only. Back: tail exits under the apron bow and
      curls to the viewer's right. Sides: tail straight back, same length in left and right.
- [ ] Both fin-ears present in front and back, one in each side view, white rim visible.
- [ ] Headband, two hair bows (both cyan), bib bow + brooch, apron with whale emblem, two gold skirt
      bows, gold trim lines, underskirt frill, frilled socks, mary-janes: all present in every view where
      they are physically visible. The socks are the item most often dropped in side views.
- [ ] Mouth closed, neutral face, eyes open (front only; sides show one eye, back shows none).
- [ ] Feet flat, both shoes visible, no ground line or shadow, background pure white (check the corners).
- [ ] No text, watermark, bubbles, plush whale, splash, or second figure anywhere.
- [ ] Skirt length the same (mid-thigh) front and back; the back view likes to shorten it.

## Then

Save the accepted files as `D:\ds\spikes\model\turnaround\front.png`, `left.png`, `back.png`, `right.png`
(overwriting the generated set is fine; the originals are kept under `turnaround\_candidates\`), and run
`python D:\ds\spikes\model\scripts\assemble_turnaround.py` after editing its PICK table if you want them
re-normalised (same figure height, same baseline, 2560 x 3072 white canvas). Then continue with
`OWNER_CARD_3d.md`.
