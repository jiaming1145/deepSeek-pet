---
name: live2d-image-production
description: Produce reviewed masks, extracted visible pixels, hidden-region reconstructions, overlap margins, and full-canvas transparent Live2D part PNGs from an approved canonical image and part manifest. Use for image generation, segmentation, inpainting, repair, and part finalization.
---

# Live2D Image Production

1. Require `canonical_approved` and `part_plan_approved`.
2. Run all paid image operations through the project image-provider adapter; never create a one-off SDK script.
3. Extract visible pixels from the canonical image. Do not redraw pixels that already exist and are correct.
4. Use segmentation as a draft. Review or refine thin hair, lashes, mouth lines, translucent pieces, and touching garments.
5. Reconstruct only the hidden region required by the part's motion envelope. Use the canonical as the primary image input and repeat identity/style invariants.
6. Change one logical region per edit. Preserve all unrelated pixels.
7. Merge visible and reconstructed pixels, add declared overlap/bleed, and keep the output at full canvas registration.
8. Store prompt revision, provider/model, response or image IDs, masks, source hashes, and output hashes per part.
9. Rebuild the canonical composite after each batch; stop if visible pixels drift or seams fail.
10. Never accept a generated part solely because a model call completed.

Read `references/generation-contract.md` before producing assets.
