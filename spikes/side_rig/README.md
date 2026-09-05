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
- `pet.js` - pointer interaction + autopilot (`window.pet`); `preload.js` - bridge for click-through toggling.
- `facekit.js` - expression atlases as swappable pieces (`spikes/model/face`); `atlasJson` picks the manifest,
  the runtime uses `atlas_matted.json`.
- `preview_front.py` - offline render of the front rig + face kit (no Electron), for checking the face:
  `python spikes/side_rig/preview_front.py --mood happy --zoom 5`.
- `main.js` - Electron harness (lab / tour / capture / pet / selftest); `tray.png` - tray icon.
- `assets/` side layers (17), `assets_front/` front layers (17 + left/right splits), `assets_q34/` 3/4 stand-in.
- `rig.json` side rig, `rig_front.json` front rig (carries `assets` and `canonical_to_canvas`).
- `tools/see_through/psd_layers.py` exports a See-through PSD into an assets folder (`--map-json` records the
  canonical-to-canvas map for a tight-crop input so the face kit lands on the layers).

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
  `atlas_matted.json`; the mouth and brow cells were already tight and come through unchanged. Evidence:
  `evidence/face_matte_before_after.png`.
- The kit draws no nose, so her `nose` layer stays visible under it. The kit's eye cells are verbatim pixels
  from the canonical (an 'open' cell composited over its own source window differs by 0.0), and the kit-to-canvas
  map is confirmed by cross-correlating the kit face against the decomposed head (scale 0.1585 fitted vs 0.1589
  analytic) - so if the eyes ever look wrong, suspect the matte or the draw order, not the alignment.
