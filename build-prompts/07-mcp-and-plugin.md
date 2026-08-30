# Codex build prompt — Phase 7: optional MCP server and plugin package

Phases 0–6 must pass. Read `mcp/TOOL_SPEC.md`, official MCP/plugin documentation through the OpenAI Docs MCP, and the repository skills. Implement **only Phase 7**.

Requirements:

- Build a local STDIO MCP server using the official Python MCP SDK.
- Wrap existing application services; do not duplicate validation, state transitions, or provider logic.
- Implement only the tools in `mcp/TOOL_SPEC.md` with structured results and stable job IDs.
- Restrict all reads/writes to a configured workspace root after path resolution.
- Require approval for paid calls, retries, revisions, PSD job creation, and artifact selection.
- Redact secrets and never return API keys or raw environment values.
- Add project and user config examples.
- Package the seven skills in a local plugin. Add `.mcp.json` only when its command is portable and tested.
- Add a local marketplace test entry and validation instructions.

Verification:

- Contract tests showing CLI and MCP operations create equivalent state transitions.
- Path traversal, duplicate job, timeout, cancellation, and missing-key tests.
- Run the MCP inspector or equivalent tool listing/call tests.
- Build the plugin with `scripts/build_plugin.py` and inspect the archive.

Stop after local installation and a new-session skill/tool discovery test. Do not publish publicly.
