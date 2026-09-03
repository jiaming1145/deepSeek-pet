// Side-view layered rig on three.js skinned meshes. Layers come from See-through (spikes/side_rig/assets),
// bones from build_rig.py (rig.json). Rigid layers are plain meshes parented to a bone; chain layers (tail,
// hair, skirt, limbs, torso) are SkinnedMesh grids weighted along their bone chain. Motion is procedural:
// actions pose the bones, springs lag the chains, the face is driven by expression parameters.
import * as THREE from 'three';

const S = 1 / 384;                       // canvas px -> world units (canvas 768 px = 2 units)
const toW = (p) => new THREE.Vector2((p[0] - 384) * S, (384 - p[1]) * S);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const VIEW_H = 2.6;
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(-VIEW_H * aspect / 2, VIEW_H * aspect / 2, VIEW_H / 2, -VIEW_H / 2, -10, 10);
camera.position.z = 5;
window.addEventListener('resize', () => {
  const a = window.innerWidth / window.innerHeight;
  camera.left = -VIEW_H * a / 2; camera.right = VIEW_H * a / 2; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const S_ = { t: 0, dt: 0, paused: false, hudOn: true, action: 'idle', tau: 0, facing: -1, x: 0.15, emotion: 'neutral',
  blink: { next: 2.2, phase: 0 }, look: { yaw: 0, pitch: 0 }, talking: false, fps: [], lastFrame: performance.now(), prevPos: new Map(), turn: null };
const rig = await (await fetch('./rig.json')).json();
const FLOOR_Y = toW([0, rig.floor]).y;

// ------------------------------------------------------------------ skeleton
const group = new THREE.Group();               // facing flip + locomotion live here
scene.add(group);
const bones = {};
const boneList = [];
const restHead = {};
for (const b of rig.bones) {
  const bone = new THREE.Bone();
  bone.name = b.name;
  const h = toW(b.head), t = toW(b.tail);
  restHead[b.name] = h;
  bone.userData = { head: h, tail: t, len: h.distanceTo(t), pose: 0, spring: 0, springVel: 0, dir: Math.atan2(t.y - h.y, t.x - h.x) };
  if (b.parent) { const ph = restHead[b.parent]; bone.position.set(h.x - ph.x, h.y - ph.y, 0); bones[b.parent].add(bone); }
  else { bone.position.set(h.x, h.y, 0); group.add(bone); }
  bones[b.name] = bone; boneList.push(bone);
}
group.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(boneList);
const boneIndex = Object.fromEntries(boneList.map((b, i) => [b.name, i]));

// ------------------------------------------------------------------ layers
const loader = new THREE.TextureLoader();
const loadTex = (file) => new Promise((res, rej) => loader.load('./assets/' + file, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; res(t); }, undefined, rej));
const layerMeshes = {};   // name -> mesh
const facePieces = {};    // eyes/mouth/brows for expressions
const drawOrder = [...rig.order];
for (const d of rig.duplicates) { const at = drawOrder.indexOf(d.z_before); drawOrder.splice(at < 0 ? 0 : at, 0, d.name); }

function chainPolyline(names) {
  const pts = names.map((n) => bones[n].userData.head.clone());
  const last = bones[names[names.length - 1]].userData;
  pts.push(last.tail.clone());
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, total: cum[cum.length - 1] };
}
function chainWeights(p, poly, names) {
  // closest point on the polyline -> arc length -> blend the two bones around it
  let best = { d: 1e9, s: 0 };
  for (let i = 0; i < poly.pts.length - 1; i++) {
    const a = poly.pts[i], b = poly.pts[i + 1], ab = b.clone().sub(a), l2 = ab.lengthSq();
    const u = l2 > 1e-9 ? clamp(p.clone().sub(a).dot(ab) / l2, 0, 1) : 0;
    const q = a.clone().add(ab.multiplyScalar(u)), d = p.distanceTo(q);
    if (d < best.d) best = { d, s: poly.cum[i] + u * (poly.cum[i + 1] - poly.cum[i]) };
  }
  const n = names.length;
  // segment k spans cum[k]..cum[k+1] and belongs to bone k; blend to bone k+1 near the joint
  let k = 0;
  while (k < n - 1 && best.s > poly.cum[k + 1]) k++;
  const segLen = Math.max(poly.cum[k + 1] - poly.cum[k], 1e-6);
  const u = (best.s - poly.cum[k]) / segLen;               // 0 at bone k head, 1 at its tail
  const blendZone = 0.45;
  let w1 = 0;
  if (k < n - 1 && u > 1 - blendZone) w1 = smooth((u - (1 - blendZone)) / blendZone) * 0.5;
  let w0 = 0;
  if (k > 0 && u < blendZone) w0 = smooth((blendZone - u) / blendZone) * 0.5;
  const idx = [boneIndex[names[k]], k < n - 1 ? boneIndex[names[k + 1]] : 0, k > 0 ? boneIndex[names[k - 1]] : 0, 0];
  const w = [1 - w1 - w0, w1, w0, 0];
  return { idx, w };
}
function buildLayer(name, spec, texName, tint, order) {
  const lay = rig.layers[texName];
  const [x0, y0, x1, y1] = lay.bbox;
  const tl = toW([x0, y0]), br = toW([x1, y1]);
  const wW = br.x - tl.x, hW = tl.y - br.y;
  const mat = new THREE.MeshBasicMaterial({ map: layerMeshes[texName + '#tex'], transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02, color: new THREE.Color(tint, tint, tint) });
  let mesh;
  if (spec.rigid) {
    const geo = new THREE.PlaneGeometry(wW, hW, 1, 1);
    const bone = bones[spec.rigid], h = bone.userData.head;
    geo.translate(tl.x + wW / 2 - h.x, br.y + hW / 2 - h.y, 0);   // bone-local at rest (bone axes = world axes at rest)
    mesh = new THREE.Mesh(geo, mat);
    bone.add(mesh);
  } else {
    const [cols, rows] = spec.grid || [6, 6];
    const geo = new THREE.PlaneGeometry(wW, hW, cols, rows);
    geo.translate(tl.x + wW / 2, br.y + hW / 2, 0);
    const pos = geo.attributes.position, n = pos.count;
    const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
    const names = spec.chain, poly = chainPolyline(names);
    const above = spec.rigid_above != null ? toW([0, spec.rigid_above]).y : null;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector2(pos.getX(i), pos.getY(i));
      let r;
      if (above != null && p.y > above) r = { idx: [boneIndex[names[0]], 0, 0, 0], w: [1, 0, 0, 0] };
      else r = chainWeights(p, poly, names);
      si.set(r.idx, i * 4); sw.set(r.w, i * 4);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bind(skeleton, new THREE.Matrix4());
    scene.add(mesh);
  }
  mesh.renderOrder = order; mesh.frustumCulled = false; mesh.name = name;
  layerMeshes[name] = mesh;
  return mesh;
}
for (const name of rig.order) layerMeshes[name + '#tex'] = await loadTex(rig.layers[name].file);
for (const [i, name] of drawOrder.entries()) {
  const dup = rig.duplicates.find((d) => d.name === name);
  if (dup) buildLayer(name, dup, dup.from, dup.tint ?? 1, i);
  else buildLayer(name, rig.attach[name] || { rigid: 'head' }, name, 1, i);
}
for (const k of ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth']) facePieces[k] = layerMeshes[k];
const eyeC = toW(rig.eyes.center), mouthC = toW(rig.mouth.center), headH = bones.head.userData.head;
// pivot face pieces about their own centres (they are bone-local meshes: shift geometry, move mesh)
for (const k of Object.keys(facePieces)) {
  const m = facePieces[k]; const c = k === 'mouth' ? mouthC : eyeC;
  m.geometry.translate(-(c.x - headH.x), -(c.y - headH.y), 0); m.position.set(c.x - headH.x, c.y - headH.y, 0);
  m.userData.base = m.position.clone();
}
group.position.set(S_.x, -VIEW_H / 2 + 0.03 - FLOOR_Y, 0); // feet on the window floor
const GROUND_Y = group.position.y;
group.scale.x = S_.facing;

// ------------------------------------------------------------------ springs
const springs = Object.values(rig.springs);
function stepSprings(dt) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const sp of springs) {
    for (const name of sp.bones) {
      const b = bones[name], u = b.userData;
      b.getWorldPosition(v);
      const prev = S_.prevPos.get(name);
      let vx = 0, vy = 0;
      if (prev && dt > 0) { vx = (v.x - prev.x) / dt; vy = (v.y - prev.y) / dt; }
      S_.prevPos.set(name, v.clone());
      // torque: spring back to rest, damping, and lag against the bone's own motion (mirrored with facing)
      const drive = sp.inertia * (-vx * S_.facing * 0.9 + vy * 0.5);
      const acc = -sp.stiffness * u.spring - sp.damping * u.springVel + drive;
      u.springVel += acc * dt;
      u.spring = clamp(u.spring + u.springVel * dt, -sp.limit, sp.limit);
    }
  }
}

