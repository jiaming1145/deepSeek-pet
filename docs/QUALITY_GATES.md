# Quality gates

The thresholds below are starting defaults. Store them per run and tune after evaluating real assets. They are not Live2D-defined limits.

## Gate 0 — intake

Critical checks:

- source ownership or permission is recorded;
- external-processing permission is explicit;
- canvas and output profile are fixed;
- character perspective side convention is acknowledged;
- the neutral pose has no crossed arms, hand-to-face overlap, extreme foreshortening, or hidden facial landmarks.

## Gate 1 — canonical design

Critical checks:

- front-facing neutral pose suitable for Cubism facial auto-generation;
- open eyes and neutral closed mouth;
- stable silhouette and unambiguous costume construction;
- no accidental text, watermark, extra limb, asymmetrical eye placement, or inconsistent accessories;
- canonical image and style bible are approved and hash-locked.

## Gate 2 — part plan

Critical checks:

- all visible or independently moving regions have a part;
- eye whites, irises, mouth internals, face under hair, neck under collar, and joints have hidden-area requirements;
- every part has one z index and unique ID;
- the occlusion graph is acyclic;
- clipping targets exist;
- no unsupported duplicate names.

## Gate 3 — masks and parts

Mechanical checks:

- every PNG is RGBA and exactly the canonical canvas size;
- nonempty parts have a valid alpha bounding box;
- no part contains unexplained opaque pixels outside its reviewed mask plus allowed overlap;
- no edge contains a white/black matte halo above configured tolerance;
- all accepted artifacts have hashes and provenance.

Visual checks:

- extracted visible pixels remain unchanged;
- hidden reconstruction matches local line weight, lighting, palette, and anatomy;
- overlap is sufficient for the declared motion envelope;
- left/right details remain intentionally consistent, not mechanically mirrored when the design is asymmetric.

## Gate 4 — composite and seams

- Rebuild the neutral canonical image from final parts in draw order.
- Compare only pixels expected to be visible in the canonical pose.
- Fail on transparent holes in covered regions.
- Render each movable part at the extremes of its planned translation/rotation envelope.
- Produce a contact sheet with neutral, mask, hidden-region, and stress-test views.

Suggested starting metrics:

- zero missing fully opaque canonical pixels outside antialiased borders;
- visible-region SSIM at least `0.995` for extracted regions;
- edge color difference and alpha leakage thresholds configured by profile;
- manual review required for face, eyes, mouth, hands, hairline, and garment joints regardless of metric score.

## Gate 5 — PSD

Import PSD must satisfy:

- PSD format;
- RGB;
- 8-bit per channel;
- sRGB profile;
- one raster layer per imported part;
- line, fill, effects, and clipping for a part merged to that layer;
- no layer masks;
- no duplicate layer names;
- no guide-only layers in the import set;
- supported blend modes and opacity behavior;
- exact group and draw order from the manifest.

Material-separation PSD remains editable and is never overwritten by import flattening.

## Gate 6 — Cubism handoff

Manual integration record must confirm:

- Cubism opens the import PSD;
- expected layers become ArtMeshes;
- no required layer is absent or misregistered;
- group hierarchy is usable;
- auto mesh can run on broad parts;
- fine parts such as lashes, mouth lines, and thin hair are flagged for manual mesh review.
