# Decisions

Architecture decisions that bind every agent working in this repository. Read this before
building anything that touches the character, the visual runtime, or the art pipeline. A
decision here is changed by adding a new entry that supersedes it, never by editing history.

Format: date, decision, the evidence it rests on, what it rules out, and what it still leaves
open. Evidence paths are relative to the repository root.

---

## D-2026-09-01-01 · The visual runtime is Spine, not Live2D Cubism, not Rive

**Decision.** The pet's character is rendered by the Spine runtime (`@esotericsoftware/spine-webgl`, 4.3.x)
inside our existing WebGL stage, with head rotation and gaze built as procedural 2.5D deformation
on top of a normal Spine body rig. The Spine Professional editor licence is bought once for
authoring.

**Why.** The product goal is a pet that walks, eats, climbs, reaches toward the cursor, plants
her feet on real window edges, and holds things dragged onto her. That is procedural posing from
runtime state, which needs a runtime bone API and inverse kinematics. Verified in Spine's source
by an adversarial pass (workflow `wf_e338ffca-cff`, 2026-09-01): bone poses are mutable per frame;
`IkConstraint` exposes public one- and two-bone solvers taking a raw target with no authored
constraint; `physicsTranslate` / `physicsRotate` inject an impulse into every physics chain,
which is a dragged window; `ManagedWebGLRenderingContext` accepts a GL context we created, so the
synchronous 1-px readback click-through in `packages/stage` survives unchanged.

**What it rules out.**

- *Live2D Cubism.* No runtime bone API, no IK, no reach to an arbitrary point. Reach-to-cursor,
  foot planting and walking are permanently out of reach, not merely hard. All Cubism-format
  authoring (`.exp3.json`, `model3.json` fragments, deformer plans, `scripts/export-facial-expressions.mjs`)
  stops. The format-neutral half of that work survives: the 138 parts, the part manifest, the
  hit-area plan, the layer role map, the skeleton hierarchy, and the logic inside
  `packages/stage/src/facial-expression.ts` and `interaction-rig.ts`, whose output layer is
  re-targeted from Cubism parameter IDs to Spine deform and attachment writes.
- *Rive.* Per-pixel hit-testing is an unavoidable regression: `Image` is not a `Shape` in Rive's
  type hierarchy (`ImageBase : public Drawable`), so a meshed raster part is unhittable on both the
  `Artboard::hitTest` path and the state-machine listener path (`src/shapes/image.cpp` prints
  "Missing mesh" and returns `nullptr`). The shipped web bundle hardcodes `preserveDrawingBuffer:0`
  with no override, so our readback fallback is not reproducible either. No built-in physics, no
  warp primitive, and a subscription to change anything. `apps/desktop/rive_bindings.cpp` (1,680
  lines, no `binding.gyp`, no dependency, no Rive source in the repo) is abandoned, not extended.
- *DragonBones.* Browser-only SaaS editor with mandatory cloud storage of source art and no
  offline fallback; single-maintainer runtime. Too much of the project's future in one vendor.
- *3D / VRM.* Discards the entire part decomposition and requires commissioning a model from a
  single front view. The approved illustration is the front view, and a desktop pet idles front-
  facing nearly all the time; 3D never reproduces that view exactly.
- *Hybrid Live2D head on a skeletal body.* Two deformation models meeting at a neck seam every
  frame, two GL state machines, a second per-frame FBO resolve on an always-on app, and the
  Cubism rigging skill still has to be learned. Not worth it when the head can be done
  procedurally in Spine.

**What it leaves open.**

- *Binary release versus source release.* Spine's editor licence forbids third parties creating
  derivative works containing the Spine Runtimes without their own licence. Shipping a compiled
  pet is fine. Publishing this repository's source with the runtime in it is not. If the owner
  wants a source release, the runtime becomes Blender-authored glTF loaded by three.js instead,
  and this decision is superseded. Owner's call, still pending.
- *Whether Spine's runtime licence permits loading skeleton data not exported from the editor.*
  Relevant if the rig is generated programmatically from the part masks rather than authored by
  hand. To be read from the licence text, not guessed.
- *Whether the free trial imports the 4096×8192 PSD cleanly.* Checked before purchase.

**Evidence.** `docs/spikes/2026-08-31-tail-rig-spike.md`, `spikes/tail/`, workflow transcript
`.claude/projects/D--ds/6937fa24-7aae-458e-9817-d81b1ced4b57/subagents/workflows/wf_e338ffca-cff/`.

---

## D-2026-09-01-02 · Parts must be riggable, and the parts QA must prove it

