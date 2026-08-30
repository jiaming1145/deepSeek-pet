---
name: live2d-orchestrator
description: Create, continue, or audit an end-to-end Live2D-ready character-art run from brief through canonical design, separated parts, PSD packaging, QA, and Cubism handoff. Use for whole-job coordination and stage selection; do not use to claim or perform complete Cubism rigging.
---

# Live2D Orchestrator

1. Read `AGENTS.md`, the run's `run.json`, and the latest QA report before acting.
2. Determine the first incomplete allowed stage from `references/state-machine.md`.
3. Refuse to skip production gates. In draft mode, clearly label outputs as previews.
4. Invoke the most specific Live2D skill for the active stage.
5. Require idempotent commands and versioned revisions; never overwrite accepted artifacts.
6. After each stage, verify expected files, hashes, schema validity, and gate status.
7. Stop on critical QA failures, rights restrictions, cost approval gaps, or unexpected source changes.
8. Report the next eligible stage and exact blocking evidence. Do not describe the run as a finished Live2D model before Cubism authoring and verification.
