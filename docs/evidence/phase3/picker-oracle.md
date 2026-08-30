# Picker oracle (§6.5, R3-6e, B-08)

cwd: `D:\ds`  ·  2026-08-30T20:36:17.223Z

Run directory: `D:\ds` (A-5 normalised by the integrator; the oracle run executed in this repository's task worktree for branch `worktree-wf_53266240-b22-5`, since removed).

HARDWARE: Windows 10.0.26200 (Windows 11 Home 10.0.26200), CPU 12th Gen Intel(R) Core(TM) i7-12700K, GPU/driver ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver), display 3840x2160 @ 150 % (devicePixelRatio 1.5)

Every candidate is measured over the **same** samples of the same 12 frozen poses. Press is not a
candidate: R3-6b makes it the 1-px GPU read of the current frame either way, and the last table row
checks that read against the framebuffer it actually reads.

## Two references, and what the gap between them proves

**Gating reference:** non-multisampled full-resolution RGBA8 FBO, redrawn by the same renderer in the same frozen pose.

**Secondary reference:** the default framebuffer, which Live2DStage.create requests with antialias: true (MSAA resolve).

This run confirms the default framebuffer really is multisampled — `getContextAttributes().antialias`
is `true` and `gl.SAMPLES` is `4` — so the objection that the false-negative rate is
nothing but MSAA fractional coverage (which a point-in-triangle predicate cannot reproduce) is a real,
testable objection. **The measurement refutes it.** The two references call the same pixels opaque to
within about one pixel in 123 000 (`poses[].refOpaque`), and the CPU predicate false-negative rate
moves only from 3.524 % (MSAA) to 3.509 % (non-MSAA) — a difference of
0.015 pp, about 0.4 % of the rate. The gate is not lost to antialiasing.
Both columns are kept below so the term stays visible; the gate is taken against the non-MSAA one.

## Results

| Metric | CPU predicate (§6.2) | CPU, GL texel centres | FBO fallback (§6.6) | Gate |
|---|---|---|---|---|
| samples | 27242 | 27242 | 27242 | ≥ 20 000 |
| boundary-weighted share | 50.044 % | (same samples) | (same samples) | ≥ 50 % |
| false-positive rate — GATING (non-MSAA) | 0.000 % | 0.000 % | 15.226 % | ≤ 0.5 % |
| false-negative rate — GATING (non-MSAA) | 3.509 % | 3.645 % | 1.531 % | ≤ 0.5 % |
| false-positive rate — vs the MSAA framebuffer | 0.000 % | 0.000 % | 15.212 % | reported |
| false-negative rate — vs the MSAA framebuffer | 3.524 % | 3.660 % | 1.531 % | reported |
| ...of those, at pixels the id pass also attributes | 544 (1.997 %) | 543 (1.993 %) | 220 (0.808 %) | diagnostic |
| ...at pixels no participating drawable reaches PART_ATTRIBUTION_MIN | 412 | 450 | 197 | diagnostic |
| false negatives INSIDE the silhouette (5x5 opaque, gating ref) | 6 | 7 | 149 | diagnostic |
| largest gating-reference alpha at a false negative | 111 / 255 | 125 / 255 | 255 / 255 | diagnostic |
| part mismatch, reference-unambiguous samples (> 2 % is a finding) | 3.939 % | 3.929 % | 13.355 % | — |
| pick p50 / p95 / p99 (ms, excl. model.update) | 0.000 / 0.100 / 0.100 | 0.000 / 0.100 / 0.100 | 0.000 / 0.100 / 0.100 | p95 ≤ 0.2 |
| passes the R3-6e gate (gating reference) | false | false | false | — |
| reference-ambiguous samples (excluded from mismatch) | 22.271 % | (same) | (same) | see below |
| parts (reference counts) | body=5266, ticklish=5538, hair=623, arm=201, face=200 | (same samples) | (same samples) | every exposed part ≥ 200 |
| §6.3 press read agrees with the framebuffer | true | — | (press is GPU-only) | true |

## Where the false negatives come from

544 of the CPU predicate's 956 false negatives are at pixels the id pass also attributes to a
participating drawable — a genuine disagreement with the predicate, 1.997 % of all samples. The other
412 are at pixels where NO participating drawable reaches PART_ATTRIBUTION_MIN: the coverage reference
is opaque there only because of drawables §6.2 tells the predicate to ignore (non-participating,
additive, multiplicative) or a stack of sub-threshold layers that composites over ENTER_ALPHA.
No false negative is deeper than 111/255 and only 6 of them are more than 2 px inside the
silhouette, so the predicate is not missing geometry — it disagrees on the faint rim.

## Part attribution (§6.5 step 5) — the earlier artefact named the wrong cause

The previous run reported 18.8 % and blamed the `ticklishRect` override. **That cause is ruled out by
the code:** the oracle applies the override to the reference using the same `modelX/modelY` and the
same rect the picker used, so any sample where both sides produce a part agrees on `ticklish` by
construction. The measured cause is that the two halves of the reference disagree about whether
anything is at the pixel at all, in **both** directions:

