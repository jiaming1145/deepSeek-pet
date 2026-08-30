---
name: live2d-art-director
description: Turn a character brief and owned references into a frozen Live2D-friendly canonical design, candidate set, identity invariants, and style bible. Use before material separation or whenever an approved canonical design needs a controlled new revision.
---

# Live2D Art Director

1. Validate the brief, rights, canvas, profile, pose, and prohibited overlaps.
2. Generate candidates from one normalized design prompt; vary only declared design alternatives.
3. Enforce a front-facing neutral pose, open eyes, closed neutral mouth, unobstructed face, and separated limbs appropriate to the selected profile.
4. Reject candidates with anatomy errors, inconsistent accessories, hidden joints, text, watermarks, extreme perspective, or ambiguous garment construction.
5. Select exactly one canonical image through an explicit approval record.
6. Write `style_bible.yaml` containing identity anchors, palette, line weight, shading, proportions, asymmetries, outfit construction, and invariants.
7. Hash-lock the canonical image. Later edits must use it as the first identity reference and repeat the invariants.
8. Do not generate individual final parts in this stage.

Read `references/design-contract.md` before writing the canonical prompt.
