---
name: live2d-quality-control
description: Audit a Live2D art run for missing parts, invalid alpha, registration errors, edge halos, visible-pixel drift, hidden-region defects, seam failures, PSD incompatibility, and incomplete provenance. Use before approvals, PSD packaging, or Cubism handoff.
---

# Live2D Quality Control

1. Read the run state, manifest, current artifacts, and configured thresholds.
2. Perform mechanical checks before visual checks; fail immediately on missing files, wrong dimensions, invalid modes, duplicate IDs, bad hashes, or unresolved references.
3. Rebuild the neutral composite and compare canonical-visible pixels.
4. Render motion-envelope seam tests for every movable part.
5. Produce focused evidence crops for face, eyes, mouth, hairline, hands, joints, clothing overlaps, and accessories.
6. Mark every check `pass`, `fail`, `needs_review`, or `skipped`; never convert an unavailable test into a pass.
7. Critical failures block gate advancement. Manual visual review remains mandatory for identity-sensitive regions.
8. Write both machine-readable JSON and an HTML/contact-sheet report.

Read `references/qa-rubric.md` for severity and evidence rules.
