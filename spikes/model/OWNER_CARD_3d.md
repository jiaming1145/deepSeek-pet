# OWNER CARD — turnaround images to a rigged GLB (Meshy and Tripo web UIs)

Run this once the four turnaround views are accepted (they are: see `OWNER_CARD_turnaround.md`).
Re-verified against the live sites on 2026-09-01; every fact below carries a source or an
**unverified** tag. Summary of what changed since the first version of this card: **multi-view input
is a paid feature on BOTH services**, and **neither free tier can hand us a usable download** (Tripo
free exports are "15 (H2.5 only)", Meshy free downloads are Meshy 6 Lite only). Budget one paid month.

## Recommendation (read first)

1. **Meshy Pro, one month, $20** (or $240/year; do not take the year). Every click below is verified
   against Meshy's own help centre and tutorial, it has an explicit "Pose = A-Pose" control, auto-rig
   costs 0 credits, assets are private, and its rig follows Mixamo bone naming (reported by Meshy's
   docs; we verify on the file). 1,000 credits = about 33 full multi-view generations with texture.
2. **Tripo Pro, one month, $20 (third-party pages still show $19.90; check the checkout)** only if
   Meshy's mesh fails the inspection in step 4 (tail missing, fin-ears fused, face smeared) or its rig
   does not map in Blender. Tripo's API documents a Mixamo skeleton spec and its credit maths is
   published, but its Studio UI labels could not be verified (the site blocks our fetcher), so expect
   to hunt for buttons.
3. Do not spend time on either free tier: you can look at previews but cannot download the GLB we need.

## 0. Inputs (same four files for both services)

```
D:\ds\spikes\model\turnaround\front.png    (required; 2560 x 3072, white background)
D:\ds\spikes\model\turnaround\left.png     (her LEFT side = the side her left arm is on; camera on her left)
D:\ds\spikes\model\turnaround\back.png
D:\ds\spikes\model\turnaround\right.png
```

Input rules, verified 2026-09-01:
- Meshy multi-view (tutorial, meshy.ai/tutorials/multi-view-image-to-3d): 1 to 4 images, "At least
  1040 x 1040 px", "Plain background (white, gray, or transparent)", `.png .jpg .jpeg .webp` "up to 20MB
  each". Help centre (help.meshy.ai/en/articles/16102789): keep "art style, proportions, and background
  color completely consistent across your Front / Back / Left / Right images", subject centred with
  padding, nothing touching the edges. Our PNGs satisfy all of this.
- Tripo multiview API (docs.tripo3d.ai, P1-20260311 and H3 pages): files in the order
  `[front, left, back, right]`, "Do not use less than two images", front cannot be omitted, JPEG/PNG,
  max 20 MB. Tripo's tutorial page adds "under 10MB" and "JPEG, PNG, and TIFF" for the Studio uploader
  (conflicting; if the 3.2 MB PNGs are refused, re-save as JPEG quality 95).
- Views are 0 / 90 / 180 / 270 degrees of the same character. "Left" means the character's own left.
- Pose: A-pose, arms about 35 degrees down-and-out, exactly as in the accepted turnaround (30 to 45
  is fine). Both services accept A or T. Meshy's "Pose" option forces A-Pose. Our Blender step
  (`tools/vrm/build_vrm.py --force-tpose`) converts the rest pose to the VRM T-pose, so keep A-pose
  here. (Caveat from `spikes/model/VERIFY.md`: `--force-tpose` silently skips if the export carries
  shape keys; the controller checks the build log.)

Where to put downloads:
```
D:\ds\spikes\model\generated\meshy\   whalechan_meshy_<date>_rigged.glb   (+ the un-rigged .glb, + preview PNGs)
D:\ds\spikes\model\generated\tripo\   whalechan_tripo_<date>_rigged.glb   (+ the un-rigged .glb, + preview PNGs)
```
Keep the service's task/asset URL, plan used and credits spent in a `notes.txt` next to the file.

