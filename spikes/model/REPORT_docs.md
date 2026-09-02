# REPORT_docs — owner and agent docs made exact (2026-09-01)

Scope: `spikes/model/OWNER_CARD_3d.md` (rewritten), `spikes/vrm/anim/OWNER_CARD_mixamo.md`
(licence and dialog notes), `docs/3D_PIPELINE.md` (new), `docs/ACTION_VOCABULARY.md` section 6
(replaced; sections 1 to 5 untouched), this report. No git write commands were run; nothing
outside those five paths was written. `OWNER_CARD_turnaround.md` was read and left as is (its
35-degree pose contract already matches the 3D card).

## 1. Web verification — what was fetched and what it said

Method: WebFetch and WebSearch from this session on 2026-09-01. Labels: **verified** = read on
the service's own page today; **third-party** = only on a review/price-tracker page; **unverified** =
could not be read anywhere.

### Meshy (all official pages fetched directly)

| claim | result | source |
|---|---|---|
| Plans: Free $0 / 100 credits; Pro $20/mo or $240/yr, 1,000 credits, private, API, 10 concurrent; Premium $40; Ultra $100; Studio $70 + $10 per member; Enterprise custom | **verified** (card was right) | meshy.ai/pricing |
| Free-plan downloads: "10 free downloads/month for models generated with Meshy 6 Lite"; Meshy 6 / Meshy 7 models need an upgrade to download | **verified** — NEW, the old card did not know this | help.meshy.ai/en/articles/15696428 |
| Multi-View "is a feature exclusive to paid subscribers", "upgrade to a Pro plan or above"; Meshy 7 only ("Meshy 6 and Meshy 6 lite does not support Multi-View") | **verified** — NEW; the old card implied the free tier could do it | help.meshy.ai/en/articles/12634481 |
| UI: "Multi-view" toggle, slots "Left, Back, and Right", "Generate" link invents missing views; Standard model type only; >= 1040 x 1040 px; png/jpg/jpeg/webp <= 20 MB; 20 credits default, Auto Split +10 = 30; "Free is not included" | **verified** (tutorial still names Meshy 6; help centre says Meshy 7, help centre wins) | meshy.ai/tutorials/multi-view-image-to-3d |
| Panel labels: Model Type Standard / Smart Topology; Model Version Meshy 7 / 6 / 6 lite; Auto Split; Multi-View; Pose "A-Pose, T-Pose, or Custom"; Image Enhancement; License "CC BY 4.0" / "Private" | **verified**; Symmetry / Topology / Target Polycount / PBR labels **unverified** (not in the article; API has `topology`, `target_polycount`, and `symmetry_mode` is deprecated "no longer affects output") | help.meshy.ai/en/articles/9996860; docs.meshy.ai/en/api/image-to-3d; /multi-image-to-3d |
| Credits: generation 20, texture 2K/4K +10, 8K +15 (full = 30 / 35); Auto Split 10 per split; AI Auto-Repair 10; rigging + animation presets free; Pose Control 0 credits, Pro+ | **verified** (card's "retexture 10 / 15" was right; "20 credits, 30 with Auto Split" corrected to "30 with texture, +10 Auto Split") | meshy.ai/tutorials/meshy-credits-guide (Aug 2026); /character-auto-rigging-workflow; /auto-split-3d-model-into-parts |
| Rigging: Animate area, character type Humanoid / Quadruped Dog / Smart Rig (Beta), Auto-Rig button, "under 30 seconds"; Download → Animation → All Added → Single File; FBX / GLB / USDZ | **verified** | meshy.ai/tutorials/character-auto-rigging-workflow; help.meshy.ai/en/articles/16231707 |
| Rig bone names follow Mixamo conventions | **third-party-ish**: search snippet attributed to docs.meshy.ai rigging guide; the guide page itself only says "Mixamo-compatible animation libraries". Card says "verify on the file with vrm_manifest.py" | docs.meshy.ai/en/webapp/guides/3d-model/rigging |
| Licence: free CC BY 4.0, credit line "Model created with Meshy – CC BY 4.0 License"; paid private, no attribution; rights tied to plan at generation; conditioned on rights to the uploaded reference | **verified** | help.meshy.ai/en/articles/16102098 |

### Tripo (official site returns HTTP 403 to the fetcher; pricing page read through the r.jina.ai read-only proxy; API docs fetched directly)

| claim | result | source |
|---|---|---|
| Free: 200 credits, "Public Models · Non-Commercial Use", Exports "15 (H2.5 only)", 1 concurrent, 1-day history, 3 free retries | **verified via proxy** — the export limit is NEW and decisive (free tier cannot export an H3/P1 model) | tripo3d.ai/pricing (proxy); a Medium review confirms "15 downloads per month limit on v2.5 models" |
| Multi-view to 3D listed under Pro, Max and Team only | **verified via proxy**; consistent with costbench (2026-08-24) and tripoia (2026-08-06) | same |
| Pro price: official page as fetched $20.00/mo, $240.00/yr, 3,000 credits; third-party pages $19.90 and a "Creator" annual-equivalent $13.93/mo | **verified via proxy**, third-party disagreement noted on the card | tripo3d.ai/pricing (proxy); costbench.com; tripoia.com |
| Max $90/mo ($1,080/yr) 25,000 credits; Team $55/seat/mo 90,000 credits | **verified via proxy**; the old card's "$49.90 to $139.90" tiers are gone | same |
| Free-tier "CC BY 4.0" | **third-party only** (costbench, aifreeapi); official row says "Public Models · Non-Commercial Use" | — |
| API credits: $1 = 100; multiview H2/H3 20 (30 textured), P1 40 (50 textured); detailed texture +10; quad +5; generate parts +20; Ultra geometry +20; pre-rig check free; rig 25; retarget 10; conversion 5 | **verified** (card was right; added parts +20 and Ultra +20) | docs.tripo3d.ai/get-started/pricing.html; /model-generation/multiview-to-model-v3-0-v3-1.html |
| Multiview P1 = `P1-20260311`, files `[front, left, back, right]`, min 2, JPEG/PNG <= 20 MB; the P1 endpoint has no quad / geometry_quality / generate_parts; H3 = `v3.1-20260211` | **verified** | docs.tripo3d.ai multiview P1 and H3 pages |
| Rig API `rig-v2.0`, spec tripo or mixamo, biped etc., glb or fbx, 25 credits, free Rig Check | **verified** | developers.tripo3d.ai/en/models/rig |
| Tripo Studio panel labels (Geometry quality, Texture HD, Quad/Smart Mesh, Symmetry, Remove background, Auto size, Style, Parts) | **unverified** — tripo3d.ai tutorial, features and blog pages reached via proxy describe the workflow in prose only; Studio itself is a login SPA | tripo3d.ai/tutorials/tripo-ai-image-to-3d-model-tutorial, /features/ai-auto-rigging, /blog/rig-ai-generated-character-for-mixamo |
| Tripo tutorial page says "300 credits per month" and "$19.90" | stale vs the pricing page (200 credits, $20.00); noted on the card | same tutorial page |
| "rig data is lost if you remesh after rigging" | **unverified today**; softened on the card | — |

### Mixamo (helpx.adobe.com FAQ timed out at 60 s three times: twice direct, once via proxy)

| claim | result | source |
|---|---|---|
| Free with an Adobe ID, no Creative Cloud subscription; not for Enterprise / Federated IDs; not available with a China country code | **verified via search excerpts of the live FAQ** | helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (WebSearch snippet) |
| Royalty-free personal, commercial, non-profit; no attribution; cannot distribute raw character/animation files as standalone assets; cannot train ML models | **verified via search excerpts + FAQ text reproduced on community.adobe.com** (that copy is from 2022 and calls the service a "limited duration technology preview") | community.adobe.com/questions-696/...-589400; licenseorg.com/guide/3d-assets/mixamo (secondary) |
| Download dialog: Format "FBX Binary", Skin "With Skin" / "Without Skin", FPS 24/30/60, Keyframe Reduction None / Uniform / Non-uniform, In Place checkbox | **verified against a script that drives the current dialog** (not the dialog itself) | gist.github.com/krazyjakee/1e3592856dd636b8043cc359ad9d66fc |
| "~2,500 clips" | **unverified**; marked on the card | — |

### The two deciding questions

- **Is Tripo's multi-view free-tier or paid?** Paid (Pro and above), verified on the official pricing
  page via proxy and by two price trackers. On top of that the free tier exports "15 (H2.5 only)".
- **Meshy's current multi-view model name?** Meshy 7 (help centre 12634481); the tutorial's "Meshy 6"
  is older. Multi-View is paid on Meshy too, and free-tier downloads are Meshy 6 Lite only.
- **Recommendation (on the card):** Meshy Pro for one month ($20) first — every label verified,
  A-Pose control, rig free, private assets, ~33 textured multi-view generations. Tripo Pro ($20; some
  pages $19.90) second, only if Meshy's mesh fails inspection or its rig does not map; Tripo's Mixamo
  skeleton spec is documented but its Studio labels are not. Skip both free tiers.

## 2. docs/3D_PIPELINE.md (new)

Stages 1 to 7 with location, owner, status and what each check proves; the owner's ordered steps;
the hookup command on the owner's GLB; a licence chain table (kit CC BY-NC-SA 4.0 → NC-SA on
everything derived; Meshy/Tripo tier terms; VRM Public License test assets; Quaternius CC0; VRoid
credit line; Mixamo no-redistribution; MIT libraries); known gaps carried from VERIFY.md. Paths were
checked with ls (spikes/model/scripts/{assemble_turnaround,build_reference_pack,extract_palette}.py,
spikes/vrm/anim/{preview/main.cjs,retarget/index.js,retarget/smoke.mjs}, quaternius License.txt) and
git check-ignore (spikes/vrm/anim/mixamo/ and runs/ are ignored). During the session parallel
builders dropped untracked tools/vrm/chains.whalechan.json, hookup_whalechan.py,
measure_turnaround.py, probe_glb.py, evidence/turnaround_landmarks.json and a face bridge in
spikes/model/face/; the document names them as unverified work in progress rather than claiming them.

