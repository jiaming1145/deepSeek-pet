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
const FRONT_FILE = Q.get('front') || 'rig_front.json';   // default so a bare page load still builds the front view + face kit (the error scanner opens it with no query)
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
let rig, group, bones, boneList, restHead, skeleton, boneIndex, layerMeshes, facePieces, FLOOR_Y, GROUND_Y, springs, ASSETS, VIEW_NAME, NATIVE, EYE_H;
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
    bone.userData = { head: h, tail: t, len: h.distanceTo(t), pose: 0, sx: 1, sy: 1, spring: 0, springVel: 0, dir: Math.atan2(t.y - h.y, t.x - h.x) };
    if (b.parent) { const ph = rest[b.parent]; bone.position.set(h.x - ph.x, h.y - ph.y, 0); B[b.parent].add(bone); }
    else { bone.position.set(h.x, h.y, 0); grp.add(bone); }
    B[b.name] = bone; list.push(bone);
  }
  for (const part of ['thigh', 'shin', 'foot', 'upper_arm', 'forearm', 'hand']) {
    if (!B[part + '_near'] && B[part + '_l']) { B[part + '_near'] = B[part + '_l']; B[part + '_far'] = B[part + '_r'] || B[part + '_l']; }
  }
  for (const n of ['thigh_near', 'thigh_far', 'shin_near', 'shin_far', 'foot_near', 'foot_far', 'upper_arm_near', 'upper_arm_far', 'forearm_near', 'forearm_far', 'hand_near', 'hand_far', 'chest', 'neck', 'head', 'hips']) {
    if (!B[n]) { B[n] = new THREE.Bone(); B[n].userData = { head: new THREE.Vector2(), tail: new THREE.Vector2(), len: 0.3, pose: 0, sx: 1, sy: 1, spring: 0, springVel: 0 }; }
  }
  for (let i = 1; i <= 6; i++) if (!B['tail_' + i]) { B['tail_' + i] = new THREE.Bone(); B['tail_' + i].userData = { pose: 0, sx: 1, sy: 1, spring: 0, springVel: 0 }; }
  grp.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(list);
  const xs = [], ys = [];
  for (const l of Object.values(rigJ.layers)) { const a = toW([l.bbox[0], l.bbox[1]]), b = toW([l.bbox[2], l.bbox[3]]); xs.push(a.x, b.x); ys.push(a.y, b.y); }
  const restBox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const view = { name, rig: rigJ, group: grp, bones: B, boneList: list, restHead: rest, skeleton: skel, boneIndex: Object.fromEntries(list.map((b, i) => [b.name, i])),
    layerMeshes: {}, facePieces: {}, floorY, assets: rigJ.assets || 'assets', springs: Object.entries(rigJ.springs || {}).map(([name, v]) => ({ ...v, name })), meshes: [], restBox,
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
  const eyeLay = rigJ.layers.eyewhite;
  view.eyeH = eyeLay ? (eyeLay.bbox[3] - eyeLay.bbox[1]) : 40;      // her eye opening in canvas px
  const eyeC = toW(rigJ.eyes.center), mouthC = toW(rigJ.mouth.center), headH = bones.head.userData.head || new THREE.Vector2();
  for (const k of Object.keys(facePieces)) {
    const m = facePieces[k]; if (!m) continue;
    const c = k === 'mouth' ? mouthC : eyeC;
    m.geometry.translate(-(c.x - headH.x), -(c.y - headH.y), 0); m.position.set(c.x - headH.x, c.y - headH.y, 0);
    m.userData.base = m.position.clone();
  }
  if (name === 'front' && rigJ.canonical_to_canvas) await mountKit(view, drawOrder.indexOf('face'), drawOrder.length);
  grp.position.set(S_.x, groundFor(view), 0);
  view.groundY = grp.position.y;
  grp.scale.x = mirrorFor(view);
  VIEWS[name] = view;
  activate(prev || view);
  return view;
}
async function mountKit(view, faceOrder, layerCount) {
  // the face kit's pieces live in neutral.png px; neutral.png is a crop of the 4096x8192 canonical, and the front
  // layers were decomposed from a crop of the same canonical (rig.canonical_to_canvas) - so kit px -> canvas px is affine
  const map = view.rig.canonical_to_canvas, hh = view.bones.head.userData.head;
  const k = new FaceKit({ base: '../model/face', atlasJson: 'atlas_matted.json', parent: view.bones.head, pxScale: map.scale * S, renderOrder: faceOrder + 0.5, fxRenderOrder: layerCount + 2, skinFxRenderOrder: faceOrder + 0.4,
    place: (u, v) => { const [cx, cy] = k.atlas.face.canonical_crop_box; const w = toW([(u + cx) * map.scale + map.offset[0], (v + cy) * map.scale + map.offset[1]]); return new THREE.Vector3(w.x - hh.x, w.y - hh.y, 0); } });
  try { await k.load(); } catch (e) { console.warn('face kit not mounted: ' + (e.message || e)); return; }
  kit = k; view.kit = k;
  for (const n of ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth']) if (view.layerMeshes[n]) view.layerMeshes[n].visible = false;   // the kit replaces these; it draws no nose, so hers stays
  view.facePieces = {};
}
function current() { return VIEW_NAME ? VIEWS[VIEW_NAME] : null; }
function activate(view) {
  VIEW_NAME = view.name; rig = view.rig; group = view.group; bones = view.bones; boneList = view.boneList; restHead = view.restHead;
  skeleton = view.skeleton; boneIndex = view.boneIndex; layerMeshes = view.layerMeshes; facePieces = view.facePieces;
  FLOOR_Y = view.floorY; GROUND_Y = view.groundY; springs = view.springs; ASSETS = view.assets; NATIVE = view.native; EYE_H = view.eyeH;
}
function showOnly(name) {
  for (const v of Object.values(VIEWS)) { const on = v.name === name; v.group.visible = on; for (const m of v.meshes) if (m.isSkinnedMesh) m.visible = on; }
}
function placeViews() { for (const v of Object.values(VIEWS)) { v.groundY = groundFor(v); v.group.position.y = v.groundY; } if (VIEW_NAME) GROUND_Y = VIEWS[VIEW_NAME].groundY; }
window.addEventListener('resize', () => { fitCamera(); placeViews(); });

// ------------------------------------------------------------------ springs
// While she is off the ground the tail should read as one heavy limb, the hair should settle faster than the
// tail or it looks like seaweed, and the skirt should barely move.
const HELD_SPRING = {
  tail:   { stiffness: 26, damping: 2.4, inertia: 1.7, limit: 1.25 },
  hair:   { stiffness: 58, damping: 5.2, inertia: 1.5, limit: 1.0 },
  hair_l: { stiffness: 58, damping: 5.2, inertia: 1.5, limit: 1.0 },
  hair_r: { stiffness: 58, damping: 5.2, inertia: 1.5, limit: 1.0 },
  skirt:  { stiffness: 95, damping: 7.6, inertia: 0.9, limit: 0.6 },
  ahoge:  { stiffness: 100, damping: 6.0, inertia: 1.8, limit: 0.8 },
};
function stepSprings(dt) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3(), m = M();
  // Carried, her chains should hang heavier and swing longer than they do while she walks. Softer and less
  // damped, with more room to travel; the walk stays exactly as tuned.
  const carried = !!S_.held || S_.y > 0.02;
  for (const sp0 of springs) {
    const o = carried && HELD_SPRING[sp0.name];
    const sp = o ? { ...sp0, ...o } : sp0;
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
// Poses are authored in the group's local frame, and that frame is ALREADY mirrored by M(). So a body-relative
// angle - tuck the knees, curl forward, lie down - must not be multiplied by M() as well, or it inverts when she
// turns around: the tuned value simply becomes its own mirror image. BODY is this frame's fixed forward sign; use
// it for poses, and M() only for quantities written to world space (root slides, drag velocity).
const BODY = -1;
const poseReset = () => { for (const b of boneList) { b.userData.pose = 0; b.userData.sx = 1; b.userData.sy = 1; } S_.rootY = 0; S_.rootRot = 0; S_.rootX = 0; S_.rootScale = 1; S_.squash = 0; S_.eyesClosed = 0; S_.mouthOpen = 0; S_.irisOff = [0, 0]; S_.speed = 0; };
const legLen = () => (bones.thigh_near.userData.len || 0.4) + (bones.shin_near.userData.len || 0.2);
const strideSpeed = (f, amp) => 4 * f * legLen() * Math.sin(amp) * 0.7;   // feet plant without sliding (0.7: the knee shortens the swing)
const lookIris = () => { S_.irisOff = [(isFront() ? S_.look.yaw : S_.look.yaw * M()) * 6, S_.look.pitch * 3]; };
const tailSway = (tau, amp) => { for (let i = 1; i <= 6; i++) if (bones['tail_' + i].userData.head) bones['tail_' + i].userData.pose = amp * Math.sin(tau * 1.3 + i * 0.35); };
const walkCycle = (tau, f, amp, knee, armAmp) => {
  const ph = 2 * Math.PI * f * tau;
  const fwd = BODY;
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
A.run = (tau) => { poseReset(); walkCycle(tau, 2.0, 0.55, 1.2, 0.7); S_.speed = strideSpeed(2.0, 0.55); bones.hips.userData.pose = -BODY * 0.12; S_.rootY += 0.02 * Math.abs(Math.sin(2 * Math.PI * 2.0 * tau)); };
A.hop = (tau) => {
  poseReset();
  const T = 0.7, t = tau % T, u = t / T;
  S_.rootY = 0.42 * 4 * u * (1 - u);
  const tuck = Math.sin(Math.PI * u), m = BODY;
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
  const u = smooth(clamp(tau / 0.6, 0, 1)), m = BODY;
  const L = bones.thigh_near.userData.len;
  if (isFront()) {
    // sitting toward the viewer: both leg segments foreshorten (knees come at the camera), so she really drops -
    // scaling one and inverse-scaling the other kept her full height and read as standing. Shins splay out to the
    // sides with the feet turned outward, and the skirt spreads where it meets the floor.
    const fold = 0.62 * u, SL = bones.shin_near.userData.len || L * 0.4;
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.sy = 1 - fold; bones['shin_' + s].userData.sy = 1 - fold * 0.75; }
    bones.shin_near.userData.pose = 0.62 * u; bones.shin_far.userData.pose = -0.62 * u;
    bones.foot_near.userData.pose = 0.55 * u; bones.foot_far.userData.pose = -0.55 * u;
    S_.rootY = -(L * fold + SL * fold * 0.75);
    bones.skirt_1.userData.sx = 1 + 0.18 * u; bones.skirt_2.userData.sx = 1 + 0.34 * u; bones.skirt_2.userData.sy = 1 - 0.18 * u;
    bones.upper_arm_near.userData.pose = -0.42 * u; bones.forearm_near.userData.pose = -0.85 * u;
    bones.upper_arm_far.userData.pose = 0.42 * u; bones.forearm_far.userData.pose = 0.85 * u;
    bones.chest.userData.sy = 1 - 0.03 * u + 0.015 * Math.sin(tau * 1.6);
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
  const u = smooth(clamp(tau / 1.0, 0, 1)), m = BODY;
  S_.rootRot = -m * (Math.PI / 2) * u;                 // lie down with the head toward her front
  S_.rootY = 0.0 + 0.16 * u;
  S_.rootX = M() * 0.82 * u;                            // world slide: the pivot is at her feet, so keep the lying body where she stood
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
  const u = smooth(clamp(tau / 0.6, 0, 1)) * (1 - smooth(clamp((tau - 1.8) / 0.5, 0, 1))), m = BODY;
  const raise = isFront() ? 2.05 : 2.9;
  bones.upper_arm_near.userData.pose = raise * u; bones.upper_arm_far.userData.pose = raise * u * farSign();
  if (isFront()) { bones.chest.userData.sy = 1 + 0.04 * u; bones.head.userData.pose = 0.05 * u; }
  else { bones.chest.userData.pose = m * 0.12 * u; bones.head.userData.pose = m * 0.2 * u; }
  S_.rootY = 0.03 * u;
  S_.eyesClosed = 0.8 * u; S_.mouthOpen = 0.6 * u;
};
A.celebrate = (tau) => { A.hop(tau); const raise = isFront() ? 2.1 : 2.8; bones.upper_arm_near.userData.pose = raise; bones.upper_arm_far.userData.pose = raise * farSign(); bones.forearm_near.userData.pose = 0.4 * Math.sin(tau * 12); bones.forearm_far.userData.pose = -0.4 * Math.sin(tau * 12); };
// ---- her dance routine -------------------------------------------------------------------------------------
// A dance is not a sine wave. The old one was exactly that: one short loop, every joint driven off the same beat
// at the same instant, nothing ever still. That is why it read as leaping on the spot with the limbs flapping.
// What follows is a routine instead - six moves that each say something different, played in order, with pauses
// written into them. The stillness between the moves is what makes the movement read as dancing; a body that
// never stops moving reads as a machine, however carefully the machine is tuned.
const BPM = 108, BEAT = 60 / BPM;
const ease = (u) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };   // soft start, soft stop
const swell = (u) => Math.sin(Math.PI * clamp(u, 0, 1));                          // 0 up to 1 and back
// a hit: snaps on in a twelfth of a beat, then leans back out. This is what an accent feels like.
const hit = (d, decay = 2.2, atk = 0.14) => (d < 0 ? 0 : Math.exp(-decay * d) * (d < atk ? ease(d / atk) : 1));
// ease() is flat at both ends, so an accent snaps hard through the middle but never starts or stops dead.
// atk is how long the snap takes, in beats: short for her hips, longer for an arm that has further to go.

const blankPose = () => ({
  hips: 0, chest: 0, neck: 0, head: 0, chestSy: 1,
  armN: 0, armF: 0, foreN: 0, foreF: 0, handN: 0, handF: 0,   // "F" values are mirrored onto her far side
  thighN: 0, thighF: 0, shinN: 0, shinF: 0, shortN: 0, shortF: 0,
  rootX: 0, rootY: 0, rootRot: 0, squash: 0, mouth: 0.14, eyes: 0,
  tail: [0, 0, 0, 0, 0, 0],
});
const mixPose = (A_, B_, k) => {
  const o = blankPose();
  for (const key of Object.keys(o)) {
    if (key === 'tail') { for (let i = 0; i < 6; i++) o.tail[i] = lerp(A_.tail[i], B_.tail[i], k); }
    else o[key] = lerp(A_[key], B_[key], k);
  }
  return o;
};
// a wave down the tail, so it trails the body instead of waving as one stiff rod
const tailWave = (p, phase, amp, lag = 0.30) => { for (let i = 0; i < 6; i++) p.tail[i] = amp * Math.sin(phase - i * lag); };

// 1. STEP-TOUCH. The plainest social dance step there is, and the one that establishes the pulse: she puts her
//    weight on one foot, taps the other in beside it, and reverses. Arms stay low and swing across her.
const mvStep = (bt, p) => {
  const s = Math.sin(Math.PI * bt / 2);                    // one full left-right-left over the four beats
  const sC = Math.sin(Math.PI * (bt - 0.5) / 2);           // the chest is half a beat behind the hips
  const sK = Math.sin(Math.PI * (bt - 0.9) / 2);           // the head is behind the chest
  p.rootX = 0.19 * s; p.hips = 0.20 * s; p.chest = -0.11 * sC; p.neck = 0.07 * sK; p.head = 0.17 * sK;
  p.rootY = 0.028 * (0.5 - 0.5 * Math.cos(2 * Math.PI * bt));   // one soft bounce per beat, no corner at the bottom
  p.squash = 0.03 * (0.5 + 0.5 * Math.cos(2 * Math.PI * bt));
  p.armN = 0.85 + 0.55 * s; p.armF = 0.85 - 0.55 * s;      // the arms alternate rather than moving as a pair,
  // and they stay out from her body: navy sleeves against a navy dress read as nothing at all
  p.foreN = 0.55 + 0.22 * Math.sin(Math.PI * (bt - 0.6) / 2);
  p.foreF = 0.55 - 0.22 * Math.sin(Math.PI * (bt - 0.6) / 2);
  p.handN = 0.12 * sK; p.handF = -0.12 * sK;
  const free = clamp(s, 0, 1), freeF = clamp(-s, 0, 1);     // the foot with no weight on it taps in
  p.thighF = -0.20 * free; p.shortF = 0.16 * free;
  p.thighN = 0.20 * freeF; p.shortN = 0.16 * freeF;
  tailWave(p, Math.PI * bt / 2 - 0.7, 0.16);
  p.mouth = 0.16;
};

// 2. BODY ROLL. A ripple that starts at her hips and arrives at her head late, twice. Nothing here is a rotation
//    of the whole body: the point is that the parts arrive at different times.
const mvRoll = (bt, p) => {
  const w = (lag) => Math.sin(Math.PI * (bt - lag) / 2);
  p.hips = 0.13 * w(0); p.chest = -0.10 * w(0.35); p.neck = 0.08 * w(0.6); p.head = 0.19 * w(0.7);
  p.chestSy = 1 + 0.055 * w(0.35);
  p.rootY = 0.035 + 0.030 * w(0.15);
  p.squash = -0.025 * w(0.35);                             // she lengthens as the wave passes through her
  const open = ease(bt / 1.6);
  p.armN = 0.75 + 0.95 * open + 0.30 * w(0.5);             // arms float out and drift with the wave
  p.armF = 0.75 + 0.95 * open + 0.30 * w(0.9);
  p.foreN = 0.30 + 0.25 * w(0.6); p.foreF = 0.30 + 0.25 * w(1.0);
  p.handN = 0.22 * w(0.8); p.handF = 0.22 * w(1.2);
  p.shortN = 0.06 * (1 - w(0)); p.shortF = 0.06 * (1 + w(0));
  tailWave(p, Math.PI * bt / 2 - 0.4, 0.20, 0.38);
  p.mouth = 0.20;
};

// 3. SCOOP. One big asymmetric sweep: the near arm carves from her knee up over her head while she leans away
//    from it, then the whole thing rings out. Asymmetry is most of what makes this look choreographed.
const mvScoop = (bt, p) => {
  const u = ease(bt / 2.4);
  const ring = bt > 2.4 ? Math.exp(-3.2 * (bt - 2.4)) * Math.sin(8.5 * (bt - 2.4)) : 0;
  p.armN = 0.12 + 1.92 * u + 0.20 * ring;                  // all the way overhead
  p.armF = 0.12 + 0.62 * u - 0.14 * ring;                  // the other arm only opens partway: not a pair
  p.foreN = 0.62 - 0.42 * u; p.foreF = 0.42 + 0.10 * u;
  p.handN = 0.30 * u + 0.18 * ring; p.handF = -0.12 * u;
  p.hips = -0.14 * u; p.chest = 0.16 * u + 0.05 * ring; p.neck = 0.09 * u; p.head = 0.25 * u + 0.10 * ring;
  p.rootX = -0.055 * u; p.rootRot = 0.05 * u; p.rootY = 0.045 * swell(bt / 4);
  p.squash = -0.05 * u;
  p.shortN = 0.13 * u; p.shortF = 0.04 * u; p.thighN = -0.10 * u;
  tailWave(p, 2.1 * u + 1.2, 0.24, 0.34);
  p.mouth = 0.22 + 0.14 * u;
};

// 4. BOUNCE. Hands up, four bounces, the one moment in the routine that is allowed to be pure energy - and it
//    works precisely because the moves either side of it are not.
const mvBounce = (bt, p) => {
  // three bounces, then the fourth beat is held with her hands still up. Four beats of continuous jumping was
  // what read as leaping on the spot; the held beat is what turns it into a phrase.
  const b = (0.5 - 0.5 * Math.cos(2 * Math.PI * Math.min(bt, 3))) * (1 - ease((bt - 3) / 0.6));
  p.rootY = 0.085 * b; p.squash = 0.055 * (1 - b);
  p.armN = 1.70 + 0.30 * b; p.armF = 1.70 + 0.30 * b;
  p.foreN = 0.45 + 0.35 * b; p.foreF = 0.45 + 0.35 * b;
  p.handN = 0.25 * Math.sin(2 * Math.PI * bt - 0.9); p.handF = 0.25 * Math.sin(2 * Math.PI * bt - 0.9);
  const s = Math.sin(Math.PI * bt / 2);
  p.hips = 0.10 * s; p.chest = -0.07 * s; p.head = 0.16 * Math.sin(Math.PI * (bt - 0.7) / 2);
  p.rootX = 0.04 * s;
  p.shortN = 0.14 * (1 - b); p.shortF = 0.14 * (1 - b);      // she loads into her knees between bounces
  p.thighN = 0.05 * s; p.thighF = -0.05 * s;
  tailWave(p, 2 * Math.PI * Math.min(bt, 3.2) - 0.5, 0.26, 0.26);
  p.mouth = 0.34 + 0.26 * b; p.eyes = 0.18 * b;            // squinting with the effort, which reads as delight
};

// 5. HIP POP. Two sharp accents with genuine stillness between them. If you take one thing out of this routine
//    it should not be this: the held beats are what stop the whole thing looking like a wobble.
const mvPop = (bt, p) => {
  const side = hit(bt) - hit(bt - 2);                        // the hips snap: they hardly travel, so they can
  const upN = hit(bt, 2.0, 0.5), upF = hit(bt - 2, 2.0, 0.5);   // the arms take longer, because they are arms
  p.hips = 0.27 * side; p.chest = -0.14 * side; p.neck = 0.07 * side; p.head = 0.21 * side;
  p.rootX = 0.14 * side; p.rootRot = -0.055 * side;
  p.rootY = 0.012 + 0.02 * (hit(bt, 5) + hit(bt - 2, 5));
  p.armN = 0.45 + 1.15 * upN; p.armF = 0.45 + 1.15 * upF;
  p.foreN = 0.75 - 0.40 * upN; p.foreF = 0.75 - 0.40 * upF;
  p.handN = 0.20 * (upN - upF); p.handF = -0.20 * (upN - upF);
  p.shortN = 0.13 * upF; p.shortF = 0.13 * upN;              // she sinks into the leg she is popping away from
  p.chestSy = 1 + 0.02 * Math.sin(2 * Math.PI * bt * 0.5);   // she is still breathing while she holds
  tailWave(p, 2.6 * (upN - upF) + 1.0, 0.22, 0.36);          // the tail follows the slow arm, not the fast hip
  p.mouth = 0.18 + 0.10 * Math.abs(side);
};

// 6. POSE. She strikes it on the first beat and then holds it for three, which is a very long time in animation
//    and exactly why it lands. Only her breath and her tail move.
const mvPose = (bt, p) => {
  // 0.6 of a beat is a third of a second: still a strike, but her hand no longer crosses 28 px between two
  // frames, which is fast enough to strobe rather than read as speed.
  const k = ease(bt / 0.68) * (1 - ease((bt - 3.1) / 0.9));
  p.armN = 0.18 + 1.95 * k; p.armF = 0.18 - 0.32 * k;      // one arm thrown up, the other across her
  p.foreN = 0.30 - 0.22 * k; p.foreF = 0.95 * k;
  p.handN = 0.26 * k; p.handF = -0.30 * k;
  p.hips = -0.13 * k; p.chest = 0.12 * k; p.neck = 0.10 * k; p.head = 0.27 * k;
  p.rootX = -0.05 * k; p.rootRot = 0.045 * k; p.rootY = 0.02 * k;
  p.squash = -0.035 * k;
  p.thighN = -0.16 * k; p.shortN = 0.18 * k; p.shortF = 0.05 * k;
  p.chestSy = 1 + 0.025 * Math.sin(2 * Math.PI * bt * 0.55);
  tailWave(p, 1.9 + 0.55 * Math.sin(2 * Math.PI * bt * 0.5), 0.26 * k + 0.06, 0.40);
  p.mouth = 0.24 * k + 0.12; p.eyes = 0.35 * ease((bt - 1.2) / 0.5) * (1 - ease((bt - 2.4) / 0.5));
};

const ROUTINE = [[mvStep, 4], [mvRoll, 4], [mvScoop, 4], [mvBounce, 4], [mvPop, 4], [mvPose, 4]];
// how big she dances it. Delighted is not the same dance as tired, and it should not look like it.
const VIGOUR = { cheerful: 1.14, happy: 1.10, affection: 1.06, smug: 1.02, curious: 0.95, gentle: 0.92,
  pouty: 0.86, relaxed: 0.85, sad: 0.72, sleepy: 0.62, hurt: 0.68 };
const ROUTINE_BEATS = ROUTINE.reduce((n, m) => n + m[1], 0);
const XFADE = 0.5;   // beats of overlap, so one move flows into the next instead of cutting to it

A.dance = (tau) => {
  poseReset();
  let bt = (tau / BEAT) % ROUTINE_BEATS;
  let i = 0;
  while (bt >= ROUTINE[i][1]) { bt -= ROUTINE[i][1]; i = (i + 1) % ROUTINE.length; }
  const [fn, len] = ROUTINE[i];
  let pose = blankPose();
  fn(bt, pose);
  if (bt > len - XFADE) {                                  // ease into the next move over the last half beat
    const nxt = ROUTINE[(i + 1) % ROUTINE.length];
    const q = blankPose();
    nxt[0](bt - len, q);                                   // the next move, started early and running negative
    pose = mixPose(pose, q, ease((bt - (len - XFADE)) / XFADE));
  }
  // a small continuous groove underneath everything, so even a held pose is alive
  const g = 2 * Math.PI * tau / (BEAT * 2);
  pose.rootY += 0.006 * Math.sin(g);
  pose.chestSy += 0.012 * Math.sin(g + 0.8);
  const vig = VIGOUR[S_.emotion] ?? 1;
  if (vig !== 1) {
    for (const key of Object.keys(pose)) {
      if (key === 'tail') { for (let t = 0; t < 6; t++) pose.tail[t] *= vig; }
      else if (key === 'chestSy') pose.chestSy = 1 + (pose.chestSy - 1) * vig;
      else if (key !== 'mouth' && key !== 'eyes') pose[key] *= vig;
    }
  }

  const fs = farSign();
  S_.rootX = pose.rootX; S_.rootY = pose.rootY; S_.rootRot = pose.rootRot; S_.squash = pose.squash;
  bones.hips.userData.pose = pose.hips;
  bones.chest.userData.pose = pose.chest; bones.chest.userData.sy = pose.chestSy;
  bones.neck.userData.pose = pose.neck; bones.head.userData.pose = pose.head;
  bones.upper_arm_near.userData.pose = pose.armN; bones.upper_arm_far.userData.pose = pose.armF * fs;
  bones.forearm_near.userData.pose = pose.foreN; bones.forearm_far.userData.pose = pose.foreF * fs;
  bones.hand_near.userData.pose = pose.handN; bones.hand_far.userData.pose = pose.handF * fs;
  bones.thigh_near.userData.pose = pose.thighN; bones.thigh_far.userData.pose = pose.thighF * fs;
  bones.shin_near.userData.pose = pose.shinN; bones.shin_far.userData.pose = pose.shinF * fs;
  // a bent knee in the front view is a shortened leg, not a rotation - rotating a thigh here kicks it sideways
  bones.thigh_near.userData.sy = 1 - 0.45 * pose.shortN; bones.shin_near.userData.sy = 1 - 0.85 * pose.shortN;
  bones.thigh_far.userData.sy = 1 - 0.45 * pose.shortF; bones.shin_far.userData.sy = 1 - 0.85 * pose.shortF;
  for (let t = 0; t < 6; t++) { const b = bones['tail_' + (t + 1)]; if (b && b.userData.head) b.userData.pose = pose.tail[t]; }
  S_.mouthOpen = pose.mouth; S_.eyesClosed = pose.eyes;
};
A.tail_react = (tau) => { A.idle(tau); const k = Math.exp(-tau * 1.2) * Math.sin(tau * 9); for (const [i, n] of ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'].entries()) bones[n].userData.pose = 0.35 * k * (0.4 + i * 0.15); };
A.stumble = (tau) => { A.idle(tau); const u = Math.sin(Math.min(tau, 0.6) / 0.6 * Math.PI), m = BODY; bones.hips.userData.pose = m * 0.35 * u; bones.chest.userData.pose = m * 0.25 * u; S_.eyesClosed = 0.5 * u; S_.mouthOpen = 0.7 * u; S_.rootY = -0.05 * u; if (tau > 0.9) S_.next = 'idle'; };
// How the tail sits when she is off the ground. Most of the curve is at the base so it reads as one heavy limb
// hanging rather than a straight rod; above head height it curls back up toward her, the way a startled animal
// tucks. Sign is negative because the tail leaves her body toward +x and drooping is clockwise.
const TAIL_HANG = [-0.62, -0.44, -0.28, -0.16, -0.09, -0.05];
const TAIL_CURL = [0.06, 0.14, 0.22, 0.27, 0.30, 0.28];
// how high she is, as a fraction of how high she CAN be held - a constant here made every lift read as maximum
const liftFrac = () => clamp(S_.y / Math.max(0.6, STAGE.h - 2.0), 0, 1);
function tailCarry(lift) {
  // lift is 0 at the floor, 1 at the top of her reach
  const droop = smooth(clamp((lift - 0.02) / 0.18, 0, 1));
  const curl = smooth(clamp((lift - 0.62) / 0.30, 0, 1));
  for (let i = 0; i < 6; i++) {
    const b = bones['tail_' + (i + 1)];
    if (b && b.userData.head) b.userData.pose = lerp(0, lerp(TAIL_HANG[i], TAIL_CURL[i], curl), droop);
  }
}

// She is snatched off the floor: a hard extreme held for a beat, then it settles into the hang. Startles read as
// startles because the pose arrives instantly and then does NOT move for a moment.
A.startle = (tau) => {
  poseReset();
  const hold = 0.14, u = tau < hold ? 1 : 1 - smooth(clamp((tau - hold) / 0.22, 0, 1));
  S_.squash = -0.09 * u;                     // taller and narrower: caught mid-gasp
  S_.rootY = 0.045 * u;
  bones.upper_arm_near.userData.pose = 1.85 * u;
  bones.upper_arm_far.userData.pose = 1.85 * u * farSign();
  bones.forearm_near.userData.pose = 0.5 * u; bones.forearm_far.userData.pose = -0.5 * u;
  bones.thigh_near.userData.pose = 0.5 * u; bones.thigh_far.userData.pose = -0.15 * u;
  bones.shin_near.userData.pose = -0.7 * u; bones.shin_far.userData.pose = -0.35 * u;
  bones.head.userData.pose = -0.16 * u;
  S_.mouthOpen = 0.9 * u;
  S_.eyesClosed = 0;
  tailCarry(Math.max(liftFrac(), 0.10));
  if (tau > 0.36) S_.next = 'dangle';
};
A.dangle = (tau) => {
  // held by the pointer: hangs from the grab point, limbs dangle, sways against the drag
  poseReset();
  const h = S_.held;
  const lift = liftFrac();
  const sw = Math.sin(tau * 2.1), sw2 = Math.sin(tau * 1.6 + 0.7);
  // limbs hang and trail; the higher she is, the less she kicks and the more she just dangles
  const kick = 1 - 0.5 * lift;
  bones.thigh_near.userData.pose = (-0.30 + 0.16 * sw) * kick;
  bones.thigh_far.userData.pose = (-0.22 - 0.16 * sw) * kick;
  bones.shin_near.userData.pose = (0.34 + 0.10 * sw2) * kick;
  bones.shin_far.userData.pose = (0.28 - 0.10 * sw2) * kick;
  bones.upper_arm_near.userData.pose = -0.30 + 0.12 * sw2;
  bones.upper_arm_far.userData.pose = (-0.26 - 0.12 * sw2) * farSign();
  bones.forearm_near.userData.pose = 0.22 + 0.08 * sw;
  bones.forearm_far.userData.pose = -0.20 - 0.08 * sw;
  bones.head.userData.pose = 0.07 * sw2;
  bones.chest.userData.pose = 0.05 * sw;
  S_.mouthOpen = 0.25 + 0.25 * (h ? h.distress || 0 : 0);
  tailCarry(lift);
  if (h) {
    // A real pendulum, integrated, rather than a read-out of pointer velocity: she swings, overshoots and rings
    // down. Horizontal acceleration of the hand drives it, which is why shaking her reads so differently from
    // carrying her smoothly.
    const L = Math.max(0.18, Math.abs(h.dy) + 0.25);
    const w0 = Math.sqrt(G / L), damp = 2 * 0.12 * w0;
    const acc = -(G / L) * Math.sin(h.th) - damp * h.w - (h.ax / L) * Math.cos(h.th);
    h.w = clamp(h.w + acc * S_.dt, -12, 12);
    h.th = clamp(h.th + h.w * S_.dt, -1.1, 1.1);
    S_.rootRot = h.th;
    S_.rootX = M() * L * Math.sin(h.th);          // the pivot is at her feet, so slide to keep the grab point still
    S_.rootY = L * (1 - Math.cos(h.th));
  }
};
A.fall = (tau) => {
  poseReset();
  const u = smooth(clamp(tau / 0.25, 0, 1)), m = BODY;
  bones.upper_arm_near.userData.pose = -m * 2.2 * u; bones.upper_arm_far.userData.pose = -m * 2.0 * u;
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.45 * u; bones['shin_' + s].userData.pose = -m * 0.8 * u; }
  bones.chest.userData.pose = -m * 0.08 * u; bones.head.userData.pose = -m * 0.1 * u;
  S_.mouthOpen = 0.8 * u;
  tailSway(tau * 3, 0.2);
};
A.land = (tau) => {
  poseReset();
  const u = Math.sin(Math.PI * clamp(tau / 0.32, 0, 1)), m = BODY;
  S_.squash = 0.18 * u; S_.rootY = -0.04 * u;
  for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.3 * u; bones['shin_' + s].userData.pose = -m * 0.55 * u; }
  bones.chest.userData.pose = m * 0.12 * u;
  bones.upper_arm_near.userData.pose = -m * 0.5 * u; bones.upper_arm_far.userData.pose = -m * 0.5 * u;
  if (tau > 0.34) S_.next = 'idle';
};
const ACTIONS = Object.keys(A);
// Being carried happens in the FRONT view: the face kit is only mounted there, so in the side view the whole
// pick-up sequence had no access to her drawn eyes or her effect decals. It is also right dramatically -
// she is looking at the hand that has hold of her.
const VIEW_FOR = { walk: 'side', run: 'side', hop: 'side', sleep: 'side', wake: 'side', turn: 'side', stumble: 'side',
  startle: 'front', dangle: 'front', fall: 'front', land: 'front',
  idle: 'front', look: 'front', talk: 'front', wave: 'front', sit: 'front', stretch: 'front', celebrate: 'front', tail_react: 'front', dance: 'front' };
function wantView(action) { const w = VIEW_FOR[action] || VIEW_NAME; return VIEWS[w] ? w : (VIEWS.side ? 'side' : Object.keys(VIEWS)[0]); }
function switchView(name) {
  if (S_.viewSwap && S_.viewSwap.to !== name) S_.viewSwap = null;   // an action that wants the view we are leaving cancels the swap
  if (name === VIEW_NAME || !VIEWS[name]) return;
  S_.viewSwap = { t0: S_.t, from: VIEW_NAME, to: name };
}

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
  curious: { browRot: 0.05, browY: 3, eyeScale: 1.1, mouthW: 1.0, mouthH: 1.1, closed: 0, kit: 'gentle' },   // she wears this the whole time you hover her; 'surprised' pinned her wide-eyed and killed her gaze
};
const KIT_TO_EMO = { relaxed: 'neutral', sleepy: 'neutral', affection: 'happy', panic: 'surprised', shy: 'awkward', smug: 'happy', pouty: 'angry', focused: 'think', hurt: 'sad', confused: 'question', shocked: 'surprised', gentle: 'happy', cheerful: 'happy' };
const KIT_NOT_MOODS = /^(blink|aa|ih|ou|ee|oh|look)/;
const emoOf = (name) => EMO[name] || EMO[KIT_TO_EMO[name]] || EMO.neutral;
const kitMood = (name) => (kit && kit.recipe(name) && !KIT_NOT_MOODS.test(name) ? name : (EMO[name] && kit && kit.recipe(EMO[name].kit) ? EMO[name].kit : 'neutral'));
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
// how hard each feeling lands
const EMO_KICK = { panic: 1, shocked: 1, surprised: 0.9, hurt: 0.8, cheerful: 0.7, affection: 0.7, angry: 0.7,
  happy: 0.5, pouty: 0.4, smug: 0.4, confused: 0.4, curious: 0.3, sad: 0.25, gentle: 0, relaxed: 0, sleepy: 0, neutral: 0 };
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
  const closed = S_.eyesHold != null ? S_.eyesHold : clamp(Math.max(blinkAmt, S_.eyesClosed || 0), 0, 1);
  if (isFront() && kit) {
    kit.setMood(kitMood(S_.emotion));
    kit.eyesClosed = S_.eyesClosed || 0;
    kit.sleepy = S_.emotion === 'sleepy' || S_.action === 'sleep' ? 1 : 0;
    kit.setViseme(S_.action === 'talk' ? VISEMES[Math.floor(S_.tau * 5.5) % VISEMES.length] : null);   // slower than the 0.12 s crossfade, or the mouth is always half-faded
    const { yaw, pitch } = S_.look;
    const thr = S_.action === 'look' ? 0.4 : 0.45;
    kit.setLook(Math.abs(yaw) > thr ? (yaw > 0 ? 'left' : 'right') : pitch > thr ? 'up' : pitch < -thr ? 'down' : null);
    kit.update(dt);
    return;
  }
  const eyeY = Math.max(0.06, emoCur.eyeScale * (1 - closed));
  const px = S * 1;   // 1 px in world units
  const [ix, iy] = S_.irisOff || [0, 0];
  // A shut eye is a lash line resting low, not an eye squashed to a sliver. So the white and the iris fade out
  // as the lid comes down, while the lash keeps most of its width and travels to where the lid closes.
  for (const k of ['eyewhite', 'irides']) {
    const m = facePieces[k]; if (!m) continue;
    m.scale.set(1, eyeY, 1); m.position.copy(m.userData.base);
    m.material.opacity = 1 - closed; m.material.transparent = true; m.visible = closed < 0.98;
  }
  if (facePieces.irides) facePieces.irides.position.add(new THREE.Vector3(ix * px, iy * px, 0));
  if (facePieces.eyelash) {
    const m = facePieces.eyelash;
    m.scale.set(1, Math.max(0.4, eyeY), 1);
    m.position.copy(m.userData.base);
    m.position.y -= closed * 0.42 * (EYE_H || 40) * px;
  }
  if (facePieces.eyebrow) { const m = facePieces.eyebrow; m.rotation.z = emoCur.browRot * M(); m.position.copy(m.userData.base); m.position.y += emoCur.browY * px; }
  if (facePieces.mouth) { const m = facePieces.mouth; m.scale.set(emoCur.mouthW, emoCur.mouthH * (1 + 2.2 * (S_.mouthOpen || 0)), 1); }
}

