# `live2dTools` MCP server contract

Build this only after the CLI is stable. Tools call the same application services as the CLI.

## Read-only tools

### `get_run_status`

Input: `run_id`.

Output: state, current revision, completed gates, blockers, artifact summary, latest QA summary, and next eligible action.

### `get_part_manifest`

Input: `run_id`, optional revision.

Output: normalized manifest and validation diagnostics.

### `get_job_status`

Input: `job_id`.

Output: queued/running/succeeded/failed/cancelled, progress, artifact references, and structured error.

## Controlled mutation tools

### `create_run`

Input: brief path under workspace.

Effect: validate and initialize only; no paid call.

### `generate_design_candidates`

Input: run ID, candidate count, quality, dry-run, cost-approved boolean.

Effect: start a paid job only when rights and approval pass.

### `select_canonical`

Input: run ID, candidate ID, approval note.

Effect: create an immutable canonical revision.

### `plan_parts`

Input: run ID, profile, optional override file.

Effect: generate plan artifacts without image calls.

### `produce_parts`

Input: run ID, optional part IDs, dry-run, cost-approved boolean, new-revision boolean.

Effect: enqueue masks/reconstruction/finalization for selected parts.

### `run_quality_control`

Input: run ID, stage.

Effect: generate reports; never auto-approve.

### `emit_psd_job`

Input: run ID, output directory under workspace.

Effect: write `packager_job.json`; does not control Photoshop.

### `generate_cubism_handoff`

Input: run ID.

Effect: write handoff files only after PSD validation.

## Security and reliability

- Resolve every path and confirm it is within the configured workspace root.
- No arbitrary shell command tool.
- No arbitrary URL fetch tool.
- Do not return environment variables or secrets.
- Paid tools require an explicit boolean plus server-side policy approval.
- Retry creates a new attempt record; it never hides the original failure.
- Long work returns a job ID quickly and supports status/cancellation.
- Use stable error codes: `invalid_state`, `rights_blocked`, `cost_not_approved`, `artifact_missing`, `schema_invalid`, `path_outside_workspace`, `provider_failed`, `qa_blocked`, `integration_required`.
