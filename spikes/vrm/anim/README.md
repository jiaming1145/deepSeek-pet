# anim/ — animation sources, loaders and retargeting for the VRM pet

```
anim/
  vrma/          .vrma clips (VRM Animation) — drop VRoid's VRMA_01..07 here (owner step, SOURCES.md)
  mixamo/        Mixamo .fbx exports go here (owner step, OWNER_CARD_mixamo.md); never redistribute
  quaternius/    CC0 Universal Animation Library GLB (46 clips) + its licence
  testdata/      VRM 1.0 sample avatar for tests/preview
  retarget/      ES modules the runtime spike imports (see below) + Node tools/tests
  preview/       Electron harness that renders the clips on the sample VRM; shots/ = evidence
  SOURCES.md     provenance + licence of every file
  ACTION_CLIPS.json  action id -> clip mapping (covered / owner / procedural)
  REPORT.md      what was done, what was verified, what remains
```

## Using the loaders from the runtime spike

```js
import { loadQuaterniusAnimations, loadVRMAnimation, loadMixamoAnimation, attachLookAtProxy }
  from '../anim/retarget/index.js';

// after the VRM is loaded with VRMLoaderPlugin:
attachLookAtProxy(vrm);                                              // needed for .vrma lookAt tracks
const q = await loadQuaterniusAnimations('../anim/quaternius/Animation%20Library%5BStandard%5D/Godot/AnimationLibrary_Godot_Standard.glb', vrm);
const walk = q.get('Walk_Loop');                                     // THREE.AnimationClip bound to vrm.scene
const wave = await loadVRMAnimation('../anim/vrma/VRMA_02.vrma', vrm);
const eat  = await loadMixamoAnimation('../anim/mixamo/eat.fbx', vrm);

const mixer = new THREE.AnimationMixer(vrm.scene);
mixer.clipAction(walk).play();
// per frame: mixer.update(dt); vrm.update(dt);
```

Bare specifiers must resolve. In a `file://` page use an importmap like `preview/index.html`:

```html
<script type="importmap">{"imports":{
  "three": "../anim/node_modules/three/build/three.module.js",
  "three/examples/jsm/": "../anim/node_modules/three/examples/jsm/",
  "three/addons/": "../anim/node_modules/three/examples/jsm/",
  "@pixiv/three-vrm": "../anim/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js",
  "@pixiv/three-vrm-core": "../anim/node_modules/@pixiv/three-vrm-core/lib/three-vrm-core.module.js",
  "@pixiv/three-vrm-animation": "../anim/node_modules/@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js"
}}</script>
```

`anim/node_modules` is created by `pnpm install --ignore-workspace` inside `anim/` (three 0.185.1,
@pixiv/three-vrm* 3.5.5, jsdom). If the runtime spike installs its own copy of `three`, point the
importmap at that one instead — the loaders only need `three`, `three/examples/jsm/loaders/*` and
`@pixiv/three-vrm-animation` to resolve to the *same* three instance the VRM was loaded with.

## Retarget module (`retarget/`)

| file | role |
|---|---|
| `retargetToVRM.js` | the maths (three-vrm's `loadMixamoAnimation` algorithm, generalised to any bone map; `restPoseClip` option for A-pose rigs) |
| `loadMixamoAnimation.js` | faithful port of three-vrm's example: `loadMixamoAnimation(url, vrm)`, plus `convertMixamoAsset` / `parseMixamoAnimation` |
| `mixamoVRMRigMap.js` | verbatim three-vrm map (MIT) |
| `quaterniusVRMRigMap.js` / `loadQuaterniusAnimations.js` | Rigify `DEF-*` map and loader for the CC0 library |
| `loadVRMAnimation.js` | `.vrma` via `@pixiv/three-vrm-animation` (`loadVRMAnimation`, `parseVRMAnimation`, `attachLookAtProxy`) |
| `index.js` | re-exports |
| `smoke.mjs` | Node test: `node retarget/smoke.mjs` (needs `anim/node_modules`) |
| `inspect-file.mjs` | `node retarget/inspect-file.mjs <glb|vrma|fbx>` prints bones and clips |
| `node-env.mjs`, `node-vrm.mjs` | jsdom shims and texture-stripped VRM loading for Node |

## Preview / evidence

```
cd D:\ds\apps\desktop
npx electron ../../spikes/vrm/anim/preview/main.cjs            # interactive, plays Walk_Loop
npx electron ../../spikes/vrm/anim/preview/main.cjs --capture  # writes preview/shots/*.png + report.json
```
