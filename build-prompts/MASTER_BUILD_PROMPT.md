# Master handoff prompt for Codex

Build the Live2D parts-production system described in this repository.

Rules:

1. Read `AGENTS.md` and all `docs/` files before implementation.
2. Execute `build-prompts/00-foundation.md` first.
3. Implement only one phase per Codex task. Do not collapse multiple phases into one change.
4. At the end of every phase, run its verification, report untested integration surfaces, and stop.
5. Do not continue until the prior phase's acceptance gate is satisfied.
6. Preserve schemas and command contracts unless a documented blocking issue requires a versioned change.
7. Prefer the CLI/application layer as the source of truth; skills guide workflow, MCP wraps services, and slash prompts are only shortcuts.
8. Never claim that generated artwork is a finished Live2D model or that Cubism rigging is fully automated.

Start with Phase 0 now.
