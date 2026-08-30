# MCP, skills, prompts, and plugin decisions

## Use skills as the primary workflow layer

Repository skills live under `.agents/skills/`. They describe decisions, stage ordering, quality gates, and output contracts. They are versioned with the project and can activate implicitly or through `$skill-name`.

## Treat custom slash prompts as compatibility shortcuts

Codex custom prompts still provide `/prompts:<name>` commands, but they are deprecated in favor of skills. Files under `codex-prompts/` are therefore thin explicit wrappers, not the source of truth.

## Required MCP server

Add the official OpenAI developer documentation server when building or maintaining the OpenAI image adapter:

```bash
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
codex mcp list
```

The server is read-only documentation access; it does not call the API for the pipeline.

## Optional custom MCP server

Build `live2dTools` only after the CLI and application services are stable. Reasons:

- Codex already has repository filesystem and shell access.
- An early MCP server duplicates orchestration logic and increases the debugging surface.
- A mature MCP layer provides useful typed, permissioned tools and can run a separate GPU worker.

Expose only the tools in `mcp/TOOL_SPEC.md`. Restrict all paths to the configured project root. Require approval for paid image generation, retries, revisions, PSD writes, and any operation that replaces a selected artifact.

## MCP servers not recommended

- Generic filesystem MCP: redundant with Codex repository access and broadens permissions.
- Random community ComfyUI MCP: avoid supply-chain and schema instability; write a small owned adapter to the local ComfyUI API if the local backend is selected.
- Browser or Playwright automation for Cubism/Photoshop authoring: brittle, resolution-dependent, and difficult to validate.

## Optional plugins

- `$imagegen`: useful for early visual experiments; the production pipeline should call its explicit provider adapter so masks, file paths, provenance, retries, and cost controls are deterministic.
- `$openai-docs`: pair with the official docs MCP while implementing API calls.
- `$skill-creator`: maintain the repository skills.
- `$plugin-creator`: package the stable skills and optional MCP server for distribution.
- GitHub plugin/MCP: optional for issues, pull requests, and CI; unrelated to core art production.

## Photoshop integrations

1. Custom Photoshop UXP packager: required production component for deterministic layer assembly and PSD export.
2. Official Live2D Cubism Material Separation Photoshop Plugin: optional manual repair tool for cutout, expansion, and transparency fill. It does not replace the pipeline's planning or QA.

## Plugin packaging

After the workflow stabilizes, run:

```bash
python scripts/build_plugin.py
```

The script copies the repository skills into a local plugin package using `plugin-template/.codex-plugin/plugin.json`.