// ------------------------------------------------------------------ picking
// Hit testing against her actual pixels rather than a box: render the few pixels around the cursor into a
// tiny target and read the alpha back. One small render, exact silhouette, works while paused, and the
// window size doubles as the grab tolerance. Nearest bone names the part, for reactions.
const PICK = { size: 15, target: null, cam: null, buf: null };
function pickAt(px, py) {
  if (!PICK.target) {
    PICK.target = new THREE.WebGLRenderTarget(PICK.size, PICK.size);
    PICK.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    PICK.cam.position.z = 5;
    PICK.buf = new Uint8Array(PICK.size * PICK.size * 4);
  }
  const [ux, uy] = toUnits(px, py);
  const r = PICK.size / 2 / STAGE.k;
  PICK.cam.left = ux - r; PICK.cam.right = ux + r; PICK.cam.top = uy + r; PICK.cam.bottom = uy - r;
  PICK.cam.updateProjectionMatrix();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(PICK.target);
  renderer.render(scene, PICK.cam);
  renderer.readRenderTargetPixels(PICK.target, 0, 0, PICK.size, PICK.size, PICK.buf);
  renderer.setRenderTarget(prev);
  for (let i = 3; i < PICK.buf.length; i += 4) if (PICK.buf[i] > 8) return true;
  return false;
}
const ZONE_OF = (n) => (n === 'head' || n === 'neck' ? 'head'
  : n.startsWith('tail') ? 'tail'
    : n.startsWith('hair') || n.startsWith('ahoge') ? 'hair'
      : n.startsWith('skirt') ? 'skirt'
        : /thigh|shin|foot/.test(n) ? 'legs'
          : /arm|hand/.test(n) ? 'arms' : 'body');
