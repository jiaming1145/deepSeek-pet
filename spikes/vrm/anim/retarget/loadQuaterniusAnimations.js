/**
 * Quaternius Universal Animation Library (CC0) -> VRM clips.
 * The Godot build is a single GLB holding 46 clips on one Rigify skeleton, including
 * `A_TPose`, which is used as the reference pose (the bind pose is an A-pose).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { quaterniusVRMRigMap } from './quaterniusVRMRigMap.js';
import { retargetClipToVRM } from './retargetToVRM.js';

export const QUATERNIUS_TPOSE_CLIP = 'A_TPose';

/**
 * @param {import('three/examples/jsm/loaders/GLTFLoader.js').GLTF} gltf
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @param {{ names?: string[] }} [opts]  restrict to these clip names
 * @returns {Map<string, THREE.AnimationClip>}
 */
export function convertQuaterniusAsset(gltf, vrm, opts = {}) {
  const restPoseClip = THREE.AnimationClip.findByName(gltf.animations, QUATERNIUS_TPOSE_CLIP);
  if (!restPoseClip) throw new Error(`convertQuaterniusAsset: "${QUATERNIUS_TPOSE_CLIP}" clip missing`);
  const wanted = opts.names ? new Set(opts.names) : null;
  const out = new Map();
  for (const clip of gltf.animations) {
    if (clip.name === QUATERNIUS_TPOSE_CLIP) continue;
    if (wanted && !wanted.has(clip.name)) continue;
    out.set(
      clip.name,
      retargetClipToVRM({
        clip,
        sourceRoot: gltf.scene,
        vrm,
        boneMap: quaterniusVRMRigMap,
        sourceHipsName: 'DEF-hips',
        restPoseClip,
      }),
    );
  }
  return out;
}

/** Browser: returns Map<clipName, AnimationClip> retargeted to `vrm`. */
export async function loadQuaterniusAnimations(url, vrm, opts = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return convertQuaterniusAsset(gltf, vrm, opts);
}

/** Node / buffer variant. */
export function parseQuaterniusAnimations(arrayBuffer, vrm, opts = {}) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) =>
    loader.parse(
      arrayBuffer,
      opts.path ?? '',
      (gltf) => {
        try {
          resolve(convertQuaterniusAsset(gltf, vrm, opts));
        } catch (e) {
          reject(e);
        }
      },
      reject,
    ),
  );
}

export { quaterniusVRMRigMap };
