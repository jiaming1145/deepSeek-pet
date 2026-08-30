# Live2D Codex Production Pipeline Blueprint

This repository is a build specification and Codex control layer for producing **Live2D-ready separated artwork** from a character brief or approved reference image.

It is deliberately not described as a one-click Live2D model generator. The reliable automation boundary is:

1. Generate and approve one canonical front-facing character image.
2. Plan all moving parts and their occlusion relationships.
3. Extract visible pixels, reconstruct hidden regions, and create overlap margins.
4. Validate the parts by rebuilding the canonical image and stress-testing seams.
5. Package two Photoshop PSDs:
   - `*_material_separation.psd`: editable production source.
   - `*_import.psd`: Live2D-compliant, one raster layer per part.
6. Hand the import PSD and rigging plan to Cubism Editor.

Cubism import, ArtMesh creation, deformer editing, keyforms, and final rigging remain a separate authoring stage. The current Cubism external integration API is useful for parameter inspection and preview control, not complete headless model authoring.

## Recommended operating model

- **Primary control plane:** repository skills under `.agents/skills/`.
- **Primary execution surface:** a typed, resumable CLI built in phases from `build-prompts/`.
- **Primary image backend:** OpenAI Image API through one adapter, with `gpt-image-2` as the default model.
- **Segmentation:** SAM 3.1 when a compatible GPU environment exists; manual seed masks and OpenCV refinement remain supported.
- **PSD creation:** a Photoshop UXP plugin or `.psjs` script driven by `packager_job.json`.
- **MCP:** optional after the CLI is stable. It should expose narrow wrappers around the CLI, not duplicate business logic.
- **Plugin packaging:** optional distribution layer built by `scripts/build_plugin.py`.

## Start here

1. Read `AGENTS.md`.
2. Review `docs/ARCHITECTURE.md`, `docs/BUILD_PHASES.md`, and `docs/PART_INVENTORY.md`.
3. Copy `templates/character_brief.yaml` and fill it out.
4. Give Codex `build-prompts/00-foundation.md`.
5. Continue through the build prompts only after the preceding phase passes its acceptance gate.

## Repository map

- `.agents/skills/`: reusable Codex workflows.
- `build-prompts/`: exact prompts for implementing the software in phases.
- `codex-prompts/`: optional deprecated slash-command wrappers for operating the finished pipeline.
- `docs/`: architecture, part inventory, QA, and integration decisions.
- `schemas/`: machine-readable contracts.
- `templates/`: starter brief and manifest.
- `mcp/`: optional MCP server contract.
- `uxp/`: Photoshop packager specification.
- `plugin-template/`: plugin manifest template.
- `scripts/`: validation, prompt installation, and plugin packaging helpers.

## Non-negotiable quality boundary

Do not generate every part independently from text. That causes identity, line-weight, proportion, lighting, and costume drift. Generate one canonical image, then derive or edit each part while repeatedly using that image as the identity anchor.