**Decision.** A parts revision is not approved on reassembly error alone. It must also pass two
continuity gates: no part carries a leaked fragment of another part's art, and every pair of
parts whose art touches has a painted overlap band under the higher part. The gate is
`03_parts/revisions/v005/scripts/qa_continuity.py` and later revisions carry it forward.

**Why.** The v001 parts reassembled to the canonical at 0.24/255 mean absolute error and passed
QA, and could not move. A motion spike found 8 of 24 articulated seams with zero overlap and 48
parts carrying islands of another part's art. Both defects are invisible to a reassembly check
by construction: a pixel on the wrong layer in the right place composites identically, and two
parts cut edge-to-edge composite identically. Only motion reveals them, so the gate has to
measure the properties motion depends on.

**Consequences for the extraction step.** Partition boundaries follow outlines (seeded watershed
inside the planned zones) and leaked fragments are reassigned by neighbour vote. The hidden band
under each occluder is sized from the manifest's own `motion_envelope` and grown geodesically so
it cannot jump across a lower part, and it is filled by continuing the part's own pixels rather
than a flat colour. Implemented as parts revision `v005`; `v001` is untouched.

**Evidence.** `spikes/tail/audit_parts.py` and `spikes/tail/evidence/part_continuity_audit_v001.json`.

---

## D-2026-09-01-03 · Rig in product order, bind the visible surfaces

**Decision.** Rigging proceeds in the order the product is experienced, not in part order: the
at-rest layer first (face, head turn, gaze, breath, blink, lip sync), then arms and tail, then
legs and locomotion, then climbing. Bones bind the visible clothing surfaces (sleeves, stockings,
shoes, hands, hair, skirt, tail). The hidden-only anatomy parts (arms, legs, torso, neck, hip)
are ellipse-shaped copies of the art above them and stay at zero opacity in the rig.

**Why.** The pet is idle and facing the user most of the time, so perceived quality per hour of
rigging is highest on the at-rest layer. The anatomy parts have zero visible pixels in the
canonical and exist only as reconstruction proxies; binding them would put duplicate pixels on
screen under motion.

**What it leaves open.** Walking across the screen needs side-view art. A front-facing cutout
walks toward the viewer convincingly and sideways like a paper doll. A second canonical view for
walk, run and climb is a separate pipeline run and a separate approval. Climbing also needs a
"world sense" module in the main process that publishes window rectangles and the work area as
collision surfaces, reading geometry only, never titles, and it needs a line in
`PRIVACY-SENSING.md`.

---

## D-2026-09-01-04 · The character is a toon-shaded 3D VRM, superseding D-2026-09-01-01

**Decision.** The character is a chibi 3D humanoid in VRM 1.0, toon-shaded (MToon with outline),
rendered by three.js and `@pixiv/three-vrm` inside the existing transparent Electron pet window.
Body motion comes from animation clips (VRM Animation and Mixamo retargets) with procedural layers
on top (look-at, blink, breathing, two-bone IK reach, foot planting, spring bones for hair, tail,
skirt and ears). Her face is her drawn face used as the face texture, with eyes, brows and mouth as
texture-transform expression states that crossfade. This supersedes the Spine decision.

**Why.** The 2D cutout path was tried to the end of what it can do with a single front-view
illustration (`spikes/character/`, 2026-09-01): a paper doll. Every motion the owner asked for,
walking in any direction, climbing with hands and feet on real window edges, reaching with
foreshortening, sitting, sleeping, eating with a prop, and rich blended expression, is an existing,
mature technique in 3D and structurally impossible from one 2D view. 3D is also the only path
where the AI can produce motions she was never animated for, via text-to-motion models on a
humanoid skeleton.

**How the model is made.** The owner cannot model and no 3D model of her exists publicly. The
community reference kit (`Neko3000/deepseek-whalechan`, CC-BY-NC-SA 4.0) supplies a front, side and
back turnaround of the same chibi. A clean A-pose turnaround is generated from it; a hosted
multi-view image-to-3D generator with auto-rig (Tripo or Meshy; the local GPU is too small for the
open models) produces the rigged mesh; Blender scripts (`tools/vrm/`) add the tail, ear, hair and
skirt bone chains with spring physics, MToon, the face texture and expressions, and export the VRM.
A human modeler can replace the body later without touching anything else.

**What it rules out.** Spine, Rive, Cubism, DragonBones, the 2D cutout rig, and the v005 parts as
things to be rigged. The v005 parts remain the face texture source and the reference.

**What it leaves open.** Non-commercial and share-alike terms carried by anything derived from the
community kit; the quality of generated hair and frills, expected to be softer than the drawing;
the second illustration view is no longer needed.

