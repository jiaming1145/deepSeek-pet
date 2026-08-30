# Intended CLI command surface

These commands are contracts for the implementation phases.

```bash
# Initialize and inspect
uv run live2d init --brief templates/character_brief.yaml --run-id aria-v001
uv run live2d status --run aria-v001
uv run live2d approve --run aria-v001 --gate brief_approved --note "Brief reviewed"

# Design
uv run live2d design generate --run aria-v001 --candidates 4 --quality low
uv run live2d design select --run aria-v001 --candidate candidate_02

# Plan
uv run live2d plan parts --run aria-v001 --profile full_body_standard
uv run live2d plan validate --run aria-v001

# Masks and parts
uv run live2d masks generate --run aria-v001 --backend manual
uv run live2d masks refine --run aria-v001
uv run live2d parts reconstruct --run aria-v001
uv run live2d parts finalize --run aria-v001

# QA
uv run live2d qc pre-psd --run aria-v001
uv run live2d qc report --run aria-v001

# Photoshop packaging
uv run live2d psd emit-job --run aria-v001
uv run live2d psd validate --run aria-v001

# Handoff
uv run live2d handoff cubism --run aria-v001
```

Paid or destructive operations must support:

```bash
--dry-run
--new-revision
--yes-to-cost
```

Do not implement a global `--force` that bypasses quality gates.
