# Codex build prompt — Phase 4: quality control and reports

Phases 0–3 must pass. Read the quality-control skill, `docs/QUALITY_GATES.md`, and QA schema. Implement **only Phase 4**.

Requirements:

- Validate file presence, dimensions, modes, alpha bounds, IDs, hashes, clipping references, and provenance.
- Rebuild the canonical composite in declared draw order.
- Compare only canonical-visible pixels and make thresholds configurable per run.
- Implement seam stress tests using each part's motion envelope and overlap region.
- Add edge-halo checks, missing-pixel maps, and focused evidence crops.
- Create a contact sheet plus JSON and self-contained HTML reports.
- Use `pass`, `fail`, `needs_review`, or `skipped`; unavailable tests cannot pass.
- Critical failures block approvals. Manual review remains mandatory for face, eyes, mouth, hands, hairline, and joints.
- Add CLI commands `qc pre-psd` and `qc report`.
- Do not build Photoshop, PSD writing, MCP, or Cubism automation.

Verification:

- Synthetic fixtures for holes, halos, wrong z order, insufficient overlap, corrupted hashes, and valid composites.
- Snapshot or image-diff tests for report evidence where stable.
- Run lint, formatting, type checks, and tests.

Stop after an approver can review the report and mark `parts_approved`.
