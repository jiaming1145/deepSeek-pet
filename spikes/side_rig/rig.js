// Layered 2D rig on three.js. Layers come from See-through (spikes/side_rig/assets*), bones from build_rig.py
// (rig*.json). Rigid layers are plain meshes parented to a bone; chain layers (tail, hair, skirt, limbs, torso) are
// SkinnedMesh grids weighted along their bone chain. Motion is procedural: actions pose the bones, springs lag the
// chains. Two views share one stage: the side rig for locomotion and the front rig (face kit mounted on its head)
// for facing actions; the compositor swaps them with a squash. Stage = world units, STAGE.k px per unit, x from the
// window's left edge, y up from the floor (her feet rest at y = STAGE.margin). S_.facing: +1 = she faces screen-right.
import * as THREE from 'three';
import { FaceKit } from './facekit.js';

const S = 1 / 384;                       // canvas px -> world units (canvas 768 px = 2 units)
const toW = (p) => new THREE.Vector2((p[0] - 384) * S, (384 - p[1]) * S);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const Q = new URLSearchParams(location.search);
const RIG_FILE = Q.get('rig') || 'rig.json';
const FRONT_FILE = Q.get('front') || null;
const HEIGHT_PX = +Q.get('height') || 0;                    // her standing height in px (pet mode); 0 = lab framing (window = 2.85 units)
const FLOOR_PX = Q.has('floor') ? +Q.get('floor') : null;   // feet this many px above the window bottom (lab: 0.03 units)

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
camera.position.z = 5;
const STAGE = { k: window.innerHeight / 2.85, w: 0, h: 0, margin: 0.03 };
function fitCamera() {
  STAGE.w = window.innerWidth / STAGE.k; STAGE.h = window.innerHeight / STAGE.k;
  camera.left = 0; camera.right = STAGE.w; camera.top = STAGE.h; camera.bottom = 0; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
fitCamera();
const toPx = (x, y) => [x * STAGE.k, window.innerHeight - y * STAGE.k];
const toUnits = (px, py) => [px / STAGE.k, (window.innerHeight - py) / STAGE.k];

const S_ = { t: 0, dt: 0, paused: false, hudOn: true, action: 'idle', tau: 0, facing: 1, x: 0, y: 0, vx: 0, vy: 0, held: null, emotion: 'neutral',
  blink: { next: 2.2, phase: 0 }, look: { yaw: 0, pitch: 0 }, fps: [], lastFrame: performance.now(), prevPos: new Map(), turn: null, blend: null, next: null, squash: 0, landed: 0 };
const G = 14;                            // gravity for drops and throws, units/s^2
const tickHooks = [];

// ------------------------------------------------------------------ layers
const loader = new THREE.TextureLoader();
const loadTex = (file) => new Promise((res, rej) => loader.load(`./${ASSETS}/` + file, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; res(t); }, undefined, rej));

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

// ------------------------------------------------------------------ views (side + front share the stage)
let rig, group, bones, boneList, restHead, skeleton, boneIndex, layerMeshes, facePieces, FLOOR_Y, GROUND_Y, springs, ASSETS, VIEW_NAME, NATIVE;
let kit = null;                          // face kit, mounted on the front view's head
const VIEWS = {};
const groundFor = (view) => STAGE.margin - view.floorY;
const isFront = () => VIEW_NAME === 'front';
// mirror sign of the active group: the side art faces -x natively, so facing +1 (screen-right) mirrors it
const mirrorFor = (view) => (view.native ? S_.facing * view.native : 1);
const M = () => mirrorFor(VIEWS[VIEW_NAME]);
const farSign = () => (isFront() ? -1 : 1);   // front view: the far arm (her right, screen-left) mirrors the near one

