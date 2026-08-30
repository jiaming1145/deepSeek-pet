# Codex build prompt — Phase 6: Cubism handoff

Phases 0–5 must pass and a real Cubism import smoke test must be recorded. Read the Cubism-handoff skill and current official Cubism manuals. Implement **only Phase 6**.

Requirements:

- Generate a layer-to-role map from the manifest.
- Classify ArtMesh guidance as broad-auto, auto-then-review, or manual.
- Produce suggested parameter/deformer groups for face angle, body angle, blink, eye tracking, brows, mouth open/form, breathing, limbs, toggles, draw order, clipping, and physics.
- Flag front-facing facial auto-generation prerequisites and all thin/irregular manual-review parts.
- Produce conservative physics candidates, not invented final constants.
- Add `handoff cubism` CLI command that writes the checklist, parameter plan, draw-order notes, rigging notes, and unresolved art risks.
- Do not modify `.cmo3` or `.moc3` files and do not automate Cubism by screen clicking.

Verification:

- Golden-file tests for bust and full-body handoff packages.
- Validate that every imported manifest part appears in the role map.
- Run lint, formatting, type checks, and tests.

Stop when a human rigger can start from the handoff without guessing intended behavior.
