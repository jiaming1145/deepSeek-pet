# Face texture kit from the v005 parts — spike report

Directory: `D:\ds\spikes\model\face\`. Build: `python build_face.py` (~35 s, Python 3.13 + numpy/cv2/PIL). Check: `python verify_atlas.py`.
Nothing under `runs/` was written; the parts, masks and canonical were read only.

## What is here

| file | size | what |
|---|---|---|
| `neutral.png` | 1360x1152 RGBA | her drawn face, hair removed, eyes open, mouth as drawn (the canonical closed smile) |
| `base_no_eyes_mouth.png` | 1360x1152 | skin + nose + the drawn brow fragments, no eyes, no mouth — the 3D face-texture base (spec) |
| `base_skin_nose.png` | 1360x1152 | same without the brow fragments — use this one under the brow atlas |
| `head_base_clean.png` | 1360x1152 | skin only (the whole head ellipse, skin continued under where the bangs were) |
| `atlas_eyes.png` | 8960x1408 | 14 states x 2 rows (eye_l, eye_r), cell 640x704, anchor = cell centre |
| `atlas_mouth.png` | 4480x288 | 14 states, cell 320x288, anchor (160,100) in the cell |
| `atlas_brows.png` | 2688x512 | 7 states x 2 rows, cell 384x256, anchor = cell centre |
| `atlas_fx.png` | 1536x2853 | 15 tight variable-size cells (blush, tears, sweat, anger, ?, sparkles, zzz, heart, face/panic shadow) |
| `atlas.json` | | cell size, anchor, `{state:{u,v,w,h}}` per atlas, region anchors on `neutral.png` in px and 0..1 UV, FX anchors |
| `preview_expressions.png` | 2976x1212 | 12 moods composed from the atlases, each beside the community sheet tile |
| `preview_atlases.png` | | contact sheet of the four atlases |
| `build_face.py`, `verify_atlas.py` | | the pipeline and the independent round-trip check |
| `_scratch/` | | evidence crops (`mood_*.png` full-res composites, `view_*.png`, `roundtrip_*.png`, `parts_sheet.png`) |

The face crop is canonical box `(864, 2688, 2224, 3840)`; every anchor in `atlas.json` is in that crop's pixel space (and as UV of `neutral.png`, v downward — flip for GL).

Region anchors (px on neutral.png): eye_l (960, 562), eye_r (448, 562), mouth (699.5, 814.5), brow_l (920.9, 340.8), brow_r (415.0, 344.6). Sides are character-perspective as in the manifest: `*_l` is HER left, on screen-right.

## What the v005 parts actually contain (this drove every decision)

Read the provenance JSONs and rendered every face part before compositing (`_scratch/parts_sheet.png`). Verified by running, not assumed:

1. **Only the pixels under `masks/<part>_visible_mask.png` are drawn art.** The rest of each final PNG is a synthetic "hidden band" (`brow_r`: 2,448 real px vs 190,208 band px containing a chunk of hair and the eye; `mouth_corner_l/r`: 464 real px in a 220x220 skin blob that covers the mouth cavity when composited in z-order). I composite verbatim canonical pixels under the visible masks only.
2. **The visible masks of `head_base`, `eye_white_*` and the lashes carry the bang pixels that overlap the face** — the partition never gave them to the hair parts (457,101 of head_base's 669,712 "visible" px classify as hair). Naively compositing gives a face texture with crisp hair painted on the forehead and hair chunks inside the eye cells (first run). Fixed by colour classification (hair: `B-R>35 & B>60`; skin: `R>185, B>110, G>165, R-B<70, R>=G+4, B<=G+15`, minus a 16 px rim around hair, minus dark pixels, minus everything below the jaw line y=950 where the mask is neck/collar).
3. **head_base's band under the eyes and mouth is mottled and blue.** Every non-trusted pixel of the head ellipse (1,379,041 of 1,473,456) is re-synthesised from the 94,415 trusted skin pixels by a multi-scale normalised convolution (sigma 12/30/80/200): smooth skin that keeps the blush and chin shading. `cv2.inpaint` was tried first and smeared lash residue into the sockets. This is also the right thing for a 3D texture: skin continues under the hair mesh.
4. **The drawn mouth is not in the mouth parts.** `upper_lip_line`/`lower_lip_line`/`mouth_corner_*` have 464 visible px each (28x28 blocks); the actual red smile strokes belong to head_base's mask. The `closed` mouth cell is therefore colour-keyed from the canonical inside a search window (974 px, lip colour sampled from the stroke core = (230,128,117)).
5. **`mouth_cavity`, `upper_teeth`, `lower_teeth`, `tongue`, `mouth_highlight` contain no cavity art.** The cavity is a skin-coloured proxy holding the closed smile; teeth/tongue are v001 vector patches. So every open-mouth state (`open_small`, `open_wide`, `aa ih ou ee oh`, `chew`) is **vector-synthesised** in the sampled lip colour (outline), a dark red cavity, white teeth band and pink tongue, anchored at the real mouth and sized from the real stroke width (117 px). The spec's "scale the open composite" was not possible: there is no open composite to scale.
6. **`eyelid_fill_*` and `mouth_cover_skin` are the wrong pink** (249,201,184 vs skin 254,244,234) — replaced by the cleaned base's own skin under the region (so closed eyes have no colour seam). `closed_eye_line_*` is an upward arc (a happy eye): used as-is for `happy`, flipped to a downward curve for `closed`.
7. **Brows are mostly under the bangs**: 2,585 / 2,333 dark px of fragments. `neutral_verbatim` keeps the fragments; all other brow states are a full stroke fitted to the fragments (PCA axis: -0.8 deg / 6.4 deg, colour (24,36,67)) so there is something to move. Documented in `atlas.json.atlases.brows.synth`.
8. `panic_shadow` is a plain rectangle gradient, `face_shadow` a plain ellipse (v001 overlays); kept in the FX atlas, left out of the preview.

Neutral composite vs canonical over the verbatim zone: mean abs error 0.166, p99 3.84 (8-bit) — the drawn pixels are untouched.

## Atlas states

- **eyes** (per eye): `open`, `half` (skin at 55 % over open, as specified — reads as a ghost, see preview), `half_lid` (upper 47 % covered + lid line — reads as a real half-closed eye; recommended), `closed`, `happy`, `surprised` (x1.15 about the anchor), `heart`, `spiral`, `look_left/right/up/down` (+ `look_down_left/right`): iris group offset 8 % of the aperture (32.6 px), clipped to the eye white, sclera continued under the iris by inpainting from clean white pixels only.
- **mouth**: `closed`, `smile`, `open_small`, `open_wide`, `aa`, `ih`, `ou`, `ee`, `oh`, `chew`, plus `flat`, `frown`, `wavy`, `pout` (added because the moods needed them).
- **brows**: `neutral`, `neutral_verbatim`, `up`, `down`, `down_inner` (angry), `up_inner` (sad), `tilted` (question). Transforms are listed in `atlas.json`.
- **fx**: 15 cells with `face_bbox_px`, `anchor_px`, `anchor_uv`, `kind` (decal = clipped to head_base in the manifest, project onto the face mesh: blush, face_shadow, panic_shadow; billboard = floats beside the head: tears, sweat, anger, ?, sparkles, zzz, heart) and `inside_face_png` (anger, ?, sparkles, zzz, heart sit above/beside the crop, e.g. question_mark anchor (1542,112), sparkle_r (-74,46)). Blush max alpha is 138 (as drawn); head_base already has a faint baked blush.

## Preview — honest read of `preview_expressions.png`

Viewed at half and full size. Left tile = our composite on the clean base (no hair; the 3D hair mesh covers the forehead), right tile = the community sheet crop.

| mood | recipe | reads? | what the atlas cannot do yet |
|---|---|---|---|
| neutral | as drawn | yes — it is the canonical face minus hair | (no sheet tile; compare `_scratch/canon_face.png`) |
| cheerful | brows up, open_wide, blush | mostly — open smiling mouth with teeth and tongue, blush | sheet mouth is a rounded D; ours is a U with a slightly pointed feel |
| smug | half_lid, brows down, smile | partly — narrowed eyes + smile | no smirk (asymmetric mouth), no sideways glance combined with the half lid |
| shy | look_down_right, up_inner, wavy, blush | partly | blush is much weaker than the sheet's heavy blush-lines; no eye-shrink; no hands |
| hurt | up_inner, frown, tears | partly — brows and frown read, tears are large v001 ovals | no watery/wobbling eye, no `><` eyes, no jagged mouth |
| pouty | look_left, down_inner, pout, blush | weakly | **cheek puff is impossible with a texture**; needs a blendshape/mesh; mouth-off-centre state missing |
| confused | look_up, brow_l tilted, flat, ? | partly (brows/eyes) | the `?` billboard sits outside `neutral.png`, so it is not in the tile; no finger |
| shocked | surprised, brows up, oh, sweat | weakly | **the sheet shrinks the iris**; our `surprised` scales the whole eye and keeps the iris large, so it reads "alert", not "shocked". A `shrunk_iris` state is the missing piece |
| focused | half_lid, down_inner, flat | yes | — |
| sleepy | closed, ou, zzz | yes for eyes | yawn mouth is a plain `ou`; zzz billboard outside the tile |
| gentle | smile, blush | yes | — |
| affection | heart, brows up, smile, blush, heart_fx | yes (no sheet tile) | — |

States the atlas cannot express and that the sheet uses: shrunken iris (shock), asymmetric smirk, cheek puff, `><`/wobble eyes, heavy blush hatching, teeth-grit and jagged mouths, tongue-out. Brow states are synthetic strokes; if the 3D hair covers the brow line (it does in the canonical) that matters little.

## Verification (ran)

- `python build_face.py` -> `DONE`; log in `_build_log.txt` (trusted skin 94,415 px; neutral vs canonical mean 0.166 / p99 3.84; lip colour (230,128,117); brow axes -0.8 / 6.4 deg).
- `python verify_atlas.py` (rebuilds faces from `atlas.json` + the atlas PNGs only, the way a texture-transform shader would):
  `neutral round trip: mean |diff| rgba = 0.000, p99.9 = 0.00, max = 1.1 (over 1473456 px)` and
  `cheerful vs build composite: mean |diff| = 0.022, p99.9 = 0.95` — the JSON anchors and UV rects place every cell exactly.
- Every image above was opened and looked at (`_scratch/view_*.png`, `preview_atlases.png`, full-res cell crops `_scratch/eye_cells_fullres.png`, `_scratch/mouth_cells_fullres.png`).

Not done: no Electron/three.js render — this task produced the texture kit; the previews are 2D composites of the same cells a shader would sample. For the runtime, downsample: the eye atlas at 8960x1408 is source resolution; a 2240x352 (x0.25) copy is plenty for a chibi head on screen.

## Using it in three.js (sketch, untested)

Face material: `base_skin_nose.png` (or `base_no_eyes_mouth.png`). Five overlay quads or one shader with five `uv` transforms: for region R and state S, sample the atlas at `cell.u + (uv_face - cell_origin_on_face_uv) * (atlas_size / face_size)`; `regions.<R>.cell_origin_on_face_px` / `cell_uv_on_face` in `atlas.json` give the mapping. Crossfade = blend two states' samples. Decal FX go on the face UV at `anchor_uv`; billboard FX at `anchor_px` relative to the head, facing the camera.
