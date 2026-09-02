# spikes/model - reference pack, turnaround, owner cards (2026-09-01)

Scope: items 1-4 of the "3D VRM chibi" model-creation brief. Everything written lives under
D:\ds\spikes\model\. No other path was touched; Codex's uncommitted work was not read or modified
(git status after the run: spikes/model/ is the only new path from this task).

## 1. Reference pack - reference\ (verified: ran scripts\build_reference_pack.py, viewed the contact sheet)

Source: community kit sheets (1448 x 1086 webp, CC BY-NC-SA 4.0) and our canonical v005 (4096 x 8192).
Method: hand-picked crop boxes; the sheet's cream background is flood-filled from the border and only the
largest connected foreground component is kept (drops labels, arrows, bubbles, sparkles); known label boxes
that overlap a figure are painted with the background colour first. Upscale is Lanczos only (2x to 4.3x),
so no detail is invented; every output is >= 1024 px on the long side (asserted in code). Each crop is
saved twice: name.png (on white) and name_rgba.png (transparent). manifest.json records crop box, source
and output pixel sizes per file.

| file | what | out px |
|---|---|---|
| overview_front | front view (reaching pose) from the overview sheet | 628 x 1024 |
| overview_side | side profile | 883 x 1024 |
| overview_back | back view | 757 x 1024 |
| overview_tail_attachment | tail-root / apron-bow detail circle | 1024 x 925 |
| tail_at_rest_back, tail_turning_side, tail_accelerating_side, tail_balancing_side, tail_cozy_hug | tail-motion sheet poses | 663-1024 px |
| costume_headband_ruffle, costume_jeweled_bow, costume_white_bib, costume_gold_trim_hem, costume_whale_apron_motif | costume callout circles | ~1000 px |
| costume_full_pose, color_full_pose | full figure from the costume and colour sheets | 940 / 847 x 1024 |
| portrait_standard_form_4head | the 4-head "standard form" portrait (face reference only; wrong proportions for the chibi) | 791 x 1440 |
| canonical_front_2048_rgba / _white | our canonical, Lanczos to 1024 x 2048 | 1024 x 2048 |

Residue seen and left (honest): the light-blue puddle under the feet in overview_front and the *_full_pose
crops (it touches the shoes so the component filter keeps it); a small navy notch at the bottom of
costume_gold_trim_hem where the sheet's label overlapped the circle; the plush whale in tail_cozy_hug (part
of the pose). _contact_sheet.png shows all 17 crops.

palette.json: 14 named colours. Sheet colours are medians of hue-filtered pixels inside the named callout
circles / swatch dots; canonical colours are medians of the opaque pixels of the named v005 part PNGs (our
own art wins for the texture). Key values: navy #122e62, deep navy #0a1f49, mid blue #2e57ab, tail blue
#22498c, cyan tips #54a2db, white #fdf9f6, gold #ce9d66, skin #f9c9b8. Raw samples in _palette_raw.json.

## 2. Turnaround - turnaround\front.png, left.png, back.png, right.png (2560 x 3072 each)

Tool check: mcp__gpt-collab__design_image accepts reference_images (max 16, project-relative paths).
The OpenAI route failed with "429 insufficient_quota / credit_balance_exhausted" (no OpenAI credits on the
key), so all generation went through Gemini: gemini-2.5-flash-image (first three, 832 x 1248) and
gemini-3.1-flash-image at 2K (1696 x 2528). 11 images generated; every one viewed. All candidates kept in
turnaround\_candidates\.

Accepted (viewed, described honestly):
- front = front_v4_g31-0.jpg: neutral face, mouth closed, arms straight at ~35 degrees, feet flat, single
  tail with flukes on the viewer's left, frilled socks, both bows cyan, all costume elements. It drew a thin
  ground line under the shoes; assemble_turnaround.py strips it (bottom crop checked, shoes intact).
- back = back_v4_g31-0.jpg: arms at ~35 degrees matching the front, apron bow, tail exits below the bow and
  curls to the viewer's right (consistent with the front's viewer-left flukes = her right side), gold skirt
  bows, socks, heels. Generated from the front + community back only, which broke the "arms horizontal"
  anchoring that v2/v3 inherited from each other.
- right = right_v1_g31-0.jpg: clean profile facing right, tail straight back, socks, one bow, fin-ear.
- left = mirror of right (the design is bilaterally symmetric and the side-view tail is drawn straight
  back). left_v1 and left_v2 were generated too; both lacked the socks and had a different tail length, so
  the mirror is the more consistent choice. Recorded in turnaround\manifest.json.

