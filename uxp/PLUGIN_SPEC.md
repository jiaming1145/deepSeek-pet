# Photoshop UXP packager specification

## Purpose

Turn `packager_job.json` and full-canvas RGBA part PNGs into authoritative PSDs that satisfy the Live2D import contract.

## Input job

Required fields:

- schema version and run ID;
- canvas width/height, RGB mode, 8-bit depth, sRGB profile;
- output paths for material and import PSDs;
- ordered group definitions;
- ordered layers with unique name, source PNG, group, z index, opacity, supported blend mode, imported flag, and visibility;
- canonical guide image marked non-imported;
- expected source and output hashes.

## Workflow

1. User chooses the job file through UXP storage APIs.
2. Validate paths and all input PNG dimensions before creating a document.
3. Create a transparent RGB document at exact dimensions.
4. Create groups and place each PNG at `(0, 0)` without scaling.
5. Verify layer bounds and names against the job.
6. Save material-separation PSD.
7. Duplicate the document.
8. Remove guide/non-import layers.
9. Apply masks and merge each part's line/fill/effects into one raster layer.
10. Delete path information and validate unique names.
11. Confirm RGB, 8-bit, sRGB, opacity, and supported blend modes.
12. Save import PSD under a different path.
13. Write a machine-readable result file with layer count, warnings, paths, and hashes.

## Implementation rules

- Run document mutations inside `executeAsModal`.
- Prefer Photoshop DOM APIs for documents, groups, layers, placement, and save.
- Use `batchPlay` only when no DOM method exists. Check each returned descriptor for `_obj: "error"`.
- Never silently scale or crop a part.
- Never overwrite either PSD without an explicit new revision.
- Keep material and import documents separate after duplication.
- The plugin does not call image-generation APIs.

## Manual integration test

- Open the produced import PSD in the target Cubism Editor version.
- Record imported ArtMesh count and compare with expected imported layers.
- Capture any warning and layer mismatch in the run QA report.
- Do not mark the PSD gate passed until this record exists.