**Evidence.** `spikes/character/evidence/` (the rejected cutout result), the owner's ruling of
2026-09-01, the community kit's overview sheet.

## D-2026-09-02-05 · The asset is authored in VRoid Studio (commission later), not auto-generated and auto-rigged

**Decision.** The VRM that the runtime animates is authored in VRoid Studio by the owner from the
card `spikes/model/OWNER_CARD_vroid.md`, exported as VRM 1.0, and may later be replaced by a
commissioned custom VRM built to the same acceptance sheet. The generated-mesh-plus-auto-rig path
(Meshy multi-view image-to-3D, Meshy API rigging, `tools/vrm/chains.meshy01.json`) is closed as the
source of the character. The runtime, action controller, expression mapping and the Blender
`tools/vrm/` build stay; they take any VRM.

**Why.** The Meshy asset was taken to the end of what procedural repair can do (runs meshy-01 to
meshy-08, 2026-09-02): baked clip stripped, elbows and hand bones relocated, arm weights cleaned by
segment radius, zone and radial profile, chains selected relative to bones. The remaining defects
are structural to a generated asset: one welded surface (hair, skirt, body, face cannot move
independently), no blendshapes (no facial expression and no mouth, the face swap was impossible on
one material), auto-rig weights that bleed across parts, and adult-proportion clips on a chibi. The
owner watched the live tour and ruled the rig not acceptable. A VRoid Studio model is a properly
authored VRM: humanoid rig, blendshape face with every VRM expression and viseme, hair strands and
skirt as separate spring-bone groups, and the stock-VRM test in this same window already proved
fluid motion, look-at and expressions on such a file.

**What it rules out.** Further Meshy or Tripo regeneration for the character; hand-separating a
generated shell in Blender; the face-atlas projection onto a single-material head.

**What it leaves open.** Style match to the reference (VRoid look vs the drawing), solved by a
commission if wanted; fin ears and tail built from hair strands and re-parented to the hips at build
time; the chibi motion set (VRoid Hub VRMA pack and Mixamo retargets tuned for 2.2-head proportions).

**Evidence.** `tools/vrm/out/whalechan/meshy-08/` sheets and window captures, the raw-vs-rigged
vertex comparison (0 of 48,244 vertices differ: the mesh was fine, the rig was not), the owner's
ruling of 2026-09-02 after the live tour, `docs/3D_PIPELINE.md` "Repairing an auto-rig".


---

## D-2026-09-04-06 · The character is a layered 2D rig cut from her own drawings, superseding D-2026-09-01-04 and D-2026-09-02-05

**Decision.** The visual layer is a two-view 2D cutout rig on our own three.js runtime (`spikes/side_rig/`).
The side view (locomotion) and the front view (facing actions) are decomposed from the approved drawings by
See-through (shitagaki-lab, Apache-2.0; hosted Space, runner `tools/see_through/run_space.py`, exporter
`tools/see_through/psd_layers.py`) into inpainted layers; bones come from the layer alphas (`build_rig.py`);
tail, hair, skirt and limbs are skinned grids with springs; the front face is the expression kit cut from the
same canonical drawing (`spikes/model/face`, `facekit.js`) mounted on the head bone through the recorded
canonical-to-canvas map. Not Spine, not Live2D Cubism, not a VRM.

**Why.** Every 3D route (Meshy auto-rig, VRoid-base restyle, chibi VRoid) was rejected by the owner on
likeness; a cutout of her own art keeps the exact drawing. The owner judged the side rig "pretty good"
(2026-09-03) and asked for the front view with expressions as good as the generated pictures; both exist
now and run at 60 fps with 18 actions, 18 kit moods (30 recipes), pick-up/throw physics, pose crossfades
and an autopilot on a click-through desktop window (`main.js --pet`).

**What it rules out.** A Spine Professional purchase for now (our runtime already does mesh skinning and
springs); VRM/three-vrm as the character; hand-painted multi-view layer sets.

**What it leaves open.** A back view only if an action needs it (mirrored side view covers walking, as in
Ark-Pets); climbing and window-edge physics; a Spine export if a rigger is ever hired; the brain layer
(LLM -> action names) on top of `window.lab` / `window.pet`.

**Evidence.** `spikes/side_rig/evidence/sheet_actions_views.png`, `sheet_emotions_views.png`,
`sheet_face.png`, `sheet_pet.png` (autopilot 100 s + hover/click/drag/throw, 0 errors, 60 fps),
`rig_front_overlay.png` (bones and face-kit cells on the real front layers); commits c126b36, ddd66ae and
the 2026-09-04 movement commit.
