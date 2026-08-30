# PSD rules

Production outputs:

- `<name>_material_separation.psd`: editable groups, sources, and repair structure.
- `<name>_import.psd`: one raster layer per part for Cubism.

Import PSD requirements:

- `.psd` format;
- RGB mode;
- 8-bit per channel;
- sRGB profile;
- one part per layer;
- line, fill, effects, and clipping for that part merged;
- all layer masks applied/removed;
- unique layer names;
- guide layers excluded;
- opacity used instead of unsupported fill semantics;
- no accidental path information;
- exact registration and manifest order.

Use broad automatic mesh generation only as a later Cubism convenience. Lashes, mouth lines, thin hair, and irregular contours require manual mesh inspection.
