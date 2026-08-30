# Architecture

## Build target

Create a local-first production system with these outputs for each character run:

```text
runs/<run_id>/
├── run.json
├── 00_intake/
│   ├── brief.yaml
│   ├── rights.json
│   └── references/
├── 01_design/
│   ├── candidates/
│   ├── canonical.png
│   ├── canonical.sha256
│   └── style_bible.yaml
├── 02_plan/
│   ├── part_manifest.json
│   ├── occlusion_graph.json
│   ├── draw_order.json
│   ├── clipping_plan.json
│   └── physics_candidates.json
├── 03_masks/
│   ├── raw/
│   ├── refined/
│   └── mask_report.json
├── 04_parts/
│   ├── extracted/
│   ├── reconstructed/
│   ├── final/
│   └── provenance/
├── 05_composites/
│   ├── canonical_rebuild.png
│   ├── contact_sheet.png
│   └── seam_tests/
├── 06_psd/
│   ├── packager_job.json
│   ├── character_material_separation.psd
│   └── character_import.psd
├── 07_qc/
│   ├── qa_report.json
│   ├── qa_report.html
│   └── evidence/
└── 08_handoff/
    ├── cubism_import_checklist.md
    ├── parameter_plan.json
    ├── draw_order_notes.md
    └── rigging_notes.md
```

## Runtime components

### 1. Brief and state service

- Validates `character_brief.yaml`.
- Creates immutable run IDs and revision IDs.
- Enforces stage transitions and approval records.
- Stores hashes and provenance for every artifact.

### 2. Image provider adapter

Interface:

```python
class ImageProvider(Protocol):
    def generate_candidates(self, request: DesignRequest) -> list[ImageArtifact]: ...
    def edit_image(self, request: EditRequest) -> ImageArtifact: ...
```

Default implementation uses the OpenAI Image API. Keep model name, snapshot, quality, size, output format, and prompt revision in the result metadata.

### 3. Segmentation service

Backends:

- `sam3`: text/point/box prompted masks on supported GPU systems.
- `manual`: user-supplied masks.
- `opencv`: deterministic cleanup, morphology, connected components, feathering, and bleed expansion.

SAM is an accelerator, not an authority. Hair strands, lashes, mouth lines, translucent accessories, and overlapping garments require review or manual seed points.

### 4. Part-production service

For each part:

1. Extract visible canonical pixels from the approved mask.
2. Determine whether hidden pixels are required by the motion envelope.
3. Generate a constrained hidden-region edit against the canonical image.
4. Merge extracted and reconstructed pixels.
5. Expand overlap/bleed without changing visible canonical pixels.
6. Validate alpha, registration, edge color, and provenance.

### 5. Composite and QA service

- Rebuilds the canonical image from final parts in draw order.
- Compares visible regions with the approved canonical image.
- Produces seam stress tests by moving each part through its declared motion envelope.
- Detects transparent holes, edge halos, clipping errors, missing layers, duplicate names, and identity drift.

### 6. PSD job emitter and Photoshop packager

The Python application emits `packager_job.json`; Photoshop performs the authoritative PSD write.

The Photoshop UXP plugin:

- creates an RGB, 8-bit, sRGB document with transparency;
- places full-canvas PNGs at exact registration;
- creates the declared group and layer order;
- preserves an editable material-separation document;
- creates a duplicate import document;
- applies masks, merges each part to one raster layer, removes guides and path data, and checks unique names;
- saves both PSDs.

### 7. Cubism handoff generator

Produces a deterministic checklist and suggested parameter/deformer plan. It does not edit Cubism project data.

### 8. Optional MCP server

Expose narrow, typed wrappers over application services after the CLI is complete. Long-running operations return a job ID and status instead of holding an unbounded tool call.

## Suggested package boundaries

```text
src/live2d_pipeline/
├── cli.py
├── application/
│   ├── run_service.py
│   ├── design_service.py
│   ├── planning_service.py
│   ├── mask_service.py
│   ├── part_service.py
│   ├── psd_service.py
│   └── qa_service.py
├── domain/
│   ├── brief.py
│   ├── manifest.py
│   ├── run_state.py
│   ├── artifacts.py
│   └── approvals.py
├── adapters/
│   ├── openai_images.py
│   ├── sam3_worker.py
│   ├── opencv_masks.py
│   ├── filesystem_store.py
│   └── photoshop_job.py
├── qc/
│   ├── alpha.py
│   ├── composite.py
│   ├── seams.py
│   ├── psd_inspection.py
│   └── reports.py
└── mcp_server/
    └── server.py
```

## Deployment shape

- Local CLI: authoritative v1 surface.
- Optional local GPU worker: separate process/environment because SAM 3.1 has heavier Python, PyTorch, and CUDA requirements.
- Photoshop UXP plugin: separate JavaScript package.
- Optional local STDIO MCP server: invokes the same application layer.
- No web service is required for v1.