async function buildView(name, file) {
  const rigJ = await (await fetch('./' + file)).json();
  const floorY = toW([0, rigJ.floor]).y;
  const grp = new THREE.Group();
  scene.add(grp);
  const B = {}, list = [], rest = {};
  for (const b of rigJ.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    const h = toW(b.head), t = toW(b.tail);
    rest[b.name] = h;
    bone.userData = { head: h, tail: t, len: h.distanceTo(t), pose: 0, sy: 1, spring: 0, springVel: 0, dir: Math.atan2(t.y - h.y, t.x - h.x) };
    if (b.parent) { const ph = rest[b.parent]; bone.position.set(h.x - ph.x, h.y - ph.y, 0); B[b.parent].add(bone); }
    else { bone.position.set(h.x, h.y, 0); grp.add(bone); }
    B[b.name] = bone; list.push(bone);
  }
  for (const part of ['thigh', 'shin', 'foot', 'upper_arm', 'forearm', 'hand']) {
    if (!B[part + '_near'] && B[part + '_l']) { B[part + '_near'] = B[part + '_l']; B[part + '_far'] = B[part + '_r'] || B[part + '_l']; }
  }
  for (const n of ['thigh_near', 'thigh_far', 'shin_near', 'shin_far', 'foot_near', 'foot_far', 'upper_arm_near', 'upper_arm_far', 'forearm_near', 'forearm_far', 'hand_near', 'hand_far', 'chest', 'neck', 'head', 'hips']) {
    if (!B[n]) { B[n] = new THREE.Bone(); B[n].userData = { head: new THREE.Vector2(), tail: new THREE.Vector2(), len: 0.3, pose: 0, sy: 1, spring: 0, springVel: 0 }; }
  }
  for (let i = 1; i <= 6; i++) if (!B['tail_' + i]) { B['tail_' + i] = new THREE.Bone(); B['tail_' + i].userData = { pose: 0, sy: 1, spring: 0, springVel: 0 }; }
  grp.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(list);
  const xs = [], ys = [];
  for (const l of Object.values(rigJ.layers)) { const a = toW([l.bbox[0], l.bbox[1]]), b = toW([l.bbox[2], l.bbox[3]]); xs.push(a.x, b.x); ys.push(a.y, b.y); }
  const restBox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const view = { name, rig: rigJ, group: grp, bones: B, boneList: list, restHead: rest, skeleton: skel, boneIndex: Object.fromEntries(list.map((b, i) => [b.name, i])),
    layerMeshes: {}, facePieces: {}, floorY, assets: rigJ.assets || 'assets', springs: Object.values(rigJ.springs || {}), meshes: [], restBox,
    heightUnits: restBox.maxY - floorY, native: rigJ.facing === '-x' ? -1 : rigJ.facing === '+x' ? 1 : 0 };
  const prev = current();
  activate(view);
  const drawOrder = [...rigJ.order];
  for (const d of rigJ.duplicates || []) { const at = drawOrder.indexOf(d.z_before); drawOrder.splice(at < 0 ? 0 : at, 0, d.name); }
  for (const nm of Object.keys(rigJ.layers)) layerMeshes[nm + '#tex'] = await loadTex(rigJ.layers[nm].file);
  for (const [i, nm] of drawOrder.entries()) {
    const dup = (rigJ.duplicates || []).find((d) => d.name === nm);
    view.meshes.push(dup ? buildLayer(nm, dup, dup.from, dup.tint ?? 1, i) : buildLayer(nm, rigJ.attach[nm] || { rigid: 'head' }, nm, 1, i));
  }
  for (const k of ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth']) facePieces[k] = layerMeshes[k];
  const eyeC = toW(rigJ.eyes.center), mouthC = toW(rigJ.mouth.center), headH = bones.head.userData.head || new THREE.Vector2();
  for (const k of Object.keys(facePieces)) {
    const m = facePieces[k]; if (!m) continue;
    const c = k === 'mouth' ? mouthC : eyeC;
    m.geometry.translate(-(c.x - headH.x), -(c.y - headH.y), 0); m.position.set(c.x - headH.x, c.y - headH.y, 0);
    m.userData.base = m.position.clone();
  }
  if (name === 'front' && rigJ.canonical_to_canvas) await mountKit(view, drawOrder.indexOf('face'));
  grp.position.set(S_.x, groundFor(view), 0);
  view.groundY = grp.position.y;
  grp.scale.x = mirrorFor(view);
  VIEWS[name] = view;
  activate(prev || view);
  return view;
}
async function mountKit(view, faceOrder) {
  // the face kit's pieces live in neutral.png px; neutral.png is a crop of the 4096x8192 canonical, and the front
  // layers were decomposed from a crop of the same canonical (rig.canonical_to_canvas) - so kit px -> canvas px is affine
  const map = view.rig.canonical_to_canvas, hh = view.bones.head.userData.head;
  const k = new FaceKit({ base: '../model/face', parent: view.bones.head, pxScale: map.scale * S, renderOrder: faceOrder + 0.5,
    place: (u, v) => { const [cx, cy] = k.atlas.face.canonical_crop_box; const w = toW([(u + cx) * map.scale + map.offset[0], (v + cy) * map.scale + map.offset[1]]); return new THREE.Vector3(w.x - hh.x, w.y - hh.y, 0); } });
  try { await k.load(); } catch (e) { console.warn('face kit not mounted: ' + (e.message || e)); return; }
  kit = k; view.kit = k;
  for (const n of ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth', 'nose']) if (view.layerMeshes[n]) view.layerMeshes[n].visible = false;
  view.facePieces = {};
}
function current() { return VIEW_NAME ? VIEWS[VIEW_NAME] : null; }
function activate(view) {
  VIEW_NAME = view.name; rig = view.rig; group = view.group; bones = view.bones; boneList = view.boneList; restHead = view.restHead;
  skeleton = view.skeleton; boneIndex = view.boneIndex; layerMeshes = view.layerMeshes; facePieces = view.facePieces;
  FLOOR_Y = view.floorY; GROUND_Y = view.groundY; springs = view.springs; ASSETS = view.assets; NATIVE = view.native;
}
function showOnly(name) {
  for (const v of Object.values(VIEWS)) { const on = v.name === name; v.group.visible = on; for (const m of v.meshes) if (m.isSkinnedMesh) m.visible = on; }
}
function placeViews() { for (const v of Object.values(VIEWS)) { v.groundY = groundFor(v); v.group.position.y = v.groundY; } if (VIEW_NAME) GROUND_Y = VIEWS[VIEW_NAME].groundY; }
window.addEventListener('resize', () => { fitCamera(); placeViews(); });

// ------------------------------------------------------------------ springs
function stepSprings(dt) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3(), m = M();
  for (const sp of springs) {
    for (const name of sp.bones) {
      const b = bones[name], u = b.userData;
      b.getWorldPosition(v);
      const prev = S_.prevPos.get(name);
      let vx = 0, vy = 0;
      if (prev && dt > 0) { vx = (v.x - prev.x) / dt; vy = (v.y - prev.y) / dt; }
      S_.prevPos.set(name, v.clone());
      // torque: spring back to rest, damping, and lag against the bone's own motion (in the group's mirrored frame)
      const drive = sp.inertia * (-vx * m * 0.9 + vy * 0.5);
      const acc = -sp.stiffness * u.spring - sp.damping * u.springVel + drive;
      u.springVel += acc * dt;
      u.spring = clamp(u.spring + u.springVel * dt, -sp.limit, sp.limit);
    }
  }
}

// ------------------------------------------------------------------ actions (poses are in the group's local frame; M() = its mirror)
const A = {};
const poseReset = () => { for (const b of boneList) { b.userData.pose = 0; b.userData.sy = 1; } S_.rootY = 0; S_.rootRot = 0; S_.rootX = 0; S_.rootScale = 1; S_.squash = 0; S_.eyesClosed = 0; S_.mouthOpen = 0; S_.irisOff = [0, 0]; S_.speed = 0; };
const legLen = () => (bones.thigh_near.userData.len || 0.4) + (bones.shin_near.userData.len || 0.2);
const strideSpeed = (f, amp) => 4 * f * legLen() * Math.sin(amp) * 0.7;   // feet plant without sliding (0.7: the knee shortens the swing)
const lookIris = () => { S_.irisOff = [(isFront() ? S_.look.yaw : S_.look.yaw * M()) * 6, S_.look.pitch * 3]; };
const tailSway = (tau, amp) => { for (let i = 1; i <= 6; i++) if (bones['tail_' + i].userData.head) bones['tail_' + i].userData.pose = amp * Math.sin(tau * 1.3 + i * 0.35); };
const walkCycle = (tau, f, amp, knee, armAmp) => {
  const ph = 2 * Math.PI * f * tau;
  const fwd = M();
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
  if (isFront()) {
    bones.chest.userData.sy = 1 + 0.018 * Math.sin(tau * 1.6);
    bones.head.userData.pose = 0.025 * Math.sin(tau * 0.8 + 1) - S_.look.yaw * 0.1;
    tailSway(tau, 0.05);
  } else {
    bones.chest.userData.pose = 0.025 * Math.sin(tau * 1.6);
    bones.head.userData.pose = 0.03 * Math.sin(tau * 0.8 + 1) + S_.look.pitch * 0.2;
  }
  bones.upper_arm_near.userData.pose = 0.03 * Math.sin(tau * 1.6 + 0.4);
  bones.upper_arm_far.userData.pose = -0.03 * Math.sin(tau * 1.6 + 0.4);
  S_.rootY = 0.004 * Math.sin(tau * 1.6);
  lookIris();
};
A.walk = (tau) => { poseReset(); walkCycle(tau, 1.1, 0.38, 0.75, 0.3); S_.speed = strideSpeed(1.1, 0.38); };
A.run = (tau) => { poseReset(); walkCycle(tau, 2.0, 0.55, 1.2, 0.7); S_.speed = strideSpeed(2.0, 0.55); bones.hips.userData.pose = -M() * 0.12; S_.rootY += 0.02 * Math.abs(Math.sin(2 * Math.PI * 2.0 * tau)); };
A.hop = (tau) => {
  poseReset();
  const T = 0.7, t = tau % T, u = t / T;
  S_.rootY = 0.42 * 4 * u * (1 - u);
  const tuck = Math.sin(Math.PI * u), m = M();
  if (isFront()) for (const s of ['near', 'far']) { bones['thigh_' + s].userData.sy = 1 - 0.35 * tuck; bones['shin_' + s].userData.sy = 1 / (1 - 0.35 * tuck); }
  else for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.7 * tuck; bones['shin_' + s].userData.pose = -m * 1.1 * tuck; }
  const up = isFront() ? 1 : -m;
  bones.upper_arm_near.userData.pose = up * 1.6 * tuck; bones.upper_arm_far.userData.pose = up * 1.6 * tuck * farSign();
  bones.chest.userData.pose = isFront() ? 0 : m * 0.1 * tuck;
};
A.wave = (tau) => {
  poseReset();
  const up = smooth(clamp(tau / 0.35, 0, 1));
  bones.upper_arm_near.userData.pose = (isFront() ? 1.95 : 2.55) * up;   // side: raised through the back; front: outward diagonal so it clears the hair
  bones.forearm_near.userData.pose = up * (0.3 + 0.55 * Math.sin(tau * 9));
  bones.hand_near.userData.pose = up * 0.3 * Math.sin(tau * 9 + 0.5);
  bones.head.userData.pose = (isFront() ? -0.06 : 0.06) * Math.sin(tau * 2) * up + (isFront() ? -0.08 * up : 0);
  bones.chest.userData.pose = (isFront() ? 0.03 : -0.03) * up;
  if (isFront()) tailSway(tau, 0.08);
  lookIris();
};
A.look = (tau) => {
  poseReset();
  const yaw = Math.sin(tau * 1.2), pitch = 0.5 * Math.sin(tau * 0.7);
  if (isFront()) { bones.head.userData.pose = -0.14 * yaw; bones.neck.userData.pose = -0.03 * yaw; S_.look.yaw = yaw; S_.look.pitch = pitch; tailSway(tau, 0.05); }
  else { bones.head.userData.pose = 0.22 * yaw; bones.neck.userData.pose = 0.06 * yaw; }
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
  const u = smooth(clamp(tau / 0.6, 0, 1)), m = M();
  const L = bones.thigh_near.userData.len;
  if (isFront()) {
    // facing the viewer: thighs foreshorten (knees come toward the camera), shins splay a little, hands on the lap
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.sy = 1 - 0.55 * u; bones['shin_' + s].userData.sy = 1 / (1 - 0.55 * u); }
    bones.shin_near.userData.pose = 0.22 * u; bones.shin_far.userData.pose = -0.22 * u;
    bones.foot_near.userData.pose = 0.35 * u; bones.foot_far.userData.pose = -0.35 * u;
    S_.rootY = -L * 0.55 * u;
    bones.upper_arm_near.userData.pose = -0.3 * u; bones.forearm_near.userData.pose = -0.7 * u;
    bones.upper_arm_far.userData.pose = 0.3 * u; bones.forearm_far.userData.pose = 0.7 * u;
    bones.chest.userData.sy = 1 + 0.015 * Math.sin(tau * 1.6);
    tailSway(tau, 0.05);
  } else {
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * -1.45 * u; bones['shin_' + s].userData.pose = m * 1.35 * u; }
    S_.rootY = -L * 0.92 * u;
    bones.chest.userData.pose = m * -0.06 * u;
    bones.upper_arm_near.userData.pose = m * -0.35 * u; bones.forearm_near.userData.pose = m * -0.9 * u;
    bones.upper_arm_far.userData.pose = m * -0.35 * u; bones.forearm_far.userData.pose = m * -0.9 * u;
    bones.chest.userData.pose += 0.02 * Math.sin(tau * 1.6);
  }
  bones.head.userData.pose = 0.02 * Math.sin(tau * 1.3);
  lookIris();
};
A.sleep = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 1.0, 0, 1)), m = M();
  S_.rootRot = -m * (Math.PI / 2) * u;                 // lie down with the head toward her front
  S_.rootY = 0.0 + 0.16 * u;
  S_.rootX = m * 0.82 * u;                              // pivot is at the feet: slide so the lying body stays where she stood
  S_.rootScale = 1 - 0.08 * u;
  S_.eyesClosed = u;
  bones.chest.userData.pose = 0.03 * Math.sin(tau * 0.9);
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * -0.35 * u; bones['shin_' + s].userData.pose = m * 0.5 * u; }
  bones.upper_arm_near.userData.pose = m * -0.6 * u; bones.forearm_near.userData.pose = m * -0.8 * u;
  bones.upper_arm_far.userData.pose = m * -0.5 * u; bones.forearm_far.userData.pose = m * -0.7 * u;
  bones.head.userData.pose = m * 0.12 * u;
};
A.wake = (tau) => { const u = 1 - smooth(clamp(tau / 1.0, 0, 1)); A.sleep(1.0); S_.rootRot *= u; S_.rootY *= u; S_.rootX *= u; S_.rootScale = 1 - 0.08 * u; S_.eyesClosed = u; for (const b of boneList) b.userData.pose *= u; if (u <= 0) { A.idle(tau); S_.next = 'idle'; } };
A.turn = (tau) => { A.idle(tau); if (!S_.turn) S_.turn = { t0: S_.t, from: S_.facing }; };
A.stretch = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 0.6, 0, 1)) * (1 - smooth(clamp((tau - 1.8) / 0.5, 0, 1))), m = M();
  const raise = isFront() ? 2.05 : 2.9;
  bones.upper_arm_near.userData.pose = raise * u; bones.upper_arm_far.userData.pose = raise * u * farSign();
  if (isFront()) { bones.chest.userData.sy = 1 + 0.04 * u; bones.head.userData.pose = 0.05 * u; }
  else { bones.chest.userData.pose = m * 0.12 * u; bones.head.userData.pose = m * 0.2 * u; }
  S_.rootY = 0.03 * u;
  S_.eyesClosed = 0.8 * u; S_.mouthOpen = 0.6 * u;
};
A.celebrate = (tau) => { A.hop(tau); const raise = isFront() ? 2.1 : 2.8; bones.upper_arm_near.userData.pose = raise; bones.upper_arm_far.userData.pose = raise * farSign(); bones.forearm_near.userData.pose = 0.4 * Math.sin(tau * 12); bones.forearm_far.userData.pose = -0.4 * Math.sin(tau * 12); };
A.tail_react = (tau) => { A.idle(tau); const k = Math.exp(-tau * 1.2) * Math.sin(tau * 9); for (const [i, n] of ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'].entries()) bones[n].userData.pose = 0.35 * k * (0.4 + i * 0.15); };
A.stumble = (tau) => { A.idle(tau); const u = Math.sin(Math.min(tau, 0.6) / 0.6 * Math.PI), m = M(); bones.hips.userData.pose = m * 0.35 * u; bones.chest.userData.pose = m * 0.25 * u; S_.eyesClosed = 0.5 * u; S_.mouthOpen = 0.7 * u; S_.rootY = -0.05 * u; if (tau > 0.9) S_.next = 'idle'; };
A.dangle = (tau) => {
  // held by the pointer: hangs from the grab point, limbs dangle, sways against the drag
  poseReset();
  const sw = Math.sin(tau * 2.4), m = M(), h = S_.held;
  for (const s of ['near', 'far']) { const k = s === 'near' ? 1 : -1; bones['thigh_' + s].userData.pose = m * (0.22 + 0.1 * sw * k); bones['shin_' + s].userData.pose = -m * 0.3; }
  bones.upper_arm_near.userData.pose = m * -0.25 + 0.06 * sw; bones.upper_arm_far.userData.pose = m * -0.2 - 0.06 * sw;
  bones.head.userData.pose = m * 0.1 * sw * 0.5;
  S_.mouthOpen = 0.4;
  if (h) {
    // pendulum: tilt against the drag velocity about the grab point (the root pivot is at the feet, so compensate)
    const tilt = clamp(-h.vx * 0.05, -0.35, 0.35) * m, Hg = Math.max(0.2, -h.dy);
    S_.rootRot = tilt; S_.rootX = m * Hg * Math.sin(tilt); S_.rootY = Hg * (1 - Math.cos(tilt));
  }
};
A.fall = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 0.25, 0, 1)), m = M();
  bones.upper_arm_near.userData.pose = -m * 2.2 * u; bones.upper_arm_far.userData.pose = -m * 2.0 * u;
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.45 * u; bones['shin_' + s].userData.pose = -m * 0.8 * u; }
  bones.chest.userData.pose = -m * 0.08 * u; bones.head.userData.pose = -m * 0.1 * u;
  S_.mouthOpen = 0.8 * u;
  tailSway(tau * 3, 0.2);
};
A.land = (tau) => {
  poseReset();
  const u = Math.sin(Math.PI * clamp(tau / 0.32, 0, 1)), m = M();
  S_.squash = 0.18 * u; S_.rootY = -0.04 * u;
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.3 * u; bones['shin_' + s].userData.pose = -m * 0.55 * u; }
  bones.chest.userData.pose = m * 0.12 * u;
  bones.upper_arm_near.userData.pose = -m * 0.5 * u; bones.upper_arm_far.userData.pose = -m * 0.5 * u;
  if (tau > 0.34) S_.next = 'idle';
};
const ACTIONS = Object.keys(A);
const VIEW_FOR = { walk: 'side', run: 'side', hop: 'side', sleep: 'side', wake: 'side', turn: 'side', stumble: 'side', dangle: 'side', fall: 'side', land: 'side',
  idle: 'front', look: 'front', talk: 'front', wave: 'front', sit: 'front', stretch: 'front', celebrate: 'front', tail_react: 'front' };
