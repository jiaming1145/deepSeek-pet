# Contributing

Thank you for wanting to make her better. This page tells you where things live, how to run and test
her, and what a good pull request looks like here.

## Set up

```
git clone https://github.com/jiaming1145/deepSeek-pet.git
cd deepSeek-pet
pnpm install
pnpm pet            # she appears on your desktop
```

Node 24 or newer and pnpm 10 (`npm i -g pnpm@10`). Windows 10/11 is where she is developed and verified.
`pnpm install` also points Git at the versioned `.githooks/`, whose pre-commit hook refuses any staged
line that looks like an API key.

Her optional DeepSeek brain reads `DEEPSEEK_API_KEY` from the environment, or a key saved to
`~/.ds/deepseek.key`. Everything she does works without it.

## Where things live

| Path | What it is |
|---|---|
| `spikes/side_rig/` | **The pet.** `main.js` opens the window; `rig.js` is her body (bones, springs, actions, physics); `pet.js` is how you touch her; `mind.js` is what she wants; `voice.js` and `persona.js` are what she says; `brain.js` is the optional language model; `facekit.js` is her face. |
| `spikes/side_rig/assets*/` | Her drawing, cut into layers (side view and front view). |
| `spikes/model/face/` | The expression atlases: eyes, mouths, brows, effects, and the recipes that combine them into moods. |
| `tools/media/` | Records and encodes the GIFs in the README from the real renderer. |
| `tools/see_through/`, `tools/face/`, `spikes/side_rig/build_rig.py` | The art pipeline: one drawing in, layers and a skeleton out. Only needed when the artwork changes. |
| `apps/desktop/`, `packages/` | An earlier prototype (Live2D avatar with a streamed DeepSeek chat). Kept, tested, not where the pet lives. |

Every file in the pet starts with a comment saying what it is for, and the comments inside `rig.js` and
`pet.js` carry the hard-won rules about dragging, mirrored poses and animation curves. Read the ones around
the code you are touching before changing it.

## Run the checks

```
pnpm pet:test                       # her mind, voice, memory, performance reader and brain: plain Node, seconds
pnpm test                           # the workspace packages (vitest)
pnpm typecheck                      # needs `pnpm fetch-sdk` once for the Live2D prototype
```

For anything that touches how she looks or moves, capture the real thing:

```
cd apps/desktop
npx electron ../../spikes/side_rig/main.js --tour                 # cycles every action, keep it open and watch
npx electron ../../spikes/side_rig/main.js --capture --rig rig.json --front rig_front.json   # every action at 20/50/80 %
npx electron ../../spikes/side_rig/main.js --pet --selftest       # hover, click, drag, throw, autopilot; exits 0 on success
```

Two rules that have each cost a day: test **both facings** (`lab.begin()` resets her to face right, so a
pose that is wrong facing left hides from every capture), and let a **real frame pass** between a synthetic
pointer-down and pointer-move (a hold only starts after 5 px of travel across frames).

## What a good pull request looks like

- One change, described in plain language. Commit messages here read like `fix(pet): dragging works again` or
  `feat(pet): she dances a routine instead of oscillating`. Say what she does differently, not which function moved.
- Evidence attached: a GIF or screenshot for visual changes, a test for behaviour changes.
- `pnpm pet:test` and `pnpm test` pass.
- Nothing from your machine leaks in: no key, no `C:\Users\...` path, no memory file.

## Where help is most welcome

- **macOS and Linux.** She is Electron and three.js, so she should run there; the click-through window, tray
  and idle detection have only been exercised on Windows.
- **English voice.** `voice.js` has an English line table; it is shorter than the Chinese one.
- **New actions.** `rig.js` actions are small functions of time; the comments explain phases, holds and easing.
- **New characters.** The pipeline turns one drawing into a rigged pet; a second character would prove it general.
- **Packaging.** A signed installer so people can try her without Node.

Open an issue before a large change so the direction is agreed first. Small fixes can go straight to a PR.
