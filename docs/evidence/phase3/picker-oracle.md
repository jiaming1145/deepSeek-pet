# Picker oracle (§6.5, R3-6e, B-08)

cwd: `D:\ds`  ·  2026-08-30T20:04:21.705Z

Run directory: `D:\ds\.claude\worktrees\wf_53266240-b22-5`.

HARDWARE: Windows 10.0.26200 (Windows 11 Home 10.0.26200), CPU 12th Gen Intel(R) Core(TM) i7-12700K, GPU/driver ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver), display 3840x2160 @ 150 % (devicePixelRatio 1.5)

Both hover candidates are measured over the **same** samples of the same 12 frozen poses, against the
same reference (the default framebuffer's alpha for the hit/miss decision, `renderIdPass` for the part).
Press is not a candidate: R3-6b makes it the 1-px GPU read of the current frame either way, and the
last row checks that read against the framebuffer.

| Metric | CPU predicate (§6.2) | FBO fallback (§6.6) | Gate |
|---|---|---|---|
| samples | 27202 | 27202 | ≥ 20 000 |
| boundary-weighted share | 50.044 % | 50.044 % | ≥ 50 % |
| false-positive rate | 0.000 % | 15.043 % | ≤ 0.5 % |
| false-negative rate | 3.496 % | 3.184 % | ≤ 0.5 % |
| part mismatch (reported, not gated; > 2 % is a finding) | 18.811 % | 20.252 % | — |
| false negatives INSIDE the silhouette (whole 5x5 neighbourhood opaque) | 7 | 352 | diagnostic |
| largest reference alpha at a false negative | 118 / 255 | 255 / 255 | diagnostic |
| pick p50 / p95 / p99 (ms, excl. model.update) | 0.000 / 0.100 / 0.100 | 0.000 / 0.100 / 0.100 | p95 ≤ 0.2 |
| passes the R3-6e gate | false | false | — |
| parts (reference counts) | body=7800, ticklish=6086, hair=629, arm=201, face=200 | (same samples) | every exposed part ≥ 200 |
| §6.3 press read agrees with the framebuffer | true | (press is GPU-only) | true |

**R3-6's rule selects: the §6.6 FboPicker — the CPU predicate missed the gate, which R3-6 rules in the fallback for.**

**Verdict: FAIL** — the selected renderer does not meet R3-6e.

## Escalation — the rule and the measurement disagree

R3-6 rules in the FBO path because the CPU predicate missed the gate, but over the same samples the CPU path has the lower worst-case error rate (3.496 % CPU vs 15.043 % FBO) and neither passes. The ruling assumed the fallback would be more accurate; the measurement says it is not, so which path Task 13 wires into HoverTracker is a controller decision, not an implementation one. Press is unaffected (R3-6b, 1-px GPU read).

## What §14.4 item 3 should read

Hit-testing is opaque-pixel. **Press** is always the synchronous 1-px read of the frame just drawn
(`GpuPressReader`, §6.3) — verified against the framebuffer in every pose above. **Hover** was measured
both ways over 27202 boundary-weighted samples of 12 poses: the CPU mesh + texture-alpha predicate
costs 0.100 ms p95 and never reports a hit on a transparent pixel (0.000 % false positives),
but misses 3.496 % of opaque samples — 7 of those misses are more than 2 px inside the
silhouette, so the error is sub-pixel edge coverage, not geometry. The quarter-scale FBO fallback is not a
strict improvement: one of its texels spans 4x4 device pixels, which costs it 15.043 % false positives
(a halo around the silhouette) and 352 interior misses on thin features. Neither meets R3-6e's 0.5 %.
