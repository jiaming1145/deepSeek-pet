# Action vocabulary

The single contract between everything that can ask the character to do something and the
rig that does it. DeepSeek's `<|ACT …|>` tags, `behaviors.json`, touch and drag, the
simulation, and the main process's window motion all speak this vocabulary and nothing
else. The rig is authored against it, the brain prompt lists it, and a behaviour that names
an action not in it is dropped at `bind()`.

Status: **draft for approval**, written 2026-09-01 against `packages/protocol` at commit
`775a561` plus Codex's uncommitted `InteractionAction` enum. Two additions are proposed
(`reach`, `climb`); everything else is the shipped enum. See `docs/DECISIONS.md`.

## 1. The three lanes and who may hold them

The arbiter (`apps/desktop/src/renderer/pet/stage/arbiter.ts`) leases three lanes. An action
declares which lanes it needs; it cannot start unless it can take all of them.

| lane | what it moves | holders, highest priority first |
|---|---|---|
| `body` | bones, skeleton, physics impulses, props | drag · touch · llm · sim · behaviour |
| `expression` | the facial controller's 45 dimensions, blink, mouth shapes | touch · llm · sim · behaviour |
| `gaze` | head 2.5D turn and eye direction | touch · llm · sim · behaviour |

Lip sync is not a lane. It owns the mouth-open channel whenever text is being revealed and
composes over whatever expression is active. Breath, weight shift and tail sway are not
actions either; they run under everything as the at-rest layer and are damped, not stopped,
while an action plays.

## 2. Realisation strategy

Every action ships first as a **procedural** controller so the whole vocabulary works on day
one and the AI can drive all of it. Authored Spine clips then replace the procedural version
of the hero actions, in the order §5 gives, without changing the contract.

- **P** procedural: computed each frame from state (IK targets, springs, curves).
- **A** authored: a Spine animation clip, played through the runtime.
- **A+P** authored base with procedural targets layered on (a walk clip whose feet are IK-planted
  on the real floor; an eat clip whose hand bone is IK-pulled to the prop).

## 3. Actions

Columns: **lanes** taken · **triggers** that may start it · **realisation** now → target ·
**interrupt** policy · **needs** from the world or art.

Triggers: `llm` = `<|ACT motion=<id>|>`; `beh` = `behaviors.json` `interaction`; `touch` = a
hit on a `HitPart`; `drag` = window drag by the user; `sim` = the simulation's mood, energy and
clock; `main` = a locomotion request executed by the main process.

### Posture and locomotion

| id | lanes | triggers | realisation | interrupt | needs |
|---|---|---|---|---|---|
| `idle` | body | sim, beh | P → P | always | — |
| `walk` | body, gaze | main, llm (`walkTo=`), beh (`locomotion: stroll`) | P → A+P | by drag, touch; llm walk cancels sim walk | floor from world sense; **side view for lateral travel** |
| `hop` | body | main, beh (`locomotion: hop`), llm | P → A+P | by drag | floor |
| `sit` | body, gaze | sim, beh, llm | P → A+P | by drag, touch | an edge to sit on: taskbar top or a window's top edge, from world sense; falls back to floor |
| `sleep` | body, expression, gaze | sim (energy, clock), llm, beh | P → A | by touch (→ `wake`), by drag | — |
| `wake` | body, expression | sim, touch while asleep | P → A | no; runs to completion (≤ 1.5 s) | — |
| `stretch` | body | sim, beh | P → A | by drag, touch | — |
| `climb` **(proposed)** | body, gaze | main, llm (`walkTo=` a vertical anchor) | P → A+P | by drag only | a vertical edge from world sense; hands and feet IK-pinned; **side or 3/4 view** |
| `stumble` | body, expression | drag release, landing, sim | P → P | by drag | physics impulse from main's window motion |
| `recover` | body, expression | follows `stumble` automatically | P → A | no; ≤ 1.2 s | — |

### Gesture and object interaction

