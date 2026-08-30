# Generation contract

## Preferred method

1. Generate and approve one canonical image.
2. Segment a visible part from that image.
3. Build a mask for only the hidden region that must be invented.
4. Edit the canonical image with a narrow instruction such as: reconstruct the forehead behind the bangs; change only the masked region; preserve face, eyes, hairline, lighting, line weight, palette, pose, and every unmasked pixel.
5. Combine canonical visible pixels with the edited hidden pixels.

## Prohibited method

Do not generate `eye_l.png`, `bang_l.png`, `torso.png`, and other parts as unrelated text-to-image calls. Independent calls create incompatible geometry and style.

## Mask handling

- Keep raw and refined masks.
- Distinguish visible mask, reconstruction mask, final alpha mask, and allowed overlap mask.
- Use deterministic morphology for cleanup and expansion.
- Do not feather sharp ink boundaries unless the canonical edge is antialiased.

## Cost control

Use low quality for candidates and mask experiments. Use higher quality only for the accepted canonical and identity-sensitive hidden-region edits. Cache by normalized request hash and never silently retry a paid call.
