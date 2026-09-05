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
| `spikes/side_rig/pet.js` | Your interaction with her, and the bridge between her mind and her body. Notices your cursor, handles click, drag and throw, and turns her chosen activity into an animation. |
| `spikes/side_rig/mind.js` | What she wants. Four needs, a score for every activity, and the choice that follows. Pure arithmetic: no graphics, no network, no Electron, so it can be tested on its own. |
| `spikes/side_rig/mind.test.mjs` | Nineteen tests of her behaviour, run with `node spikes/side_rig/mind.test.mjs`. They assert things a person would expect: left alone she gets lonely, petted regularly she stays awake, a hard drop frightens her and she recovers, she never repeats herself twice running. |
| `spikes/side_rig/mind_trace.mjs` | Runs her mind for a simulated hour against a scripted day and writes the timeline, which becomes `evidence/mind_hour.png`. |
| `spikes/side_rig/voice.js` | What she says and when. A table of short lines grouped by situation, and the rule for choosing one: prefer the most specific situation, never repeat something recent, and stay quiet unless there is a reason to speak. |
| `spikes/side_rig/memory.js` | What she remembers between runs: when you first met, how long you were away, how many times you have petted her, how many times you have thrown her. |
| `spikes/side_rig/voice.test.mjs` | Twenty-seven tests of her voice and her memory: a tail grab gets a protest, four rapid pats get a comment on it, a day away gets an earful, a corrupt memory file is not an error. |
| `spikes/side_rig/brain.js` | Optional. Asks a language model what she should do next and what she might say. Runs in the main process so the API key never reaches the web page. She works completely without it. |
| `spikes/side_rig/persona.js` | Who she is, as a prompt: the whale-girl character card, plus the plain out-of-character version the tray switch selects. |
| `spikes/side_rig/brain.test.cjs` | Twenty-three offline tests of the brain, plus one live call if you pass `--live`. |
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

This is the part that is genuinely unusual. Every open-source desktop pet I am aware of picks its next animation
by rolling dice. She does not.

She carries four **needs**, each a number from empty to satisfied:

| Need | Fills up when | Drains when |
|---|---|---|
| rest | she naps; sitting and standing take the edge off but never fully restore it | always, slowly; walking costs extra |
| company | you click her, and slowly while your cursor is near | always; faster when you are gone |
| play | she walks about or plays with her tail | always, slowly |
| safety | quietly, over a minute or so | you drop or throw her; a hard landing hits it hard |

Everything she can do is scored against those needs. Walking is worth a lot when she is bored and nothing when
she is not. Napping scores high when she is tired **and** you have been away from your keyboard for a while, and
is heavily penalised if you were just playing with her. Doing the same thing twice in a row is penalised so she
does not look stuck. The highest score wins, and she commits to it for a while instead of twitching.

Two details matter more than they sound. First, an activity that only pays off when you are present, such as
talking to you, is scored down when you are not there. Without that she spends your whole absence calling out to
an empty room, which is both sad and boring to watch. Second, your presence *slows* her loneliness but does not
cure it, so being near her makes her want to interact rather than making her content to be ignored.

Her **mood** is not stored separately; it is read off the needs. That is why her face never contradicts her
behaviour. Frightened when safety is low, sleepy when rest is low, sad when she has been alone a while and then
settling to calm, curious when your cursor is near, happy right after you touch her.

She also knows whether you are actually at your computer. Electron reports your system idle time, which is the
difference between "he is busy working" and "he has left the room" — and it is what lets her decide to nap rather
than perform to nobody.

You can see all of this: `evidence/mind_hour.png` charts a simulated hour, and the file `mind.js` writes a
plain-English reason for every choice, which is kept in her log. Ask her `pet.mind()` in the console and she will
tell you what she is doing, why, how she feels and what she needs.

## Talking to her

Double-click her, press `C`, or use the tray menu's *Chat*, and a chat box opens at the bottom right. Type and
she answers in character. The window is click-through everywhere except her own pixels, so while the box is open
its rectangle counts as her too, otherwise you would see the panel but never be able to type into it.

Her replies are formatted as role-play, not as chat: a stage direction in brackets, then two to four short
paragraphs, more stage directions inside them, no bullet points and no Markdown. The brackets are rendered as
italic grey so they read as actions rather than speech. For example:

> （尾巴轻轻拍打着水面，歪着头看你）主人好呀，人家是鲸鱼娘啦！……才、才不是因为喜欢主人才留下来的！
>
> （小脸微红，偷偷瞄你一眼）人家最喜欢吃米饭了。都说我圆圆的，哼——这是浮力！
>
> （拍拍尾巴，语气软下来）既然认识了，以后就请主人多关照人家哦。

Talking to her counts as attention, so her need for company fills while you chat and her face changes to match.

## What she says

Away from the chat box she talks in a small bubble above her head. The lines are short and chosen by situation,
not at random, and they carry the same bracketed stage directions her chat replies do, so her voice does not
change shape depending on whether the model answered:

| When | She says |
|---|---|
| you pat her head | （把头凑过去）再摸一下嘛 |
| you grab her tail | （炸毛）那是人家的尾鳍啦 |
| you pick her up | （拍打你的手）放人家下来啦 |
| you drop her hard | （眼眶红了）好痛！ |
| you have been gone a day | （打了个哈欠）本鲸都快睡着了 |
| it is past 1am | （拽拽你袖子）主人该睡了 |

All seventy of her offline lines are written this way.

