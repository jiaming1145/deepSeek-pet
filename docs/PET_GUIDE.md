# Whale-chan, explained in plain language

This is a guide to the desktop pet's code, written to be read start to finish by someone who did not write it.
No jargon without an explanation. If you only read one section, read "The big idea".

Run her:

```
cd D:\ds\apps\desktop
npx electron ../../spikes/side_rig/main.js --pet
```

She appears on your desktop with no window frame. Hover and she looks at you, click and she reacts, drag and you
pick her up, let go and she falls. The tray icon (bottom-right of Windows) has Wave, Nap and Quit.

---

## The big idea

She is **not** a 3D model, and she is **not** a video. She is her own drawing, cut into pieces, with an invisible
skeleton behind the pieces. Move a bone and the pieces attached to it move too. That is the whole trick.

Three things had to happen to get there.

**1. Cut the drawing into pieces.** One picture of her went into a tool called See-through, which is an AI model
that looks at a drawing of a character and separates it into layers: hair, face, dress, tail, each arm, each leg,
and so on. Crucially it also *paints in* the parts that were hidden. Her far arm was behind her body in the
drawing, but the tool invents the rest of that arm so it can move independently. We did this twice: once on a
side-on picture and once on a front-on picture. The pieces live in `spikes/side_rig/assets/` (side) and
`spikes/side_rig/assets_front/` (front).

**2. Work out where her joints are.** A script reads those pieces and figures out the skeleton: where the knee is
in the leg piece, where the elbow is in the arm piece, how the tail curves. It writes that out as a list of bones.
Nobody positioned these by hand.

**3. Move the bones and let the pieces follow.** At runtime each piece is glued to a bone. Stiff pieces like a shoe
are glued to one bone. Bendy pieces like the tail or her hair are stretched across a chain of bones, so they bend
smoothly instead of snapping at a joint. Then code rotates the bones over time to make her walk, sit, sleep, wave.

Two extras make her feel alive rather than mechanical:

- **Springs.** Her hair, tail and skirt are not posed directly. They lag behind her body and swing back, the way
  real hair does when you stop walking. That single detail does most of the work of "feels alive".
- **Two views.** A side-on drawing cannot look at you and a front-on drawing cannot walk convincingly. So there are
  two complete rigs, and she switches between them with a quick squash so it reads as a turn, not a cut.

---

## The files, one by one

### Running her

| File | What it is |
|---|---|
| `spikes/side_rig/main.js` | The program that opens the window. Also has test modes: `--pet` is the real pet, `--tour` cycles through every action so you can watch, `--capture` takes screenshots of every action and quits, `--selftest` pretends to be a user clicking and dragging her, then quits. |
| `spikes/side_rig/index.html` | The page inside the window. Almost empty on purpose; it just loads the code and shows the text overlay. |
| `spikes/side_rig/preload.js` | A tiny safety bridge. The page is not allowed to touch the operating system directly, so this passes three messages: "the cursor is on her", "quit", and tray commands. |

### The character herself

| File | What it is |
|---|---|
| `spikes/side_rig/rig.js` | The heart of it. Loads the pieces, builds the skeleton, poses the bones for each action, runs the springs, handles gravity when you throw her, and draws everything 60 times a second. Everything else is a layer on top of this. |
| `spikes/side_rig/pet.js` | Her behaviour and your interaction. Decides on her own to wander, sit, stretch, chat or nap; notices your cursor; handles click, drag and throw. If `rig.js` is the body, this is the personality. |
| `spikes/side_rig/facekit.js` | Her face. Swaps her eyes, eyebrows and mouth for different drawn versions to make expressions, blinks on a timer, moves her mouth while talking, and fades smoothly between moods. |
| `spikes/side_rig/rig.json` | The side-on skeleton and the list of pieces. Generated, not hand-written. |
| `spikes/side_rig/rig_front.json` | The same for the front-on view. |
| `spikes/side_rig/assets/`, `assets_front/` | The cut-up pieces of her, as transparent PNG images, plus a small index file listing where each piece sits. |
| `spikes/model/face/` | The expression artwork: sheets containing 14 eye shapes, 14 mouth shapes, 7 eyebrow shapes and 15 effects (blush, tears, sweat drop, hearts, sparkles), plus a recipe list saying which combination makes "happy", "sleepy", "panic" and so on. |

### Building the pieces (you only run these when the artwork changes)

