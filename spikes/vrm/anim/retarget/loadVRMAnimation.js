/**
 * .vrma (VRM Animation, VRMC_vrm_animation) -> three AnimationClip for a given VRM,
 * via @pixiv/three-vrm-animation. Mirrors packages/three-vrm-animation/examples/loader-plugin.html.
 *
 *   const vrm = ...;                       // loaded with VRMLoaderPlugin
 *   attachLookAtProxy(vrm);                // once per VRM, before creating clips with lookAt tracks
 *   const clip = await loadVRMAnimation('x.vrma', vrm);
 *   mixer = new THREE.AnimationMixer(vrm.scene); mixer.clipAction(clip).play();
 *   // each frame: mixer.update(dt); vrm.update(dt);
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
} from '@pixiv/three-vrm-animation';

export function createVRMAnimationLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

/**
 * VRMA lookAt tracks drive a quaternion on a proxy object; add it once per VRM.
 * Safe to call repeatedly (idempotent).
 */
export function attachLookAtProxy(vrm) {
  if (!vrm.lookAt) return null;
  const existing = vrm.scene.getObjectByName('lookAtQuaternionProxy');
  if (existing) return existing;
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
  proxy.name = 'lookAtQuaternionProxy';
  vrm.scene.add(proxy);
  return proxy;
}

/** @returns {import('@pixiv/three-vrm-animation').VRMAnimation[]} */
export function vrmAnimationsFromGLTF(gltf) {
  const list = gltf.userData?.vrmAnimations ?? [];
  if (list.length === 0) throw new Error('vrmAnimationsFromGLTF: file has no VRMC_vrm_animation');
  return list;
}

/** Browser: load a .vrma and bind it to `vrm`. */
export async function loadVRMAnimation(url, vrm, opts = {}) {
  const gltf = await createVRMAnimationLoader().loadAsync(url);
  const anims = vrmAnimationsFromGLTF(gltf);
  const clip = createVRMAnimationClip(anims[opts.index ?? 0], vrm);
  if (opts.name) clip.name = opts.name;
  return clip;
}

/** Node / buffer variant. */
export function parseVRMAnimation(arrayBuffer, vrm, opts = {}) {
  const loader = createVRMAnimationLoader();
  return new Promise((resolve, reject) =>
    loader.parse(
      arrayBuffer,
      opts.path ?? '',
      (gltf) => {
        try {
          const anims = vrmAnimationsFromGLTF(gltf);
          const clip = createVRMAnimationClip(anims[opts.index ?? 0], vrm);
          if (opts.name) clip.name = opts.name;
          resolve(clip);
        } catch (e) {
          reject(e);
        }
      },
      reject,
    ),
  );
}
