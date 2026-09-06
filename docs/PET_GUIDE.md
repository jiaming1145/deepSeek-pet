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
| `spikes/side_rig/perform.js` | Turns words into movement: reads what you asked for and the bracketed stage directions in her reply, and produces an action, a mood and somewhere to walk to. Pure text in, a small plan out. |
| `spikes/side_rig/perform.test.mjs` | Twenty-four tests of that, including that words she merely *says* cannot move her. |
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

**She does what you ask.** Tell her to dance, to go and stand on the left, to sit down or go to sleep, and she
actually does it. There are two mechanisms, and the first is the reliable one:

1. **She states the action herself.** Her reply begins with a single machine-only line, `【动作】{"do":…}`, that
   is stripped before anything reaches the screen. Because the model writes it deliberately rather than being
   guessed at from prose, it handles things a keyword list cannot: "别睡了" comes back as `wake`, not `sleep`.
2. **The keyword reader**, `perform.js`, is the fallback when there is no language model or the line is missing.
   It reads your message and the bracketed stage directions in her reply. It understands negation ("别睡了",
   "don't sleep") and an explicit stop ("停下", "别动"), and a place and an action can now be asked for together
   ("去左边跳舞" walks her left AND makes her dance).

Once told, she stays told: her own mind is held off for the duration of the order, which is most of why she used
to look like she was ignoring you. Examples:

| You say | She does |
|---|---|
| 给人家跳个舞吧 | dances, and says （笨拙地转了个圈，尾巴不小心打翻了水杯） |
| 去左边站着 | walks to the left of your screen |
| 过来 | walks to wherever your cursor is |
| 坐下休息一下 | sits down |
| 挥个手 / 去睡觉 | waves / lies down and sleeps |

Only the bracketed parts of her reply are read, so her *saying* "主人要不要去睡觉呀" cannot put her to sleep by
accident. Her stage directions also set her expression: （脸微微泛红）makes her shy, （骄傲地抬起下巴）makes her
smug, （打了个哈欠）makes her sleepy. Screenshot: `evidence/chat_makes_her_dance.png`.

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

**Picking her up.** Grabbing her plays a startle: a hard extreme held for a beat, both arms up, mouth open, and
no blink, because you do not blink when something grabs you. Then she hangs. Her tail droops as she leaves the
floor and curls back up toward her when she is held high, her arms and legs dangle and trail, and she swings on a
real pendulum, so she overshoots and rings down instead of tracking your hand rigidly. Her hair and tail springs
soften while she is off the ground so they read as heavy.

How you handle her decides how she feels. Height, how hard you are shaking her, how far she is swinging and
where you grabbed her all feed one distress number: hold her gently round the middle and she is fond of it, hold
her high and she is uneasy, shake her and she panics. Grabbing her by the tail is worse than grabbing her by the
body. Screenshot: `evidence/carry_sequence.png`.

**Closed eyes.** Worth knowing because it bit us. Her shut eyes are drawn cells, and in the shipped artwork the
`closed` and `happy` cells sit near the top of their frame while every other state fills it. Dropped onto her
face that put the lash line above her eye with a gap of bare skin under it, which reads as a missing eye rather
than a closed one. The re-matte tool now measures each short cell and records the shift that seats it about two
thirds of the way down the eye, where a lid actually rests, and the face kit applies that when it swaps the cell
in. The side view has no drawn cells, so it used to close by squashing the eye to a sliver; it now fades the
white and the iris out and walks the lash line down instead. Before and after: `evidence/closed_eye_fix.png`
and `evidence/closed_eye_side.png`.

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

## Her dance, and why it is built the way it is

Worth its own section, because it is the clearest example in the whole project of the difference between
*moving* and *looking alive*, and because the first version of it was bad in an instructive way.