## 3. docs/ACTION_VOCABULARY.md section 6

Replaced with: the four original code bullets (protocol, brain, behaviors, world-sense) kept, a
renderer bullet for the VRM stage (clip layer via spikes/vrm/anim/retarget/index.js, expression
manager, lookAt), a per-action "clip vs procedural" table derived from ACTION_CLIPS.json (status,
primary clip, procedural layer for all 17 vocabulary actions), and the runtime rules (procedural first,
A+P bone overwrite order, owner-gated clips never redistributed, retarget check numbers from
VERIFY.md, section 5 order re-read as the fetch order). Sections 1 to 5 unchanged (diff: 55 insertions,
1 deletion, all below the section 6 heading; grep shows the same six headings). The action list is
unchanged; run, which ACTION_CLIPS.json also covers, is not in the vocabulary and was not added.

## 4. Evidence of the edits

    git diff --stat docs/ACTION_VOCABULARY.md            -> 56 +-  (55 insertions, 1 deletion)
    git diff --stat spikes/vrm/anim/OWNER_CARD_mixamo.md -> 40 +-  (28 insertions, 11 deletions)
    git diff --stat spikes/model/OWNER_CARD_3d.md        -> 296 +-
    git status --short (my paths) -> M docs/ACTION_VOCABULARY.md, M spikes/model/OWNER_CARD_3d.md,
                                     M spikes/vrm/anim/OWNER_CARD_mixamo.md, ?? docs/3D_PIPELINE.md,
                                     ?? spikes/model/REPORT_docs.md

No screenshots: this task produced documents only; nothing visual was claimed.

## 5. Still open

- Tripo Studio panel labels (need a logged-in look; the card tells the owner to record what was clicked).
- Meshy web-panel labels for Symmetry / Topology / Polycount / PBR.
- Meshy rig bone names on a real export (check with python tools\vrm\vrm_manifest.py).
- The Adobe FAQ page itself (read it once when signing in; the card says so).