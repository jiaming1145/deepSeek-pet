# Repository instructions: Live2D parts production

## Objective

Build and operate a deterministic, resumable pipeline that converts an approved character brief or owned reference image into Live2D-ready transparent parts, two Photoshop PSDs, a QA report, and a Cubism handoff package.

## Codex and Claude coexistence

- `AGENTS.md`, `.agents/skills/`, `codex-prompts/`, the Codex config examples,
  `plugin-template/`, and `dist/live2d-production-plugin*` are Codex control or distribution
  assets. Keep Codex-specific workflow instructions there.
- Treat `CLAUDE.md`, `.claude/settings*.json`, `.claude/skills/`, and
  `.claude/worktrees/**` as Claude-owned control surfaces. Do not modify them unless the user
  explicitly asks for Claude configuration work.
- Both agents may read and implement the shared contracts in `docs/`, `schemas/`, and `templates/`,
  plus normal application and pipeline source code. Codex-only prompts are not shared contracts.
- Before editing shared files, inspect `git status` and the registered worktrees. Preserve user and
  other-agent changes, use a separate branch or worktree when practical, and do not edit a file
  concurrently when another agent owns an in-progress change to it.
- Never reset, clean, move, or delete another agent worktree. Do not run
  `scripts/install_prompts.ps1` or `scripts/install_prompts.sh` automatically; those write outside
  the repository into a user-level Codex profile.

## Hard boundaries

- Do not claim that this repository automatically produces a finished `.cmo3` or `.moc3` model.
- Do not automate Cubism Editor by brittle screen-coordinate clicking or browser-style UI macros.
- Treat Cubism external application integration as parameter/preview support only unless official API documentation adds authoring operations.
- Do not independently redraw every layer. Derive visible pixels from the canonical image and use constrained edits only for hidden regions or repair.
- Do not overwrite an approved canonical image, approved part, PSD, or report. Create a versioned artifact and update run state explicitly.
- Do not send source images to an external service unless the run's rights and privacy fields permit it.
- Never store API keys in prompts, run files, logs, generated reports, or Git.

## Conventions

- `l` and `r` mean the character's left and right, not the viewer's.
- Canvas origin is top-left. Coordinates are integer pixels unless a schema states otherwise.
- Use lowercase ASCII snake_case for part IDs and unique layer names.
- Every part PNG uses the full canvas dimensions and preserves exact registration.
- Store all prompts, masks, model aliases or snapshots, response IDs, source hashes, and output hashes.
- Prefer immutable stage outputs under `runs/<run_id>/`; use a new revision rather than mutating accepted files.

## Required run gates

1. `brief_approved`
2. `canonical_approved`
3. `part_plan_approved`
4. `parts_approved`
5. `psd_validated`
6. `cubism_ready`

Never skip a gate in production mode. Draft mode may generate low-cost previews but cannot mark a later production gate complete.

## Engineering rules

- Use Python 3.12, `uv`, Typer, Pydantic v2, Pillow, NumPy, OpenCV, and pytest unless a phase prompt changes the stack with a documented reason.
- Keep image providers behind typed adapters. The orchestrator must not call vendor SDKs directly.
- Implement the CLI before the MCP server. MCP tools must wrap the same application services used by the CLI.
- Use Photoshop UXP or Photoshop UXP scripting for the final PSD writer. Third-party PSD libraries may inspect or test PSDs but are not the production writer.
- Make every stage idempotent. Re-running a completed stage without `--new-revision` must be a no-op or a clear error.
- Fail closed on schema errors, missing artifacts, hash mismatches, duplicate layer names, unsupported image modes, and failed QA gates.
- Record external-call cost metadata when returned by the provider.

## Verification

For every implementation phase:

- run targeted unit tests;
- run schema fixture tests;
- run `ruff check`, `ruff format --check`, and type checks;
- report unexecuted GPU, Photoshop, or paid-API tests explicitly;
- do not mark the phase complete while a promised acceptance test is missing.
