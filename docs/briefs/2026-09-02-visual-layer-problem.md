# Problem brief: an AI-driven character layer for a desktop pet

## Goal
A desktop companion for Windows. A character lives in a transparent, always-on-top window (640x900) and
feels alive: she idles, walks along the screen, hops, sits, sleeps and wakes, eats and drinks with a prop,
stretches, reaches toward the mouse cursor, looks at the user, climbs and hangs on window edges, waves,
celebrates, and shows rich facial expression plus lip-sync when she talks. A large language model (DeepSeek)
chooses what she does at runtime from the user's activity and chat, so the character needs an open action
vocabulary that can be composed and blended, not a fixed set of canned animations. The bar is "exquisite":
better than every existing GitHub desktop pet. The character is Whale-chan, the DeepSeek whale mascot as a
chibi maid: blue hair with an ahoge, fin ears, a whale tail, navy maid dress with white apron. A community
reference kit exists with a front, side and back turnaround.

## Constraints
- The owner cannot draw or 3D-model. Assets must come from AI generators, free or cheap tools, or a paid
  commission. Budget is a consideration, not a hard wall.
- The runtime is already built and proven: Electron, three.js and @pixiv/three-vrm rendering a VRM 1.0 model
  in the transparent window at 60 fps with animation clips (VRMA and Mixamo retargets), two-bone IK reach,
  head look-at, foot planting, spring-bone physics and VRM expressions. Any solution that produces a proper
  VRM plugs in with no runtime changes. Other formats are possible but cost a rewrite.
- A Blender 5.2 headless pipeline exists that can post-process meshes and rigs (move joints, clean weights,
  add spring chains, apply toon shading, export VRM). It cannot do artistic work: no sculpting, no hand
  weight painting, no drawing blendshapes.
- Local GPU is small; heavy open-source 3D generators do not run locally, hosted ones do.

## What has been tried and why each failed
1. Live2D Cubism. Parameter-driven 2D deformation. Beautiful faces, but no bones at runtime, no IK, no
   walking or climbing through space, and every pose must be authored in advance. Rejected.
2. 2D cutout skeletal animation built from a single front-view illustration (parts cut from the drawing,
   94-bone rig, procedural tail). Result was a paper doll: no foreshortening, no turning, every motion
   looked unnatural. Rejected after a full test lab.
3. 3D from a hosted multi-view image-to-3D generator (Meshy) with its auto-rig. The mesh itself looks
   excellent and matches the drawing. The rig and structure do not:
   - The mesh is one welded shell with one texture. Hair, skirt, body and face are a single surface, so hair
     and skirt cannot move independently; hair swings as a slab, and the skirt is fused to a hand.
   - No blendshapes. The face cannot emote and the mouth cannot open. Projecting a drawn face texture with
     expression states was impossible on a single-material head and would still give no mouth motion.
   - Auto-rig weights bleed across parts (skirt and hair weighted to arm bones), and joints were misplaced
     on chibi proportions (both elbows placed behind the back, hand bones as long as forearms). These were
     repaired procedurally as far as possible: baked clip stripped, joints relocated, weights cleaned by
     distance, zone and radial-profile rules, physics chains placed relative to bones. It still looked
     wrong in motion, and the owner ruled it unacceptable.
   - Generic adult motion clips retargeted onto 2.2-head chibi proportions look off even when playback is fluid.
   A human-proportioned generation would fix joint placement and clip fit but not the welded shell or the
   missing face rig.

## The core problem in one sentence
We need a rigged character asset, VRM preferred, with (1) separate movable parts for hair, skirt, tail and
ears with physics, (2) a face that can emote and lip-sync (blendshapes or an equivalent trick), (3) clean
humanoid skinning that accepts retargeted motion, and (4) a look faithful to the reference, produced with
no human modeler, or with the least paid human work possible.

## Options currently on the table, with the build team's assessment
- VRoid Studio (free character creator). Produces a proper VRM with a real humanoid rig, a full blendshape
  face, hair strands and skirt as separate physics groups. Fin ears and tail can be built from hair strands.
  Downside: a recognizable VRoid style rather than the drawing, and chibi proportions are limited by sliders.
- Commission a custom VRM from a VTuber-model artist. Best fidelity, roughly 200 to 600 USD, 2 to 6 weeks.
- Keep repairing generated meshes. Structural limits above; not recommended.
- Angles not yet explored that another AI could weigh: generators that output separated parts or
  blendshapes; auto-retopology and auto-rig tools built for humanoids (Reallusion AccuRIG and Character
  Creator, Mixamo auto-rigger) applied to the generated mesh; a hybrid of a 3D body with a drawn 2D face
  overlay (a billboarded texture face on a 3D head, common in chibi games); commissioning only the
  rig-ready split and retopology of the existing mesh; video-generation or sprite approaches that give
  up on 3D; a commissioned Live2D model combined with a separate locomotion trick.

## Questions to answer
1. Is there any generator or tool chain today that gets a welded single-shell mesh to a rig-ready state
   (split parts, retopology, face blendshapes) without a human artist, at acceptable quality?
2. For a chibi companion whose purpose is emotional reaction, is a texture-based face (swapped expression
   states, no mouth deformation) acceptable, and how do chibi games make it convincing?
3. Which asset route gives the best "alive" feel per dollar and per week for a solo owner who cannot model?
4. Is VRM the right target given an LLM-driven open action vocabulary, or is another rig standard better?
5. What should the acceptance test for the asset be so a commission cannot fail silently?

## Evidence available on request
Turnaround images, the Meshy mesh and rigged file, render sheets and window captures of every action,
the stock-VRM proof that the runtime itself moves fluidly, and the Blender pipeline logs.
