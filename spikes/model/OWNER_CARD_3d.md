# OWNER CARD — turnaround images to a rigged GLB (Tripo and Meshy web UIs)

Run this once the four turnaround views are accepted (see `OWNER_CARD_turnaround.md`).
Do both services if you have the credits; we pick the better mesh in Blender.

## 0. Inputs (same four files for both services)

```
D:\ds\spikes\model\turnaround\front.png    (required)
D:\ds\spikes\model\turnaround\left.png     (her LEFT side = the side her left arm is on; camera on her left)
D:\ds\spikes\model\turnaround\back.png
D:\ds\spikes\model\turnaround\right.png
```

Rules that both services state (verified on Tripo's API docs and Meshy's help centre, 2026-09-01):
- Plain white (or transparent) background, one character per image, same distance/scale in every view,
  same pose, no shadows, no text. Meshy: at least 1040 x 1040 px, PNG/JPG/WEBP, under 20 MB.
  Tripo: PNG/JPEG/WEBP; higher resolution = more mesh detail (their tutorial suggests 2048 px or more).
- Views are 0 / 90 / 180 / 270 degrees of the same object. "Left" means the character's own left.
- Pose: A-pose with the arms about 35 degrees down-and-out, exactly as in the accepted turnaround (anything
  from 30 to 45 degrees is fine). Both services accept A or T; A gives cleaner armpit geometry and Meshy's
  "Pose" option lets you force A-Pose. Our Blender step (`tools/vrm/build_vrm.py --force-tpose`) converts the
  rest pose to the VRM T-pose, so keep the generation in A-pose.

Where to put downloads:
```
D:\ds\spikes\model\generated\tripo\   whalechan_tripo_<date>_rigged.glb   (+ the un-rigged .glb, + preview PNGs)
D:\ds\spikes\model\generated\meshy\   whalechan_meshy_<date>_rigged.glb   (+ the un-rigged .glb, + preview PNGs)
```
Keep the service's task/asset URL in a `notes.txt` next to the file (free-tier assets are public; we need the link).

What our Blender script expects (from `tools/vrm/README.md`, verified 2026-09-01): one rigged GLB (FBX also
imports), a humanoid skeleton with recognisable joint names (Mixamo-style names map directly; generic
`joint_12` names fail on purpose), textures embedded, A-pose or T-pose rest, feet on the ground, any scale
(we pass `--height`). One mesh is fine: the tail, ears, hair and skirt bone chains are placed by bounding box
or material. If a service offers a segmented export with the tail and ears as separate named meshes WITHOUT
losing the rig, take that too as a second download; it makes the chains exact. A separate face material is a
bonus, not a requirement: with one head material the whole head texture becomes the expression atlas cell.

---

## 1. Tripo (Tripo Studio, https://www.tripo3d.ai/app)

Plans seen 2026-09-01 (third-party price pages; the official pricing page returned HTTP 403 to our fetcher):
- Free / Basic: 200 credits per month (one page says 300), outputs are public, CC BY 4.0, non-commercial,
  limited downloads (one page: 15 per month).
- Professional: $19.90/month, 3,000 credits, commercial rights, private models. "Multi-view input / batch"
  is listed as Professional and above, so multi-view may need the paid tier.
- Higher tiers $49.90 to $139.90 (tier names differ between pages; check the app).
- API credit costs (official docs.tripo3d.ai pricing page, $1 = 100 credits): multiview-to-model H3 = 20
  (30 with texture); P1 = 40 (50 with texture); quad +5; "detailed" texture +10; rig = 25; retarget = 10 per
  clip; conversion = 5. A Studio generation with default HD texture + Ultra geometry costs about 50.

Steps:
1. Sign in, open Create, choose Image to 3D, switch the upload panel to Multi-view. The API order is
   `front, left, back, right`. Put `front.png` in Front (required), `left.png` in Left, `back.png` in Back,
   `right.png` in Right. Tripo needs at least two views; give it all four.
