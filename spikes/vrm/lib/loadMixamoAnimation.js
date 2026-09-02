// Port of three-vrm's official example loader:
//   https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js
// (MIT, (c) pixiv Inc.). Split into a pure retarget step (`retargetMixamoAsset`) that a Node
// unit test can exercise without an FBX file, plus the file-loading wrapper. Behaviour is the
// upstream behaviour: every Mixamo track is converted from the Mixamo rig's local space into the
// VRM normalized-bone space (parentRestWorld * q * restWorld^-1), hips translation is scaled by
// the hips-height ratio, and VRM 0.x models get the X/Z flip.
import * as THREE from 'three';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';

/**
 * Convert a loaded Mixamo FBX asset (THREE.Group with `.animations`) into an AnimationClip whose
 * tracks target the VRM's normalized humanoid bone nodes.
 * @param {THREE.Object3D & {animations: THREE.AnimationClip[]}} asset
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @param {{clipName?: string}} [opts]
 * @returns {{clip: THREE.AnimationClip, mapped: string[], unmapped: string[]}}
 */
export function retargetMixamoAsset(asset, vrm, opts = {}) {
  const clipName = opts.clipName ?? 'mixamo.com';
  const clip = THREE.AnimationClip.findByName(asset.animations, clipName) ?? asset.animations[0];
  if (!clip) throw new Error('Mixamo asset has no animation clip');

  const tracks = [];
  const mapped = [];
  const unmapped = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();

  asset.updateWorldMatrix(true, true);

  // Scale the hips translation so the clip's stride/height matches the VRM's proportions.
  const motionHips = asset.getObjectByName('mixamorigHips');
  if (!motionHips) throw new Error('Mixamo asset has no mixamorigHips node');
  const motionHipsHeight = motionHips.position.y;
  const vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips.position[1];
  const hipsPositionScale = vrmHipsHeight / motionHipsHeight;
  const isVRM0 = vrm.meta?.metaVersion === '0';

  for (const track of clip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.');
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
    const vrmNodeName = vrmBoneName ? vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name : undefined;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (vrmNodeName == null || !mixamoRigNode) { unmapped.push(track.name); continue; }
    mapped.push(`${mixamoRigName}->${vrmBoneName}`);

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quatA.fromArray(values, i);
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        _quatA.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${vrmNodeName}.${propertyName}`, track.times,
        Array.from(values, (v, i) => (isVRM0 && i % 2 === 0 ? -v : v)),
      ));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const values = Array.from(track.values, (v, i) => (isVRM0 && i % 3 !== 1 ? -v : v) * hipsPositionScale);
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, values));
    }
  }
  return { clip: new THREE.AnimationClip('vrmAnimation', clip.duration, tracks), mapped, unmapped };
}

/**
 * Load a Mixamo FBX and retarget it to the VRM. `FBXLoaderClass` is injected so this module does
 * not import `three/addons` itself (keeps the Node unit test free of the FBX parser).
 * @returns {Promise<THREE.AnimationClip>}
 */
export function loadMixamoAnimation(url, vrm, FBXLoaderClass) {
  const loader = new FBXLoaderClass();
  return loader.loadAsync(url).then((asset) => retargetMixamoAsset(asset, vrm).clip);
}

export { mixamoVRMRigMap };
