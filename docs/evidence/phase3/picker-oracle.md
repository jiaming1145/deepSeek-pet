# Picker oracle (§6.5, R3-6e, B-08)

cwd: `D:\ds`  ·  2026-08-30T19:55:16.491Z

Run directory: `D:\ds\.claude\worktrees\wf_53266240-b22-5`.

HARDWARE: Windows 10.0.26200 (Windows 11 Home 10.0.26200), CPU 12th Gen Intel(R) Core(TM) i7-12700K, GPU/driver ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver), display 3840x2160 @ 150 % (devicePixelRatio 1.5)

Renderer under test: CPU mesh + texture-alpha predicate (`packages/stage/src/picker.ts`), reference = default-framebuffer alpha + `renderIdPass`.

| Metric | Value | Gate |
|---|---|---|
| samples | 26736 | ≥ 20 000 |
| boundary-weighted share | 50.045 % | ≥ 50 % |
| false-positive rate | 0.000 % | ≤ 0.5 % |
| false-negative rate | 3.381 % | ≤ 0.5 % |
| part mismatch (reported, not gated; > 2 % is a finding) | 18.746 % | — |
| false negatives INSIDE the silhouette (whole 5x5 neighbourhood opaque) | 8 | diagnostic |
| largest reference alpha at a false negative | 126 / 255 | diagnostic |
| pick p50 / p95 / p99 (ms, excl. model.update) | 0.000 / 0.100 / 0.100 | p95 ≤ 0.2 |
| parts (reference counts) | body=7721, ticklish=5833, hair=638, arm=201, face=200 | every exposed part ≥ 200 |
| §6.3 press read agrees with the framebuffer | true | true |

**Verdict: FAIL — the CPU predicate FAILS the gate; §6.6 FboPicker ships (Task 11 Step 12) and this oracle is re-run against it.**
