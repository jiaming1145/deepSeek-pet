# Tail rig spike

A throwaway probe answering one question before we commit to replacing the Live2D Cubism
runtime with a skeletal one: **can we drive bone transforms procedurally, every frame, over
the real extracted parts, inside the real pet window, cheaply enough?**

Answer: yes. 60 fps, 0.19–0.27 ms/frame of CPU for the solver, the skinning and the buffer
upload combined.

This is a spike, not a component. It is kept because it is the only thing in the repo that
puts the actual character on screen, and because re-running it is the cheapest way to catch
the class of art defect described in `docs/spikes/2026-08-31-tail-rig-spike.md`.

## What it does

- Six-bone chain down the whale tail, joints measured off `canonical_v005.png`.
- CPU linear-blend skinning: `tail_root` and `tail_stock` share one continuous weight
  function so the root/stock boundary deforms as a single surface; the two flukes ride
  rigidly on the tip bone.
- The solver is a **verbatim port of `stepTailFixed()`** from
  `packages/stage/src/interaction-rig.ts` — the spike tests our real code, not a toy.
- Renders in a transparent, frameless, always-on-top Electron window: the same configuration
  as the production pet window.

## Run it

```powershell
cd D:\ds\apps\desktop
node ..\..\spikes\tail\build_assets.py   # first time only - see below
npx electron ..\..\spikes\tail\main.js
```

`build_assets.py` is Python, not node — run it with `python`. It reads the approved parts out
of `runs/deepseek_humanized_20260830_001/` and writes `parts/` (git-ignored: the assets are
derived, and large). The Electron harness runs a scripted capture sequence into `shots/`
(also git-ignored) and prints a timing report.

Interactive controls, once the window is up:

| key / input | effect |
|---|---|
| drag the mouse | pull the tail; release to whip |
| `R` | toggle mesh deformation (skinned vs rigid) |
| `P` | toggle the root weight ramp |
| `M` | flip tail mood |
| `[` `]` | zoom out / in |

## Evidence

`evidence/sheet_final.png` — idle, pulled, and mid-whip at the shipped tuning.
`evidence/sheet_tuned.png` — the root seam before and after the weight ramp.
`evidence/report.json` — frame timings and bone angles from the scripted run.
