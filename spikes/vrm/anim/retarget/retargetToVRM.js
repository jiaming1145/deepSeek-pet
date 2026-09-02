/**
 * Generic humanoid retargeting onto a three-vrm VRM (VRM 0.x or 1.0).
 *
 * This is the maths of three-vrm's `examples/humanoidAnimation/loadMixamoAnimation.js`
 * lifted out so it works for any source rig that has a bone-name map:
 *
 *   for every rotation track of a mapped source bone
 *     q' = parentRestWorldRotation * q * inverse(restWorldRotation)
 *   which, applied to VRM's normalized (T-pose, identity-rest) bones, makes every
 *   normalized bone's world rotation equal the source bone's world rotation relative
 *   to the source rest pose  (T_i = W_i * R_i^-1, provable by induction over the chain).
 *
 *   hips translation is scaled by  vrmHipsRestHeight / sourceHipsRestHeight
 *   VRM 0.x models get x/z negated (rotation x,z and position x,z), exactly as the sample.
 *
 * Two deliberate hardenings over the sample, both documented in ../REPORT.md:
 *   1. only the hips translation track is kept (the VRMA spec allows translation on hips
 *      only; copying other bones' local positions onto a differently proportioned VRM
 *      shears the skeleton). Opt back in with `keepNonHipsTranslation: true`.
 *   2. scale tracks are always dropped.
 *
 * Plus one extension needed for non-Mixamo rigs: `restPoseClip`. Mixamo's bind pose is a
 * T-pose so rest == T-pose. Blender/Rigify exports (e.g. Quaternius) bind in an A-pose and
 * ship a `A_TPose` clip; pass it as `restPoseClip` and its first frame becomes the
 * reference pose R_i. The induction above holds for any consistent reference pose, so the
 * result is still exact.
 */
import * as THREE from 'three';

/**
 * @typedef {object} RetargetOptions
 * @property {THREE.AnimationClip} clip            source clip (tracks named `<node>.quaternion` / `<node>.position`)
 * @property {THREE.Object3D} sourceRoot           root of the source hierarchy the clip was authored on
 * @property {import('@pixiv/three-vrm').VRM} vrm  target VRM
 * @property {Record<string,string>} boneMap       source node name -> VRM humanoid bone name
 * @property {string} [sourceHipsName]             defaults to the key mapping to 'hips'
 * @property {THREE.AnimationClip} [restPoseClip]  clip whose t=0 frame is the source's T-pose (see above)
 * @property {number} [restPoseTime=0]
 * @property {string} [name]                       name for the output clip (default: clip.name)
 * @property {boolean} [keepNonHipsTranslation=false]
 */

/**
 * @param {RetargetOptions} opts
 * @returns {THREE.AnimationClip}
 */
export function retargetClipToVRM(opts) {
  const { clip, sourceRoot, vrm, boneMap } = opts;
  if (!clip) throw new Error('retargetClipToVRM: clip is required');
  if (!sourceRoot) throw new Error('retargetClipToVRM: sourceRoot is required');
  if (!vrm?.humanoid) throw new Error('retargetClipToVRM: vrm.humanoid is required');
  if (!boneMap) throw new Error('retargetClipToVRM: boneMap is required');

  const sourceHipsName = opts.sourceHipsName ?? Object.keys(boneMap).find((k) => boneMap[k] === 'hips');
  const sourceHips = sourceHipsName ? sourceRoot.getObjectByName(sourceHipsName) : null;
  if (!sourceHips) throw new Error(`retargetClipToVRM: source hips node "${sourceHipsName}" not found`);

  // Put the source hierarchy into its reference (T) pose before sampling rest rotations.
  let mixer = null;
  if (opts.restPoseClip) {
    mixer = new THREE.AnimationMixer(sourceRoot);
    const action = mixer.clipAction(opts.restPoseClip);
    action.play();
    mixer.setTime(opts.restPoseTime ?? 0);
  }
  sourceRoot.updateMatrixWorld(true);

  // Adjust with reference to hips height. The sample reads `hips.position.y` directly, which
  // is only the height when the hips' parent is an identity node at the origin (true for
  // Mixamo). Rigify/glTF exports parent the hips under a rotated `root` bone, so measure the
  // hips in the source root's frame and carry the parent's rest transform into the
  // translation samples below. For Mixamo the two formulations are identical.
  const rootWorldInverse = sourceRoot.matrixWorld.clone().invert();
  const hipsParentRestMatrix = sourceHips.parent.matrixWorld.clone().premultiply(rootWorldInverse);
  const hipsRestInRoot = sourceHips.position.clone().applyMatrix4(hipsParentRestMatrix);
  const motionHipsHeight = hipsRestInRoot.y;
  const vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips.position[1];
  const hipsPositionScale = Math.abs(motionHipsHeight) > 1e-6 ? vrmHipsHeight / motionHipsHeight : 1;

  const isVRM0 = vrm.meta?.metaVersion === '0';
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();
  const tracks = [];
  const stats = { mapped: 0, unmapped: [], droppedTranslation: 0, droppedScale: 0 };

  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const sourceNodeName = parsed.nodeName;
    const propertyName = parsed.propertyName;
    const vrmBoneName = boneMap[sourceNodeName];
    const vrmNode = vrmBoneName ? vrm.humanoid.getNormalizedBoneNode(vrmBoneName) : null;
    const sourceNode = sourceRoot.getObjectByName(sourceNodeName);

    if (vrmNode == null || sourceNode == null) {
      if (propertyName === 'quaternion' && !stats.unmapped.includes(sourceNodeName)) stats.unmapped.push(sourceNodeName);
      continue;
    }
    const vrmNodeName = vrmNode.name;

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // Store rotations of rest-pose.
      sourceNode.getWorldQuaternion(restRotationInverse).invert();
      sourceNode.parent.getWorldQuaternion(parentRestWorldRotation);

      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quatA.fromArray(values, i);
        // parent rest world rotation * track rotation * inverse(rest world rotation)
        _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        _quatA.toArray(values, i);
      }
      if (isVRM0) {
        for (let i = 0; i < values.length; i += 4) { values[i] = -values[i]; values[i + 2] = -values[i + 2]; }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.${propertyName}`, Float32Array.from(track.times), values));
      stats.mapped++;
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      if (propertyName === 'scale') { stats.droppedScale++; continue; }
      if (propertyName === 'position' && vrmBoneName !== 'hips' && !opts.keepNonHipsTranslation) {
        stats.droppedTranslation++;
        continue;
      }
      const values = Float32Array.from(track.values);
      const isHips = vrmBoneName === 'hips';
      for (let i = 0; i < values.length; i += 3) {
        _vec3.fromArray(values, i);
        if (isHips) _vec3.applyMatrix4(hipsParentRestMatrix); // local -> source-root frame
        _vec3.multiplyScalar(hipsPositionScale);
        if (isVRM0) { _vec3.x = -_vec3.x; _vec3.z = -_vec3.z; }
        _vec3.toArray(values, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, Float32Array.from(track.times), values));
    }
  }

  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(sourceRoot); }

  const out = new THREE.AnimationClip(opts.name ?? clip.name ?? 'vrmAnimation', clip.duration, tracks);
  out.userData = { ...(out.userData ?? {}), retarget: { ...stats, hipsPositionScale, motionHipsHeight, vrmHipsHeight } };
  return out;
}

/** Retarget every clip of a loaded asset. Returns Map<name, clip>. */
export function retargetAllClips(clips, common) {
  const out = new Map();
  for (const clip of clips) out.set(clip.name, retargetClipToVRM({ ...common, clip }));
  return out;
}
