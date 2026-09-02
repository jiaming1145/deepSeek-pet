// Unit tests for the Mixamo -> VRM retarget path, without Electron or an FBX parser.
// Run:  node --import ./test/register.mjs --test test/   (cwd D:\ds\spikes\vrm)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mixamoVRMRigMap, retargetMixamoAsset } from '../lib/loadMixamoAnimation.js';

// The 55 humanoid bone names of VRM 1.0 (VRMC_vrm-1.0/humanoid.md).
const VRM1_BONES = new Set([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
]);

test('every Mixamo rig name maps to a valid VRM 1.0 humanoid bone, uniquely', () => {
  const values = Object.values(mixamoVRMRigMap);
  for (const v of values) assert.ok(VRM1_BONES.has(v), `not a VRM1 bone: ${v}`);
  assert.equal(new Set(values).size, values.length, 'duplicate VRM targets');
  assert.equal(Object.keys(mixamoVRMRigMap).length, 52, 'Mixamo rig has 52 mapped joints (65 minus eyes/jaw/toe-ends)');
  for (const k of Object.keys(mixamoVRMRigMap)) assert.ok(k.startsWith('mixamorig'), k);
  // The three bones every Mixamo clip animates must be present.
  assert.equal(mixamoVRMRigMap.mixamorigHips, 'hips');
  assert.equal(mixamoVRMRigMap.mixamorigRightArm, 'rightUpperArm');
  assert.equal(mixamoVRMRigMap.mixamorigLeftForeArm, 'leftLowerArm');
});

// A synthetic "Mixamo asset": Hips at y=100 (cm, like Mixamo), Spine rotated 90deg about X at rest,
// with a clip that animates Hips position + Spine rotation. A fake VRM whose normalized bones are
// named Normalized_<bone> and whose hips sit at 1 m.
function makeAsset() {
  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.set(0, 100, 0);
  const spine = new THREE.Bone(); spine.name = 'mixamorigSpine'; spine.position.set(0, 10, 0);
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const unknown = new THREE.Bone(); unknown.name = 'mixamorigNotABone';
  root.add(hips); hips.add(spine); spine.add(unknown);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 + 0.3);
  root.animations = [new THREE.AnimationClip('mixamo.com', 1, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 100, 0, 5, 110, -5]),
    new THREE.QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 1], [0, 0, 0, 1, q.x, q.y, q.z, q.w]),
    new THREE.QuaternionKeyframeTrack('mixamorigNotABone.quaternion', [0], [0, 0, 0, 1]),
  ])];
  return root;
}
const fakeVRM = (metaVersion = '1') => ({
  meta: { metaVersion },
  humanoid: {
    normalizedRestPose: { hips: { position: [0, 1, 0] } },
    getNormalizedBoneNode: (name) => (VRM1_BONES.has(name) ? { name: `Normalized_${name}` } : null),
  },
});

test('retarget renames tracks to normalized bones, scales hips, drops unmapped', () => {
  const { clip, mapped, unmapped } = retargetMixamoAsset(makeAsset(), fakeVRM());
  assert.equal(clip.name, 'vrmAnimation');
  assert.equal(clip.duration, 1);
  assert.deepEqual(clip.tracks.map((t) => t.name), ['Normalized_hips.position', 'Normalized_spine.quaternion']);
  assert.deepEqual(mapped, ['mixamorigHips->hips', 'mixamorigSpine->spine']);
  assert.deepEqual(unmapped, ['mixamorigNotABone.quaternion']);
  // 100 cm hips -> 1 m: scale 0.01
  const pos = Array.from(clip.tracks[0].values);
  assert.deepEqual(pos.map((v) => +v.toFixed(4)), [0, 1, 0, 0.05, 1.1, -0.05]);
});

test('retarget removes the Mixamo rest rotation: rest keyframe becomes identity in VRM space', () => {
  const { clip } = retargetMixamoAsset(makeAsset(), fakeVRM());
  const rot = clip.tracks[1].values;
  // Frame 0: the spine's own rest rotation (90deg X) is baked out -> identity.
  // parentRestWorld(hips: identity) * q(identity) * restWorld^-1(spine: -90deg X) = -90deg X ... but
  // the *track* key is local rotation relative to parent, and the formula intentionally yields
  // parentWorld * local * inverse(childWorld). With local=identity the result is Rx(-90).
  const q0 = new THREE.Quaternion().fromArray(rot, 0);
  const expect0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  assert.ok(Math.abs(q0.dot(expect0)) > 0.9999, `frame0 ${q0.toArray()} vs ${expect0.toArray()}`);
  // Frame 1: local = Rx(90+0.3) -> Rx(90+0.3) * Rx(-90) = Rx(0.3): the delta from rest survives.
  const q1 = new THREE.Quaternion().fromArray(rot, 4);
  const expect1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
  assert.ok(Math.abs(q1.dot(expect1)) > 0.9999, `frame1 ${q1.toArray()} vs ${expect1.toArray()}`);
});

test('VRM 0.x models get the X/Z flip on rotations and positions', () => {
  const { clip } = retargetMixamoAsset(makeAsset(), fakeVRM('0'));
  const pos = Array.from(clip.tracks[0].values).map((v) => +v.toFixed(4) + 0);
  assert.deepEqual(pos, [0, 1, 0, -0.05, 1.1, 0.05]);
  const rot = Array.from(clip.tracks[1].values);
  const { clip: c1 } = retargetMixamoAsset(makeAsset(), fakeVRM('1'));
  const rot1 = Array.from(c1.tracks[1].values);
  for (let i = 0; i < rot.length; i++) assert.equal(rot[i], i % 2 === 0 ? -rot1[i] : rot1[i]);
});

test('input asset track values are not mutated', () => {
  const asset = makeAsset();
  const before = Array.from(asset.animations[0].tracks[1].values);
  retargetMixamoAsset(asset, fakeVRM());
  assert.deepEqual(Array.from(asset.animations[0].tracks[1].values), before);
});
