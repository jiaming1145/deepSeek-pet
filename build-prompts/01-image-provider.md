# Codex build prompt — Phase 1: canonical design and image provider

Phase 0 must already pass. Read the art-director and image-production skills, current official OpenAI image-generation documentation through the OpenAI Docs MCP, and the existing provider interfaces. Implement **only Phase 1**.

Requirements:

- Define provider-neutral request/result models for generation and editing.
- Implement a deterministic fake provider for tests.
- Implement an OpenAI Image API adapter with `gpt-image-2` as the configurable default; keep provider/model aliases or snapshots, quality, dimensions, format, prompt revision, response/image IDs, and usage/cost metadata when available.
- Centralize all SDK calls in the adapter. No other module may import the OpenAI SDK.
- Add normalized request hashing, cache lookup, explicit retry policy, and non-overwriting output names.
- Add `design generate` and `design select` CLI commands.
- Generate candidates into a new revision. Selecting a canonical must hash-lock it and require an approval record.
- Enforce rights and external-processing permission before a live call.
- Add `--dry-run` and explicit paid-call confirmation. Never silently retry a paid call.
- Store the final normalized prompt and all invariants.
- Do not implement masks, part generation, PSD, MCP, or Photoshop code.

Verification:

- Full fake-provider tests with no network.
- Live smoke test must be opt-in and skipped cleanly without `OPENAI_API_KEY`.
- Test cache hits, failed calls, retries, duplicate selection, and canonical immutability.
- Run lint, formatting, type checks, and relevant tests.

Stop after Phase 1 and report residual API assumptions with citations to the official docs used.
