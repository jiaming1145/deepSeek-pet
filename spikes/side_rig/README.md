# side_rig - her 2D cutout rig (side + front) and the desktop pet

Layers come from See-through decompositions of her approved drawings; bones are derived from the layer
alphas; the runtime is plain three.js (no Spine, no Live2D). See `docs/DECISIONS.md` D-2026-09-04-06.

## Run (from `apps/desktop`)

    npx electron ../../spikes/side_rig/main.js --pet                      the pet on the desktop (autopilot on)
    npx electron ../../spikes/side_rig/main.js --pet --height 300         smaller
    npx electron ../../spikes/side_rig/main.js --rig rig.json --front rig_front.json          lab window, keys on the HUD
    npx electron ../../spikes/side_rig/main.js --tour --rig rig.json --front rig_front.json   cycles every action
    npx electron ../../spikes/side_rig/main.js --capture --rig rig.json --front rig_front.json   shots_views/ then exit
    npx electron ../../spikes/side_rig/main.js --pet --selftest           autopilot + synthetic click/drag/throw, shots_pet/
    npx electron ../../tools/electron-errscan.js D:/ds/spikes/side_rig/index.html          renderer error scan

Pet controls: hover = she looks at the cursor (turns around if you stay behind her); click = reaction;
drag = pick her up, release = drop or throw; `P` toggles the autopilot; `Esc` quits (after clicking her);
the tray icon has Wave / Nap / Autopilot / Quit. Sheets: `python make_sheet.py views`,
`python make_pet_sheet.py` (needs Pillow: use `D:/tools/see-through/.venv/Scripts/python.exe`).

## Files

- `build_rig.py` - bones + attachments from `assets*/layers.json` (`--view side|front`); writes `rig*.json` + overlay.
- `rig.js` - runtime: views, skinning, springs, actions, face (procedural pieces in side view, face kit in
  front view), physics (hold/throw/land), pose crossfade, stage in px, `window.lab` control surface.
- `pet.js` - pointer interaction and the bridge from mind to body (`window.pet`); `preload.js` - the click-through
  and idle-time bridge.
- `mind.js` - needs-driven behaviour: four needs, utility scoring over activities, mood derived from needs, and a
  plain-English reason for every choice. No DOM, no three.js, no network. `node mind.test.mjs` runs 19 behaviour
  tests; `node mind_trace.mjs` writes a simulated hour that becomes `evidence/mind_hour.png`.
  An outside brain may call `suggest()`; it is honoured once, validated, and never blocks her.
- `voice.js` - her lines, grouped by situation, with repeat suppression and a minimum silence between unprompted
  remarks. `memory.js` - what persists between runs (first met, time together, pats, throws, her needs at
  shutdown), written by the main process to `<userData>/whalechan-memory.json`. `node voice.test.mjs` runs 27
  tests over both. The speech bubble is a plain DOM element in `index.html`, positioned above her silhouette each
  frame and never able to take a click. The CHAT BOX in the same file is interactive, so `overChat()` is folded
  into the hit region - without that the window stays click-through over the panel and you cannot type into it.
  Open it by double-clicking her, pressing C, or the tray's Chat item. `brain.chat()` is a separate call from
  `brain.think()`: no activity to pick, a 700-token budget, its own 30 s timeout, and the last 8 turns for
  context. Both key handlers ignore events whose target is an input, or typing drives her animations.
- `perform.js` - what is said in the chat box drives the animation. `readPerformance(asked, said)` reads your
  instruction first and her bracketed stage directions second, and returns `{action, emotion, target}`; pet.js
  maps that onto her states, her mood, or a walk to a fraction of the stage width (or to your cursor). Only the
  bracketed parts of her reply are read, so speech cannot trigger movement by accident. `node perform.test.mjs`.
  The persona tells her the body follows the brackets, which is what makes the model write them reliably.
- `brain.js` - the optional language-model brain, required by `main.js` and run ONLY in the main process so the
  key at `~/.ds/deepseek.key` never reaches the renderer. It returns a suggestion or null; `pet.js` fires it in
  the background and never awaits it on the frame path. Rate limited to one call per 45 s and 60 per hour; a 401
  or 402 disables it for the session rather than retrying. `node brain.test.cjs` for 23 offline tests,
  `--live` for one real call.
- `persona.js` - her character card. It carries the Chinese RULES from the community preset the owner asked for,
  not the ALL_CAPS token line (which is only labels on those rules - see
  `docs/research/2026-08-29-persona-load-research.md`, which found zero hits for the tokens in DeepSeek's own API
  or harness source). All ten tokens are kept verbatim in the owner's order as the marker line, with each one's
  Chinese rule from the source preset underneath, including its author's own safety sentence on obedience.
  `TIMEOUT_SIGNAL` is additionally implemented as a tray switch in our code, never as a string the model has to
  notice: it selects the plain persona and silences her.
