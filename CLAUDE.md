# Claude Code repository instructions

## Agent ownership boundaries

- `CLAUDE.md`, `.claude/settings*.json`, `.claude/skills/`, and the worktree assigned to the
  current Claude task are Claude control surfaces.
- `AGENTS.md`, `.agents/skills/`, `codex-prompts/`, `config/codex.project.toml.example`,
  `config/mcp.user.toml.example`, `plugin-template/`, and `dist/live2d-production-plugin*` are
  Codex-only control or distribution assets. Do not treat them as Claude instructions and do not
  modify or execute them unless the user explicitly requests Codex configuration work.
- Do not run `scripts/install_prompts.ps1` or `scripts/install_prompts.sh`; they install prompts
  into a user-level Codex profile outside this repository.
- If this task has an assigned `.claude/worktrees/<id>` worktree, make all task edits there and on
  its branch. Never edit, reset, clean, move, or delete a different agent worktree.

## Shared project contracts

- Read `docs/DECISIONS.md` before building anything that touches the character, the visual
  runtime, or the art pipeline. It records the binding architecture decisions and their evidence.
- The product specifications in `docs/`, machine-readable contracts in `schemas/`, starter data in
  `templates/`, and normal application or pipeline source code are shared between Codex and Claude.
- The reliable automation boundary ends at Live2D-ready artwork, validated PSDs, QA, and a Cubism
  handoff. Do not claim automatic finished `.cmo3` or `.moc3` generation.
- Do not automate Cubism Editor with screen-coordinate macros. Use documented integration only for
  supported parameter or preview operations.
- Derive parts from the approved canonical image. Do not independently redraw every layer.
- Do not overwrite approved images, parts, PSDs, reports, or handoff artifacts. Create versioned
  outputs and update run state explicitly.
- Never send source images externally unless rights and privacy fields permit it, and never store
  API keys in prompts, run files, logs, reports, or Git.
- Respect the production gates: `brief_approved`, `canonical_approved`, `part_plan_approved`,
  `parts_approved`, `psd_validated`, and `cubism_ready`.

## Concurrent work safety

- Run `git status` before editing and preserve all pre-existing user or agent changes.
- Prefer a dedicated branch or worktree. Do not modify a file that another active agent is editing;
  coordinate ownership first.
- Do not use destructive Git or filesystem cleanup to resolve another agent change.
- Run the targeted tests and validation appropriate to each implementation phase before reporting
  it complete.