function wantView(action) { const w = VIEW_FOR[action] || VIEW_NAME; return VIEWS[w] ? w : (VIEWS.side ? 'side' : Object.keys(VIEWS)[0]); }
function switchView(name) { if (name === VIEW_NAME || !VIEWS[name]) return; S_.viewSwap = { t0: S_.t, from: VIEW_NAME, to: name }; }

// ------------------------------------------------------------------ face
// side view: procedural expression on the decomposed pieces; front view: the face kit recipes (kit moods are emotions too)
const EMO = {
  neutral: { browRot: 0, browY: 0, eyeScale: 1, mouthW: 1, mouthH: 1, closed: 0, kit: 'neutral' },
  happy: { browRot: -0.08, browY: 2, eyeScale: 0.32, mouthW: 1.5, mouthH: 1.3, closed: 0, kit: 'happy' },
  sad: { browRot: 0.35, browY: -1, eyeScale: 0.85, mouthW: 0.8, mouthH: 0.7, closed: 0, kit: 'sad' },
  angry: { browRot: -0.45, browY: -4, eyeScale: 0.8, mouthW: 1.1, mouthH: 0.6, closed: 0, kit: 'angry' },
  surprised: { browRot: 0.1, browY: 6, eyeScale: 1.25, mouthW: 1.2, mouthH: 2.0, closed: 0, kit: 'surprised' },
  think: { browRot: 0.15, browY: 3, eyeScale: 0.95, mouthW: 0.9, mouthH: 0.8, closed: 0, kit: 'focused' },
  awkward: { browRot: 0.25, browY: 0, eyeScale: 0.9, mouthW: 1.3, mouthH: 0.5, closed: 0, kit: 'shy' },
  question: { browRot: 0.2, browY: 4, eyeScale: 1.05, mouthW: 0.9, mouthH: 1.2, closed: 0, kit: 'confused' },
  curious: { browRot: 0.05, browY: 3, eyeScale: 1.1, mouthW: 1.0, mouthH: 1.1, closed: 0, kit: 'surprised' },
};
const KIT_TO_EMO = { relaxed: 'neutral', sleepy: 'neutral', affection: 'happy', panic: 'surprised', shy: 'awkward', smug: 'happy', pouty: 'angry', focused: 'think', hurt: 'sad', confused: 'question', shocked: 'surprised', gentle: 'happy', cheerful: 'happy' };
const KIT_NOT_MOODS = /^(blink|aa|ih|ou|ee|oh|look)/;
const emoOf = (name) => EMO[name] || EMO[KIT_TO_EMO[name]] || EMO.neutral;
const kitMood = (name) => (kit && kit.recipe(name) && !KIT_NOT_MOODS.test(name) ? name : (EMO[name] && kit && kit.recipe(EMO[name].kit) ? EMO[name].kit : 'neutral'));
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
const emoCur = { ...EMO.neutral };
function applyFace(dt) {
  const target = emoOf(S_.emotion);
  const k = 1 - Math.exp(-dt * 10);
  for (const key of ['browRot', 'browY', 'eyeScale', 'mouthW', 'mouthH', 'closed']) emoCur[key] = lerp(emoCur[key], target[key], k);
  // blink
  S_.blink.next -= dt;
  if (S_.blink.next <= 0 && S_.blink.phase === 0) { S_.blink.phase = 0.001; S_.blink.next = 1.8 + Math.random() * 3.2; }
  if (S_.blink.phase > 0) { S_.blink.phase += dt; if (S_.blink.phase > 0.22) S_.blink.phase = 0; }
  const blinkAmt = S_.blink.phase > 0 ? Math.sin(Math.PI * clamp(S_.blink.phase / 0.22, 0, 1)) : 0;
  const closed = clamp(Math.max(blinkAmt, S_.eyesClosed || 0), 0, 1);
  if (isFront() && kit) {
    kit.setMood(kitMood(S_.emotion));
    kit.eyesClosed = S_.eyesClosed || 0;
    kit.setViseme(S_.action === 'talk' ? VISEMES[Math.floor(S_.tau * 9) % VISEMES.length] : null);
    const { yaw, pitch } = S_.look;
    const thr = S_.action === 'look' ? 0.4 : 0.45;
    kit.setLook(Math.abs(yaw) > thr ? (yaw > 0 ? 'left' : 'right') : pitch > thr ? 'up' : pitch < -thr ? 'down' : null);
    kit.update(dt);
    return;
  }
  const eyeY = Math.max(0.06, emoCur.eyeScale * (1 - closed));
  const px = S * 1;   // 1 px in world units
  const [ix, iy] = S_.irisOff || [0, 0];
  for (const k of ['eyewhite', 'irides', 'eyelash']) { const m = facePieces[k]; if (!m) continue; m.scale.set(1, eyeY, 1); m.position.copy(m.userData.base); }
  if (facePieces.irides) facePieces.irides.position.add(new THREE.Vector3(ix * px, iy * px, 0));
  if (facePieces.eyelash) facePieces.eyelash.position.y -= (1 - eyeY) * 6 * px;
  if (facePieces.eyebrow) { const m = facePieces.eyebrow; m.rotation.z = emoCur.browRot * M(); m.position.copy(m.userData.base); m.position.y += emoCur.browY * px; }
  if (facePieces.mouth) { const m = facePieces.mouth; m.scale.set(emoCur.mouthW, emoCur.mouthH * (1 + 2.2 * (S_.mouthOpen || 0)), 1); }
}