- `facekit.js` - expression atlases as swappable pieces (`spikes/model/face`); `atlasJson` picks the manifest,
  the runtime uses `atlas_matted.json`.
- `preview_front.py` - offline render of the front rig + face kit (no Electron), for checking the face:
  `python spikes/side_rig/preview_front.py --mood happy --zoom 5`.
- `main.js` - Electron harness (lab / tour / capture / pet / selftest); `tray.png` - tray icon.
- `assets/` side layers (17), `assets_front/` front layers (17 + left/right splits), `assets_q34/` 3/4 stand-in.
- `rig.json` side rig, `rig_front.json` front rig (carries `assets` and `canonical_to_canvas`).
- `tools/see_through/psd_layers.py` exports a See-through PSD into an assets folder (`--map-json` records the
  canonical-to-canvas map for a tight-crop input so the face kit lands on the layers).

Plain-language guide to every file, for reading the code cold: `docs/PET_GUIDE.md`.

Her behaviour is tuned against the trace, not by eye: `node mind_trace.mjs` then compare the per-situation time
split. Two tuning traps already caught, both of which made her pace or chatter endlessly: an activity must fill
its need FASTER than the need drains, or she chases it forever; and an activity that only pays off when you are
present must be scored down when you are not.

Dragging her is the fragile path and it broke once already. The window is click-through except over her, so a
gesture spans three systems: the OS hit region, the renderer's pointer handlers, and the rig's hold state. Rules
learned the hard way:
- A press is NOT a hold. `lab.hold()` only fires once the pointer has moved 5 px, so anything that asks "is she
  held?" on the frame after mousedown will be wrong. The lost-mouseup watchdog did exactly that and cancelled
  every drag, every click and every double-click; the self-test could not see it because it presses and moves in
  one JS turn, before a frame runs. Any regression test for this MUST let a real frame pass between them.
- The gesture owns the hit state: `setOver` forces true while `P.drag` is set, and `endDrag` never forces false.
  Slamming the window back to click-through mid-press leaks the whole drag onto the app behind her.
- Pointer capture on pointerdown is what guarantees the release arrives. Do not use `e.buttons` as a guard: an
  Electron-forwarded mousemove reports 0 even with the button physically down.
- A generous box (`GRAB_PAD`) around her counts as interactive, because the hover-to-interactive round trip
  measures 15-64 ms and a fast swipe-and-grab lands inside it.

Animation, if you are editing an action in `rig.js`:
- Give the joints different phases. One shared sine across hips, chest and head is what made the first dance
  look like a machine; half a beat of lag down the chain fixes most of it.
- No corners in any curve. `Math.abs(Math.sin(x))` has a cusp at every zero and you can see it. Use
  `0.5 - 0.5 * Math.cos(x)` for a bounce and `ease()` for anything that starts or stops.
- Write holds in deliberately. A four-beat move that moves for four beats reads as worse than one that moves for
  one and holds for three.
- Scale the attack of an accent to how far the joint travels. Hips over 0.14 of a beat is a snap; an arm over
  the same 0.14 of a beat crosses 28 px between two frames and strobes.
- In the FRONT view a thigh rotation kicks the leg out sideways, it does not bend the knee. A bend is a
  shortening (`userData.sy`), which is the trick `A.hop` already uses.
- Judge it with numbers, not stills. `--out` probes in the scratchpad step the rig at 60 fps and dump every
  joint angle and screen position; peak px-per-frame and its frame-to-frame change tell you what a contact sheet
  cannot. A whole-body jolt above about 0.3 is visible.
- Her sleeves, her dress and her hair are all the same navy. An arm held low against her body is invisible, so
  choreography has to keep her hands out where they read against the background.

## Conventions

- Stage: world units, `STAGE.k` px per unit, x from the window's left edge, y up from the floor.
  `--height` sets her standing height in px (pet), otherwise the lab window is 2.85 units tall.
- `S_.facing = +1` means she faces screen-right. The side art faces -x natively, so the side group's
  mirror is `-facing`; the front view never mirrors. Poses are written in the group's local frame via `M()`.
- Front-view arm raises stay on an outward diagonal (about 2 rad); near-vertical raises hide behind the
  face/hair layers. A raised arm is drawn above the hair (renderOrder 40).