// ------------------------------------------------------------------ actions
const A = {};
const poseReset = () => { for (const b of boneList) b.userData.pose = 0; S_.rootY = 0; S_.rootRot = 0; S_.rootX = 0; S_.eyesClosed = 0; S_.mouthOpen = 0; S_.irisOff = [0, 0]; S_.speed = 0; };
const walkCycle = (tau, f, amp, knee, armAmp) => {
  const ph = 2 * Math.PI * f * tau;
  const fwd = S_.facing;                       // -1: forward is -x. rotation.z positive = CCW; a down-pointing leg swings to +x with +rot
  bones.thigh_near.userData.pose = fwd * amp * Math.sin(ph);
  bones.thigh_far.userData.pose = fwd * amp * Math.sin(ph + Math.PI);
  bones.shin_near.userData.pose = -fwd * knee * Math.max(0, Math.sin(ph + 0.9));
  bones.shin_far.userData.pose = -fwd * knee * Math.max(0, Math.sin(ph + Math.PI + 0.9));
  bones.upper_arm_near.userData.pose = -fwd * armAmp * Math.sin(ph);
  bones.upper_arm_far.userData.pose = fwd * armAmp * Math.sin(ph);
  bones.forearm_near.userData.pose = -fwd * 0.25 * (1 + Math.sin(ph));
  bones.forearm_far.userData.pose = fwd * 0.25 * (1 - Math.sin(ph));
  S_.rootY = 0.012 * Math.abs(Math.sin(ph));
  bones.chest.userData.pose = fwd * 0.04 * Math.sin(2 * ph);
  bones.head.userData.pose = -fwd * 0.03 * Math.sin(2 * ph + 0.5);
};
A.idle = (tau) => {
  poseReset();
  bones.chest.userData.pose = 0.025 * Math.sin(tau * 1.6);
  bones.head.userData.pose = 0.03 * Math.sin(tau * 0.8 + 1) + S_.look.yaw * 0.25;
  bones.upper_arm_near.userData.pose = 0.03 * Math.sin(tau * 1.6 + 0.4);
  bones.upper_arm_far.userData.pose = -0.03 * Math.sin(tau * 1.6 + 0.4);
  S_.rootY = 0.004 * Math.sin(tau * 1.6);
  S_.irisOff = [S_.look.yaw * 5, S_.look.pitch * 3];
};
A.walk = (tau) => { poseReset(); walkCycle(tau, 1.9, 0.5, 0.75, 0.35); S_.speed = 0.32; };
A.run = (tau) => { poseReset(); walkCycle(tau, 3.0, 0.75, 1.2, 0.7); S_.speed = 0.7; bones.hips.userData.pose = -S_.facing * 0.12; S_.rootY += 0.02 * Math.abs(Math.sin(2 * Math.PI * 3.0 * tau)); };
A.hop = (tau) => {
  poseReset();
  const T = 0.7, t = tau % T, u = t / T;
  S_.rootY = 0.42 * 4 * u * (1 - u);
  const tuck = Math.sin(Math.PI * u);
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = S_.facing * 0.7 * tuck; bones['shin_' + s].userData.pose = -S_.facing * 1.1 * tuck; }
  bones.upper_arm_near.userData.pose = -S_.facing * 1.6 * tuck; bones.upper_arm_far.userData.pose = -S_.facing * 1.6 * tuck;
  bones.chest.userData.pose = S_.facing * 0.1 * tuck;
};
A.wave = (tau) => {
  poseReset();
  const up = smooth(clamp(tau / 0.35, 0, 1));
  bones.upper_arm_near.userData.pose = 2.55 * up;              // arm goes from hanging to raised (rotating through the back)
  bones.forearm_near.userData.pose = up * (0.3 + 0.55 * Math.sin(tau * 9));
  bones.hand_near.userData.pose = up * 0.3 * Math.sin(tau * 9 + 0.5);
  bones.head.userData.pose = 0.06 * Math.sin(tau * 2);
  bones.chest.userData.pose = -0.03 * up;
};
A.look = (tau) => {
  poseReset();
  const yaw = Math.sin(tau * 1.2), pitch = 0.5 * Math.sin(tau * 0.7);
  bones.head.userData.pose = 0.22 * yaw; bones.neck.userData.pose = 0.06 * yaw;
  S_.irisOff = [-6 * yaw, 3 * pitch];
  bones.chest.userData.pose = 0.02 * Math.sin(tau * 1.6);
};
A.talk = (tau) => {
  A.idle(tau);
  S_.mouthOpen = 0.35 + 0.65 * Math.abs(Math.sin(tau * 11) * Math.sin(tau * 3.7 + 1));
  bones.head.userData.pose += 0.04 * Math.sin(tau * 3.1);
};
A.sit = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 0.6, 0, 1));
  const L = bones.thigh_near.userData.len;
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = S_.facing * -1.45 * u; bones['shin_' + s].userData.pose = S_.facing * 1.35 * u; }
  S_.rootY = -L * 0.92 * u;
  bones.chest.userData.pose = S_.facing * -0.06 * u; bones.head.userData.pose = 0.02 * Math.sin(tau * 1.3);
  bones.upper_arm_near.userData.pose = S_.facing * -0.35 * u; bones.forearm_near.userData.pose = S_.facing * -0.9 * u;
  bones.upper_arm_far.userData.pose = S_.facing * -0.35 * u; bones.forearm_far.userData.pose = S_.facing * -0.9 * u;
  bones.chest.userData.pose += 0.02 * Math.sin(tau * 1.6);
};
A.sleep = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 1.0, 0, 1));
  S_.rootRot = -S_.facing * (Math.PI / 2) * u;                 // lie down with the head toward her front
  S_.rootY = 0.0 + 0.16 * u;
  S_.rootX = -S_.facing * 0.85 * u;                             // she pivots at the feet: slide so the lying body stays in frame
  S_.eyesClosed = u;
  bones.chest.userData.pose = 0.03 * Math.sin(tau * 0.9);
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = S_.facing * -0.35 * u; bones['shin_' + s].userData.pose = S_.facing * 0.5 * u; }
  bones.upper_arm_near.userData.pose = S_.facing * -0.6 * u; bones.forearm_near.userData.pose = S_.facing * -0.8 * u;
  bones.upper_arm_far.userData.pose = S_.facing * -0.5 * u; bones.forearm_far.userData.pose = S_.facing * -0.7 * u;
  bones.head.userData.pose = S_.facing * 0.12 * u;
};
A.wake = (tau) => { const u = 1 - smooth(clamp(tau / 1.0, 0, 1)); A.sleep(1.0); S_.rootRot *= u; S_.rootY *= u; S_.rootX *= u; S_.eyesClosed = u; for (const b of boneList) b.userData.pose *= u; if (u <= 0) A.idle(tau); };
A.turn = (tau) => { A.idle(tau); if (!S_.turn) S_.turn = { t0: S_.t, from: S_.facing }; };
A.stretch = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 0.6, 0, 1)) * (1 - smooth(clamp((tau - 1.8) / 0.5, 0, 1)));
  bones.upper_arm_near.userData.pose = 2.9 * u; bones.upper_arm_far.userData.pose = 2.9 * u;
  bones.chest.userData.pose = S_.facing * 0.12 * u; bones.head.userData.pose = S_.facing * 0.2 * u; S_.rootY = 0.03 * u;
  S_.eyesClosed = 0.8 * u; S_.mouthOpen = 0.6 * u;
};
A.celebrate = (tau) => { A.hop(tau); bones.upper_arm_near.userData.pose = 2.8; bones.upper_arm_far.userData.pose = 2.8; bones.forearm_near.userData.pose = 0.4 * Math.sin(tau * 12); bones.forearm_far.userData.pose = -0.4 * Math.sin(tau * 12); };
A.tail_react = (tau) => { A.idle(tau); const k = Math.exp(-tau * 1.2) * Math.sin(tau * 9); for (const [i, n] of ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'].entries()) bones[n].userData.pose = 0.35 * k * (0.4 + i * 0.15); };
A.stumble = (tau) => { A.idle(tau); const u = Math.sin(Math.min(tau, 0.6) / 0.6 * Math.PI); bones.hips.userData.pose = S_.facing * 0.35 * u; bones.chest.userData.pose = S_.facing * 0.25 * u; S_.eyesClosed = 0.5 * u; S_.mouthOpen = 0.7 * u; S_.rootY = -0.05 * u; };
const ACTIONS = Object.keys(A);

const EMO = {
  neutral: { browRot: 0, browY: 0, eyeScale: 1, mouthW: 1, mouthH: 1, closed: 0 },
  happy: { browRot: -0.08, browY: 2, eyeScale: 0.32, mouthW: 1.5, mouthH: 1.3, closed: 0 },
  sad: { browRot: 0.35, browY: -1, eyeScale: 0.85, mouthW: 0.8, mouthH: 0.7, closed: 0 },
  angry: { browRot: -0.45, browY: -4, eyeScale: 0.8, mouthW: 1.1, mouthH: 0.6, closed: 0 },
  surprised: { browRot: 0.1, browY: 6, eyeScale: 1.25, mouthW: 1.2, mouthH: 2.0, closed: 0 },
  think: { browRot: 0.15, browY: 3, eyeScale: 0.95, mouthW: 0.9, mouthH: 0.8, closed: 0 },
  awkward: { browRot: 0.25, browY: 0, eyeScale: 0.9, mouthW: 1.3, mouthH: 0.5, closed: 0 },
  question: { browRot: 0.2, browY: 4, eyeScale: 1.05, mouthW: 0.9, mouthH: 1.2, closed: 0 },
  curious: { browRot: 0.05, browY: 3, eyeScale: 1.1, mouthW: 1.0, mouthH: 1.1, closed: 0 },
};
const emoCur = { ...EMO.neutral };
function applyFace(dt) {
  const target = EMO[S_.emotion] || EMO.neutral;
  const k = 1 - Math.exp(-dt * 10);
  for (const key of Object.keys(target)) emoCur[key] = lerp(emoCur[key], target[key], k);
  // blink
  S_.blink.next -= dt;
  if (S_.blink.next <= 0 && S_.blink.phase === 0) { S_.blink.phase = 0.001; S_.blink.next = 1.8 + Math.random() * 3.2; }
  if (S_.blink.phase > 0) { S_.blink.phase += dt; if (S_.blink.phase > 0.22) S_.blink.phase = 0; }
  const blinkAmt = S_.blink.phase > 0 ? Math.sin(Math.PI * clamp(S_.blink.phase / 0.22, 0, 1)) : 0;
  const closed = clamp(Math.max(blinkAmt, S_.eyesClosed || 0), 0, 1);
  const eyeY = Math.max(0.06, emoCur.eyeScale * (1 - closed));
  const px = S * 1;   // 1 px in world units
  const [ix, iy] = S_.irisOff || [0, 0];
  for (const k of ['eyewhite', 'irides', 'eyelash']) { const m = facePieces[k]; if (!m) continue; m.scale.set(1, eyeY, 1); m.position.copy(m.userData.base); }
  if (facePieces.irides) facePieces.irides.position.add(new THREE.Vector3(ix * px, iy * px, 0));
  if (facePieces.eyelash) facePieces.eyelash.position.y -= (1 - eyeY) * 6 * px;
  if (facePieces.eyebrow) { const m = facePieces.eyebrow; m.rotation.z = emoCur.browRot * S_.facing; m.position.copy(m.userData.base); m.position.y += emoCur.browY * px; }
  if (facePieces.mouth) { const m = facePieces.mouth; m.scale.set(emoCur.mouthW, emoCur.mouthH * (1 + 2.2 * (S_.mouthOpen || 0)), 1); }
}

// ------------------------------------------------------------------ frame
function applyPose() {
  for (const b of boneList) b.rotation.z = b.userData.pose + b.userData.spring;
  bones.root.position.set(restHead.root.x, restHead.root.y + (S_.rootY || 0), 0);
  bones.root.rotation.z = S_.rootRot || 0;
}
function tick(dt) {
  S_.dt = dt; S_.t += dt; S_.tau += dt;
  const fn = A[S_.action] || A.idle;
  fn(S_.tau);
  // locomotion
  if (S_.speed && !S_.turn) {
    S_.x += S_.facing * S_.speed * dt;
    // she spans ~0.4 units ahead of the hips and ~0.8 behind (the tail); keep both inside the window
    const halfW = VIEW_H * aspect / 2, ahead = 0.42, behind = 0.82;
    const front = S_.facing < 0 ? -halfW + ahead : halfW - ahead;
    const back = S_.facing < 0 ? halfW - behind : -halfW + behind;
    if (S_.facing < 0 ? S_.x < front : S_.x > front) { S_.x = front; S_.turn = { t0: S_.t, from: S_.facing }; }
    if (S_.facing < 0 ? S_.x > back : S_.x < back) S_.x = back;
  }
  if (S_.turn) {
    const u = (S_.t - S_.turn.t0) / 0.28;
    if (u >= 1) { S_.facing = -S_.turn.from; group.scale.x = S_.facing; S_.turn = null; if (S_.action === 'turn') S_.action = 'idle'; }
    else group.scale.x = S_.turn.from * Math.max(0.05, Math.abs(Math.cos(Math.PI * u))) * (u < 0.5 ? 1 : -1);
  }
  group.position.x = S_.x + (S_.rootX || 0); group.position.y = GROUND_Y;
  applyPose();
  stepSprings(dt);
  applyPose();
  applyFace(dt);
  group.updateMatrixWorld(true);
}
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - S_.lastFrame) / 1000); S_.lastFrame = now;
  if (!S_.paused) tick(dt);
  renderer.render(scene, camera);
  S_.fps.push(dt); if (S_.fps.length > 120) S_.fps.shift();
  if (S_.hudOn) hud.textContent = `side rig  ${(S_.fps.length / S_.fps.reduce((a, b) => a + b, 0)).toFixed(0)} fps  action ${S_.action} ${S_.tau.toFixed(1)}s  facing ${S_.facing > 0 ? '+x' : '-x'}  emotion ${S_.emotion}\n` +
    `[I] idle [W] walk [R] run [H] hop [V] wave [L] look [T] talk [S] sit [Z] sleep [K] wake [F] turn [X] stretch [C] celebrate [B] tail [U] stumble\n[1-9] neutral happy sad angry surprised think awkward question curious  [Space] stop  [G] hud`;
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ control surface
const lab = window.lab = {
  info: () => ({ bones: boneList.length, layers: Object.keys(layerMeshes).filter((k) => !k.endsWith('#tex')).length, actions: ACTIONS, emotions: Object.keys(EMO) }),
  actions: () => ACTIONS,
  start(name) { if (!A[name]) throw new Error('unknown action ' + name); S_.action = name; S_.tau = 0; if (name === 'turn') S_.turn = null; return { name }; },
  begin(name) { lab.start(name); S_.t = 0; S_.x = -0.15; S_.facing = -1; group.scale.x = -1; S_.turn = null; S_.blink.next = 9; S_.blink.phase = 0; for (const b of boneList) { b.userData.spring = 0; b.userData.springVel = 0; } S_.prevPos.clear(); return { name }; },
  step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) tick(1 / 60); renderer.render(scene, camera); },
  stop() { S_.action = 'idle'; S_.tau = 0; },
  pause(v) { S_.paused = !!v; },
  hud(v) { S_.hudOn = !!v; hud.style.display = v ? 'block' : 'none'; },
  emotion(name) { if (!EMO[name]) throw new Error('unknown emotion ' + name); S_.emotion = name; },
  look(yaw, pitch) { S_.look.yaw = clamp(yaw || 0, -1, 1); S_.look.pitch = clamp(pitch || 0, -1, 1); },
  snapshot: () => ({ action: S_.action, tau: +S_.tau.toFixed(2), x: +S_.x.toFixed(3), facing: S_.facing, rootY: +(S_.rootY || 0).toFixed(3), springs: Object.fromEntries(springs.flatMap((s) => s.bones).map((n) => [n, +bones[n].userData.spring.toFixed(3)])) }),
  fps: () => +(S_.fps.length / S_.fps.reduce((a, b) => a + b, 0)).toFixed(1),
};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const em = { 1: 'neutral', 2: 'happy', 3: 'sad', 4: 'angry', 5: 'surprised', 6: 'think', 7: 'awkward', 8: 'question', 9: 'curious' }[k];
  const act = { i: 'idle', w: 'walk', r: 'run', h: 'hop', v: 'wave', l: 'look', t: 'talk', s: 'sit', z: 'sleep', k: 'wake', f: 'turn', x: 'stretch', c: 'celebrate', b: 'tail_react', u: 'stumble' }[k];
  try {
    if (em) lab.emotion(em); else if (act) lab.start(act); else if (k === ' ') lab.stop(); else if (k === 'g') lab.hud(!S_.hudOn);
  } catch (err) { window.__error = String(err.stack || err); }
});
window.addEventListener('error', (e) => { window.__error = String(e.error?.stack || e.message); });
window.addEventListener('unhandledrejection', (e) => { window.__error = String(e.reason?.stack || e.reason); });
lab.hud(true);
requestAnimationFrame(frame);
window.__ready = true;
