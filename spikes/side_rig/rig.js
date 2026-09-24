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
const PET_MODE = Q.get('pet') === '1';     // the desktop pet: pet.js owns the keyboard, and there is no HUD
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
  blink: { next: 2.2, phase: 0 }, look: { yaw: 0, pitch: 0 }, fps: [], lastFrame: performance.now(), prevPos: new Map(), turn: null, blend: null, next: null, squash: 0, landed: 0,
  plant: 1, vig: 1, danceBeat0: 0, talkUntil: 0, syl: null, talkOpen: 0, gaze: null, snapCur: null, snapPrev: null };
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
    bone.userData = { head: h, tail: t, tailLocal: t.clone().sub(h), len: h.distanceTo(t), pose: 0, sx: 1, sy: 1, spring: 0, springVel: 0, dir: Math.atan2(t.y - h.y, t.x - h.x) };
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
    heightUnits: restBox.maxY - floorY, native: rigJ.facing === '-x' ? -1 : rigJ.facing === '+x' ? 1 : 0,
    // where her ankles are when she simply stands, in the group's frame: what the ground solver holds them to
    standAnkle: Math.min(...['foot_near', 'foot_far'].map((n) => (B[n].userData.head ? B[n].userData.head.y : Infinity))) };
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
// What pushes each chain. A strand hanging from a point is swung by three things: the point being ACCELERATED out
// from under it (accel), the air it is dragged through (drag), and its parent turning under it (turn, a fraction of
// the chain's damping applied to the parent's angular velocity, so the strand lags a head turn instead of riding
// it rigidly). The push becomes a torque through the strand's own direction - cross(dir, push) / length - which is
// what makes the two front locks flare in MIRROR on a bounce (they hang out to opposite sides, so a vertical push
// turns them opposite ways) while a sideways sway still swings them together. The old drive read only the pivot's
// velocity, with no geometry, so both locks always moved as one and a bounce barely moved them at all.
// The numbers are per chain so the walk keeps the look it was tuned to; damp scales the chain's own damping.
const SPRING_DRIVE = {
  tail:   { accel: 0.07, drag: 0.14, turn: 0.5, damp: 0.65 },   // and a heavy tail rings on after she stops
  hair:   { accel: 0.035, drag: 0.11, turn: 0.6 },
  hair_l: { accel: 0.30, drag: 0.16, turn: 0.25 },   // the front locks: light, loose, and what a bounce should flare
  hair_r: { accel: 0.30, drag: 0.16, turn: 0.25 },
  skirt:  { accel: 0.06, drag: 0.20, turn: 0.4 },
  ahoge:  { accel: 0.009, drag: 0.075, turn: 0.6 },
};
const SPRING_ACC_MAX = 60;                // units/s^2: past this it is a teleport, not a motion
const SPRING_LP = 0.03;                   // s: finite-difference acceleration is noisy, so it is low-passed
function stepSprings(dt) {
  if (!(dt > 0)) return;
  // The springs feel her PHYSICAL motion. The view swap's squash is a camera trick, so it is taken back out of the
  // group's scale while the pivots are measured; left in, every view swap slammed every chain.
  const shown = group.scale.x;
  if (group.userData.physScaleX != null) group.scale.x = group.userData.physScaleX;
  group.updateMatrixWorld(true);
  const mir = Math.sign(group.scale.x) || 1;   // a local angle is the world angle times the group's mirror
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const lp = 1 - Math.exp(-dt / SPRING_LP);
  // Carried, her chains should hang heavier and swing longer than they do while she walks. Softer and less
  // damped, with more room to travel; the walk stays exactly as tuned.
  const carried = !!S_.held || S_.y > 0.02;
  // A long frame (the window was blocked) is integrated in short steps, so the springs cannot blow up.
  const nSub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / nSub;
  for (const sp0 of springs) {
    const o = carried && HELD_SPRING[sp0.name];
    const sp = o ? { ...sp0, ...o } : sp0;
    const dr = SPRING_DRIVE[sp.name] || SPRING_DRIVE.tail, damping = sp.damping * (dr.damp ?? 1);
    for (const name of sp.bones) {
      const b = bones[name], u = b.userData;
      b.getWorldPosition(p);
      q.set(u.tailLocal ? u.tailLocal.x : 0, u.tailLocal ? u.tailLocal.y : -0.1, 0); b.localToWorld(q);
      let dx = q.x - p.x, dy = q.y - p.y; const len = Math.max(Math.hypot(dx, dy), 1e-4); dx /= len; dy /= len;
      const e = b.parent.matrixWorld.elements, pa = Math.atan2(-e[4], e[5]);   // the parent's up axis, in world
      let st = S_.prevPos.get(name);
      if (st && !(Math.hypot(p.x - st.x, p.y - st.y) <= 0.3)) st = null;       // teleported (setPos, begin), or not a number: start over
      if (!st) { st = { x: p.x, y: p.y, vx: 0, vy: 0, ax: 0, ay: 0, pa, pw: 0, n: 0 }; S_.prevPos.set(name, st); }
      else {
        const vx = (p.x - st.x) / dt, vy = (p.y - st.y) / dt;
        if (st.n >= 1) {                                    // a velocity needs two frames, an acceleration three
          st.ax += (clamp((vx - st.vx) / dt, -SPRING_ACC_MAX, SPRING_ACC_MAX) - st.ax) * lp;
          st.ay += (clamp((vy - st.vy) / dt, -SPRING_ACC_MAX, SPRING_ACC_MAX) - st.ay) * lp;
        }
        let da = pa - st.pa; da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
        st.pw += (da / dt - st.pw) * lp;
        st.x = p.x; st.y = p.y; st.vx = vx; st.vy = vy; st.pa = pa; st.n++;
      }
      const push = dr.accel * (dx * st.ay - dy * st.ax) + dr.drag * (dx * st.vy - dy * st.vx);
      const drive = mir * (-sp.inertia * push / len - damping * dr.turn * st.pw);
      for (let i = 0; i < nSub; i++) {
        const acc = -sp.stiffness * u.spring - damping * u.springVel + drive;
        u.springVel += acc * h;
        u.spring += u.springVel * h;
        // at the limit the strand stops, it does not keep pushing outward and then stick there
        if (Math.abs(u.spring) > sp.limit) { u.spring = Math.sign(u.spring) * sp.limit; if (u.springVel * u.spring > 0) u.springVel = 0; }
      }
      if (!Number.isFinite(u.spring) || !Number.isFinite(u.springVel)) { u.spring = 0; u.springVel = 0; }
    }
  }
  group.scale.x = shown;
}
// A view swap hands the chains from one rig to the other instead of zeroing them, so a tail that was still
// swinging when she stopped walking keeps swinging in the front view. Angles travel in world terms (a side-view
// angle is mirrored with her facing); the side view's single hair chain feeds both front locks and back.
function carrySprings(fromView, toView) {
  const out = {}, mFrom = Math.sign(mirrorFor(fromView)) || 1, mTo = Math.sign(mirrorFor(toView)) || 1;
  const twin = (n) => {
    let m = /^hair_(\d)$/.exec(n); if (m) return ['hair_l_' + m[1], 'hair_r_' + m[1]];
    m = /^hair_[lr]_(\d)$/.exec(n); if (m) return ['hair_' + m[1]];
    return [n];
  };
  for (const sp of fromView.springs) for (const n of sp.bones) {
    const u = fromView.bones[n].userData;
    for (const t of twin(n)) {
      const o = out[t] || (out[t] = { s: 0, v: 0, k: 0 });
      o.s += u.spring * mFrom; o.v += u.springVel * mFrom; o.k++;
    }
  }
  for (const sp of toView.springs) for (const n of sp.bones) {
    const u = toView.bones[n].userData, o = out[n];
    u.spring = o ? clamp(o.s / o.k * mTo, -sp.limit, sp.limit) : 0; u.springVel = o ? o.v / o.k * mTo : 0;
  }
}