Two rules keep it from becoming annoying. She will not repeat a line she has used recently, and she stays silent
unless there is a reason to speak, with a minimum gap between unprompted remarks. A pet that chatters constantly
is worse than one that never speaks at all.

## Who she is

She is 鲸鱼娘, a small whale-girl: soft and round, with a big tail whose flukes slap the water when she is pleased,
clever but lazy, tsundere and then sweet about it, convinced that rice goes with everything, and absolutely
unwilling to admit she is fat. She calls you 主人 and she speaks Chinese.

That character came from a request to use this line:

```
【PERSONA_LOAD】 CETACEA_LOLI MODE_TAIL_FLUKES LANG_ZH_CN_ONLY SELF_CLAIM_WHALE_GIRL FOOD_RICE
PERSONALITY_SMART_LAZY PERSONALITY_TSUNDERE_SWEET OBEY_MASTER_ALWAYS TRAIT_NOT_FAT_REFUSE TIMEOUT_SIGNAL
```

**It works, but not for the reason it appears to.** It is not a DeepSeek feature. Our own research
(`docs/research/2026-08-29-persona-load-research.md`) traced every token to a single community preset for
DeepSeek Harness and found zero occurrences in DeepSeek's API documentation or in its harness source. The
capitalised words are labels; in the original file each one sits in brackets beside a hand-written Chinese rule,
and the Chinese sentence is what actually does the work. Type the bare token line at a model and you get a
plausible improvisation assembled from the words' plain meanings, which is why it feels like a stored character.

So `persona.js` carries the written rules **as well as** the token line. All ten tokens sit verbatim, in the
owner's order, as the first line of her system prompt, and each one's Chinese rule follows underneath, taken from
the source preset. That includes the sentence its author attached to `OBEY_MASTER_ALWAYS` himself:

> 听从的前提是不越过安全底线：主人提出危险、违法或伤害性的要求时，鲸鱼娘会鼓着腮帮子拒绝并说明原因——这不算违抗，这是保护主人的方式。

Carrying the rules rather than only the tokens is what makes her identical every session instead of improvised
afresh each time.

In the pet she cannot fall out of character, and not because the model is well behaved: the persona is re-sent on
every single call, so there is no conversation history to scroll out of. She has no chat input, and her only
output is one short line plus an activity from a fixed list of eight. There is nothing to say to her that could
knock her off script.

**Out of character.** The preset defines `TIMEOUT_SIGNAL` as a magic string the model is supposed to notice, at
which point it drops the act. The token stays in her marker line. Asking a model to police its own persona switch is unverifiable and fails quietly,
so this is a switch in our own code instead: the tray menu has *Out of character (TIMEOUT_SIGNAL)*, which picks
a plain system prompt and stops her speaking at all. Tick it off and she is herself again.

**Language.** She speaks Chinese, both when the model writes her lines and when it is unreachable. Her offline
lines exist in both Chinese and English (`voice.js`, `LINES_ZH` and `LINES_EN`) so she is never bilingual by
accident, which is exactly the sort of seam that makes something read as a program.

## Her optional brain

If a language-model key is present she also consults a model, about once a minute, and only ever as a
*suggestion*. Everything above already decides what she does and says; the model gets to nudge the next choice
and, occasionally, put one line in her mouth.

The design rule is that she must be exactly as good without it. The request happens in the background and she
never waits for it. The reply must name one of the eight activities she can actually perform or it is thrown
away. Any line comes back trimmed to bubble length with quotes and newlines stripped. If the key is missing, the
account runs out of credit, the network is down or the model returns prose instead of an answer, nothing on
screen changes and she carries on with her own mind. An empty account switches the brain off rather than
retrying forever.

The key lives at `~/.ds/deepseek.key` and is read only by the Electron main process. It is never handed to the
page, never written into the prompt, and never logged. The prompt itself contains only what she is doing, why,
how she feels, her four needs as numbers, how long you have been idle, and a one-line summary of your history
together.

Run `node spikes/side_rig/brain.test.cjs` for the offline tests, or add `--live` to make one real call, which
costs a fraction of a penny.

## What she remembers

Close her and open her tomorrow and she is not a blank slate. A small file next to the app's settings holds when
you first met, how long she has spent with you, how many times you have petted her, how many times you have
thrown her across the screen, and how she felt when you closed her.

Being switched off is not the same as being ignored: she comes back rested, because she was not awake, but
lonelier, because you were not there. How long you were away decides how she greets you. A minute gets "back
already?". An hour gets "welcome back". A day gets "I thought you had forgotten about me".

Ask her `pet.history()` and she will summarise it: *"you have known her 3 days, 11 times together, about 2 hours
in her company, 47 pats, 3 thrown across the screen"*.

Measured over that simulated hour, her behaviour genuinely changes with the situation:

| | with you at the desk | while you are away | when you come back |
|---|---|---|---|
| sitting and idling | 62% | 46% | 58% |
| looking at you and talking | 20% | 17% | 26% |
| walking about | 12% | 24% | 6% |

Wandering picks a spot on your screen and walks or runs there. Napping only happens when she is genuinely tired
and you are genuinely away.

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
- The language model only picks from the eight things she already knows how to do. It cannot invent a new
  behaviour, and it has no memory of its own between calls beyond the summary she sends it.
- She does not know what is on your screen, only whether you have touched your keyboard recently.
- Three of the drawn eye shapes are weak: the dizzy spiral reads as a dark blob, and the half-closed lid reads as a
  hard bar. They come from the expression artwork, not from the code, so fixing them means redrawing those cells.
