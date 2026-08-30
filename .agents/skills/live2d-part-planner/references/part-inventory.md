# Part planning rules

Start from the categories in `docs/PART_INVENTORY.md` when working in the source repository. In a packaged plugin, apply these compact rules:

- Complete face/head base under hair.
- Full sclera and iris under eyelids.
- Mouth cavity, lips/lines, teeth, and tongue with hidden margin.
- Back hair, front hair, bangs, side locks, and independently moving strands.
- Neck and joints extended under adjacent clothing.
- Limb and garment segmentation at intended bend or draw-order boundaries.
- Accessories split into rigid bases and moving segments.
- Separate shadows/highlights only when clipping, recoloring, toggling, or independent deformation requires it.

A layer is justified only by independent motion, toggle state, draw order, clipping, or hidden-region exposure. Merge everything else.
