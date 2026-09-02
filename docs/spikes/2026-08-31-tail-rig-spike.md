# Tail rig spike — findings

**Date:** 2026-08-31
**Spike:** `spikes/tail/` (run it; the defects below are reproducible in about a minute)
**Subject:** run `deepseek_humanized_20260830_001`, parts revision `v001`, canonical `v005`

A six-bone chain with CPU linear-blend skinning was driven over the real extracted parts in a
transparent always-on-top Electron window, using a verbatim port of `stepTailFixed()` from
`packages/stage/src/interaction-rig.ts`.

## Result

Procedural bone-driven posing over these parts **works**, and it is cheap:

| metric | value |
|---|---|
| frame rate | 60 fps |
| CPU per frame (solver + skinning + upload) | 0.19–0.27 ms, max 1.0 ms |
| bone angles at full pull | 30.0° 26.2° 13.1° 3.8° 1.0° 0.6° |

The spring solver reads well — the release whip propagates visibly down the chain and the
flukes track the tip. Performance is not a constraint at this scale.

## Defects found

Every one of these is invisible in a static composite and appears the moment a part moves.
That is the point: they were undetectable until something animated.

### D1 — the tail is two disconnected pieces (blocking)

```
tail_root   spans x 2272..2483
tail_stock  spans x 2564..3131
            64 empty columns between them, 0 overlapping pixels
```

There is no art at all between x 2484 and x 2547. At rest the hole is covered by 24,315
pixels of skirt/dress/hip, so the neutral composite looks perfect. Rotate the tail and it
splits in half.

Neighbouring parts that must deform together need a real overlap band, not a butt joint.
Every other articulated boundary in the 138 (shoulder/upper_arm, upper_arm/forearm,
forearm/hand, thigh/lower_leg, lower_leg/foot, neck/head) should be checked for the same
thing before any of them is rigged.

### D2 — `tail_fluke_upper` carries art that is not the fluke (blocking)

```
tail_fluke_upper — 242 connected components
  main body   299,731 px   x 2924..3487  y 4240..5067
  ORPHAN       21,788 px   x 2568..2787  y 4068..4339   ~350 px from the body
  ORPHAN        1,814 px   x 2548..2591  y 4360..4455
```

~23,600 px of what looks like hair was assigned to the fluke layer. It sits behind her hair
at rest, so nothing shows. When the tail moves it flies across the skirt as a detached blue
squiggle — clearly visible in `spikes/tail/evidence/sheet_final.png`.

### D3 — the parts QA cannot detect D2 (systemic)

`parts_v001_report.json` gates on reassembly error against the canonical (0.24/255 mean
absolute, 0 unassigned pixels) and reports `pass`. That check is **by construction blind to
layer mis-assignment**: a pixel on the wrong layer but in the right place composites to the
same image. Only motion reveals it.

Any of the 138 parts could carry the same defect today with a green QA report. A connected
component count per part would catch it cheaply — every part should be one island (plus
deliberate exceptions such as paired highlights), and anything with a second island larger
than a few hundred pixels is a mis-assignment.

### D4 — hidden-region reconstruction is too shallow at the tail/skirt seam

Only 25,403 of `tail_stock`'s 176,607 pixels (14%) sit behind `skirt_back`. Its cut edge is
a straight line roughly 20 canvas px inside the skirt hem, so any meaningful rotation exposes
it as a hard rectangular step.

This is risk **R03** from `05_cubism/revisions/v00*/unresolved_art_risks.json`, now measured
rather than predicted. Ramping bone influence in across the overlap (weight painting) hides
most of it — see `evidence/sheet_tuned.png` — but not all. The art needs more margin.

### D5 — FX overlays default to visible

Only 3 of the 25 generated overlays carry `default_runtime_opacity: 0` in
`04_psd/revisions/v001/packager_job.json`. Composite the layers at their stated defaults and
tears, bubbles, sparkles, a heart and sleepy-marks all render at once, permanently. Every
expression FX layer should default to 0 and be raised only by an expression.

### D6 — `face_shadow` and `panic_shadow` are flat ellipses

Both are solid pale ovals with no shading, ~18% mean opacity over the whole head. They grey
out her face in F03 angry, F04 sad, F07 awkward, F08 think and F11 error_panic. Fix before
rigging: repainting a source part after the rig is bound is far more expensive.