// ------------------------------------------------------------------ actions (poses are in the group's local frame; M() = its mirror)
const A = {};
// Poses are authored in the group's local frame, and that frame is ALREADY mirrored by M(). So a body-relative
// angle - tuck the knees, curl forward, lie down - must not be multiplied by M() as well, or it inverts when she
// turns around: the tuned value simply becomes its own mirror image. BODY is this frame's fixed forward sign; use
// it for poses, and M() only for quantities written to world space (root slides, drag velocity).
const BODY = -1;
// S_.plant is how firmly her feet are held to the floor by the ground solver in tick(): 1 = standing (the default),
// 0 = the action owns her height (a jump, lying down, being carried). Values between are part-way, e.g. the dance's
// bounce hands her height over to the jump for its airtime and takes it back as she lands.
const poseReset = () => { for (const b of boneList) { b.userData.pose = 0; b.userData.sx = 1; b.userData.sy = 1; } S_.rootY = 0; S_.rootRot = 0; S_.rootX = 0; S_.rootScale = 1; S_.squash = 0; S_.eyesClosed = 0; S_.mouthOpen = 0; S_.irisOff = [0, 0]; S_.speed = 0; S_.plant = 1; };
// A bent knee in the FRONT view is a shortened leg (the knee comes at the camera), not a rotation. Scale is
// inherited down the chain, so the shin's shortening multiplies the thigh's rather than adding to it - which is why
// adding the two up (the old sit formula) under-dropped her by about 12 px. The foot is scaled back to its own size
// so the shoe does not squash. Returns how far the ankle really came up, in the group's units.
function bendLegs(side, k) {
  const th = bones['thigh_' + side].userData, sh = bones['shin_' + side].userData, ft = bones['foot_' + side].userData;
  k = clamp(k, 0, 0.9);
  const a = 1 - 0.45 * k, b = 1 - 0.85 * k;
  th.sy = a; sh.sy = b; ft.sy = 1 / (a * b);
  const t1 = th.tail ? Math.abs(th.tail.y - th.head.y) : 0, t2 = sh.tail ? Math.abs(sh.tail.y - sh.head.y) : 0;
  return t1 * (1 - a) + t2 * (1 - a * b);
}
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
  poseReset(); S_.plant = 0;          // a jump owns her height
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
// The mouth is not driven here: speech is `lab.talking(secs)`, which moves her mouth in any action for exactly as
// long as there is something being said (see speechCell). A talk action with nothing to say keeps its mouth shut.
A.talk = (tau) => {
  A.idle(tau);
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
    // How far that drops her is left to the ground solver, which measures where the ankles really end up.
    const fold = 0.62 * u;
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.sy = 1 - fold; bones['shin_' + s].userData.sy = 1 - fold * 0.75; }
    bones.shin_near.userData.pose = 0.62 * u; bones.shin_far.userData.pose = -0.62 * u;
    bones.foot_near.userData.pose = 0.55 * u; bones.foot_far.userData.pose = -0.55 * u;
    bones.skirt_1.userData.sx = 1 + 0.18 * u; bones.skirt_2.userData.sx = 1 + 0.34 * u; bones.skirt_2.userData.sy = 1 - 0.18 * u;
    bones.upper_arm_near.userData.pose = -0.42 * u; bones.forearm_near.userData.pose = -0.85 * u;
    bones.upper_arm_far.userData.pose = 0.42 * u; bones.forearm_far.userData.pose = 0.85 * u;
    bones.chest.userData.sy = 1 - 0.03 * u + 0.015 * Math.sin(tau * 1.6);
    tailSway(tau, 0.05);
  } else {
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * -1.45 * u; bones['shin_' + s].userData.pose = m * 1.35 * u; }
    S_.rootY = -L * 0.92 * u; S_.plant = 1 - u;   // side view: she sits on her bottom, which is not where her ankles are
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
  S_.plant = 0;                                         // lying down: her ankles are not what touches the floor
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
A.wake = (tau) => { const u = 1 - smooth(clamp(tau / 1.0, 0, 1)); A.sleep(1.0); S_.plant = u > 0 ? 0 : 1; S_.rootRot *= u; S_.rootY *= u; S_.rootX *= u; S_.rootScale = 1 - 0.08 * u; S_.eyesClosed = u; for (const b of boneList) b.userData.pose *= u; if (u <= 0) { A.idle(tau); S_.next = 'idle'; } };
A.turn = (tau) => { A.idle(tau); if (!S_.turn) S_.turn = { t0: S_.t, from: S_.facing }; };
// The stretch is laid over her idle, so she keeps breathing through it and simply IS idle once it is over; built on
// a blank pose it froze solid after 2.3 s and stayed frozen until something else happened to start.
A.stretch = (tau) => {
  A.idle(tau);
  const u = smooth(clamp(tau / 0.6, 0, 1)) * (1 - smooth(clamp((tau - 1.8) / 0.5, 0, 1))), m = BODY;
  const raise = isFront() ? 2.05 : 2.9;
  bones.upper_arm_near.userData.pose += raise * u; bones.upper_arm_far.userData.pose += raise * u * farSign();
  if (isFront()) { bones.chest.userData.sy += 0.04 * u; bones.head.userData.pose += 0.05 * u; }
  else { bones.chest.userData.pose += m * 0.12 * u; bones.head.userData.pose += m * 0.2 * u; }
  S_.squash = -0.03 * u;                                  // she gets taller, she does not float: her feet stay down
  S_.eyesClosed = 0.8 * u; S_.mouthOpen = 0.6 * u;
  if (tau > 2.3) S_.next = 'idle';
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
  rootX: 0, rootY: 0, rootRot: 0, squash: 0, mouth: 0.14, eyes: 0, plant: 1,
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
  p.rootY = 0.030 * w(0.15);                              // a dip and a rise, not a hover: see the knee give in A.dance
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
  // (flat before its first beat: the crossfade into it runs this at negative bt, which used to add a fourth hop)
  const b = (0.5 - 0.5 * Math.cos(2 * Math.PI * clamp(bt, 0, 3))) * (1 - ease((bt - 3) / 0.6));
  p.rootY = 0.085 * b; p.squash = 0.055 * (1 - b);
  p.plant = 1 - b;                                         // her feet leave the floor only for the airtime of each bounce
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
  // 1.1 beats is about 0.6 s: still a strike, because everything around it is held, but her arm no longer covers
  // more than a tenth of a radian between two frames even at her most vigorous. At 0.68 of a beat it did (0.13),
  // which strobes rather than reading as speed.
  const k = ease(bt / 1.1) * (1 - ease((bt - 2.8) / 1.2));   // and lets go over longer still, since the next move takes over
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

// [move, beats, beats of overlap into the next move]. Half a beat is enough where the two moves meet in similar
// places; where they do not - the roll ends with her arms up and the scoop starts with them down, the scoop ends
// with one arm low and the bounce starts with both overhead, the bounce ends overhead and the pop starts low - half
// a beat made the arms cross that distance at over 0.1 rad a frame, which strobes. A full beat there is still a
// transition, not a new move. (The pose's own strike and release are the fourth place; see mvPose.)
const ROUTINE = [[mvStep, 4, 0.5], [mvRoll, 4, 1.0], [mvScoop, 4, 1.0], [mvBounce, 4, 1.0], [mvPop, 4, 0.5], [mvPose, 4, 0.5]];
// how big she dances it. Delighted is not the same dance as tired, and it should not look like it.
const VIGOUR = { cheerful: 1.14, happy: 1.10, affection: 1.06, smug: 1.02, curious: 0.95, gentle: 0.92,
  pouty: 0.86, relaxed: 0.85, sad: 0.72, sleepy: 0.62, hurt: 0.68 };
const ROUTINE_BEATS = ROUTINE.reduce((n, m) => n + m[1], 0);

// She does not always start from the top: `lab.start('dance')` picks the move she starts on (S_.danceBeat0).
const moveBeat = (i) => ROUTINE.slice(0, i).reduce((n, m) => n + m[1], 0);
// The ground solver holds her feet to the floor, so a move's lift can no longer float her (it used to: 9-28 px in
// every move but the bounce). What a lift does instead is straighten her out of the slight knee bend she dances in,
// and a negative one bends her deeper, so every move keeps its rise and fall with her feet planted.
const KNEE_GIVE = 0.06, KNEE_PER_LIFT = 2;

A.dance = (tau) => {
  poseReset();
  let bt = (tau / BEAT + (S_.danceBeat0 || 0)) % ROUTINE_BEATS;
  let i = 0;
  while (bt >= ROUTINE[i][1]) { bt -= ROUTINE[i][1]; i = (i + 1) % ROUTINE.length; }
  const [fn, len, xfade] = ROUTINE[i];
  let pose = blankPose();
  fn(bt, pose);
  if (bt > len - xfade) {                                  // ease into the next move over the last beat or half beat
    const nxt = ROUTINE[(i + 1) % ROUTINE.length];
    const q = blankPose();
    nxt[0](bt - len, q);                                   // the next move, started early and running negative
    pose = mixPose(pose, q, ease((bt - (len - xfade)) / xfade));
  }
  // a small continuous groove underneath everything, so even a held pose is alive
  const g = 2 * Math.PI * tau / (BEAT * 2);
  pose.rootY += 0.006 * Math.sin(g);
  pose.chestSy += 0.012 * Math.sin(g + 0.8);
  // Her mood's vigour is eased toward, not applied raw: a mood change mid-dance used to rescale the whole pose in
  // one frame and throw her hand 146 px.
  S_.vig += ((own(VIGOUR, S_.emotion) ?? 1) - S_.vig) * (1 - Math.exp(-(S_.dt || 0) * 3));
  const vig = S_.vig;
  if (vig !== 1) {
    for (const key of Object.keys(pose)) {
      if (key === 'tail') { for (let t = 0; t < 6; t++) pose.tail[t] *= vig; }
      else if (key === 'chestSy') pose.chestSy = 1 + (pose.chestSy - 1) * vig;
      else if (key !== 'mouth' && key !== 'eyes' && key !== 'plant') pose[key] *= vig;
    }
  }
  const give = clamp(KNEE_GIVE - KNEE_PER_LIFT * pose.rootY, 0, 3 * KNEE_GIVE);

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
  bendLegs('near', pose.shortN + give); bendLegs('far', pose.shortF + give);
  for (let t = 0; t < 6; t++) { const b = bones['tail_' + (t + 1)]; if (b && b.userData.head) b.userData.pose = pose.tail[t]; }
  // The squint goes to the face kit as a lid amount. On an open eye that is a half-closed lid; on eyes that are
  // already arcs (happy) the kit shows it as cheeks pushing up instead, rather than swapping the arcs for a lid.
  S_.mouthOpen = pose.mouth; S_.eyesClosed = pose.eyes; S_.plant = pose.plant;
};
A.tail_react = (tau) => { A.idle(tau); const k = Math.exp(-tau * 1.2) * Math.sin(tau * 9); for (const [i, n] of ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'].entries()) bones[n].userData.pose = 0.35 * k * (0.4 + i * 0.15); };
// Her upper body lurches; her feet do not. The legs hang off the hips bone, so the thighs take the lurch back out
// or both feet swing forward with it, and her height is the ground solver's - the old -0.05 sank her 11 px into
// the floor, which on the desktop means behind the taskbar edge.
A.stumble = (tau) => { A.idle(tau); const u = Math.sin(Math.min(tau, 0.6) / 0.6 * Math.PI), m = BODY; bones.hips.userData.pose = m * 0.35 * u; bones.thigh_near.userData.pose -= m * 0.35 * u; bones.thigh_far.userData.pose -= m * 0.35 * u; bones.chest.userData.pose = m * 0.25 * u; S_.eyesClosed = 0.5 * u; S_.mouthOpen = 0.7 * u; if (tau > 0.9) S_.next = 'idle'; };
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
  poseReset(); S_.plant = 0;
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
  poseReset(); S_.plant = 0;
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
  poseReset(); S_.plant = 0;
  const u = smooth(clamp(tau / 0.25, 0, 1)), m = BODY;
  if (isFront()) {
    // Facing us, the side view's pose is wrong twice over: the far arm must mirror the near one or it swings across
    // her body, and a thigh rotation kicks a leg out sideways instead of bending the knee. So: both arms up and out,
    // knees drawn up by shortening the legs, and the body lowered by exactly what the legs lost, so the feet stay
    // at her contact height and she lands on them rather than on thin air.
    const fs = farSign(), flail = 0.14 * Math.sin(tau * 11) * u;
    bones.upper_arm_near.userData.pose = 2.0 * u + flail; bones.upper_arm_far.userData.pose = (1.85 * u - flail) * fs;
    bones.forearm_near.userData.pose = 0.35 * u; bones.forearm_far.userData.pose = 0.35 * u * fs;
    S_.rootY = -Math.min(bendLegs('near', 0.34 * u), bendLegs('far', 0.26 * u));
    bones.chest.userData.sy = 1 + 0.03 * u;
    bones.head.userData.pose = 0.05 * Math.sin(tau * 7) * u;
    S_.squash = -0.04 * u;
  } else {
    bones.upper_arm_near.userData.pose = -m * 2.2 * u; bones.upper_arm_far.userData.pose = -m * 2.0 * u;
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.45 * u; bones['shin_' + s].userData.pose = -m * 0.8 * u; }
    bones.chest.userData.pose = -m * 0.08 * u; bones.head.userData.pose = -m * 0.1 * u;
  }
  S_.mouthOpen = 0.8 * u;
  tailSway(tau * 3, 0.2);
};
// A landing is a spring, not a half sine: she is squashed flat on impact, rebounds a little past standing and
// settles. Released from 0.18 with w = 14 and damping 0.45, the rebound peaks at about -0.04 near 0.25 s, and the
// tail is faded out so it is exactly zero by 0.45 s.
const LAND_W = 14, LAND_Z = 0.45, LAND_WD = LAND_W * Math.sqrt(1 - LAND_Z * LAND_Z);
const landSpring = (t) => (t <= 0 ? 1 : Math.exp(-LAND_Z * LAND_W * t) * (Math.cos(LAND_WD * t) + (LAND_Z * LAND_W / LAND_WD) * Math.sin(LAND_WD * t)));
A.land = (tau) => {
  poseReset();
  const fade = 1 - smooth(clamp((tau - 0.3) / 0.15, 0, 1)), m = BODY;
  const q = 0.18 * landSpring(tau) * fade;
  const qh = 0.18 * landSpring(tau - 0.05) * fade;          // the head arrives 0.05 s after the body
  const k = Math.max(0, q) / 0.18;                           // how far into the squash: the knees only ever bend
  S_.squash = q;
  if (isFront()) {
    bendLegs('near', 0.3 * k); bendLegs('far', 0.3 * k);
    bones.upper_arm_near.userData.pose = 0.55 * k; bones.upper_arm_far.userData.pose = 0.55 * k * farSign();   // out for balance
    bones.forearm_near.userData.pose = 0.3 * k; bones.forearm_far.userData.pose = 0.3 * k * farSign();
    bones.chest.userData.sy = 1 - 0.05 * k;
    // the head dips by shortening the neck, and the head is scaled back so her face does not squash with it
    bones.neck.userData.sy = 1 - 0.5 * qh; bones.head.userData.sy = 1 / (1 - 0.5 * qh);
  } else {
    for (const s of ['near', 'far']) { bones['thigh_' + s].userData.pose = m * 0.3 * k; bones['shin_' + s].userData.pose = -m * 0.55 * k; }
    bones.chest.userData.pose = m * 0.12 * k;
    bones.upper_arm_near.userData.pose = -m * 0.5 * k; bones.upper_arm_far.userData.pose = -m * 0.5 * k;
    bones.head.userData.pose = m * 0.6 * qh;
  }
  if (tau > 0.45) S_.next = 'idle';
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
// own keys only: 'toString' or 'constructor' from a model's reply must not read as a mood (it made her vigour NaN)
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const emoOf = (name) => own(EMO, name) || own(EMO, own(KIT_TO_EMO, name)) || EMO.neutral;
const kitMood = (name) => (kit && kit.recipe(name) && !KIT_NOT_MOODS.test(name) ? name : (own(EMO, name) && kit && kit.recipe(EMO[name].kit) ? EMO[name].kit : 'neutral'));
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
// how hard each feeling lands
const EMO_KICK = { panic: 1, shocked: 1, surprised: 0.9, hurt: 0.8, cheerful: 0.7, affection: 0.7, angry: 0.7,
  happy: 0.5, pouty: 0.4, smug: 0.4, confused: 0.4, curious: 0.3, sad: 0.25, gentle: 0, relaxed: 0, sleepy: 0, neutral: 0 };
const emoCur = { ...EMO.neutral };
// Speech. While `lab.talking(secs)` says she is talking, her mouth takes a new shape for every syllable - a random
// one, never the same twice running - at a rate that wanders between 4 and 6 a second, and every 6-10 syllables it
// closes for a breath of 0.25-0.4 s. A fixed-rate loop through the five shapes read as a machine; the jitter and
// the phrase breaks are what make it read as words. Returns the viseme, 'closed' in a break, or null when silent.
const SPEECH_OPEN = { aa: 1, oh: 0.8, ee: 0.55, ou: 0.45, ih: 0.4, closed: 0 };   // the side view's mouth opening per shape
function speechCell() {
  if (!(S_.t < S_.talkUntil)) { S_.syl = null; return null; }
  let s = S_.syl;
  if (!s || s.until - S_.t > 1) s = S_.syl = { until: S_.t, cell: 'closed', left: 6 + Math.floor(Math.random() * 5) };   // a stale clock starts over
  if (S_.t >= s.until) {
    if (s.left <= 0) { s.cell = 'closed'; s.until = S_.t + 0.25 + Math.random() * 0.15; s.left = 6 + Math.floor(Math.random() * 5); }
    else {
      let c; do c = VISEMES[Math.floor(Math.random() * VISEMES.length)]; while (c === s.cell);
      s.cell = c; s.until = S_.t + 1 / (4 + 2 * Math.random()); s.left--;
    }
  }
  return s.cell;
}
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
  const say = speechCell();
  S_.talkOpen = lerp(S_.talkOpen || 0, say ? SPEECH_OPEN[say] ?? 0.5 : 0, 1 - Math.exp(-dt * 25));
  // The kit keeps running while the side view is up, hidden, so the front face is current the moment the view
  // swaps back; left alone it showed whatever mouth the front view last had (a fall's gasp) for a few frames.
  if (kit) {
    kit.setMood(kitMood(S_.emotion));
    kit.eyesClosed = S_.eyesClosed || 0;
    kit.mouthOpen = S_.mouthOpen || 0;          // a gasp, a yawn, a cry: the body can hold her mouth open
    kit.noBlink = S_.action === 'startle';      // a startle is a stare; a blink in the middle of it kills it
    kit.sleepy = S_.emotion === 'sleepy' || S_.action === 'sleep' ? 1 : 0;
    kit.setViseme(say || (S_.action === 'talk' ? 'closed' : null));
    // Gaze needs hysteresis: with one threshold a cursor resting near it flicked her eyes between looking and not.
    const { yaw, pitch } = S_.look;
    const enter = S_.action === 'look' ? 0.4 : 0.45, leave = 0.30, g = S_.gaze;
    const still = g === 'left' ? yaw > leave : g === 'right' ? -yaw > leave : g === 'up' ? pitch > leave : g === 'down' ? -pitch > leave : false;
    S_.gaze = still ? g : Math.abs(yaw) > enter ? (yaw > 0 ? 'left' : 'right') : pitch > enter ? 'up' : pitch < -enter ? 'down' : null;
    kit.setLook(S_.gaze);
    kit.update(dt);
    if (isFront()) return;
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
  // The brow lives inside the mirrored group, so its angle is already mirrored with her; multiplying by M() as well
  // flipped it twice, and her angry and sad brows turned upside down whenever she faced left.
  if (facePieces.eyebrow) { const m = facePieces.eyebrow; m.rotation.z = emoCur.browRot; m.position.copy(m.userData.base); m.position.y += emoCur.browY * px; }
  if (facePieces.mouth) { const m = facePieces.mouth; m.scale.set(emoCur.mouthW, emoCur.mouthH * (1 + 2.2 * Math.max(S_.mouthOpen || 0, S_.talkOpen || 0)), 1); }
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
// ---- action switches: inertialization
// Every channel of the pose, flat: bone angles, bone x/y scales, then the whole-body values.
const POSE_CH = ['rootY', 'rootRot', 'rootX', 'rootScale', 'eyesClosed', 'mouthOpen', 'squash', 'plant'];
const CH_REST = { rootScale: 1, plant: 1 };
function readPose() {
  const n = boneList.length, out = new Float64Array(3 * n + POSE_CH.length);
  for (let i = 0; i < n; i++) { const u = boneList[i].userData; out[i] = u.pose; out[n + i] = u.sx ?? 1; out[2 * n + i] = u.sy ?? 1; }
  POSE_CH.forEach((k, j) => { out[3 * n + j] = S_[k] ?? CH_REST[k] ?? 0; });
  out.view = VIEW_NAME;
  return out;
}
function writePose(a) {
  const n = boneList.length;
  for (let i = 0; i < n; i++) { const u = boneList[i].userData; u.pose = a[i]; u.sx = a[n + i]; u.sy = a[2 * n + i]; }
  POSE_CH.forEach((k, j) => { S_[k] = a[3 * n + j]; });
}
// A switch used to crossfade from a frozen snapshot of the old pose: smoothstep starts flat, so for a frame the
// outgoing motion simply stopped, and a switch that also changed view skipped the fade altogether (walk -> idle
// threw a foot 25 px). Instead the new action runs at once and carries the difference from the old pose as an
// offset that dies away on a critically damped curve. The offset starts with the old motion's own velocity, so
// nothing stalls, and its half-life grows with how far apart the two poses are, so no joint is flung across
// more than about a tenth of a radian in a frame. `hl` overrides that: startle and land snap on purpose.
const blendHalfLife = (D) => clamp(0.13 * D, 0.08, 0.3);
function startBlend(hl, hlRoot) {
  const from = readPose(), cur = S_.snapCur, prev = S_.snapPrev;
  const vel = new Float64Array(from.length);
  if (cur && prev && cur.view === VIEW_NAME && prev.view === VIEW_NAME && cur.length === from.length && prev.length === from.length && S_.dt > 0) {
    for (let i = 0; i < vel.length; i++) vel[i] = clamp((cur[i] - prev[i]) / S_.dt, -12, 12);
  }
  const floor = (h) => (h == null ? null : Math.max(0.005, +h || 0.005));   // a zero half-life is 0 * Infinity: NaN
  S_.blend = { t0: S_.t, view: VIEW_NAME, from, vel, hl: floor(hl), hlRoot: floor(hlRoot), off: null, ticks: 0 };
}
function applyBlend() {
  const bl = S_.blend; if (!bl) return;
  const target = readPose();
  if (bl.view !== VIEW_NAME || target.length !== bl.from.length) { S_.blend = null; return; }
  const n = boneList.length, iRot = 3 * n + 1, iX = 3 * n + 2, iPlant = 3 * n + 7;
  if (!bl.off) {
    // first tick of the new action: now that its pose exists, measure how far it is from where she was
    bl.off = new Float64Array(target.length);
    let D = 0;
    for (let i = 0; i < target.length; i++) {
      bl.off[i] = bl.from[i] - target[i];
      // Coming down onto her feet is immediate (the fall already put them at the floor); only leaving it is eased.
      if (i === iPlant && bl.off[i] < 0) { bl.off[i] = 0; bl.vel[i] = 0; }
      if (i < 3 * n || i === iRot) D = Math.max(D, Math.abs(bl.off[i]));
    }
    bl.hl = bl.hl ?? blendHalfLife(D);
    bl.t0 = S_.t - (S_.dt || 0);                  // the offset is defined at the switch, one frame ago
  } else if (bl.ticks === 1 && S_.dt > 0) {
    // Second tick: now the new action's own velocity is known too. The offset has to carry the OLD motion minus the
    // new one, or for a switch between two moving actions (walk -> run) she briefly moves at both speeds added up.
    // Re-anchored on what was actually shown last frame, so the curve stays continuous.
    for (let i = 0; i < target.length; i++) {
      const vNew = (target[i] - bl.tgt0[i]) / S_.dt, vShown = (bl.out1[i] - bl.from[i]) / S_.dt;
      bl.off[i] = bl.out1[i] - bl.tgt0[i];
      bl.vel[i] = clamp(vShown - vNew, -12, 12);
    }
    bl.t0 = S_.t - S_.dt;
  }
  const t = Math.max(0, S_.t - bl.t0), out = new Float64Array(target.length);
  let live = false;
  for (let i = 0; i < target.length; i++) {
    // the grip on the floor changes over a couple of frames whatever the pose does: a landing is on the floor now
    const hl = i === iPlant ? Math.min(bl.hl, 0.03) : (i === iRot || i === iX) && bl.hlRoot ? bl.hlRoot : bl.hl;
    const y = 2 * Math.LN2 / hl, e = Math.exp(-y * t);
    const o = e * (bl.off[i] + (bl.vel[i] + y * bl.off[i]) * t);   // critically damped, from (offset, velocity)
    out[i] = target[i] + o;
    if (y * t < 8) live = true;
  }
  writePose(out);
  if (bl.ticks === 0) { bl.tgt0 = target; bl.out1 = out; }
  bl.ticks++;
  if (!live) S_.blend = null;
}
// ---- the ground
// Her feet belong on the floor whatever the pose does to her legs. Squash and the turn's stretch scale the whole
// figure about a point well above her feet, and a shortened leg lifts the ankle, so any pose that bends her or
// squashes her used to leave her floating (the landing by up to 36 px, the dance by 9-29 px) or sunk (a stumble
// by 11 px, behind the taskbar edge on the desktop). So after the pose is decided, measure where her lowest ankle
// actually is and move her root to put it back on the floor, weighted by S_.plant.
function groundFeet() {
  const plant = clamp(S_.plant ?? 1, 0, 1);
  if (S_.held || S_.y > 0 || plant <= 0) return;
  const view = current();
  if (!Number.isFinite(view.standAnkle)) return;
  applyPose(); group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let low = Infinity;
  for (const s of ['near', 'far']) { bones['foot_' + s].getWorldPosition(v); low = Math.min(low, v.y); }
  const want = GROUND_Y + view.standAnkle;            // where they are when she just stands there
  const sy = group.scale.y || 1;
  S_.rootY = (S_.rootY || 0) + plant * (want - low) / sy;
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
  const lo = 0.45, hi = STAGE.w - 0.45, wasIn = S_.x >= lo && S_.x <= hi;
  S_.vy -= G * dt; S_.y += S_.vy * dt; S_.x += S_.vx * dt;
  if (wasIn) { if (S_.x < lo) { S_.x = lo; S_.vx = -S_.vx * 0.4; } else if (S_.x > hi) { S_.x = hi; S_.vx = -S_.vx * 0.4; } }
  else {
    // She can START a fall outside the walls: the drag's swing carries her out past the hand, and a release keeps
    // her where she was. Clamping her back in one frame was a 90 px jump, so here the wall pushes instead.
    const out = S_.x < lo ? lo - S_.x : S_.x > hi ? hi - S_.x : 0;
    if (out * S_.vx < 0) S_.vx *= -0.4;
    S_.vx += out * 40 * dt;
  }
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
    const u = Math.max(0, (S_.t - S_.turn.t0) / 0.28);
    // She faces the new way from the moment the sprite flips (u = 0.5), not when the squash finishes: committing at
    // the end left everything that reads S_.facing - the springs' mirror, her walk, the pet's cursor logic - facing
    // backwards for the second half of every turn. turn.from still drives the squash.
    if (u >= 0.5) S_.facing = -S_.turn.from;
    if (u >= 1) { S_.turn = null; if (S_.action === 'turn') S_.next = 'idle'; sx = M(); }
    else { const fromM = NATIVE ? S_.turn.from * NATIVE : 1; S_.turnSquash = Math.max(0.14, Math.abs(Math.cos(Math.PI * u))); sx = (NATIVE ? fromM * (u < 0.5 ? 1 : -1) : 1) * S_.turnSquash; }
  }
  let sxPhys = sx;
  if (S_.viewSwap) {
    const u = (S_.t - S_.viewSwap.t0) / 0.24;
    if (u >= 0.5 && VIEW_NAME !== S_.viewSwap.to) {
      const from = current(), to = VIEWS[S_.viewSwap.to];
      carrySprings(from, to);
      activate(to); showOnly(S_.viewSwap.to); S_.prevPos.clear(); S_.blend = null; sx = sxPhys = M();
      S_.swapTick = true;       // this view's bones still hold whatever it last showed: not a frame to take a velocity from
    }
    sx *= Math.max(0.04, Math.abs(Math.cos(Math.PI * u)));
    if (u >= 1) S_.viewSwap = null;
  }
  const sc = S_.rootScale || 1, sq = S_.squash || 0;
  const stretch = S_.turn ? 1 + 0.12 * (1 - (S_.turnSquash ?? 1)) : 1;   // squash and stretch: she gets a touch taller as she narrows, so a turn reads as a turn
  group.scale.set(sx * sc * (1 + sq), sc * (1 - sq) * stretch, 1);
  group.userData.physScaleX = sxPhys * sc * (1 + sq);
  // Squash and stretch happen about the floor under her, not about the group's origin (the middle of the canvas,
  // most of her height above her feet): scaled about that, a landing squash of 0.18 lifted her feet 36 px. The
  // widening is about her own centre line for the same reason, or she slid sideways on every squash.
  group.position.x = S_.x + (S_.rootX || 0) - sx * sc * sq * restHead.root.x; group.position.y = GROUND_Y + S_.y + FLOOR_Y * sc * (1 - (1 - sq) * stretch);
  groundFeet();
  applyPose();
  // the impulse of a feeling arriving, decaying over about half a second
  if (S_.emoKick) {
    const age = S_.t - S_.emoKick.t0;
    // A negative age means the clock was restarted under it (lab.begin does that), so this impulse belongs to a
    // timeline that no longer exists. Left alone its decay term, exp(-6 * age), grows instead of shrinking: one
    // measured case drove her head to -4291 radians, which whipped the hair chains attached to it straight out
    // to their limits and produced the spiky halo that made screenshots look randomly broken. Drop a stale kick.
    if (age < 0 || age > 0.7) S_.emoKick = null;
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
  S_.snapPrev = S_.snapCur; S_.snapCur = S_.swapTick ? null : readPose();   // the last two frames she was shown in: a switch's velocity
  S_.swapTick = false;
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
  // opts.blend: half-life of the switch in seconds (default: from how far apart the poses are);
  // opts.move: for 'dance', which move of the routine she starts on (default: any of them)
  start(name, opts = {}) {
    if (!A[name]) throw new Error('unknown action ' + name);
    const want = wantView(name);
    // Always blended, even when the view changes: the first half of a view swap still shows the old view, and an
    // unblended switch there threw her foot 25 px in one frame. Startle and land snap on purpose.
    startBlend(opts.blend ?? (name === 'land' || name === 'startle' ? 0.012 : null), opts.blendRoot);
    if (S_.action === 'look' && name !== 'look') { S_.look.yaw = 0; S_.look.pitch = 0; }   // A.look drives the gaze itself; leaving it must hand it back
    if (name === 'dance') {
      const i = opts.move != null ? clamp(Math.floor(opts.move), 0, ROUTINE.length - 1) : Math.floor(Math.random() * ROUTINE.length);
      S_.danceBeat0 = moveBeat(i);
    }
    S_.action = name; S_.tau = 0; if (name === 'turn') S_.turn = null;
    switchView(want);
    return { name, view: want };
  },
  begin(name, opts) {
    lab.start(name, opts); S_.blend = null; S_.t = 0; S_.x = STAGE.w / 2 - 0.15; S_.y = 0; S_.vx = 0; S_.vy = 0; S_.held = null; S_.facing = 1; S_.turn = null; S_.squash = 0;
    if (S_.viewSwap) { activate(VIEWS[S_.viewSwap.to]); showOnly(S_.viewSwap.to); S_.viewSwap = null; }
    group.scale.set(M(), 1, 1); S_.blink.next = 9; S_.blink.phase = 0; for (const b of boneList) { b.userData.spring = 0; b.userData.springVel = 0; } S_.prevPos.clear();
    // everything timed against the old clock is void: speech, the dance's vigour, the frames a blend reads
    S_.talkUntil = 0; S_.syl = null; S_.talkOpen = 0; S_.gaze = null; S_.vig = own(VIGOUR, S_.emotion) ?? 1; S_.snapCur = null; S_.snapPrev = null;
    return { name };
  },
  step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) tick(1 / 60); renderer.render(scene, camera); },
  // step until nothing is in transit (a turn, a view swap, a blend), for captures that must not catch one mid-way
  settle(maxSec = 5) { let n = 0; while ((S_.turn || S_.viewSwap || S_.blend) && n < maxSec * 60) { tick(1 / 60); n++; } renderer.render(scene, camera); return n; },
  // she is saying something for the next `secs` seconds: her mouth moves, whatever she is doing
  talking(secs) { S_.talkUntil = S_.t + Math.max(0, +secs || 0); },
  stop() { lab.start('idle'); },
  pause(v) { S_.paused = !!v; },
  hud(v) { S_.hudOn = !!v; hud.style.display = v ? 'block' : 'none'; },
  // An unknown feeling is not an error worth stopping her for (a model can name any mood it likes): it is logged
  // once per name, her face is left as it was, and the answer is false.
  emotion(name) {
    if (!own(EMO, name) && !own(KIT_TO_EMO, name) && !(kit && kit.recipe(name))) {
      if (!warnedEmotions.has(name)) { warnedEmotions.add(name); console.warn('unknown emotion ' + name); }
      return false;
    }
    // A feeling arriving should move her, not just her face: a small head snap and a kick through the hair and
    // ahoge springs. Without it a mood change is a silent texture swap.
    if (name !== S_.emotion) S_.emoKick = { t0: S_.t, mag: own(EMO_KICK, name) ?? 0.35 };
    S_.emotion = name;
    return true;
  },
  eyes(closed) { S_.eyesHold = closed == null ? null : clamp(closed, 0, 1); },   // testing hook: hold the lids
  blink() { if (kit) kit.blink.next = 0; },                                      // testing hook: blink as soon as allowed
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
    if (!S_.held) return; const h = S_.held; S_.held = null;
    // Zeroing the pendulum's slide and angle here, before the next action snapshots her, made her jump 40-80 px on
    // release. The slide is folded into her position instead (she stays exactly where she is on screen), and the
    // swing angle is left for the blend to carry out over about a third of a second, momentum included.
    S_.x += S_.rootX || 0; S_.rootX = 0;
    S_.vx = clamp(h.vx, -12, 12); S_.vy = clamp(h.vy, -6, 8);
    if (S_.y > 0.01 || S_.vy > 0) lab.start('fall', { blend: 0.1 }); else { S_.vx = 0; lab.start('land', { blendRoot: 0.1 }); }
    if (S_.blend) S_.blend.vel[3 * boneList.length + 2] = 0;   // the slide's velocity is already in S_.vx
  },
  onTick(fn) { tickHooks.push(fn); },
  // exact hit test on her pixels (window px); zone names the part for reactions
  pick(px, py) { return pickAt(px, py); },
  zone(px, py) { return zoneAt(px, py); },
  showLayer(name, v) { const m = layerMeshes[name]; if (m) m.visible = !!v; return !!m; },
  bone(name) { const b = bones[name]; if (!b) return null; const v = new THREE.Vector3(); b.getWorldPosition(v); return { pose: +b.userData.pose.toFixed(3), spring: +b.userData.spring.toFixed(3), rot: +b.rotation.z.toFixed(3), sy: b.userData.sy, px: toPx(v.x, v.y).map((n) => Math.round(n)), visible: b.parent ? b.parent.visible : null }; },
  snapshot: () => ({ view: VIEW_NAME, native: NATIVE, mirror: M(), scaleX: +group.scale.x.toFixed(3), action: S_.action, tau: +S_.tau.toFixed(2), x: +S_.x.toFixed(3), y: +S_.y.toFixed(3), facing: S_.facing, rootY: +(S_.rootY || 0).toFixed(3),
    plant: +(S_.plant ?? 1).toFixed(3), vig: +S_.vig.toFixed(3), blending: !!S_.blend, brow: facePieces.eyebrow ? +facePieces.eyebrow.rotation.z.toFixed(4) : null, springs: Object.fromEntries(springs.flatMap((s) => s.bones).map((n) => [n, +bones[n].userData.spring.toFixed(3)])) }),
  fps: () => +(S_.fps.length / S_.fps.reduce((a, b) => a + b, 0)).toFixed(1),
  // what the face kit is showing (front view), for tests
  face: () => (kit ? { eye_l: kit.regions.eye_l.state, eye_l_in: kit.regions.eye_l.incoming || null, eye_r: kit.regions.eye_r.state, mouth: kit.regions.mouth.state, mouth_in: kit.regions.mouth.incoming || null,
    viseme: kit.viseme, look: kit.look, mood: kit.mood, lid: kit.lid ?? 0, blinking: kit.blink.phase > 0 } : null),
};
const warnedEmotions = new Set();
// Letter keys drive the lab. The pet has its own keys (C, P, Esc) in pet.js and must not also get these.
if (!PET_MODE) window.addEventListener('keydown', (e) => {
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
lab.hud(!PET_MODE);
requestAnimationFrame(frame);
window.__ready = true;
