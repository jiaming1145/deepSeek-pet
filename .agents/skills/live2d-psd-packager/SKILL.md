---
name: live2d-psd-packager
description: Assemble approved full-canvas part PNGs into editable material-separation and Live2D import PSDs through Photoshop UXP, then validate layer structure, names, mode, profile, masks, and draw order. Use only after parts pass pre-PSD QA.
---

# Live2D PSD Packager

1. Require `parts_approved` and a passing pre-PSD report.
2. Emit a deterministic `packager_job.json`; do not encode business logic only in the Photoshop plugin.
3. Use Photoshop UXP or UXP scripting as the production writer.
4. Create `*_material_separation.psd` first and preserve editable groups/source organization.
5. Duplicate it to create `*_import.psd`; flatten each imported part to one raster layer, apply masks, remove guide-only content and path data, and preserve declared groups/order.
6. Enforce PSD, RGB, 8-bit/channel, sRGB, unique names, supported blend modes, and no layer masks in the import PSD.
7. Never overwrite the material-separation PSD while flattening the import PSD.
8. Run structural inspection and require a recorded Cubism import smoke test before `psd_validated`.

Read `references/psd-rules.md` before packaging.
