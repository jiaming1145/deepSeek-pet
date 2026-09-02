/**
 * Mixamo FBX -> VRM AnimationClip.
 *
 * `loadMixamoAnimation(url, vrm)` is three-vrm's example function
 * (packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js, MIT, pixiv Inc.)
 * with the per-track maths moved into ./retargetToVRM.js so the same code serves
 * other rigs. Behaviour is identical for Mixamo input: the clip named 'mixamo.com' is
 * taken, rest rotations come from the FBX bind pose (Mixamo binds in T-pose), hips height
 * is normalised against `vrm.humanoid.normalizedRestPose.hips.position[1]`, VRM 0.x gets
 * the x/z sign flip.
 *
 * `convertMixamoAsset(asset, vrm)` is the same for an FBX you already parsed (Node tests,
 * or the runtime spike's own loader/caching).
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';
import { retargetClipToVRM } from './retargetToVRM.js';

/**
 * @param {THREE.Group} asset  result of FBXLoader.parse / load
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @param {{ clipName?: string, name?: string }} [opts]
 */
export function convertMixamoAsset(asset, vrm, opts = {}) {
  const clip =
    THREE.AnimationClip.findByName(asset.animations, opts.clipName ?? 'mixamo.com') ?? asset.animations[0];
  if (!clip) throw new Error('convertMixamoAsset: FBX has no animation clip');
  if (!asset.getObjectByName('mixamorigHips')) {
    throw new Error(
      'convertMixamoAsset: no "mixamorigHips" node. Export from Mixamo with the default skeleton (see OWNER_CARD_mixamo.md).',
    );
  }
  return retargetClipToVRM({
    clip,
    sourceRoot: asset,
    vrm,
    boneMap: mixamoVRMRigMap,
    sourceHipsName: 'mixamorigHips',
    name: opts.name ?? 'vrmAnimation',
  });
}

/**
 * Load Mixamo animation, convert for three-vrm use, and return it.
 * @param {string} url A url of mixamo animation data
 * @param {import('@pixiv/three-vrm').VRM} vrm A target VRM
 * @returns {Promise<THREE.AnimationClip>} The converted AnimationClip
 */
export function loadMixamoAnimation(url, vrm, opts = {}) {
  const loader = new FBXLoader(); // A loader which loads FBX
  return loader.loadAsync(url).then((asset) => convertMixamoAsset(asset, vrm, opts));
}

/** Node / buffer variant. `arrayBuffer` is the FBX file bytes. */
export function parseMixamoAnimation(arrayBuffer, vrm, opts = {}) {
  const loader = new FBXLoader();
  const asset = loader.parse(arrayBuffer, opts.path ?? '');
  return convertMixamoAsset(asset, vrm, opts);
}

export { mixamoVRMRigMap };