Rejected: front_g25-0 (arms ~20 degrees, tail as a long side appendage), front_v2 (arms hanging),
front_v3_g31 (TWO tails, one per side, longer legs, one navy bow), back_v1 (no arms visible, shorter skirt),
back_v2 / back_v3 (arms near-horizontal, ground line), left_v1 / left_v2 (no socks; ground shadow on v1).

Normalisation: each accepted image is cropped to its figure, scaled so ahoge-to-sole = 2700 px, centred on
a 2560 x 3072 white canvas with the soles on one baseline (y = 2900). turnaround\_contact_sheet.png shows
the four side by side.

Known weaknesses of this set (the owner card lists them as reject criteria for a second pass):
- Arm angle: front/back ~35 degrees, sides ~15 degrees (the profile arm hangs closer to the body). Gemini
  never produced a true 45-degree A-pose in 11 tries; 35 degrees is the best it gave.
- Tail: side views show a long straight tail (about 1.2x skirt width); front/back show it curling to her
  right. A 3D tool will get a plausible but not identical tail from these; expect to fix the tail in Blender.
- Skirt reads a little shorter in the back view than in the front; hair covers most of the back bodice.
- Gemini 3.1 returned JPEG; re-saved as PNG after normalisation. Fine for image-to-3D input.

## 3. OWNER_CARD_turnaround.md
Copy-paste card: which three references to attach (paths), a shared design block plus one prompt per
view, negative list, resolution/style settings per generator (ChatGPT Images, Nano Banana, Seedream,
Midjourney --cref), and a 12-point acceptance checklist built from the failures seen above.

## 4. OWNER_CARD_3d.md
Tripo Studio and Meshy web-UI steps: multi-view slots (Tripo API order front, left, back, right; front
required, min 2 views. Meshy: main image + Multi-view toggle exposing Left / Back / Right slots), settings
(model version, geometry/texture quality, quad off for the first pass, symmetry auto, Meshy Pose = A-Pose,
Auto Split off), auto-rig (Tripo: Rig, Biped, spec tripo/mixamo, GLB out; Meshy: Animate > Humanoid, joint
markers, Auto-Rig, Download > Animation > All Added > Single File), export (GLB with rig, textures embedded;
neither service exports VRM), download locations generated\tripo\ and generated\meshy\ (created, empty).

Verified via WebFetch on 2026-09-01: docs.tripo3d.ai pricing (credit table: multiview-to-model H3 20/30,
P1 40/50, rig 25, quad +5, detailed texture +10, conversion 5), multiview-to-model P1-20260311 parameters,
rig v2.5-20260210 parameters, export/conversion formats (GLTF, USDZ, FBX, OBJ, STL, 3MF; no VRM);
developers.tripo3d.ai image-to-multiview; meshy.ai/pricing (Free 100 credits CC BY 4.0, Pro $20 / 1,000);
meshy.ai/features/image-to-3d; meshy.ai/tutorials/multi-view-image-to-3d (slot labels, 1040 px minimum,
20 credits); help.meshy.ai Image-to-3D article (Meshy 7, Pose A/T/Custom, Auto Split);
meshy.ai/tutorials/character-auto-rigging-workflow.
NOT verified: the live Tripo Studio UI (tripo3d.ai returned HTTP 403 to the fetcher); Tripo plan prices come
from third-party pages (costbench.com, "verified 2026-08-24": Free 200 credits, CC BY 4.0 non-commercial,
Pro $19.90 / 3,000 credits; tripo3ds.com: multi-view listed at Professional and above). The card says so.

Assumption flagged in the card: tools/vrm/README.md does not exist yet, so the Blender-side expectation is
stated as "rigged GLB, humanoid skeleton, embedded textures, A- or T-pose, glTF default orientation".

## Commands run (evidence)
- python scripts/build_reference_pack.py -> 17 crops with per-crop size and background fraction.
- python scripts/extract_palette.py -> sheet samples + 72 canonical part medians.
- python scripts/assemble_turnaround.py -> front/right/back bboxes and scales, mirrored left, contact sheet.
- JSON validation + size assertions over reference\*.png (all >= 1024 long side): passed.
- 11 design_image calls (Gemini) all viewed; 1 failed OpenAI call (quota); 1 Gemini 503 retried on 2.5.
- Screens viewed: reference\_contact_sheet.png (twice, before and after the isolation fix),
  every candidate, turnaround\_contact_sheet.png, bottom crops of front.png and back.png.

## Not done / for the controller
- No OpenAI image credits: gpt-image-1.5 edits (input_fidelity high) was the intended first route; if
  credits are added, rerun the front with provider openai and the same prompt for a stricter A-pose.
- Turnaround consistency is "good enough to try Tripo/Meshy", not "strict"; the owner card's checklist is
  the bar for a second pass.
- generated\ stays empty until the owner runs the 3D card.
