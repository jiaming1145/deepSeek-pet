# Codex build prompt — Phase 3: masks, reconstruction, and final parts

Phases 0–2 must pass. Read the image-production skill and generation contract. Implement **only Phase 3**.

Requirements:

- Implement full-canvas mask types: visible, reconstruction, overlap allowance, and final alpha.
- Implement a manual-mask backend and deterministic OpenCV refinement first.
- Define a separate worker interface for SAM 3.1. Keep heavy GPU dependencies out of the base environment; provide installation and capability detection but do not make the normal test suite require a GPU.
- Extract visible canonical pixels without repainting them.
- Create constrained edit requests only for hidden regions. Use the approved canonical as the first identity reference and include frozen invariants.
- Merge visible and reconstructed pixels, apply declared overlap, decontaminate edge colors, and save full-canvas RGBA PNGs.
- Persist raw/refined masks and complete provenance.
- Add CLI groups `masks` and `parts` with dry-run, new-revision, and paid-call controls.
- Regenerate one part at a time unless an explicit reviewed batch is requested.
- Do not build PSD or MCP functionality.

Verification:

- Deterministic synthetic-image tests for mask morphology, alpha, registration, overlap, and compositing.
- Fake-provider reconstruction tests.
- Tests proving unmasked canonical pixels remain unchanged.
- Optional SAM and live image tests must skip with explicit reasons when unavailable.
- Run lint, formatting, type checks, and tests.

Stop when parts can be produced and staged for pre-PSD QA; do not mark `parts_approved` automatically.