What our Blender script expects (`tools/vrm/README.md`): one rigged GLB (FBX also imports), a humanoid
skeleton with recognisable joint names (Mixamo-style names map directly; generic `joint_12` names fail
on purpose), textures embedded, A-pose or T-pose rest, feet on the ground, any scale (we pass
`--height`). One mesh is fine (tail, ears, hair and skirt chains are then placed by material or
bounding box); if the service can export the tail and ears as separate named meshes WITHOUT losing the
rig, take that as a second download, it makes the chains exact. A separate face material is a bonus:
with one head material the whole head texture becomes the expression atlas cell.

**Segmentation decision (closes VERIFY gap 3):** first generation with segmentation OFF (Meshy "Auto
Split" off; Tripo "generate parts" off). Segmentation on both services is a post-process that costs
extra (Meshy +10 credits per split; Tripo +20 credits) and is not documented to preserve the rig, so it
is an optional SECOND download from the same task, never the primary one.

---

## 1. Meshy (https://app.meshy.ai) — do this first

Plans (meshy.ai/pricing, fetched 2026-09-01):
- Free: $0, 100 credits/month, licence "CC BY 4.0" ("allows commercial use with attribution"), public
  assets. Help centre (help.meshy.ai/en/articles/15696428): credits reset on the 1st at 00:00 UTC and
  do not carry over; "10 free downloads/month for models generated with Meshy 6 Lite"; a model
  "generated with Meshy 6 or Meshy 7 ... you'll need to upgrade" to download. Multi-View "is a feature
  exclusive to paid subscribers" (help.meshy.ai/en/articles/12634481). So the free tier cannot do this
  card.
- Pro: $20/month or $240/year, 1,000 credits, private ownership, API, 10 concurrent tasks, "60% faster
  generation".
- Premium $40, Ultra $100, Studio $70 + $10 per extra member, Enterprise custom.
- Credit costs (meshy.ai/tutorials/meshy-credits-guide, Aug 2026, and the multi-view tutorial):
  model generation 20, texture 2K/4K +10 (8K +15), so a full textured generation is 30 (35 at 8K);
  Auto Split +10 per split; AI Auto-Repair 10; "Animation (rigging + presets)" free; Pose Control
  0 credits, Pro and above.
- Licence (help.meshy.ai/en/articles/16102098): free-plan models are CC BY 4.0 with the credit line
  "Model created with Meshy – CC BY 4.0 License"; paid plans "retain full private ownership", no
  attribution; rights are "tied to the plan you were on at the time of generation"; uploading a
  reference "you don't own or don't have permission to use ... can affect your ability to legally use
  the resulting model commercially, regardless of your Meshy plan tier" (see section 4).

Steps (labels from help.meshy.ai/en/articles/9996860 "How to Use Meshy Image to 3D",
help.meshy.ai/en/articles/12634481 "How to Use Multi-View", meshy.ai/tutorials/multi-view-image-to-3d,
meshy.ai/tutorials/character-auto-rigging-workflow, help.meshy.ai/en/articles/16231707):
1. Open **Image to 3D**. **Model Type: Standard** (Multi-View is "unavailable in Smart Topology
   mode"). **Model Version: Meshy 7** (help centre: "available with Meshy 7. Meshy 6 and Meshy 6 lite
   does not support Multi-View"; the older tutorial still says Meshy 6, ignore it).
2. Upload `front.png` as the main image. "flip on the **Multi-view** toggle"; "Three labeled upload
   slots appear below: **Left**, **Back**, and **Right**". Upload the matching files. Do NOT click the
   **Generate** link next to the slots (that makes Meshy invent the missing views); every view must
   be ours.
3. Settings:
   - **Pose: A-Pose** (options are "A-Pose, T-Pose, or Custom"; Pose Control is Pro and above, 0 credits).
   - **Auto Split: off** (one mesh; see the segmentation decision above).
   - **Image Enhancement: off** (our PNGs are clean; it "applies AI preprocessing to your input image").
   - **License: Private** (options "CC BY 4.0" or "Private"; Private is the paid default).
   - Symmetry: the API says `symmetry_mode` is deprecated and "no longer affects output"; if the UI
     still shows a Symmetry control leave it on Auto. **Unverified label.**
   - Topology / target polycount: the API exposes `topology` quad|triangle and `target_polycount`
     100 to 300,000 (default 30,000) with remesh off by default for Meshy 6/7. If the panel shows them,
     Triangle and 30k to 60k. **Unverified labels** (not in the help article).
   - Texture on (2K/4K, +10 credits). PBR: we only use base colour; leave the default.
4. Generate (30 credits with texture). Rotate the preview: the tail must be a solid shape attached at
   the lower back, both fin-ears present, the apron a distinct raised shape, the face not smeared.
   Regenerate (new seed) if the tail is missing or fused into the skirt, the arms are fused to the
   dress, or the back-view hair is a slab. Meshy gives free retries "depending on your subscription
   tier".
5. Optional **Retexture** with Image Input = `front.png`, Texture Resolution 4K (10 credits) if the
   face or apron emblem came out muddy.
6. Open the **Animate** area, character type **Humanoid** (others: "Quadruped Dog", "Smart Rig
   (Beta)" — do not use Smart Rig, "Smart-rigged models currently aren't supported by our animation
   library"). Position check: centred at origin, facing the viewer, feet at ground. If joint markers
   are offered, place them on the anatomical joints; for a 2.8-head chibi put the shoulder markers
   where the sleeves meet the bodice, not at the outer edge of the puffed sleeve. Click **Auto-Rig**
   ("under 30 seconds", 0 credits).
7. Download: **Download → Animation → All Added → Single File**, format **GLB** (FBX and USDZ also
   offered). There is no VRM export; Blender does that. Take the rigged GLB and the un-rigged GLB
   (download the model once before rigging, or from the model's own Download button).
8. Save to `D:\ds\spikes\model\generated\meshy\` plus two viewport screenshots (front, back) and
   `notes.txt`.

Bone names: Meshy's docs say the rig follows Mixamo conventions (reported via meshy docs search
snippet; not read verbatim). The controller checks with
`python tools\vrm\vrm_manifest.py <file>.glb` — if the bone list shows `Hips, Spine, LeftArm ...` (with
or without `mixamorig:`), the Blender mapper takes it as is.

## 2. Tripo (Tripo Studio, https://www.tripo3d.ai/app) — second choice

Plans (tripo3d.ai/pricing, fetched 2026-09-01 through a read-only proxy because the site returns HTTP
403 to our fetcher; third-party figures noted where they differ):
- Free: $0, 200 credits/month ("approx. 13 models"), "Public Models · Non-Commercial Use",
  **Exports "15 (H2.5 only)"**, 1 concurrent task, 1-day edit history, 3 free retries. "Multi-view to 3D"
  is listed under Pro, Max and Team only. The "CC BY 4.0" wording for the free tier appears only on
  third-party pages (costbench.com, aifreeapi.com), not on the official pricing row. Tripo's own
  tutorial page still says "300 credits per month" — stale; the pricing page says 200.
- Pro: $20.00/month or $240.00/year on the official page as fetched; costbench (verified 2026-08-24) and
  tripoia.com (2026-08-06) show $19.90 and an annual-equivalent "Creator" $13.93/month. 3,000 credits
  ("approx. 200 models"), "Private Models · Commercial Use", unlimited exports, 10 concurrent tasks,
  7-day history, Ultra mesh quality, part-based retopology, DCC Bridge.
- Max: $90/month ($1,080/year), 25,000 credits. Team: $55/seat/month. (Older cards said $49.90 to
  $139.90; those figures are gone from the current page.)
- API credit costs (docs.tripo3d.ai/get-started/pricing.html, $1.00 = 100 credits): multiview-to-model
  H2/H3 = 20 (30 with texture); P1 = 40 (50 with texture); detailed texture +10; quad +5; generate
  parts +20; geometry_quality "detailed" (Ultra) +20 (H3 page); pre-rig check free; rig 25; retarget
  10 per animation; conversion 5. Studio uses the same credit pool; a textured H3 Ultra generation plus
  rig is about 75 credits, a textured P1 plus rig about 75.
- Model versions (docs): multiview P1 = `P1-20260311`; H3 = `v3.1-20260211` (and `v3.0-20250812`).
  The P1 multiview endpoint has no `quad`, `geometry_quality` or `generate_parts` options; H3 has all
  three. Rig = `rig-v2.0`, "spec: tripo (default) or mixamo", output "glb (default) or fbx",
  "Always run Rig Check first" (free).

Steps. **Studio button labels are unverified** (every tripo3d.ai page we could reach describes the
workflow in prose, none reproduces the panel); the names below are the API parameter names, pick the
closest label and note what you actually clicked in the hand-back.
1. Sign in, open Create, choose Image to 3D and the multi-view / multi-image upload. Order is
   front, left, back, right: `front.png` in Front (required), `left.png` in Left, `back.png` in Back,
   `right.png` in Right.
2. Settings: model version H3 (v3.1) first — P1 is the low-poly "clean asset" model and costs double;
   H3 is the one Tripo recommends "when you have multi-angle inputs". Geometry quality: standard first
   (Ultra +20 credits only if standard loses the fin-ears or tail). Texture on, PBR on (default; we use
   base colour only), texture quality standard (detailed +10 if the face is muddy). Quad off (+5;
   rig on the triangle mesh). face_limit 30k to 60k if the slider exists. auto_size off (we scale in
   Blender). generate parts off (see segmentation decision).
3. Generate. Inspect as in Meshy step 4.
4. Rig: Rig Check first (free), then Rig with model type biped and **skeleton spec = mixamo** if the
   Studio exposes the spec (the API does; its joint names map directly onto VRM humanoid bones in
   Blender). 25 credits. Rig LAST (the earlier card said Tripo drops rig data if you remesh or edit
   after rigging; not re-verified today, but rigging last costs nothing).
5. Export GLB with skeleton (the rig output is "glb (default) or fbx"; textures are embedded in GLB).
   No VRM export. Download the rigged GLB and the un-rigged GLB.
6. Save to `D:\ds\spikes\model\generated\tripo\` plus two viewport screenshots and `notes.txt`.

## 3. Hand-back checklist (paste into the chat when done)

- [ ] `generated\<service>\whalechan_<service>_<date>_rigged.glb` exists, size and asset URL noted
- [ ] `..._unrigged.glb` exists
- [ ] two viewport screenshots (front, back) per service
- [ ] which settings you actually picked where the UI labels differed from this card
- [ ] plan used and credits spent (paid tier means private; free tier would be public and unusable anyway)

## 4. Licence notes (verified 2026-09-01)

- Meshy free tier: CC BY 4.0, public, credit line required; paid tiers: private ownership, no
  attribution. Rights follow the plan active at generation time.
- Tripo free tier: "Public Models · Non-Commercial Use" (official); paid tiers: "Private Models ·
  Commercial Use".
- Both services condition commercial rights on your right to the uploaded reference. Our turnaround is
  derived from the community reference kit (CC BY-NC-SA 4.0), so a model made from it is
  **non-commercial and share-alike regardless of the plan**. This spike is a personal desktop pet;
  revisit before any release. See `docs/3D_PIPELINE.md` section "Licence chain".

Sources fetched 2026-09-01: meshy.ai/pricing; help.meshy.ai articles 15696428 (free plan), 12634481
(multi-view), 16102789 (multi-view best practices), 9996860 (image to 3D), 16102098 (commercial use),
16231707 (auto rigging); meshy.ai/tutorials/multi-view-image-to-3d, /character-auto-rigging-workflow,
/auto-split-3d-model-into-parts, /meshy-credits-guide; docs.meshy.ai/en/api/image-to-3d,
/multi-image-to-3d, /webapp/image-to-3d, /webapp/guides/3d-model/rigging; tripo3d.ai/pricing (via
r.jina.ai proxy; direct fetch HTTP 403), tripo3d.ai/tutorials/tripo-ai-image-to-3d-model-tutorial and
/features/ai-auto-rigging and /blog/rig-ai-generated-character-for-mixamo (via proxy, no panel labels);
docs.tripo3d.ai/get-started/pricing.html, /model-generation/multiview-to-model-p1-20260311.html,
/model-generation/multiview-to-model-v3-0-v3-1.html; developers.tripo3d.ai/en/models/rig;
costbench.com/software/ai-3d-generation/tripo-ai/ (verified 2026-08-24); tripoia.com (2026-08-06);
aifreeapi.com/en/posts/tripo-3d (2026-05-17). Still unverified: Tripo Studio panel labels; Meshy
Symmetry / Topology / Polycount labels in the web panel; Meshy rig bone names on an actual export.
