# Build phases

Do not ask one Codex session to implement the entire product in one pass. Run the files in `build-prompts/` sequentially and require each gate to pass.

## Phase 0 — foundation and contracts

Deliverables:

- Python/uv project scaffold.
- Typed domain models and JSON schemas.
- Run-state transition service.
- CLI skeleton with no paid or GPU operations.
- Fixture-based validation tests.

Gate: a run can be initialized, inspected, approved, and rejected without any image generation.

## Phase 1 — design and image-provider adapter

Deliverables:

- Provider-neutral image contracts.
- OpenAI Image API adapter.
- dry-run/fake provider.
- prompt and response provenance.
- candidate generation and canonical selection.

Gate: fake-provider tests pass; live API smoke test is opt-in; accepted canonical is immutable.

## Phase 2 — part planning

Deliverables:

- profile-aware part planner.
- part manifest, draw order, occlusion graph, clipping plan, and physics candidates.
- graph and schema validators.

Gate: all required visible/animated anatomy and costume regions are represented and the occlusion graph is acyclic.

## Phase 3 — masks and hidden-region reconstruction

Deliverables:

- manual and OpenCV mask backend.
- optional SAM 3.1 worker boundary.
- mask refinement and bleed expansion.
- hidden-region edit jobs.
- full-canvas transparent part output.

Gate: final parts rebuild the canonical image on visible pixels and pass alpha/registration tests.

## Phase 4 — QA and reporting

Deliverables:

- canonical rebuild.
- seam-stress renderer.
- missing-pixel and halo checks.
- contact sheet.
- JSON and HTML reports.

Gate: no critical failures; accepted thresholds are stored in run config.

## Phase 5 — Photoshop packager

Deliverables:

- `packager_job.json` schema and emitter.
- Photoshop UXP plugin or UXP script.
- material-separation and import PSD workflows.
- PSD inspection tests where possible.

Gate: a real PSD imports into Cubism Editor without format or layer-structure errors. This is a manual integration test and must be recorded.

## Phase 6 — Cubism handoff

Deliverables:

- import checklist.
- suggested ArtMesh density classes.
- parameter/deformer map.
- draw-order, clipping, and physics notes.

Gate: a rigger can start without reverse-engineering the intended layer behavior.

## Phase 7 — optional MCP and plugin distribution

Deliverables:

- STDIO MCP server wrapping application services.
- approval and workspace-root restrictions.
- plugin package containing the repository skills.
- marketplace test entry.

Gate: CLI and MCP produce identical run-state changes for the same operation; no tool can write outside the configured workspace.
