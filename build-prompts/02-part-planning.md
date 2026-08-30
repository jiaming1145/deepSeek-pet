# Codex build prompt — Phase 2: part planning

Phases 0 and 1 must pass. Read the part-planner skill, `docs/PART_INVENTORY.md`, the baseline manifest, and schemas. Implement **only Phase 2**.

Requirements:

- Implement profile-aware planning for `bust_standard`, `full_body_standard`, and `full_body_deluxe`.
- Start from the baseline inventory, evaluate each `required_if`, and support explicit user additions/removals with reasons.
- Produce part manifest, draw order, occlusion graph, clipping plan, hidden-region plan, and physics candidates.
- Validate unique IDs, character-perspective side naming, assigned z indices, existing clipping references, acyclic occlusion graph, and mandatory facial/hidden-area parts.
- Add CLI commands `plan parts` and `plan validate`.
- Record plan revisions and invalidate only dependent later stages when an approved plan changes.
- Add clear diagnostics that name missing or conflicting parts.
- Do not call an image model. Do not implement masks, PSD, MCP, or Photoshop code.

Verification:

- Fixture tests for a simple bust, long-haired full body, glasses, skirt panels, and asymmetric accessory.
- Negative tests for cycles, duplicate IDs, missing eye internals, invalid clipping targets, and unassigned z indices.
- Run lint, formatting, type checks, and tests.

Stop after a production run can reach `part_plan_approved` through explicit approval.