**The first version was one repeating wobble.** Every joint was driven off the same sine wave at the same
instant: her hips, her chest and her head all leaned left at the same moment and all came back at the same
moment, her arms sat permanently overhead twitching, and she bobbed up and down about three times a second. Two
things made it look wrong. Everything moved together, which nothing alive does. And nothing ever stopped. It
read, accurately, as a machine hopping on the spot.

**What it is now is a routine.** Six moves, played in order, taking about thirteen seconds:

| # | Move | What she does |
|---|------|----------------|
| 1 | Step-touch | Weight onto one foot, tap the other in beside it, reverse. The plainest social dance step there is, and it sets the pulse. |
| 2 | Body roll | A ripple that starts at her hips and reaches her head late. |
| 3 | Scoop | One arm carves a big arc up over her head while she leans away from it, then rings out. |
| 4 | Bounce | Hands up, three bounces, then a held fourth beat. The one burst of pure energy. |
| 5 | Hip pop | Two sharp accents with real stillness between them. |
| 6 | Pose | She strikes a pose on the first beat and holds it for three. |

Four ideas do most of the work, and they are worth knowing because they apply to every other animation here:

- **Things arrive late.** Her hips lead, her chest is about half a beat behind them, her head is behind that. A
  body is a chain, so movement takes time to travel up it. Driving everything off the same instant is the single
  most reliable way to make a character look like a puppet.
- **Stillness is part of the dance.** Beats 11, 17, 19, 21 and 22 are holds, where almost nothing moves. A dance
  with no pauses in it is a washing machine. The holds are what make the bursts read as bursts.
- **Not every joint accents at the same speed.** Her hips can snap across in a twentieth of a second because
  they barely travel. Her arm covering sixty degrees in that same time is not an accent, it is a teleport. So
  the sharpness of a hit is a setting, and the big limbs get a slower one. That is only the ordinary physical
  fact that heavy things take longer to get going.
- **Nothing is allowed to turn a corner.** Anywhere a curve has a sharp point in it, you see a jolt. The old
  bounce used the absolute value of a sine wave, which comes to a point at the bottom of every step, and that
  point was visible. Everything now eases in and out.

**How it was checked.** Guessing at fluidity from a still image does not work, so the routine is measured
instead. A probe steps her through all thirteen seconds sixty times a second and records every joint angle and
every joint's position on screen. Two numbers matter: how far a joint moves between two frames (more than about
a tenth of a radian and it strobes rather than reading as speed), and how much that changes from frame to frame
(a spike there is a jolt). Fixing the accents dropped the worst whole-body jolt from 0.95 to 0.15, and every
joint is now under the strobe threshold. Watch it: `spikes/side_rig/evidence/dance_routine.gif`. Frame by frame:
`evidence/dance_routine_sheet.png`.

**She dances it bigger when she is happier.** One number scales the whole routine according to her mood, so
cheerful is about a sixth larger than neutral and sleepy is about a third smaller. Same choreography, different
conviction.

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
- She dances one fixed routine. It is long enough that you rarely see it repeat, but it always starts at the
  same move, and it is not aware of any music that might actually be playing.
- Landing after a throw is not reproducible: run the screenshot helper twice and her hair sometimes flies out
  into a spiky halo and sometimes does not. That is her hair springs going unstable, it depends on frame timing
  rather than on anything in the animation, and it is not fixed.
- Her face has a blink with a proper middle rung, double and sleepy blinks, and a jolt through her head and hair
  when a feeling arrives, but there are still no idle eye movements between blinks.
- The words that move her are a fixed keyword list. She understands 跳舞 and 去左边, not an arbitrary instruction.
- The language model only picks from the eight things she already knows how to do. It cannot invent a new
  behaviour, and it has no memory of its own between calls beyond the summary she sends it.
- She does not know what is on your screen, only whether you have touched your keyboard recently.
- Three of the drawn eye shapes are weak: the dizzy spiral reads as a dark blob, and the half-closed lid reads as a
  hard bar. They come from the expression artwork, not from the code, so fixing them means redrawing those cells.
