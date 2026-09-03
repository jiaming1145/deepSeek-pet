# Owner card: build Whale-chan in VRoid Studio (free), export VRM 1.0

Budget: one or two evenings. Nothing here is modelling; it is presets, sliders, a hair "drawing" tool and
colour picking. When a menu name below differs slightly from what you see, go by the description: the
VRoid help pages could not be fetched from this machine, so names come from VRoid's release notes and
the editor layout as I know it.

## 0. Install and set up (10 min)
1. Install VRoid Studio, free, from https://vroid.com/en/studio (or Steam, same app). Version 1.20 or
   newer is required: that is the version that added VRM 1.0 export
   (https://vroid.com/en/studio/notice/lqLbniPQLCEfU4ZVxadnN).
2. New model, female base. Save the project immediately as
   `D:\ds\spikes\model\generated\vroid\whalechan_v1.vroid` (create the folder). Save often; the
   project file is what we iterate on later.
3. Keep `spikes\model\turnaround\front.png` and `spikes\model\reference\` open on the side for colours.

Palette (pick with the eyedropper from the front turnaround, these are the targets):
- hair base navy blue, tips light sky blue (gradient), ahoge same navy
- eyes bright blue with a lighter ring, big and round
- dress navy with white apron, white frills at hem, cuffs and collar, thin gold trim
- bows and ribbons light blue; maid headdress white with navy band
- tail and fin ears navy on top, pale blue-white underside
- skin light, stockings white, shoes navy

## 1. Body, the chibi shape (10 min)
Body tab, body parameters. Target is about 2.2 heads tall, head wide "like a bun":
- Head size to maximum, height to minimum, neck short.
- Arms and legs short (arm length low, leg length low), shoulders narrow, torso as short as it goes.
- VRoid will not go fully chibi; a wide head with the shortest body is the known limit and it is fine.
  Reference: https://vroid.pixiv.help/hc/en-us/articles/360014785994 and the guide at
  https://note.com/okomenko/n/ncef896909a02 (chibi in VRoid, the same slider recipe).

## 2. Face (15 min)
Face tab. Large round eyes, blue iris with lighter highlight ring, soft eyebrows, small mouth, blush on.
Do not touch the expression editor beyond a look: VRoid generates every VRM expression (happy, angry,
sad, relaxed, surprised, blink, and the aa/ih/ou/ee/oh mouth shapes) automatically. Check them once in
the expression editor by dragging the sliders, then leave defaults.

## 3. Hair (30 to 45 min)
Hair tab. Start from a long wavy preset (long back hair, side locks, bangs with an ahoge).
- Bangs: a soft fringe with one ahoge curl on top (VRoid presets have "ahoge"; keep it thick enough to read).
- Back hair: long, wavy, reaching the waist. Side locks over the shoulders.
- Colour: base navy, gradient to light blue at the tips (hair material has a gradient/highlight setting).
- Fin ears: in the hair editor add a new hair group at each side of the head and draw 3 or 4 flat,
  short strands pointing sideways and slightly back, thickness high, so they read as fins. Colour navy,
  set the highlight pale. If you find a free or cheap "fin ears" hair preset on BOOTH, that is faster.
- Maid headdress: either a BOOTH headdress item or a white hair-strand band with a frilled edge.
- Physics: every hair group has spring-bone settings (stiffness, gravity, collision). Leave the presets;
  I tune them after export if needed.

## 4. Outfit (20 min, plus BOOTH)
Outfit tab. Use a one-piece dress base with a white apron and frilled hem. The fastest good result is
a ready maid outfit for VRoid; they are cheap on BOOTH, for example
"(Vroid) Cute Maid Outfit Set (multiple colour)", 399 JPY, https://booth.pm/en/items/5369262. Search
https://booth.pm/en/search/vroid%20maid for others; `.vroidcustomitem` files import straight into the
outfit tab. Then recolour to navy plus white using the texture layer colour controls, add the light
blue bow at the collar. Stockings white, shoes navy. Check the item's licence allows modification and
use in an app (most say so on the listing).

## 5. Tail (20 min)
VRoid has no tail primitive. Two ways, either is fine:
- Buy a hair-based shark tail such as "(VROID) Shark Hoodie (optional shark tail)", 399 JPY,
  https://booth.pm/en/items/4624356, import only the tail item, colour it navy with a pale underside.
- Or draw it yourself in the hair editor: a new hair group of 6 to 8 thick strands starting at the
  lower back, sweeping down and out to two flukes.
Either way the tail will be attached to the head bone, because VRoid hair always is. That is expected.
I re-parent it to the hips during the build so it swings from her lower back.

## 6. Export (10 min)
File, Export, VRM. Choose **VRM 1.0**. Fill Avatar name `Whale-chan` and Creator `<your name>` (both
required for 1.0). Settings:
- Texture size 2048, no polygon reduction, do NOT delete bones (hair bones are her physics),
  material reduction is fine.
- Licence block: personal use, modification allowed (this is for your own app).
Save as `D:\ds\spikes\model\generated\vroid\whalechan_vroid_v1.vrm`. Also export a thumbnail or take
one screenshot of the front view next to it.

## 7. Two 5-minute extras while you are there
- Free official motion pack, 7 VRM animations (.vrma) from the VRoid Project:
  https://vroid.booth.pm/items/5512385 (free). Unzip into `D:\ds\spikes\vrm\anim\vrma\`.
- Upload the model to VRoid Hub if you like; not needed for us.

## Then tell me the file names
I probe the VRM (bones, expressions, spring bones), run the live tour with her, re-parent the tail,
retune the chibi motion set, map the expressions to the pet's emotions, and show you sheets plus the
window. Nothing in the runtime changes for this model.
