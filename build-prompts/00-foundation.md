# Codex build prompt — Phase 0: foundation and contracts

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_PHASES.md`, all schemas, and the templates. Implement **only Phase 0**.

Requirements:

- Scaffold a Python 3.12 project using `uv`, a `src/` layout, Typer, Pydantic v2, pytest, ruff, and a strict type checker.
- Implement domain models for character brief, run state, approval records, artifact metadata, and part manifest.
- Treat the JSON schemas as public contracts. Add tests that parse the supplied YAML/JSON fixtures and round-trip normalized JSON.
- Implement an immutable filesystem run store under `runs/<run_id>/` with atomic writes and SHA-256 artifact records.
- Implement allowed state transitions from the orchestrator skill reference.
- Add CLI commands: `init`, `status`, `validate`, and `approve`. Do not add image generation, segmentation, PSD, MCP, or Photoshop code.
- Reject production initialization when rights fields are incomplete or external processing is requested without permission.
- Make commands idempotent and safe on Windows, macOS, and Linux.
- Add concise professional comments at module/class boundaries, not line-by-line narration.

Verification:

- Run targeted tests, schema fixture tests, ruff, formatting check, and type checks.
- Demonstrate a temporary run moving from `created` to `brief_approved` and reject an invalid transition.
- Do not modify later-phase prompt or skill files.

At completion, report file-level changes, commands run, tests, assumptions, and any blocked acceptance item. Do not begin Phase 1.
