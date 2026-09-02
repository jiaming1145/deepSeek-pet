// Node smoke test for the animation sources and the retargeting code.
//   node retarget/smoke.mjs            (run from D:/ds/spikes/vrm/anim)
// Exit code 0 only if every check passes. Prints track counts per clip.
import './node-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadVRMFromFile, toArrayBuffer } from './node-vrm.mjs';
import { parseVRMAnimation, attachLookAtProxy } from './loadVRMAnimation.js';
import { parseQuaterniusAnimations, quaterniusVRMRigMap, QUATERNIUS_TPOSE_CLIP } from './loadQuaterniusAnimations.js';
import { parseMixamoAnimation, convertMixamoAsset, mixamoVRMRigMap } from './loadMixamoAnimation.js';
import { retargetClipToVRM } from './retargetToVRM.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANIM = path.resolve(here, '..');
const VRM_FILE = path.join(ANIM, 'testdata', 'VRM1_Constraint_Twist_Sample.vrm');
const QUAT_GLB = path.join(ANIM, 'quaternius', 'Animation Library[Standard]', 'Godot', 'AnimationLibrary_Godot_Standard.glb');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- helpers
/** Max angular difference (deg) between the VRM normalized bones' world rotation and the
 *  source bones' world-delta-from-reference, sampled at `time`. Proves the retarget maths. */
function retargetError({ sourceRoot, sourceClip, restPoseClip, boneMap, vrm, targetClip, time }) {
  // reference pose
  const ref = new Map();
  const mixerS = new THREE.AnimationMixer(sourceRoot);
  if (restPoseClip) {
    const a = mixerS.clipAction(restPoseClip);
    a.play();
    mixerS.setTime(0);
    mixerS.stopAllAction();
  }
  sourceRoot.updateMatrixWorld(true);
  for (const name of Object.keys(boneMap)) {
    const n = sourceRoot.getObjectByName(name);
    if (n) ref.set(name, n.getWorldQuaternion(new THREE.Quaternion()));
  }
  // posed source
  const act = mixerS.clipAction(sourceClip);
  act.play();
  mixerS.setTime(time);
  sourceRoot.updateMatrixWorld(true);
  // posed target
  const mixerT = new THREE.AnimationMixer(vrm.scene);
  const actT = mixerT.clipAction(targetClip);
  actT.play();
  mixerT.setTime(time);
  vrm.scene.updateMatrixWorld(true);

  let maxDeg = 0;
  let worst = '';
  const qs = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  for (const [srcName, boneName] of Object.entries(boneMap)) {
    const sn = sourceRoot.getObjectByName(srcName);
    const tn = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!sn || !tn || !ref.has(srcName)) continue;
    sn.getWorldQuaternion(qs).multiply(ref.get(srcName).clone().invert()); // W * R^-1
    tn.getWorldQuaternion(qt);
    const deg = THREE.MathUtils.radToDeg(qs.angleTo(qt));
    if (deg > maxDeg) {
      maxDeg = deg;
      worst = boneName;
    }
  }
  mixerS.stopAllAction();
  mixerT.stopAllAction();
  vrm.humanoid.resetNormalizedPose();
  return { maxDeg, worst };
}

/** Build a tiny Mixamo-like rig (T-pose bind, cm units) plus a clip, so the Mixamo code path
 *  is exercised even before the owner has exported anything from mixamo.com. */
