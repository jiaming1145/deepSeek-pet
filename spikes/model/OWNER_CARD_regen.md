# Owner card: regenerate Whale-chan with her hands clear of the skirt (optional, only if the skirt flap bothers you)

## Why
The current Meshy mesh is excellent, but in it her **left cuff and the side of the skirt are one fused surface**: the
turnaround had her arms hanging against the dress, so Meshy welded them together. No rig can separate a welded
surface, so when the left arm rises (stretch, reach, wave-high) a triangle of skirt rises with it. Everything else is
solved in the pipeline (see `docs/3D_PIPELINE.md`, "Repairing an auto-rig"). The flap is small at idle and walking.

The professional fix is upstream: generate the mesh with the arms held **away** from the body, the way every game
character is modelled (A-pose, hands clear of the hips by at least a hand's width).

## What to do (Meshy Pro, image-to-3D multi-view, same as before)
1. Make a new turnaround (front / left / back / right) with the SAME character, SAME outfit, but:
   - arms straight, raised about **45 degrees from the body** (halfway between hanging and horizontal)
   - palms open, fingers together, a clear gap between each cuff and the skirt in EVERY view
   - the tail exactly as before (lower back, her right side); no props, no cape, no held items
   Prompt addition for the image generator (append to the prompt you used last time):
   `A-pose reference sheet, arms held straight out at 45 degrees away from the body, hands clearly separated from the
   skirt with visible background between cuff and hip, neutral standing pose, feet slightly apart`
2. Put the four images in `spikes/model/turnaround_v2/{front,left,back,right}.png`.
3. Generate on Meshy exactly like last time (multi-image, Pro quality, texture on). Download the GLB to
   `spikes/model/generated/meshy/` (any name).
4. Tell me the file name. I rig it through the API (5 credits), run the hookup, and show you the sheets. No other
   step changes: the chain file, the weight repairs and the bone fixups are re-derived from the new mesh automatically
   where they are bone-relative, and I re-measure the two hand-coded boxes.

## If you would rather keep the current mesh
Say so. The current build (`tools/vrm/out/whalechan/meshy-08/whalechan.vrm`) is usable: idle, walk, sit, sleep,
eat, look-at and the tail/hair/ears all behave. The flap shows only when the LEFT arm goes above the shoulder.