2. Settings (names as in Tripo's docs; pick the closest label if the Studio UI has moved):
   - Model version: latest (P1, released 2026-03; H3 = v3.1 is the cheaper fallback).
   - Geometry quality: Standard first (half price); Ultra only if Standard loses the fin-ears or tail.
   - Texture: on; Texture quality: HD / detailed; PBR: on (default; we use only base colour).
   - Quad / Smart Mesh: OFF for the first generation (rig on the triangle mesh; retopo later if needed).
     Face limit 30k to 60k if the slider exists.
   - Symmetry: Auto (the character is symmetric, including the tail flukes).
   - Remove background: on (harmless; our PNGs are already white-background).
   - Auto size: off (we scale in Blender). Style: none. Generate parts / segmentation: OFF (one mesh).
3. Generate. Rotate the preview: the tail must be a solid shape attached at the lower back, both fin-ears
   present, the apron a distinct raised shape, the face not smeared. Reject and regenerate (new seed) if the
   tail is missing or fused into the skirt, the arms are fused to the dress, or the back view hair is a slab.
4. Auto Rig: open the model, click Rig (Studio module "Auto Rig"). Model type: Biped (humanoid). Skeleton
   spec: Tripo (default) or Mixamo; pick Mixamo if offered, its joint names map directly onto VRM humanoid
   bones in Blender. Run the pre-rig check first if offered (free). Tripo says rig data is lost if you
   remesh or edit after rigging, so rig LAST.
5. Export / Download: format GLB (default), "with skeleton / with animation" ON, textures embedded (GLB
   always embeds), texture size 2048 or 4096. Tripo's converter offers GLTF, USDZ, FBX, OBJ, STL, 3MF; there
   is no VRM export, we build the VRM in Blender. Download the rigged GLB and the un-rigged GLB.
6. Save to `D:\ds\spikes\model\generated\tripo\` plus a screenshot of the Studio viewport (front and back).

## 2. Meshy (https://app.meshy.ai)

Plans seen 2026-09-01 (meshy.ai/pricing fetched directly):
- Free: 100 credits/month, outputs CC BY 4.0 (commercial use allowed with attribution), public assets,
  lower queue priority, no card needed. Image-to-3D = 20 credits (30 with Auto Split): about 5 free
  generations a month.
- Pro: $20/month (or $240/year): 1,000 credits, private assets, 10 concurrent tasks, faster queue.
- Premium $40, Ultra $100, Studio $70 + $10 per seat, Enterprise custom.
- Retexture at 2K/4K = 10 credits, 8K = 15 credits.

Steps (labels from Meshy's help centre and multi-view tutorial):
1. Open Image to 3D. AI Model: Meshy 7 (help centre: multi-view is a Meshy 7 feature; an older tutorial
   says Meshy 6; use the newest offered). Model Type: Standard (multi-view is NOT available in Smart
   Topology mode).
2. Upload `front.png` as the main image. Turn on the Multi-view toggle; three labelled slots appear:
   Left, Back, Right. Upload the matching files. If a view is missing the "Generate" link next to a slot lets
   Meshy invent it; do NOT use that, every view must be ours.
3. Settings:
   - Symmetry: Auto. Image Enhancement: off (our PNGs are clean). Auto Split: off (one mesh).
   - Pose: A-Pose (character option; standardises the rest pose for rigging).
   - Topology: Triangle for the first pass (Quad later via Remesh if we retopo). Target polycount 30k to
     60k if the slider exists.
   - PBR: on; texture: on.
4. Generate (20 credits). Inspect as in Tripo step 3.
5. Optional Retexture with Image Input = `front.png`, Texture Resolution 4K (10 credits) if the face or
   apron emblem came out muddy.
6. Animate, then Auto-Rig: Character type Humanoid. Position check: centred at origin, facing the viewer,
   feet at ground. Place the joint markers on the anatomical joints (neck, shoulders, elbows, wrists, hips,
   knees, ankles); for a 2.8-head chibi put the shoulder markers where the sleeves meet the bodice, not at
   the outer edge of the puffed sleeve. Click Auto-Rig (about 30 s).
7. Download: Download, then Animation, then All Added, then Single File; format GLB (FBX and USDZ also
   offered). No VRM export at Meshy either; Blender does that. Take the rigged GLB and the un-rigged GLB.
8. Save to `D:\ds\spikes\model\generated\meshy\` plus viewport screenshots.

## 3. Hand-back checklist (paste into the chat when done)

- [ ] `generated\<service>\whalechan_<service>_<date>_rigged.glb` exists, size and asset URL noted
- [ ] `..._unrigged.glb` exists
- [ ] two viewport screenshots (front, back) per service
- [ ] which settings you actually picked if the UI labels differed from this card
- [ ] credits spent and plan used (free tier means the model is public and CC BY; fine for the spike)

## 4. Licence notes seen on 2026-09-01

- Tripo free tier: CC BY 4.0, non-commercial, public gallery. Paid tiers: commercial, private.
- Meshy free tier: CC BY 4.0 (attribution), public; paid: private ownership.
- The community reference sheets we drew from are CC BY-NC-SA 4.0: a model derived from them is
  non-commercial and share-alike. This spike is a personal desktop pet; revisit before any release.

Sources fetched: docs.tripo3d.ai (pricing, multiview-to-model P1-20260311, rig v2.5-20260210, export/conversion),
developers.tripo3d.ai (image-to-multiview), tripo3ds.com/pricing (indicative July 2026), costbench.com Tripo plans
(verified 2026-08-24), makerstack.co Tripo review, meshy.ai/pricing, meshy.ai/features/image-to-3d,
meshy.ai/tutorials/multi-view-image-to-3d, help.meshy.ai "How to use Meshy Image to 3D",
meshy.ai/tutorials/character-auto-rigging-workflow. The official tripo3d.ai site returned HTTP 403 to our
fetcher, so Tripo Studio button labels come from the API docs and third-party write-ups, not the live UI.