## Rig lesson

Mesh deformation contributed little at first (44k differing pixels vs a rigid transform)
because hand-placed joints put the whole bend at the root. Distributing bend along a limb and
ramping weights across a seam is fiddly, visual, iterative work — it is precisely what a
rigging editor's weight painting and visual joint placement exist to make tractable.

The renderer is the cheap half of a skeletal pivot. The rigging craft is the expensive half.

## Resolution (2026-09-01)

Parts revision **v005** rebuilds all 138 parts from the same approved canonical, anchors, zones
and face rules, and replaces only the two mechanisms responsible for D1 and D2. v001 is untouched
(138 of 138 final PNGs verified byte-identical to their recorded hashes). Scripts and their
rationale: `tools/parts/`, executable copies in `runs/<run>/03_parts/revisions/v005/scripts/`.

What changed in the extraction, in order of what it fixed:

1. **Partition.** Seeded watershed inside the zones whose parts are separated by drawn outlines
   (tail, hair, stocking/shoe); v001's ellipse-normalised nearest-anchor rule kept for the
   one-fabric zones (dress, sleeves, skirt panels, frills, bows, bonnet), where equal-speed
   flooding let the largest seed eat its neighbours. A neighbour-vote island cleanup reassigns
   leaked fragments; a colour gate strips the white frill v001 had given `tail_root`.
2. **Arms.** Since v001 the hair zone, which runs last and whose `blue` test accepts navy, had
   given both sleeve bodies to `hair_back_strand_l/r` and `hair_back_inner_l`; the sleeve parts
   held only their trim (154 and 99 work px). Dark pixels inside each arm polygon now go to that
   arm's sleeve parts (6,736 and 6,694 work px).
3. **Band.** Sized from the plan's own `motion_envelope` and `occluded_by` (64–320 source px),
   grown geodesically so it can never jump across a lower part, placed only on solid pixels
   (alpha ≥ 200 rather than exactly 255, which had turned 2.8% of the interior into hairline
   walls), filled by continuing the part's own pixels and fading to its median colour, and kept
   connected to the part's art.

Measured on the finished revision, same audit script as the v001 numbers above:

| seam | v001 | v005 |
|---|---|---|
| tail_root → tail_stock | 0 px (80 px gap) | 100,856 px |
| tail_stock → tail_fluke_upper | 17,036 | 175,552 |
| sleeve_upper_l → sleeve_lower_l | 64 | 109,632 |
| sleeve_lower_l → cuff_l | 8,690 | 118,924 |
| sleeve_upper_r → sleeve_lower_r | 0 | 101,216 |
| stocking_l → shoe_l | 19,390 | 83,671 |
| forearm_l → hand_l | 18,847 | 44,448 |
| reassembly error vs canonical | 0.239 / 255 | 0.240 / 255 |

The six seams the old audit still reports torn are all between hidden-only anatomy proxies
(hip, torso, thigh, foot, upper arm, forearm), which have zero visible pixels and are not bound
by a rig (`docs/DECISIONS.md` D-2026-09-01-03).

**Continuity gate** (`qa_continuity.py`, now the parts gate): 184 touching pairs derived from the
art, 0 leaked fragments, 0 torn seams, one active waiver (`skirt_front_l → hand_l`, 84%)
where the hand nests inside the cuff and lower-z geometry makes a fuller band impossible
without changing the at-rest composite. The
gate had to learn three things on the way: a greyscale mask read as RGBA is alpha 255 everywhere
(every check passed vacuously until a sanity assertion was added); a seam is only where two parts
meet through solid pixels, so the zone is geodesic and excludes silhouette contacts; and face
detail riding on face detail is one unit to a rig.

**Spike on v005 parts** (`evidence/sheet_v005_tail.png`): one continuous tail in idle, pulled
and mid-whip, no gap at the root, no stray fragment, 60 fps at 0.10–0.13 ms/frame. What remains
visible under a 30° root swing is the band's own end at the skirt hem, which the weight ramp
mostly hides; a longer envelope or rig-side weighting finishes it.

Still open, deliberately: D5 (FX overlays default visible) is a stage-04 fix; D6 (flat-ellipse
shadows) is moot since the owner rejected patch-based expressions (`03_parts/revisions/v003`);
the hidden-only anatomy proxies should sit at zero opacity in any rig.
