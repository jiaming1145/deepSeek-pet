// ES module entry for the runtime spike:
//   import { loadMixamoAnimation, loadVRMAnimation, loadQuaterniusAnimations } from '../anim/retarget/index.js'
// Bare specifiers 'three', 'three/examples/jsm/...', '@pixiv/three-vrm-animation' must be resolvable
// (importmap in a file:// page, or a bundler). See ../README.md.
export { retargetClipToVRM, retargetAllClips } from './retargetToVRM.js';
export {
  loadMixamoAnimation,
  parseMixamoAnimation,
  convertMixamoAsset,
  mixamoVRMRigMap,
} from './loadMixamoAnimation.js';
export {
  loadQuaterniusAnimations,
  parseQuaterniusAnimations,
  convertQuaterniusAsset,
  quaterniusVRMRigMap,
  QUATERNIUS_TPOSE_CLIP,
} from './loadQuaterniusAnimations.js';
export {
  loadVRMAnimation,
  parseVRMAnimation,
  createVRMAnimationLoader,
  attachLookAtProxy,
  vrmAnimationsFromGLTF,
} from './loadVRMAnimation.js';