function makeSyntheticMixamo() {
  const root = new THREE.Group();
  root.name = 'Armature';
  const mk = (name, parent, pos, rotEulerDeg = [0, 0, 0]) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...pos);
    b.rotation.set(...rotEulerDeg.map(THREE.MathUtils.degToRad));
    parent.add(b);
    return b;
  };
  const hips = mk('mixamorigHips', root, [0, 98, 0]);
  const spine = mk('mixamorigSpine', hips, [0, 10, 0]);
  const spine1 = mk('mixamorigSpine1', spine, [0, 12, 0]);
  const spine2 = mk('mixamorigSpine2', spine1, [0, 12, 0]);
  const neck = mk('mixamorigNeck', spine2, [0, 15, 0]);
  mk('mixamorigHead', neck, [0, 10, 0]);
  const lsh = mk('mixamorigLeftShoulder', spine2, [6, 12, 0], [0, 0, -90]); // arm bones point down +Y local after -90 z
  const larm = mk('mixamorigLeftArm', lsh, [0, 12, 0]);
  const lfore = mk('mixamorigLeftForeArm', larm, [0, 28, 0]);
  mk('mixamorigLeftHand', lfore, [0, 26, 0]);
  const rsh = mk('mixamorigRightShoulder', spine2, [-6, 12, 0], [0, 0, 90]);
  const rarm = mk('mixamorigRightArm', rsh, [0, 12, 0]);
  const rfore = mk('mixamorigRightForeArm', rarm, [0, 28, 0]);
  mk('mixamorigRightHand', rfore, [0, 26, 0]);
  const lleg = mk('mixamorigLeftUpLeg', hips, [9, -5, 0], [0, 0, 180]);
  const lshin = mk('mixamorigLeftLeg', lleg, [0, 44, 0]);
  mk('mixamorigLeftFoot', lshin, [0, 42, 0]);
  const rleg = mk('mixamorigRightUpLeg', hips, [-9, -5, 0], [0, 0, 180]);
  const rshin = mk('mixamorigRightLeg', rleg, [0, 44, 0]);
  mk('mixamorigRightFoot', rshin, [0, 42, 0]);

  // Clip: hips bob + left arm swing + head turn, 1 s at 30 fps.
  const times = Float32Array.from({ length: 31 }, (_, i) => i / 30);
  const tracks = [];
  const hipsPos = [];
  for (const t of times) hipsPos.push(0, 98 + 3 * Math.sin(t * Math.PI * 2), 5 * t);
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, Float32Array.from(hipsPos)));
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const rot = (bone, fn) => {
    const vals = [];
    const restQ = bone.quaternion.clone();
    for (const t of times) {
      e.set(...fn(t).map(THREE.MathUtils.degToRad));
      q.setFromEuler(e).premultiply(restQ);
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, Float32Array.from(vals)));
  };
  rot(larm, (t) => [60 * Math.sin(t * Math.PI * 2), 0, 0]);
  rot(neck, (t) => [0, 40 * Math.sin(t * Math.PI * 2), 0]);
  rot(lleg, (t) => [30 * Math.sin(t * Math.PI * 2), 0, 0]);
  rot(hips, (t) => [0, 0, 5 * Math.sin(t * Math.PI * 2)]);
  root.animations = [new THREE.AnimationClip('mixamo.com', 1, tracks)];
  return root;
}

// ---------------------------------------------------------------- run
console.log(`three ${THREE.REVISION}, node ${process.version}`);
const vrm = await loadVRMFromFile(VRM_FILE);
ok(vrm.humanoid != null, `loaded VRM ${path.basename(VRM_FILE)} (metaVersion ${vrm.meta.metaVersion}, hips rest y=${vrm.humanoid.normalizedRestPose.hips.position[1].toFixed(3)})`);
attachLookAtProxy(vrm);

// 1. every .vrma under anim/vrma
const vrmaDir = path.join(ANIM, 'vrma');
const vrmaFiles = fs.readdirSync(vrmaDir).filter((f) => f.toLowerCase().endsWith('.vrma'));
ok(vrmaFiles.length > 0, `found ${vrmaFiles.length} .vrma file(s) in anim/vrma`);
for (const f of vrmaFiles) {
  try {
    const clip = await parseVRMAnimation(toArrayBuffer(fs.readFileSync(path.join(vrmaDir, f))), vrm, { name: f });
    const kinds = { quaternion: 0, position: 0, expression: 0, lookAt: 0 };
    for (const t of clip.tracks) {
      if (t.name.endsWith('.quaternion')) kinds[t.name.startsWith('lookAtQuaternionProxy') ? 'lookAt' : 'quaternion']++;
      else if (t.name.endsWith('.position')) kinds.position++;
      else kinds.expression++;
    }
    ok(clip.tracks.length > 0, `vrma ${f}: duration=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length} (rot ${kinds.quaternion}, hipsPos ${kinds.position}, expression ${kinds.expression}, lookAt ${kinds.lookAt})`);
  } catch (e) {
    ok(false, `vrma ${f}: ${e.message}`);
  }
}