function zoneAt(px, py) {
  const [ux, uy] = toUnits(px, py);
  const target = new THREE.Vector3(ux, uy, 0), at = new THREE.Vector3();
  let best = null, bd = Infinity;
  for (const b of boneList) {
    if (!b.userData.head) continue;
    b.getWorldPosition(at);
    const d = at.distanceToSquared(target);
    if (d < bd) { bd = d; best = b.name; }
  }
  return best ? ZONE_OF(best) : null;
}

// ------------------------------------------------------------------ frame
function applyPose() {
  for (const b of boneList) { b.rotation.z = b.userData.pose + b.userData.spring; b.scale.set(b.userData.sx || 1, b.userData.sy || 1, 1); }
  if (isFront()) for (const [layer, bone] of [['handwear_l', 'upper_arm_l'], ['handwear_r', 'upper_arm_r']]) {
    const m = layerMeshes[layer]; if (!m) continue;
    if (m.userData.baseOrder == null) m.userData.baseOrder = m.renderOrder;
    // A raised arm draws in front of the hair. The test needs hysteresis: one bare threshold makes the layer pop
    // in and out every time an arm crosses it, which is precisely what an arm does while she is dancing.
    const raised = Math.abs(bones[bone].userData.pose);
    m.userData.armUp = m.userData.armUp ? raised > 0.60 : raised > 0.85;
    m.renderOrder = m.userData.armUp ? 40 : m.userData.baseOrder;
  }
  bones.root.position.set(restHead.root.x, restHead.root.y + (S_.rootY || 0), 0);
  bones.root.rotation.z = S_.rootRot || 0;
}
const snapshotPose = () => ({ pose: boneList.map((b) => b.userData.pose), sx: boneList.map((b) => b.userData.sx || 1), sy: boneList.map((b) => b.userData.sy || 1), rootY: S_.rootY || 0, rootRot: S_.rootRot || 0, rootX: S_.rootX || 0, rootScale: S_.rootScale || 1, eyesClosed: S_.eyesClosed || 0, mouthOpen: S_.mouthOpen || 0, squash: S_.squash || 0 });
function applyBlend() {
  // crossfade from the pose the previous action left, so action switches never pop
  const bl = S_.blend; if (!bl) return;
  const u = clamp((S_.t - bl.t0) / bl.dur, 0, 1), f = bl.from;
  if (u >= 1 || f.pose.length !== boneList.length) { S_.blend = null; return; }
  const k = smooth(u);
  boneList.forEach((b, i) => { b.userData.pose = lerp(f.pose[i], b.userData.pose, k); b.userData.sx = lerp(f.sx[i], b.userData.sx || 1, k); b.userData.sy = lerp(f.sy[i], b.userData.sy || 1, k); });
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
  h.ax = (h.vx - (h.pvx || 0)) / Math.max(dt, 1e-3);
  h.pvx = h.vx;
  // how alarming is this? height, shaking (which means reversals, so large |ax|) and how far she is swinging.
  // Where she was grabbed biases it: by the tail is worse than round the middle.
  const lift = liftFrac();
  h.shake = lerp(h.shake || 0, clamp(Math.abs(h.ax) / 34, 0, 1), 1 - Math.exp(-dt * 3));
  h.distress = clamp(0.45 * lift + 0.85 * h.shake + 0.35 * clamp(Math.abs(h.th) / 0.9, 0, 1) + (h.zoneBias || 0), 0, 1);
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
    if (S_.facing > 0 ? S_.x < back : S_.x > back) S_.x += Math.sign(back - S_.x) * Math.min(Math.abs(back - S_.x), S_.speed * dt * 2);   // ease in, never teleport
  }
  let sx = M();
  if (S_.turn) {
    const u = (S_.t - S_.turn.t0) / 0.28;
    if (u >= 1) { S_.facing = -S_.turn.from; S_.turn = null; if (S_.action === 'turn') S_.next = 'idle'; sx = M(); }
    else { const fromM = NATIVE ? S_.turn.from * NATIVE : 1; S_.turnSquash = Math.max(0.14, Math.abs(Math.cos(Math.PI * u))); sx = (NATIVE ? fromM * (u < 0.5 ? 1 : -1) : 1) * S_.turnSquash; }
  }
  if (S_.viewSwap) {
    const u = (S_.t - S_.viewSwap.t0) / 0.24;
    if (u >= 0.5 && VIEW_NAME !== S_.viewSwap.to) { activate(VIEWS[S_.viewSwap.to]); showOnly(S_.viewSwap.to); S_.prevPos.clear(); for (const b of boneList) { b.userData.spring = 0; b.userData.springVel = 0; } S_.blend = null; sx = M(); }
    sx *= Math.max(0.04, Math.abs(Math.cos(Math.PI * u)));
    if (u >= 1) S_.viewSwap = null;
  }
  const sc = S_.rootScale || 1, sq = S_.squash || 0;
  const stretch = S_.turn ? 1 + 0.12 * (1 - (S_.turnSquash ?? 1)) : 1;   // squash and stretch: she gets a touch taller as she narrows, so a turn reads as a turn
  group.scale.set(sx * sc * (1 + sq), sc * (1 - sq) * stretch, 1);
  group.position.x = S_.x + (S_.rootX || 0); group.position.y = GROUND_Y + S_.y;
  applyPose();
  // the impulse of a feeling arriving, decaying over about half a second
  if (S_.emoKick) {
    const age = S_.t - S_.emoKick.t0;
    if (age > 0.7) S_.emoKick = null;
    else {
      const k = S_.emoKick.mag * Math.exp(-6 * age);
      bones.head.userData.pose += 0.07 * k * Math.sin(age * 34);
      if (!S_.emoKick.fired) {
        S_.emoKick.fired = true;
        for (const n of ['ahoge_1', 'ahoge_2', 'hair_1', 'hair_l_1', 'hair_r_1']) {
          const b = bones[n]; if (b) b.userData.springVel += 5 * S_.emoKick.mag;
        }
      }
    }
  }
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
  // a throw inside tick must not take the render loop with it: the pet is always on top, a frozen one is unusable
  try { if (!S_.paused) tick(dt); } catch (err) { window.__error = String(err.stack || err); console.error(err); S_.action = 'idle'; S_.blend = null; }
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
    S_.blend = want === VIEW_NAME ? { from: snapshotPose(), t0: S_.t, dur: name === 'land' || name === 'stumble' || name === 'startle' ? 0.05 : 0.22 } : null;
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
  emotion(name) {
    if (!EMO[name] && !KIT_TO_EMO[name] && !(kit && kit.recipe(name))) throw new Error('unknown emotion ' + name);
    // A feeling arriving should move her, not just her face: a small head snap and a kick through the hair and
    // ahoge springs. Without it a mood change is a silent texture swap.
    if (name !== S_.emotion) S_.emoKick = { t0: S_.t, mag: EMO_KICK[name] ?? 0.35 };
    S_.emotion = name;
  },
  eyes(closed) { S_.eyesHold = closed == null ? null : clamp(closed, 0, 1); },   // testing hook: hold the lids
  look(yaw, pitch) { S_.look.yaw = clamp(yaw || 0, -1, 1); S_.look.pitch = clamp(pitch || 0, -1, 1); },
  lookAt(px, py) { if (px == null) { lab.look(0, 0); return; } const [hx, hy] = lab.headPx(); lab.look((px - hx) / (STAGE.k * 1.2), (hy - py) / (STAGE.k * 0.9)); },
  headPx() { const v = new THREE.Vector3(); bones.head.getWorldPosition(v); return toPx(v.x, v.y); },
  // stage + position (units) and her hit box (window px, top-left origin)
  stage: () => ({ k: STAGE.k, w: STAGE.w, h: STAGE.h, margin: STAGE.margin, wPx: window.innerWidth, hPx: window.innerHeight }),
  pos: () => ({ x: S_.x, y: S_.y, vx: S_.vx, vy: S_.vy, facing: S_.facing, action: S_.action, tau: S_.tau, view: VIEW_NAME, speed: S_.speed || 0, held: !!S_.held, airborne: S_.y > 0.001, turning: !!S_.turn, landed: S_.landed }),
  carry: () => (S_.held ? { lift: +liftFrac().toFixed(3), shake: +(S_.held.shake || 0).toFixed(3), swing: +Math.abs(S_.held.th || 0).toFixed(3), distress: +(S_.held.distress || 0).toFixed(3), zone: S_.held.zone } : null),
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
  hold(px, py, zone) {
    const [ux, uy] = toUnits(px, py);
    const BIAS = { tail: 0.25, hair: 0.2, legs: 0.15, skirt: 0.1, arms: 0.05, head: -0.1, body: -0.15 };
    S_.held = { dx: S_.x - ux, dy: S_.y - uy, tx: S_.x, ty: S_.y, vx: 0, vy: 0, ax: 0, pvx: 0,
      th: 0, w: 0, shake: 0, distress: 0, zone: zone || null, zoneBias: BIAS[zone] ?? 0 };
    S_.vx = 0; S_.vy = 0; S_.speed = 0; S_.turn = null;
    lab.start('startle');
  },
  holdAt(px, py) { if (!S_.held) return; const [ux, uy] = toUnits(px, py); S_.held.tx = clamp(ux + S_.held.dx, 0.3, STAGE.w - 0.3); S_.held.ty = clamp(uy + S_.held.dy, 0, Math.max(0, STAGE.h - 2.0)); },
  release() {
    if (!S_.held) return; const h = S_.held; S_.held = null; S_.rootRot = 0; S_.rootX = 0;
    S_.vx = clamp(h.vx, -12, 12); S_.vy = clamp(h.vy, -6, 8); S_.rootRot = 0; S_.rootX = 0;
    if (S_.y > 0.01 || S_.vy > 0) lab.start('fall'); else { S_.vx = 0; lab.start('land'); }
  },
  onTick(fn) { tickHooks.push(fn); },
  // exact hit test on her pixels (window px); zone names the part for reactions
  pick(px, py) { return pickAt(px, py); },
  zone(px, py) { return zoneAt(px, py); },
  showLayer(name, v) { const m = layerMeshes[name]; if (m) m.visible = !!v; return !!m; },
  bone(name) { const b = bones[name]; if (!b) return null; const v = new THREE.Vector3(); b.getWorldPosition(v); return { pose: +b.userData.pose.toFixed(3), spring: +b.userData.spring.toFixed(3), rot: +b.rotation.z.toFixed(3), sy: b.userData.sy, px: toPx(v.x, v.y).map((n) => Math.round(n)), visible: b.parent ? b.parent.visible : null }; },
  snapshot: () => ({ view: VIEW_NAME, native: NATIVE, mirror: M(), scaleX: +group.scale.x.toFixed(3), action: S_.action, tau: +S_.tau.toFixed(2), x: +S_.x.toFixed(3), y: +S_.y.toFixed(3), facing: S_.facing, rootY: +(S_.rootY || 0).toFixed(3), springs: Object.fromEntries(springs.flatMap((s) => s.bones).map((n) => [n, +bones[n].userData.spring.toFixed(3)])) }),
  fps: () => +(S_.fps.length / S_.fps.reduce((a, b) => a + b, 0)).toFixed(1),
};
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;   // typing into the chat box is not a command
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
