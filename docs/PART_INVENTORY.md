# Live2D part inventory

This is a planning baseline, not a command to create every possible layer. Create a part when it is visible, moves independently, acts as a clipping surface, or must reveal hidden artwork during expected motion.

`l` and `r` are always the character's left and right.

## Core face and head

Required for a standard front-facing model:

- `head_base`: complete face, jaw, forehead, and scalp area needed under hair.
- `ear_l`, `ear_r`: include hidden attachment area under hair.
- `neck`: extend under jaw, hair, collar, and torso clothing.
- `nose`: line/shadow/highlight as one part unless expression control requires separation.
- `brow_l`, `brow_r`.
- Optional overlays: `face_shadow`, `blush_l`, `blush_r`, `freckles`, `sweat`, `tear_l`, `tear_r`.

## Each eye

Create the same logical set for left and right:

- `eye_white_*`: full sclera shape, including pixels hidden by lids.
- `iris_*`: full iris disk or ellipse.
- `pupil_*`.
- `iris_detail_*` or `iris_gradient_*` when independent color/effect control is needed.
- `eye_highlight_primary_*` and optional secondary highlight.
- `upper_lash_*`.
- `lower_lash_*`.
- `eyelid_line_*` or `closed_eye_line_*`.
- `eyelid_fill_*` when needed to cover the eye during blinking.
- `eye_shadow_*` or makeup when it must move independently.

Do not crop the iris or sclera to the open-eye shape. Blinking and eye rotation require hidden pixels.

## Mouth

Baseline mouth set:

- `mouth_cavity`.
- `upper_lip_line`.
- `lower_lip_line`.
- `closed_mouth_line` when the design uses a distinct closed form.
- `upper_teeth`.
- `lower_teeth` when visible in wide-open shapes.
- `tongue`.
- `mouth_corner_l`, `mouth_corner_r` when corner deformation needs independent control.
- Optional `lip_fill`, `lip_highlight`, or `mouth_cover_skin` for the chosen rigging method.

All internal elements need additional hidden area beyond the neutral closed-mouth opening.

## Hair

Minimum logical groups:

- `hair_back_base` behind head and body.
- Back-hair lobes or strands that need independent physics: left outer/inner, right outer/inner, center, ponytail, braid, bun, or long strand segments.
- `hair_front_base` when a stable front mass exists.
- Bangs split into center, left, right, and any independently swinging strands.
- `side_lock_l`, `side_lock_r`; split root and tip only when the motion benefit justifies it.
- `sideburn_l`, `sideburn_r` when distinct from bangs.
- `ahoge` or antenna strands.
- Hair accessories split into rigid base and moving tails/loops.

The head base must be complete under front hair. Back hair must include hidden roots and overlap behind the neck/shoulders.

## Torso, limbs, and hands

Create only the anatomy or covered base required by the outfit and motion:

- `torso_base` or `torso_skin`.
- `shoulder_l`, `shoulder_r` when arms move independently.
- `upper_arm_l`, `upper_arm_r`.
- `forearm_l`, `forearm_r`.
- `hand_l`, `hand_r`; split fingers only for explicit hand animation.
- For full body: `hip_base`, `thigh_l/r`, `lower_leg_l/r`, `foot_l/r`.

Extend joints under adjacent pieces. Never terminate an arm exactly at a sleeve edge or a leg exactly at a skirt edge.

## Clothing

Split by independent motion and draw order, not by every painted color region:

- garment back panel(s) behind body.
- torso garment base.
- collar back and front pieces.
- lapel, scarf, tie, bow knot, bow loops, and bow tails when they move separately.
- sleeve upper/lower sections and cuffs when arms bend.
- jacket or coat front left/right panels.
- skirt back, front center, front left/right, and loose side panels as required.
- pants/shorts left and right legs for full-body movement.
- socks and shoes left/right when feet move.
- buttons, zipper pull, chains, badges, and straps only when independent motion or toggle control is intended.

A shadow or highlight can stay merged into its parent unless clipping, recoloring, or independent deformation requires separation.

## Accessories and toggles

Conditional parts:

- glasses frame, bridge, lenses, temples, lens glare.
- earrings left/right and dangling segments.
- horns, animal ears, tails, wings, halo, headphones, microphone, or props.
- expression toggles such as blush, tears, veins, stars, hearts, or alternate pupils.
- alternate outfits, sleeves, hand poses, or props in clearly separated groups.

## Metadata required for every part

- unique `id` and display name.
- parent group and category.
- character side: `l`, `r`, `center`, or `none`.
- z index and draw-order notes.
- whether it is imported into Cubism.
- visible-source mask path.
- whether hidden reconstruction is required.
- parts it occludes and parts that occlude it.
- clipping target, if any.
- motion role and motion envelope.
- required overlap or bleed.
- source hash, prompt revision, and review status.

## Separation test

A planned layer is justified only if at least one is true:

1. It moves or deforms independently.
2. It must appear/disappear as a toggle.
3. It must sit at a different draw order.
4. It is a clipping source or clipping target.
5. It must reveal hidden artwork when another layer moves.

Merge layers that fail all five tests.
