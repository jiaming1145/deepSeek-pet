# Codex build prompt — Phase 5: Photoshop UXP PSD packager

Phases 0–4 must pass. Read the PSD packager skill, `uxp/PLUGIN_SPEC.md`, current Adobe Photoshop UXP documentation, and official Live2D PSD requirements. Implement **only Phase 5**.

Requirements:

- Define and validate `packager_job.json`.
- Add a Python emitter that converts the approved manifest and final parts into a deterministic job.
- Build a Photoshop UXP plugin or UXP script that creates exact groups/layers, places full-canvas PNGs without registration drift, and saves a material-separation PSD.
- Duplicate the document for the import PSD, apply/remove masks, merge each part to one raster layer, remove guides/path data, preserve unique names/order, and save RGB 8-bit sRGB PSD.
- Prefer Photoshop DOM methods; use `batchPlay` only for operations not exposed by the DOM and check returned error descriptors.
- Never overwrite the material-separation PSD.
- Add Python-side structural checks and a manual real-Photoshop/Cubism test procedure.
- Add CLI commands `psd emit-job` and `psd validate`.
- Do not implement MCP or automate Cubism UI.

Verification:

- Unit tests for job generation and path safety.
- UXP tests or a documented manual fixture run.
- Record the real Cubism import result; do not mark `psd_validated` without it.
- Run all available lint/type/test commands for both Python and JavaScript packages.

Stop after the PSD gate. Report anything that could not be tested without installed Photoshop or Cubism.
