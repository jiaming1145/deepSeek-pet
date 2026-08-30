---
name: live2d-cubism-handoff
description: Prepare a validated Live2D import PSD for a human rigger by generating Cubism import checks, ArtMesh density guidance, parameter/deformer suggestions, draw-order notes, clipping assignments, and physics candidates. Use after PSD validation; do not claim final rigging automation.
---

# Live2D Cubism Handoff

1. Require `psd_validated` and the recorded Cubism import smoke test.
2. Generate a layer-to-role map and highlight thin or irregular parts needing manual mesh editing.
3. Suggest standard parameter groups for face angle, body angle, eyes, brows, mouth, breathing, limbs, toggles, and physics without editing project files.
4. Map clipping targets and expected draw-order changes.
5. Group physics candidates by hair, clothing, ribbons, earrings, tails, and accessories; provide conservative starting notes rather than invented final constants.
6. Document which official Cubism auto-generation features may help and which parts require manual review.
7. Treat the external application API as a later parameter/preview QA channel only.
8. Output a concise rigger checklist, parameter plan, and unresolved art risks.

Read `references/cubism-checklist.md` before final handoff.