// ------------------------------------------------------------------ frame
function applyPose() {
  for (const b of boneList) { b.rotation.z = b.userData.pose + b.userData.spring; b.scale.y = b.userData.sy || 1; }
  if (isFront()) for (const [layer, bone] of [['handwear_l', 'upper_arm_l'], ['handwear_r', 'upper_arm_r']]) {
    const m = layerMeshes[layer]; if (!m) continue;
    if (m.userData.baseOrder == null) m.userData.baseOrder = m.renderOrder;
    m.renderOrder = Math.abs(bones[bone].userData.pose) > 0.9 ? 40 : m.userData.baseOrder;   // a raised arm is in front of the hair
  }
  bones.root.position.set(restHead.root.x, restHead.root.y + (S_.rootY || 0), 0);
  bones.root.rotation.z = S_.rootRot || 0;
}
const snapshotPose = () => ({ pose: boneList.map((b) => b.userData.pose), sy: boneList.map((b) => b.userData.sy || 1), rootY: S_.rootY || 0, rootRot: S_.rootRot || 0, rootX: S_.rootX || 0, rootScale: S_.rootScale || 1, eyesClosed: S_.eyesClosed || 0, mouthOpen: S_.mouthOpen || 0, squash: S_.squash || 0 });
function applyBlend() {
  // crossfade from the pose the previous action left, so action switches never pop
  const bl = S_.blend; if (!bl) return;
  const u = clamp((S_.t - bl.t0) / bl.dur, 0, 1), f = bl.from;
  if (u >= 1 || f.pose.length !== boneList.length) { S_.blend = null; return; }
  const k = smooth(u);
  boneList.forEach((b, i) => { b.userData.pose = lerp(f.pose[i], b.userData.pose, k); b.userData.sy = lerp(f.sy[i], b.userData.sy || 1, k); });
  for (const key of ['rootY', 'rootRot', 'rootX', 'eyesClosed', 'mouthOpen', 'squash']) S_[key] = lerp(f[key], S_[key] || 0, k);
  S_.rootScale = lerp(f.rootScale, S_.rootScale || 1, k);
}
function followHold(dt) {
  const h = S_.held;
  const ease = 1 - Math.exp(-dt * 28);
  const nx = lerp(S_.x, h.tx, ease), ny = lerp(S_.y, h.ty, ease);
  const vx = (nx - S_.x) / Math.max(dt, 1e-3), vy = (ny - S_.y) / Math.max(dt, 1e-3);
  const k = 1 - Math.exp(-dt * 10);
  h.vx = lerp(h.vx, vx, k); h.vy = lerp(h.vy, vy, k);
  S_.x = nx; S_.y = ny;
}
function stepPhysics(dt) {
  if (S_.held || (S_.y <= 0 && S_.vy <= 0 && S_.vx === 0)) return;
  S_.vy -= G * dt; S_.y += S_.vy * dt; S_.x += S_.vx * dt;
  const lo = 0.45, hi = STAGE.w - 0.45;
  if (S_.x < lo) { S_.x = lo; S_.vx = -S_.vx * 0.4; } else if (S_.x > hi) { S_.x = hi; S_.vx = -S_.vx * 0.4; }
  if (S_.y <= 0) {
    S_.y = 0; const impact = -S_.vy; S_.vy = 0; S_.vx = 0; S_.landed = impact;
    if (S_.action === 'fall' || S_.action === 'dangle') S_.next = impact > 4.5 ? 'stumble' : 'land';
  }
}
function tick(dt) {
  S_.dt = dt; S_.t += dt; S_.tau += dt;
  if (S_.held) followHold(dt);
  const fn = A[S_.action] || A.idle;
  fn(S_.tau);
  applyBlend();
  stepPhysics(dt);
  // locomotion: walk in the facing direction, turn at the stage edges (she spans ~0.42 ahead of the root, ~0.82 behind: the tail)
  if (S_.speed && !S_.turn && !S_.held && S_.y <= 0) {
    S_.x += S_.facing * S_.speed * dt;
    const ahead = 0.42, behind = 0.82;
    const front = S_.facing > 0 ? STAGE.w - ahead : ahead;
    const back = S_.facing > 0 ? behind : STAGE.w - behind;
    if (S_.facing > 0 ? S_.x > front : S_.x < front) { S_.x = front; S_.turn = { t0: S_.t, from: S_.facing }; }
    if (S_.facing > 0 ? S_.x < back : S_.x > back) S_.x = back;
  }
  let sx = M();
  if (S_.turn) {
    const u = (S_.t - S_.turn.t0) / 0.28;
    if (u >= 1) { S_.facing = -S_.turn.from; S_.turn = null; if (S_.action === 'turn') S_.next = 'idle'; sx = M(); }
    else { const fromM = NATIVE ? S_.turn.from * NATIVE : 1; sx = (NATIVE ? fromM * (u < 0.5 ? 1 : -1) : 1) * Math.max(0.05, Math.abs(Math.cos(Math.PI * u))); }
  }
  if (S_.viewSwap) {
    const u = (S_.t - S_.viewSwap.t0) / 0.24;
    if (u >= 0.5 && VIEW_NAME !== S_.viewSwap.to) { activate(VIEWS[S_.viewSwap.to]); showOnly(S_.viewSwap.to); S_.prevPos.clear(); for (const b of boneList) { b.userData.spring = 0; b.userData.springVel = 0; } S_.blend = null; sx = M(); }
    sx *= Math.max(0.04, Math.abs(Math.cos(Math.PI * u)));
    if (u >= 1) S_.viewSwap = null;
  }
  const sc = S_.rootScale || 1, sq = S_.squash || 0;
  group.scale.set(sx * sc * (1 + sq), sc * (1 - sq), 1);
  group.position.x = S_.x + (S_.rootX || 0); group.position.y = GROUND_Y + S_.y;
  applyPose();
  stepSprings(dt);
  applyPose();
  applyFace(dt);
  group.updateMatrixWorld(true);
  if (S_.next) { const n = S_.next; S_.next = null; lab.start(n); }
  for (const cb of tickHooks) cb(dt);
}
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - S_.lastFrame) / 1000); S_.lastFrame = now;
  if (!S_.paused) tick(dt);
  renderer.render(scene, camera);
  S_.fps.push(dt); if (S_.fps.length > 120) S_.fps.shift();
  if (S_.hudOn) hud.textContent = `rig [${VIEW_NAME}]  ${(S_.fps.length / S_.fps.reduce((a, b) => a + b, 0)).toFixed(0)} fps  action ${S_.action} ${S_.tau.toFixed(1)}s  facing ${S_.facing > 0 ? '+x' : '-x'}  x ${S_.x.toFixed(2)} y ${S_.y.toFixed(2)}  emotion ${S_.emotion}${S_.held ? '  HELD' : ''}\n` +
    `[I] idle [W] walk [R] run [H] hop [V] wave [L] look [T] talk [S] sit [Z] sleep [K] wake [F] turn [X] stretch [C] celebrate [B] tail [U] stumble\n[1-9] neutral happy sad angry surprised think awkward question curious  [Space] stop  [G] hud   drag her / click her`;
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ control surface
const lab = window.lab = {
  info: () => ({ views: Object.keys(VIEWS), view: VIEW_NAME, bones: boneList.length, layers: Object.keys(layerMeshes).filter((k) => !k.endsWith('#tex')).length, actions: ACTIONS, emotions: Object.keys(EMO), kit: !!kit, kitMoods: kit ? kit.moods().filter((m) => !KIT_NOT_MOODS.test(m)) : [], stage: lab.stage() }),
  actions: () => ACTIONS,
  start(name) {
    if (!A[name]) throw new Error('unknown action ' + name);
    const want = wantView(name);
    S_.blend = want === VIEW_NAME ? { from: snapshotPose(), t0: S_.t, dur: name === 'land' || name === 'stumble' ? 0.08 : 0.22 } : null;
    S_.action = name; S_.tau = 0; if (name === 'turn') S_.turn = null;
    switchView(want);
    return { name, view: want };
  },
  begin(name) {
    lab.start(name); S_.blend = null; S_.t = 0; S_.x = STAGE.w / 2 - 0.15; S_.y = 0; S_.vx = 0; S_.vy = 0; S_.held = null; S_.facing = 1; S_.turn = null; S_.squash = 0;
    if (S_.viewSwap) { activate(VIEWS[S_.viewSwap.to]); showOnly(S_.viewSwap.to); S_.viewSwap = null; }
    group.scale.set(M(), 1, 1); S_.blink.next = 9; S_.blink.phase = 0; for (const b of boneList) { b.userData.spring = 0; b.userData.springVel = 0; } S_.prevPos.clear();
    return { name };
  },
  step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) tick(1 / 60); renderer.render(scene, camera); },
  stop() { lab.start('idle'); },
  pause(v) { S_.paused = !!v; },
  hud(v) { S_.hudOn = !!v; hud.style.display = v ? 'block' : 'none'; },
  emotion(name) { if (!EMO[name] && !KIT_TO_EMO[name] && !(kit && kit.recipe(name))) throw new Error('unknown emotion ' + name); S_.emotion = name; },
  look(yaw, pitch) { S_.look.yaw = clamp(yaw || 0, -1, 1); S_.look.pitch = clamp(pitch || 0, -1, 1); },
  lookAt(px, py) { if (px == null) { lab.look(0, 0); return; } const [hx, hy] = lab.headPx(); lab.look((px - hx) / (STAGE.k * 1.2), (hy - py) / (STAGE.k * 0.9)); },
  headPx() { const v = new THREE.Vector3(); bones.head.getWorldPosition(v); return toPx(v.x, v.y); },
  // stage + position (units) and her hit box (window px, top-left origin)
  stage: () => ({ k: STAGE.k, w: STAGE.w, h: STAGE.h, margin: STAGE.margin, wPx: window.innerWidth, hPx: window.innerHeight }),
  pos: () => ({ x: S_.x, y: S_.y, vx: S_.vx, vy: S_.vy, facing: S_.facing, action: S_.action, tau: S_.tau, view: VIEW_NAME, speed: S_.speed || 0, held: !!S_.held, airborne: S_.y > 0.001, turning: !!S_.turn, landed: S_.landed }),
  setPos(x, y) { S_.x = clamp(x, 0, STAGE.w); S_.y = Math.max(0, y || 0); },
  turnTo(dir) { dir = dir > 0 ? 1 : -1; if (dir !== S_.facing && !S_.turn) S_.turn = { t0: S_.t, from: S_.facing }; return dir === S_.facing; },
  bbox(pad = 0) {
    const v = current(), rb = v.restBox, r = restHead.root, th = S_.rootRot || 0, c = Math.cos(th), s = Math.sin(th);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of [[rb.minX, rb.minY], [rb.maxX, rb.minY], [rb.minX, rb.maxY], [rb.maxX, rb.maxY]]) {
      const dx = x - r.x, dy = y - r.y;
      const lx = r.x + dx * c - dy * s, ly = r.y + (S_.rootY || 0) + dx * s + dy * c;
      const [px, py] = toPx(group.position.x + lx * group.scale.x, group.position.y + ly * group.scale.y);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  },
  // pick up / carry / drop (window px)
  hold(px, py) {
    const [ux, uy] = toUnits(px, py);
    S_.held = { dx: S_.x - ux, dy: S_.y - uy, tx: S_.x, ty: S_.y, vx: 0, vy: 0 };
    S_.vx = 0; S_.vy = 0; S_.speed = 0; S_.turn = null;
    lab.start('dangle');
  },
  holdAt(px, py) { if (!S_.held) return; const [ux, uy] = toUnits(px, py); S_.held.tx = clamp(ux + S_.held.dx, 0.3, STAGE.w - 0.3); S_.held.ty = clamp(uy + S_.held.dy, 0, Math.max(0, STAGE.h - 2.0)); },
  release() {
    if (!S_.held) return; const h = S_.held; S_.held = null;
    S_.vx = clamp(h.vx, -12, 12); S_.vy = clamp(h.vy, -6, 8); S_.rootRot = 0; S_.rootX = 0;
    if (S_.y > 0.01 || S_.vy > 0) lab.start('fall'); else { S_.vx = 0; lab.start('land'); }
  },
  onTick(fn) { tickHooks.push(fn); },
  dump(match) { const out = []; scene.traverse((o) => { if (o.isMesh && (!match || o.name.includes(match))) { const v = new THREE.Vector3(); o.getWorldPosition(v); out.push({ name: o.name, type: o.type, visible: o.visible, parent: o.parent && (o.parent.name || o.parent.type), pos: [+v.x.toFixed(2), +v.y.toFixed(2)], ro: o.renderOrder, skel: o.skeleton ? o.skeleton.bones.length : null, b0: o.skeleton ? o.skeleton.bones[o.geometry.attributes.skinIndex.getX(0)].name : null, groupVisible: (function f(n) { return n ? (n.visible && f(n.parent)) : true; })(o.parent) }); } }); return out; },
  showLayer(name, v) { const m = layerMeshes[name]; if (m) m.visible = !!v; return !!m; },
  layer(name) { const m = layerMeshes[name]; if (!m) return null; const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; const idx = si ? Array.from(si.array.slice(0, 8)) : null; return { skinned: !!m.isSkinnedMesh, visible: m.visible, sameSkeleton: m.skeleton === skeleton, skelBones: m.skeleton ? m.skeleton.bones.length : null, boneNamesAtIdx: idx ? idx.map((i) => m.skeleton.bones[i] && m.skeleton.bones[i].name) : null, w: sw ? Array.from(sw.array.slice(0, 8)).map((v) => +v.toFixed(2)) : null, renderOrder: m.renderOrder, parent: m.parent && m.parent.type, boneTexture: !!(m.skeleton && m.skeleton.boneTexture), scene: m.parent === scene }; },
  bone(name) { const b = bones[name]; if (!b) return null; const v = new THREE.Vector3(); b.getWorldPosition(v); return { pose: +b.userData.pose.toFixed(3), spring: +b.userData.spring.toFixed(3), rot: +b.rotation.z.toFixed(3), sy: b.userData.sy, px: toPx(v.x, v.y).map((n) => Math.round(n)), visible: b.parent ? b.parent.visible : null }; },
  snapshot: () => ({ view: VIEW_NAME, native: NATIVE, mirror: M(), scaleX: +group.scale.x.toFixed(3), action: S_.action, tau: +S_.tau.toFixed(2), x: +S_.x.toFixed(3), y: +S_.y.toFixed(3), facing: S_.facing, rootY: +(S_.rootY || 0).toFixed(3), springs: Object.fromEntries(springs.flatMap((s) => s.bones).map((n) => [n, +bones[n].userData.spring.toFixed(3)])) }),
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
await buildView('side', RIG_FILE);
if (FRONT_FILE) await buildView('front', FRONT_FILE);
if (HEIGHT_PX) { STAGE.k = HEIGHT_PX / VIEWS.side.heightUnits; fitCamera(); }
if (FLOOR_PX != null) STAGE.margin = FLOOR_PX / STAGE.k;
placeViews();
S_.x = Q.has('x') ? +Q.get('x') : STAGE.w / 2 + 0.15;
activate(VIEWS.side); showOnly('side');
lab.hud(true);
requestAnimationFrame(frame);
window.__ready = true;