| id | lanes | triggers | realisation | interrupt | needs |
|---|---|---|---|---|---|
| `reach` **(proposed)** | body | llm (`look=` point), touch, beh | P → P | always | a target point; two-bone IK on the nearer arm; this is the primitive `inspect`, `eat`, `drink` and `climb` build on |
| `inspect` | body, gaze | llm, beh, touch on `prop` | P → P | by drag, touch | = `reach` + lean + gaze lock on the target |
| `wave` | body | llm, beh, touch on `hand` | P → A | by drag | — |
| `eat` | body, expression | llm, beh, sim (hunger later) | P → A+P | not during the last 30 %; drag cancels with a `stumble` | `prop:food` attached to the hand bone; chew via the facial controller |
| `drink` | body, expression | llm, beh | P → A+P | as `eat` | `prop:drink` |
| `celebrate` | body, expression | llm, beh | P → A | by drag, touch | — |
| `tail_react` | body | touch on `tail`, drag release | P → P | always | the existing six-link solver |

### Face and gaze (not actions; composed with any action)

- **Emotion**, one of the nine in `@ds/protocol` `EMOTIONS`, set by `llm` (`emotion=`), `sim`,
  `beh`, or `touch`. Realised by `FacialExpressionController` blending into 45 muscle-like
  dimensions; its output layer is re-targeted from Cubism parameter IDs to Spine deform and
  attachment writes. Static overlays are not used (owner's ruling, `03_parts/revisions/v003`).
- **Gaze pattern**, one of `follow · wander · cursorLock · away · down · up · edge · none`, set
  by `llm` (`look=`), `beh`, `sim`, `touch`. Realised as head 2.5D turn plus eye offset.

## 4. Touch map

A hit on a `HitPart` starts an action on the highest-priority lane holder, `touch`, which
preempts `llm`, `sim` and `beh`.

| part | reaction |
|---|---|
| `head`, `hair` | `expression` happy + `gaze` follow; repeated pats escalate to `celebrate` |
| `face` | `expression` awkward, `gaze` away, brief `reach` to cover |
| `body` | `stumble` if hard, else `expression` surprised |
| `arm`, `hand` | `wave` |
| `leg`, `foot` | `expression` question, `gaze` down |
| `tail` | `tail_react` |
| `accessory` | `expression` angry, brief `reach` to fix it |
| `prop` | `inspect` |
| `ticklish` | `expression` happy burst, body wriggle (P), no lane change on release |

Drag is above touch: it takes `body` for the duration, feeds `stumble` on release.

## 5. Authoring order

Hero actions get authored clips in this order; everything else stays procedural until the
owner asks. Order follows `docs/DECISIONS.md` D-2026-09-01-03: the at-rest layer is not an
action and is finished first.

1. `walk` (front-facing, toward the viewer)
2. `eat`
3. `sleep` / `wake`
4. `celebrate`
5. `wave`
6. `sit`

`climb` and lateral `walk` wait on the second canonical view.

## 6. What this changes in code

Updated 2026-09-01 for the 3D runtime (`docs/DECISIONS.md` D-2026-09-01-04). The action list above is
unchanged; "authored" now means an animation clip played on the VRM humanoid, not a Spine clip. The
authoritative action-to-clip map is `spikes/vrm/anim/ACTION_CLIPS.json`; the runtime reads that file,
this section only explains it.

- `packages/protocol` `INTERACTION_ACTIONS`: add `reach`, `climb`. Behaviours naming them are
  valid; the rig realises them.
- `packages/brain`: `motion=` values are validated against this list, not the model3 motion
  catalogue. Unknown values are dropped as today.
- `packages/behaviors`: `interaction` is already optional on a behaviour; the `motion` tuple
  becomes optional too, since an action can be fully procedural.
- `apps/desktop/src/main`: a world-sense module publishing the work area and window rectangles
  (geometry only, never titles) as collision surfaces for `walk`, `sit`, `climb`.
- `apps/desktop/src/renderer/pet`: the stage renders a VRM 1.0 with three.js + `@pixiv/three-vrm`
  (spike: `spikes/vrm/index.html`). The three lanes of §1 are unchanged. `body` is realised by a
  clip layer (three `AnimationMixer` on the VRM humanoid, loaded through
  `spikes/vrm/anim/retarget/index.js`: `loadQuaterniusAnimations`, `loadVRMAnimation`,
  `loadMixamoAnimation`) with procedural layers written after the mixer each frame; `expression`
  by `vrm.expressionManager` (presets + the face-atlas states); `gaze` by `vrm.lookAt` plus a
  head-turn layer. The at-rest layer (breath, weight shift, tail sway, blink) is procedural under
  everything and spring bones (`VRMC_springBone`) move tail, ears, hair and skirt without any clip.

### Clip vs procedural, per action

From `ACTION_CLIPS.json` (`status`: covered = licence-clean clip in the tree now; owner = free clip
behind the owner's BOOTH or Mixamo login; procedural = no clip, computed at runtime). The
`procedural_layer` column is what stays procedural on top of the clip, and is the whole realisation
until the clip arrives.

| action | realisation | primary clip | procedural layer |
|---|---|---|---|
| `idle` | covered | `quaternius:Idle_Loop` | breath, weight shift, tail sway, blink, look-at |
| `walk` | covered | `quaternius:Walk_Loop` | foot IK to floor, head look-at; in 3D lateral walk needs no side-view art (D-2026-09-01-04 supersedes the last line of §5), only the floor from world sense |
| `hop` | covered | `quaternius:Jump_Start` + `Jump_Land` | vertical offset from main's window motion, landing squash |
| `sit` | covered | `quaternius:Sitting_Idle_Loop` (+ `Sitting_Enter` / `Sitting_Exit`) | hips pinned to the sensed edge height, gaze |
| `sleep` | owner | `mixamo:sleep_lie.fbx` (stopgap `quaternius:Death01` end pose) | slow breath, eyes-closed expression, damped tail |
| `wake` | owner | `mixamo:get_up.fbx` | blink/squint, stretch overlay; trimmed to <= 1.5 s |
| `stretch` | owner | `mixamo:stretch_arms.fbx` | procedural arms-up spline until the clip lands |
| `climb` | owner | `mixamo:climb_ladder.fbx` | hands and feet IK-pinned to the sensed vertical edge, gaze up |
| `stumble` | procedural | none (`quaternius:Hit_Chest` as an impact flinch overlay) | physics impulse from window motion drives everything |
| `recover` | owner | `mixamo:get_up.fbx` (stopgap `quaternius:Jump_Land` tail) | expression; <= 1.2 s |
| `reach` | procedural | none (`quaternius:Interact` is a timing reference) | two-bone IK on the nearer arm to the target point |
| `inspect` | procedural | none | reach + lean + gaze lock |
| `wave` | owner | `vrma:VRMA_02.vrma` (VRoid Greeting; alt `mixamo:wave.fbx`) | gaze to viewer; procedural arm wave until then (currently reads as a salute, VERIFY.md) |
| `eat` | owner | `mixamo:eat.fbx` | hand IK to `prop:food`, chew via the facial controller |
| `drink` | owner | `mixamo:drink.fbx` | hand IK to `prop:drink`, swallow via the facial controller |
| `celebrate` | covered | `quaternius:Dance_Loop` (2 to 3 cycles) | happy expression, tail wag |
| `tail_react` | procedural | none | spring-bone tail (VRM `VRMC_springBone`), impulse on touch or drag release |

Rules the runtime follows:
- Every action still starts procedural (§2 P), so the vocabulary is complete before any owner clip
  arrives; a clip replaces the body motion of an action without changing its lanes, triggers or
  interrupt policy.
- `A+P` actions apply the clip through the mixer, then overwrite specific bones (feet, hands,
  hips) with IK / pin results in the same frame; the VRM's spring bones and look-at update after that.
- Mixamo and VRoid clips are owner-gated (`spikes/vrm/anim/OWNER_CARD_mixamo.md`,
  `spikes/vrm/anim/SOURCES.md`); their raw files are never redistributed, only shipped inside the pet.
- Clips are retargeted once at load (`retarget/smoke.mjs` is the check: 45 Quaternius clips, 53 tracks
  per clip, 0.03 deg mean error); the hips translation is scaled by the hips-height ratio so adult
  mocap fits a 2.8-head chibi.
- The §5 authoring order stands, read as "which owner clip to fetch and tune first":
  walk (covered) → eat → sleep/wake → celebrate (covered) → wave → sit (covered).