// 2. Quaternius CC0 library -> VRM (real clips, real rig, A-pose bind + A_TPose reference)
if (fs.existsSync(QUAT_GLB)) {
  const ab = toArrayBuffer(fs.readFileSync(QUAT_GLB));
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  const clips = await parseQuaterniusAnimations(ab, vrm);
  ok(clips.size === gltf.animations.length - 1, `quaternius: retargeted ${clips.size} clips (source ${gltf.animations.length} incl. ${QUATERNIUS_TPOSE_CLIP})`);
  const show = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Dance_Loop', 'Interact', 'PickUp_Table', 'Hit_Chest', 'Roll', 'Death01'];
  for (const name of show) {
    const c = clips.get(name);
    if (!c) { ok(false, `quaternius: missing ${name}`); continue; }
    const st = c.userData.retarget;
    ok(st.mapped === 52, `quaternius ${name}: duration=${c.duration.toFixed(3)}s tracks=${c.tracks.length} (rot ${st.mapped}, hipsScale ${st.hipsPositionScale.toFixed(4)}, unmapped=[${st.unmapped.join(',')}])`);
  }
  const restPoseClip = THREE.AnimationClip.findByName(gltf.animations, QUATERNIUS_TPOSE_CLIP);
  for (const name of ['Walk_Loop', 'Sitting_Idle_Loop']) {
    const srcClip = THREE.AnimationClip.findByName(gltf.animations, name);
    let worstAll = { maxDeg: 0, worst: '' };
    for (const time of [0.0, 0.37, 0.8]) {
      const r = retargetError({ sourceRoot: gltf.scene, sourceClip: srcClip, restPoseClip, boneMap: quaterniusVRMRigMap, vrm, targetClip: clips.get(name), time });
      if (r.maxDeg > worstAll.maxDeg) worstAll = r;
    }
    ok(worstAll.maxDeg < 0.05, `quaternius ${name}: normalized-bone world rotation == source delta, max err ${worstAll.maxDeg.toFixed(4)} deg (${worstAll.worst || 'all'})`);
  }
} else {
  ok(false, `quaternius GLB missing at ${QUAT_GLB}`);
}

// 3. Mixamo path: synthetic rig always; real FBX files from anim/mixamo when present
{
  const rig = makeSyntheticMixamo();
  const clip = convertMixamoAsset(rig, vrm, { name: 'synthetic' });
  const st = clip.userData.retarget;
  ok(clip.tracks.length === 5 && st.mapped === 4, `mixamo(synthetic): tracks=${clip.tracks.length} (rot ${st.mapped}, hips pos 1), hipsScale=${st.hipsPositionScale.toFixed(5)} (src hips ${st.motionHipsHeight} cm -> vrm ${st.vrmHipsHeight.toFixed(3)} m)`);
  let worstAll = { maxDeg: 0, worst: '' };
  for (const time of [0, 0.25, 0.6]) {
    const r = retargetError({ sourceRoot: rig, sourceClip: rig.animations[0], boneMap: mixamoVRMRigMap, vrm, targetClip: clip, time });
    if (r.maxDeg > worstAll.maxDeg) worstAll = r;
  }
  ok(worstAll.maxDeg < 0.05, `mixamo(synthetic): normalized-bone world rotation == source delta, max err ${worstAll.maxDeg.toFixed(4)} deg`);
  // hips translation scaled into VRM metres
  const hipsTrack = clip.tracks.find((t) => t.name.endsWith('.position'));
  const y0 = hipsTrack.values[1];
  ok(Math.abs(y0 - st.vrmHipsHeight) < 1e-4, `mixamo(synthetic): hips y at t=0 is ${y0.toFixed(4)} m == VRM rest hips height`);
}
const mixamoDir = path.join(ANIM, 'mixamo');
const fbxFiles = fs.existsSync(mixamoDir) ? fs.readdirSync(mixamoDir).filter((f) => f.toLowerCase().endsWith('.fbx')) : [];
if (fbxFiles.length === 0) {
  console.log('INFO  no .fbx in anim/mixamo yet (owner step, see OWNER_CARD_mixamo.md) - real-FBX check skipped');
}
for (const f of fbxFiles) {
  try {
    const clip = parseMixamoAnimation(toArrayBuffer(fs.readFileSync(path.join(mixamoDir, f))), vrm, { name: f });
    const st = clip.userData.retarget;
    ok(st.mapped >= 20, `mixamo ${f}: duration=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length} (rot ${st.mapped}, hipsScale ${st.hipsPositionScale.toFixed(5)}, unmapped=[${st.unmapped.join(',')}])`);
  } catch (e) {
    ok(false, `mixamo ${f}: ${e.message}`);
  }
}

// 4. sanity: a retargeted clip actually moves the VRM's normalized bones when played
{
  const clip = (await parseVRMAnimation(toArrayBuffer(fs.readFileSync(path.join(vrmaDir, vrmaFiles[0]))), vrm));
  const mixer = new THREE.AnimationMixer(vrm.scene);
  mixer.clipAction(clip).play();
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  const before = head.quaternion.clone();
  mixer.setTime(Math.min(0.5, clip.duration * 0.5));
  const moved = clip.tracks.some((t) => t.name.startsWith(head.name)) ? before.angleTo(head.quaternion) > 1e-6 : true;
  ok(moved, `playing ${vrmaFiles[0]} through AnimationMixer(vrm.scene) writes the normalized bones`);
  mixer.stopAllAction();
  vrm.humanoid.resetNormalizedPose();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