- `capturePage` returns physical px (this 4K screen at 150 % gives 1.5x the window px); hit boxes are window px.
- Action -> view: locomotion/sleep/held/fall = side; idle/talk/wave/look/sit/stretch/celebrate = front.
- The shipped face atlases were cut with a generous round matte: an open-eye cell was ~61 % pale skin and a
  closed-eye cell ~88 %, lifted from a differently shaded copy of her face, so each eye pasted a disc of wrong
  skin over the decomposed head. `tools/face/rematte_atlases.py` rebuilds every cell's alpha from the ink it
  contains (plus what the ink encloses, plus a short feather) and writes `spikes/model/face/matted/` +
  `atlas_matted.json`; the mouth and brow cells were already tight and come through unchanged. The matte is
  colour-aware, not distance-based: it grows out from the ink through everything that is not skin. A distance
  feather cannot tell a wide-eyed cell (whose disc reaches onto the cheek) from a narrow one, which is how the
  `surprised` state - and `shocked`, which reuses it - kept its disc through the first version of the tool.
  Evidence: `evidence/face_matte_before_after.png` and `evidence/face_matte_states.png` (every state, so the next
  gap cannot hide behind a three-state sample).
- **Poses are body-relative.** They are authored inside a group that is already mirrored by `M()`, so a pose angle
  must NOT be multiplied by `M()` as well or it inverts when she turns around; use the fixed sign `BODY`. Only
  quantities written to world space carry `M()`: the sleep slide (`rootX`) and the drag pendulum. Getting this wrong
  is invisible in captures, because `lab.begin()` always resets facing to +1 - the nap rotated the wrong way and put
  her 166 px below the window at the other facing for a long time before anyone saw it.
- Hit testing is per-pixel: `lab.pick(x, y)` renders a 15x15 window around the cursor into an offscreen target and
  reads the alpha, so it follows her real silhouette (a single box was only 46 % her, and bone-shaped zones only
  66 %). `lab.zone(x, y)` names the nearest part so her reaction can depend on where you touched her.
- Effect decals (blush, tears, sweat drop, hearts, sparkles) draw ABOVE the hair - they are floating symbols, not
  skin paint. `facekit.js` takes `fxRenderOrder` separately from `renderOrder`; with them under the hair the sweat
  drop was 100 % hidden, which made `panic` and `shocked` render pixel-identical to each other.
- The atlas's `neutral_verbatim` brow cell is erased-hair strands, not a brow; the default brow is `neutral`. The
  brow cells were also anchored ~95 face px too low, re-anchored onto her drawn brows in `atlas_matted.json`.
- Visemes step at 5.5 Hz against the kit's 0.12 s crossfade; faster and the mouth is permanently half-faded.
- The side view's `headwear` layer from See-through was an inpainted skull blob that painted over her forehead and
  eye; it is re-cut from the source art (the original is kept at `assets/orig/headwear.png`) and now draws above
  her hair, where a headdress belongs.
- Closed eyes are placed, not just swapped. The shipped `closed` and `happy` cells are drawn ~120 cell px higher
  in their frame than every other state, so they landed above her eye with bare skin below. `rematte_atlases.py`
  seats any short cell at `LID_REST` (0.65) down the open eye's ink and records the shift in `atlas_matted.json`
  under `regions[...].state_offsets_px`; `facekit.js` moves the quad when it applies the UV, and
  `preview_front.py` does the same so the offline check stays honest. The side view has no cells: it fades the
  white and iris out with `closed` and drops the lash by `0.42 * EYE_H` instead of squashing everything to 6 %.
  `lab.eyes(0..1)` holds the lids for testing.
- The sheet builders read `report.json` as UTF-8: her log is Chinese, and the Windows default codepage cannot.
- Being carried runs in the FRONT view (`VIEW_FOR.startle/dangle/fall/land`), because the face kit is only
  mounted there - in the side view the whole pick-up sequence had no expression at all. Lift is measured against
  reachable height, not a constant, or every lift reads as maximum and the tail skips its hang.
- Effect decals split by kind: blush and the face shadows are paint on her skin and draw UNDER her hair
  (`skinFxRenderOrder`); tears, sweat, hearts and marks are floating symbols and draw above everything.
- The kit draws no nose, so her `nose` layer stays visible under it. The kit's eye cells are verbatim pixels
  from the canonical (an 'open' cell composited over its own source window differs by 0.0), and the kit-to-canvas
  map is confirmed by cross-correlating the kit face against the decomposed head (scale 0.1585 fitted vs 0.1589
  analytic) - so if the eyes ever look wrong, suspect the matte or the draw order, not the alignment.