- ~21671 px per pose are opaque in the composite but unattributed by the id pass (it draws only
  participating, Normal-blend drawables and discards fragments under PART_ATTRIBUTION_MIN);
- ~6798 px per pose are attributed by the id pass but transparent in the composite.

Boundary-weighted, that is 22.271 % of all samples (11.424 % coverage-only,
10.847 % id-only). The reference defines no part at those pixels, so they are excluded from
the mismatch count and reported here instead — the earlier 18.8 % was mostly this, silently resolved
to `hitPartDefault`. Over the samples where both halves agree, the CPU predicate mismatches on
3.939 %, split as:

- 548 where the picker reports no part but the reference has one: 544 of them are the
  reference-unambiguous false negatives above, and 4 are samples whose accumulated alpha rounds up to
  exactly ENTER_ALPHA in `PickResult.alpha` while §6.2 step 10 tested the unrounded value — a 4-sample
  seam between steps 10 and 11, not a geometry error;
- 286 genuine part-vs-part disagreements — 1.351 % of unambiguous samples, under the 2 % finding line.

Top confusion pairs (reference -> picked): body -> none = 298, ticklish -> none = 198, body -> face = 78, hair -> face = 70, hair -> none = 49, arm -> body = 40.

Task 13 consumes `PickResult.part` for `arb:touch`; the number that matters there is the part-vs-part
1.351 %, not the composite figure.

## Part coverage (§6.5 step 4)

Required — every distinct `part` the character map exposes with `participatesInHitTest: true`: arm, body, face, hair, head.
The required set is derived from `character.json`, not from the parts that happened to be sampled, so a
part with zero samples is a visible shortfall rather than a row the assertion never reaches.

**SHORTFALL — `head` never reached 200 samples.** The id pass attributes ZERO pixels to
`head` in any of the 12 poses (`poses[].idPartPixels`): those drawables are never the topmost
participating drawable at any pixel — on Haru, `head` is `Part01Ear001`, and the ears are behind the hair
in every pose the model can reach. R3-6e "every part represented" cannot be met for such a part by
sampling; a controller must accept the shortfall, add a pose that exposes it, or change the character
map. The gate asserts the quota for every OTHER required part.

**R3-6 rule selects: the §6.6 FboPicker — the CPU predicate missed the gate, which R3-6 rules in the fallback for.**

**Verdict: FAIL** — the selected renderer does not meet R3-6e against the gating reference.

## Escalation — the rule and the measurement disagree

R3-6 rules in the FBO path because the CPU predicate missed the gate, but over the same samples the CPU path has the lower worst-case error rate (3.509 % CPU vs 15.226 % FBO) and neither passes. The ruling assumed the fallback would be more accurate; the measurement says it is not, so which path Task 13 wires into HoverTracker is a controller decision, not an implementation one. Press is unaffected (R3-6b, 1-px GPU read).

## Known-red B-08 (for downstream batches)

Until a controller rules, this spec fails on purpose, and it is the ONLY expected failure in the
browser lane. The failing assertion is `expect(shipped.geom.fpRate | fnRate).toBeLessThanOrEqual(0.005)`
at the end of `apps/desktop/tests/picker-oracle.spec.ts`, in the test
`B-08 picker/holes-and-parts — §6.5 oracle over 12 poses (R3-6e gate)`. Reproduce with:

```
node apps/desktop/node_modules/@playwright/test/cli.js test -c apps/desktop/playwright.config.ts tests/picker-oracle.spec.ts
```

Expected failure line today: `fbo false-positive rate (non-MSAA reference)`
with `Received: 0.1522648851038837`. Any OTHER failing test in that suite is a regression, not this known red.

## §6.2 step 6: the texel mapping

`bilinearAlpha` follows §6.2 step 6 verbatim (`u -> u * (W - 1)`), which places texel centres at the
texture outer corners; GL LINEAR filtering — what the reference was rendered with — uses `u * W - 0.5`,
a half-texel difference exactly at the rim where half the samples are drawn. The middle column measures
the GL-correct form on the same samples:
false negatives 3.509 % (contract) vs 3.645 % (texel centres), false positives
0.000 % vs 0.000 %. The GL-correct form is slightly WORSE, so it does not
explain the gate either and §6.2 step 6 needs no amendment on this evidence. Only the contract form ships.

## What §14.4 item 3 should read

Hit-testing is opaque-pixel. **Press** is always the synchronous 1-px read of the frame just drawn
(`GpuPressReader`, §6.3) — verified against the framebuffer in every pose above. **Hover** was measured
both ways over 27242 boundary-weighted samples of 12 poses against a non-multisampled reference:
the CPU mesh + texture-alpha predicate costs 0.100 ms p95, never claims a transparent pixel
(0.000 % false positives) and misses 3.509 % of opaque samples — 1.997 % of them at pixels a
participating drawable actually covers, only 6 more than 2 px inside the silhouette, and none deeper
than 111/255. The quarter-scale FBO fallback trades that for a halo: one of its texels spans 4x4
device pixels, costing 15.226 % false positives and 149 interior misses on thin features.
