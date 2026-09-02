# Animation sources — provenance and licences

Every file under `anim/` that did not originate in this repo is listed here with its
download URL and licence. Nothing here phones home at runtime; downloads happened once
during the build (2026-09-01/02).

## Downloaded (in the tree)

| path | what | source URL | licence | notes |
|---|---|---|---|---|
| `quaternius/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb` | Quaternius **Universal Animation Library (Standard)** — 46 humanoid clips on one Rigify skeleton, 6.7 MB glTF-binary, 30 fps, metres | https://store.godotengine.org/asset/quaternius/universal-animation-library/ (direct: `…/download/44/` → `Universal_Animation_LibraryStandard.zip`); pack page https://quaternius.com/packs/universalanimationlibrary.html ; itch https://quaternius.itch.io/universal-animation-library | **CC0 1.0** (`quaternius/Animation Library[Standard]/License.txt`, verbatim from the zip) | Godot build chosen because it is a single GLB three's GLTFLoader parses directly. The Unity/Unreal FBX copies, preview PNGs and the zip were deleted after extraction to keep the tree small; re-download from the URL. The full (name-your-own-price, also CC0) library has 120+ clips and a `.blend`. |
| `vrma/three-vrm_test.vrma` | pixiv three-vrm test fixture (`test.vrma`, 11 KB, 3 s: 1 rotation track on head, 1 expression, 1 lookAt) | https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm-animation/examples/models/test.vrma | **MIT** (repo licence, Copyright (c) 2019-2026 pixiv Inc.) | Only a format/loader smoke fixture; not a usable motion. |
| `testdata/VRM1_Constraint_Twist_Sample.vrm` | VRM 1.0 sample avatar (10.8 MB) used by the smoke test and the preview | https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm-animation/examples/models/VRM1_Constraint_Twist_Sample.vrm (origin: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample) | **VRM Public License 1.0** https://vrm.dev/licenses/1.0/ , (c) 2022 pixiv Inc. | Test model only. The same file exists at `spikes/vrm/models/` (runtime-spike owner's copy); this copy keeps `anim/` self-contained. |
| `retarget/mixamoVRMRigMap.js` | Mixamo→VRM bone-name map | https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/humanoidAnimation/mixamoVRMRigMap.js | **MIT** (pixiv Inc.) | Verbatim, header added. `retarget/loadMixamoAnimation.js` is a port of the sibling `loadMixamoAnimation.js` (same licence). |

npm packages (installed into `anim/node_modules`, not committed): `three` 0.185.1 (MIT),
`@pixiv/three-vrm` / `@pixiv/three-vrm-core` / `@pixiv/three-vrm-animation` 3.5.5 (MIT),
`jsdom` 30.0.1 (MIT).

## Owner-gated (free, licence-clean, but needs a login) — not in the tree yet

| target path | what | source URL | licence (plain words) |
|---|---|---|---|
| `vrma/VRMA_01.vrma` … `vrma/VRMA_07.vrma` | **VRoid Project "VRMA_MotionPack"** — 7 official `.vrma` clips: 01 Show full body, 02 Greeting (wave), 03 Peace sign, 04 Shoot, 05 Spin, 06 Model pose, 07 Squat. Ships as `VRMA_MotionPack.zip` with `Readme_VRMA_MotionPack_EN.txt`. | https://vroid.booth.pm/items/5512385 (announcement: https://vroid.com/en/news/6HozzBIV0KkcKf9dc1fZGW) — **price 0, "Free Download" button requires a pixiv/BOOTH account**, so this is an owner step | pixiv Inc. terms on the item page (fetched 2026-09-02): copyright stays with pixiv; free to modify and to use for any purpose incl. **commercial use by individuals or companies with the credit line** "Character animation credits to pixiv Inc.'s VRoid Project" (or the Japanese wording); **prohibited**: redistributing the motions or alterations "in a way that can be rigged or extracted", religious/political use, defamation, illegal use, rights infringement, sexual or significantly violent content. Practical reading: fine inside the pet; do not ship the raw `.vrma` files as a pack; put the credit line in the app's about/credits. |

Owner step: log in to BOOTH, open the item, click Free Download, unzip, copy the seven
`VRMA_0x.vrma` files into `D:\ds\spikes\vrm\anim\vrma\` (keep the original names), then run
`cd D:\ds\spikes\vrm\anim && node retarget/smoke.mjs` — it picks up every `.vrma` in that folder.

Mixamo (Adobe) is the other owner-gated route; see `OWNER_CARD_mixamo.md`.

## Looked at and rejected

| source | why not |
|---|---|
| GitHub code search `extension:vrma` (101 hits: `yv-was-taken/desktop-waifu`, `Enigma-EE/Cipher_Stage`, `DavinciDreams/3dchat`, `LongbowXXX/ai-tuber`, …) | almost all are Mixamo clips converted to `.vrma` and re-uploaded ("Dwarf Idle", "Joyful Jump", "Femme Peek Around Corner" are Mixamo titles). Mixamo terms forbid redistributing raw animations, so these repos cannot grant a licence. Not downloaded. |
| VRoid Hub Photo Booth community `.vrma` uploads | per-item conditions, login required, most are not redistributable; skip for now. |
| BOOTH `.vrma` packs (Tân Logic "Animation vrma for VroidHub Photo Booth", etc.) | mostly paid; the free ones need a BOOTH login and carry per-seller terms. Owner may cherry-pick later. |
| Bandai Namco Research motion dataset | CC BY-NC-ND 4.0 — no derivatives, non-commercial. Unusable. |
| Kevin Iglesias "Human Basic Motions FREE" (itch) | free but custom licence and a non-Mixamo rig; Quaternius already covers locomotion under CC0. |
| Quaternius Universal Animation Library **2** (130+ clips, CC0) | same author/licence, newer rig naming; not needed yet. If wanted later, `retarget/quaterniusVRMRigMap.js` will need re-verifying with `retarget/inspect-file.mjs`. |
| `vrm-c/vrm-specification` samples | contains VRM models and material tests, **no `.vrma` samples** (checked `samples/` listing and an `org:vrm-c extension:vrma` code search → 0). |
