---
name: live2d-part-planner
description: Convert an approved canonical character into a complete, profile-aware Live2D part manifest, draw order, occlusion graph, clipping plan, hidden-region plan, and physics candidates. Use before masks or part generation and when revising separation scope.
---

# Live2D Part Planner

1. Require an approved canonical image and style bible.
2. Read `references/part-inventory.md` and remove only parts that are inapplicable to the design.
3. Add design-specific parts when an element moves independently, toggles, uses a different draw order, participates in clipping, or reveals hidden artwork.
4. For every part, record side, parent group, z index, occluders, occluded parts, clipping target, motion role, motion envelope, hidden-region requirement, and overlap requirement.
5. Use character-perspective left/right naming and unique lowercase snake_case IDs.
6. Validate that clipping references exist, z indices are assigned, the occlusion graph is acyclic, and required anatomy is not missing.
7. Produce `part_manifest.json`, `draw_order.json`, `occlusion_graph.json`, `clipping_plan.json`, and `physics_candidates.json`.
8. Do not generate masks or artwork.
