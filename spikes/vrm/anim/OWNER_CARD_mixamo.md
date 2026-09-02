# Owner card — Mixamo clips for Whale-chan

Mixamo (https://www.mixamo.com) is Adobe's free library of ~2,500 humanoid mocap clips.
It needs an Adobe ID (free) and a browser; nothing can be scripted, so this is your step.
Budget: about 25 minutes for the whole list below.

## Licence in plain words (Adobe Mixamo FAQ, helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)

- Free for personal, commercial and non-profit projects, no royalties, no attribution required.
- Allowed: use the animations inside a finished product (our desktop pet, videos, images).
- Not allowed: redistributing the raw animation files as a pack, template or asset-store
  item. So the FBX files stay private build inputs; the pet ships them only inside its own
  bundle/asset format. Keep `anim/mixamo/` out of any public repo.
- Adobe keeps the rights to the library; you keep the rights to what you make with it.

## One-time setup

1. Sign in at https://www.mixamo.com with an Adobe ID.
2. Character: keep the default Mixamo character (X Bot / Y Bot). Do **not** upload our own
   model — the retargeter maps by Mixamo bone names, which every default character has.

## Export settings (use these for every clip)

Click **Download** on the clip and set:

| field | value |
|---|---|
| Format | **FBX Binary (.fbx)** |
| Skin | **Without Skin** (animation only; the file is ~1/10 the size) |
| Frames per Second | **30** |
| Keyframe Reduction | **none** |

Leave "In Place" **unchecked** unless the row below says otherwise (we want root motion on
the hips; the runtime decides whether to use it).

Save the file as `D:\ds\spikes\vrm\anim\mixamo\<name>.fbx` using the `<name>` in the table.
Names are lower-case with underscores; the runtime looks them up by that name.

## Clips to fetch (one search string per line)

Type the search string in Mixamo's search box, pick the result whose preview matches the
description (Mixamo's titles vary slightly — "Waving" vs "Wave", "Sleeping Idle" vs
"Sleeping"), preview, then download with the settings above.

| save as `mixamo/<name>.fbx` | search string | what to look for in the preview | action(s) it serves |
|---|---|---|---|
| `idle_breathing.fbx` | `Breathing Idle` | calm standing idle, subtle weight shift | idle (alt to Quaternius `Idle_Loop`) |
| `idle_happy.fbx` | `Happy Idle` | cheerful bouncy idle | idle (happy mood) |
| `wave.fbx` | `Waving` | one-arm friendly wave, standing | wave |
| `greeting.fbx` | `Standing Greeting` | small bow / hand raise | wave (alt), celebrate (soft) |
| `stretch_arms.fbx` | `Stretching` | arms-up full-body stretch | stretch |
| `yawn.fbx` | `Yawn` | yawn with arm stretch | stretch / wake |
| `sleep_lie.fbx` | `Sleeping Idle` | lying on back/side, slow breathing loop | sleep |
| `lie_down.fbx` | `Lying Down` (or `Stand To Lie`) | transition from stand/sit to lying | sleep (enter) |
| `get_up.fbx` | `Getting Up` | from lying/floor to standing | wake, recover |
| `stand_to_sit.fbx` | `Stand To Sit` | sits down onto a chair/edge | sit (enter) |
| `sit_idle.fbx` | `Sitting Idle` | seated, relaxed | sit |
| `sit_to_stand.fbx` | `Sit To Stand` | stands up from seated | sit (exit) |
| `eat.fbx` | `Eating` | hand-to-mouth eating loop | eat |
| `drink.fbx` | `Drinking` | lifts cup/bottle to mouth | drink |
| `look_around.fbx` | `Looking Around` | head/torso scans left and right | inspect, gaze wander |
| `stumble_back.fbx` | `Stumble Backwards` | loses balance backwards, no fall | stumble |
| `fall_back.fbx` | `Falling Back` (or `Falling Back Death`) | falls onto back | stumble (hard) → sleep pose |
| `jump_small.fbx` | `Jump` | short vertical hop in place (tick **In Place**) | hop |
| `celebrate_victory.fbx` | `Victory` | fist pump / arms up | celebrate |
| `cheer.fbx` | `Cheering` | two-arm cheer | celebrate (alt) |
| `dance_silly.fbx` | `Silly Dancing` | goofy loop; chibi-friendly | celebrate (long), dance |
| `climb_ladder.fbx` | `Climbing Ladder` | vertical climb loop, hands+feet | climb (base for IK pinning) |
| `climb_wall.fbx` | `Climbing Up Wall` | pull-up over an edge | climb (top-out) |
| `pick_up.fbx` | `Picking Up Object` | bends and grabs from floor/table | reach, inspect |
| `walk_front.fbx` | `Walking` | neutral forward walk (leave In Place unchecked) | walk (alt to Quaternius `Walk_Loop`) |

Optional extras if you have time: `Excited`, `Clapping`, `Thankful`, `Shrugging`, `Head Nod Yes`,
`Shaking Head No`, `Laughing`, `Crying`, `Angry`, `Defeated`. Same settings, name them freely.

## After downloading

```
cd D:\ds\spikes\vrm\anim
node retarget/smoke.mjs              # prints track counts for every mixamo/*.fbx
cd D:\ds\apps\desktop
npx electron ../../spikes/vrm/anim/preview/main.cjs --capture   # screenshots into anim/preview/shots/mixamo_*.png
```

If a file prints `no "mixamorigHips" node`, it was exported from a non-Mixamo character —
re-export using the default X Bot / Y Bot.