| File | What it is |
|---|---|
| `tools/see_through/run_space.py` | Sends a picture of her to the layer-separating AI and downloads the result. |
| `tools/see_through/psd_layers.py` | Unpacks that result into individual PNG pieces plus the index file. |
| `spikes/side_rig/build_rig.py` | Reads the pieces and works out the skeleton. `--view side` or `--view front`. Also writes a picture with the bones drawn on top so you can check it. |
| `tools/face/rematte_atlases.py` | Cleans up the expression artwork. Explained under "Two problems worth understanding" below. |

### Checking your work

| File | What it is |
|---|---|
| `spikes/side_rig/preview_front.py` | Draws her face exactly the way the real program would, but as a still image, without opening a window. The fast way to check a face change. |
| `spikes/side_rig/make_sheet.py`, `make_pet_sheet.py`, `make_face_sheet.py` | Turn screenshots into contact sheets so you can see every action or mood at once. |
| `tools/electron-errscan.js` | Opens the page, mashes every key and calls every function, and reports any error. |
| `spikes/side_rig/evidence/` | The resulting proof pictures. If a claim was made about how she looks, the picture is in here. |

---

## How she decides what to do

Left alone she runs a simple loop: pick something to do, do it for a few seconds, pick again. Wandering picks a
spot on your screen and walks or runs there. If nobody has touched her for a long while she may lie down for a nap.

Your cursor overrides all of it. Come near and she looks at you. Linger behind her and she turns around. Hover and
she brightens. Click and she reacts, and *what* she does depends on where you clicked: her head, her tail and her
body each get a different response. Drag her and she dangles and swings; let go and she falls, lands with a squash,
and if the drop was hard she stumbles.

The window covers your whole screen but is invisible and clicks pass straight through it, so it never gets in your
way. The moment your cursor touches her actual pixels, the window starts accepting clicks; the moment it leaves, it
goes back to passing them through.

---

## Two problems worth understanding

These two caused real, visible bugs, and knowing them will save you time.

**The eyes used to look pasted on.** The expression artwork was cut with a generous round mask, so each eye came
with a disc of skin around it, lifted from a slightly differently shaded copy of her face. Dropped onto her head
that showed up as a circle of wrong-coloured skin around each eye, with her blush washed out underneath.
`tools/face/rematte_atlases.py` fixes it by rebuilding each cut-out: it starts at the drawn lines and grows outward
through anything that is *not* skin, so it keeps the white of the eye and the soft lash edges but stops dead at the
skin. It has to judge by colour, not by distance: a wide-open eye's disc reaches further onto the cheek than a
narrow one's, and an earlier distance-based version of this tool missed exactly that case.

**Left and right are easy to get backwards.** She is drawn facing one way, and to face the other way the whole
drawing is flipped like a mirror. That means any pose written in code is already mirrored for free. Multiplying a
pose by the facing direction *as well* flips it twice, which cancels out — the pose stops depending on which way she
faces. That is why her nap once rotated the wrong way and sank her below the bottom of the screen whenever she
happened to be facing left. In `rig.js` a pose therefore uses the fixed value `BODY`, and only genuinely
left-or-right things, like sliding her sideways as she lies down, use the facing direction. **When you test a
change, test both facings** — the screenshot helper always resets her to face right, which is exactly how that bug
survived so long.

---

## If something looks wrong

- **Her face looks off.** Run `python spikes/side_rig/preview_front.py --mood happy --zoom 5` and look at the
  result. It renders in the same order as the real program, so what you see is what she does.
- **A piece is in front of something it should be behind.** Draw order is the `order` list in `rig.json` /
  `rig_front.json`: earlier in the list means further back.
- **She moves oddly only when facing one way.** That is the mirroring trap above.
- **Nothing renders at all.** Run the error scanner; it prints exactly what broke.
- **Note:** the Python tools need image libraries that the system Python does not have. Use
  `D:/tools/see-through/.venv/Scripts/python.exe` instead of plain `python` for anything under `tools/` or any
  script here whose name ends in `.py`.

---

## What is still missing

Honest list, so nothing reads as finished when it is not.

- She only walks along the bottom of the screen. No climbing the sides, no sitting on a window edge.
- There is no brain yet. She picks actions at random, not because she understood anything. Wiring a language model
  to choose her actions is the next large step, and the seam for it already exists: everything she can do is
  reachable by name through `window.lab` and `window.pet`.
- She cannot speak or hear.
- Three of the drawn eye shapes are weak: the dizzy spiral reads as a dark blob, and the half-closed lid reads as a
  hard bar. They come from the expression artwork, not from the code, so fixing them means redrawing those cells.
