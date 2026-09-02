// Actions lab: stock VRM in the pet-style window driven by ActionController. Exposes `window.lab`
// for main.js --capture (deterministic stepping) and keys for interactive use (HUD lists them).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadQuaterniusAnimations, loadVRMAnimation, loadMixamoAnimation, attachLookAtProxy } from '../anim/retarget/index.js';
import { ActionController, ACTIONS, EMOTIONS, LOOK_PATTERNS } from './ActionController.js';

const DEG = Math.PI / 180;
const hud = document.getElementById('hud');
const params = new URLSearchParams(location.search);
const VRM_URL = params.get('vrm') || '../models/VRM1_Constraint_Twist_Sample.vrm';
const QUAT_URL = '../anim/quaternius/Animation%20Library%5BStandard%5D/Godot/AnimationLibrary_Godot_Standard.glb';

// ------------------------------------------------------------------ renderer / scene (same framing as ../index.html)
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 0.1, 50);
const key = new THREE.DirectionalLight(0xfff4e6, Math.PI * 0.9); key.position.set(1.2, 2.2, 2.0); scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe3ff, Math.PI * 0.35); fill.position.set(-1.5, 0.5, 1.0); scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ------------------------------------------------------------------ VRM
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));
const gltf = await loader.loadAsync(VRM_URL);
const vrm = gltf.userData.vrm;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.combineSkeletons(gltf.scene);
vrm.scene.traverse((o) => { o.frustumCulled = false; });
scene.add(vrm.scene);
attachLookAtProxy(vrm);
vrm.springBoneManager?.reset();
const model = vrm.scene, hum = vrm.humanoid, B = (n) => hum.getNormalizedBoneNode(n);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
const dist = (size.y * 1.3) / (2 * Math.tan(camera.fov * DEG / 2));
camera.position.set(0, center.y + size.y * 0.07, dist); camera.lookAt(0, center.y + size.y * 0.07, 0);

// ------------------------------------------------------------------ clip library (shared loaders, one three instance)
const manifest = await (await fetch('../anim/ACTION_CLIPS.json')).json();
const library = { quaternius: new Map(), vrma: new Map(), mixamo: new Map() };
const loadLog = { quaternius: 0, vrma: [], mixamo: [], missing: [] };
hud.textContent = 'loading clips';
library.quaternius = await loadQuaterniusAnimations(QUAT_URL, vrm);
loadLog.quaternius = library.quaternius.size;
const refs = new Set();
for (const a of Object.values(manifest.actions)) for (const r of [a.primary, ...(a.alternates || [])]) { const m = /^(vrma|mixamo):([^\s(]+)/.exec(r || ''); if (m) refs.add(m[0]); }
refs.add('vrma:three-vrm_test.vrma');
for (const ref of refs) {
  const [kind, file] = ref.split(':');
  try {
    const clip = kind === 'vrma' ? await loadVRMAnimation('../anim/vrma/' + file, vrm, { name: file }) : await loadMixamoAnimation('../anim/mixamo/' + file, vrm);
    library[kind].set(file, clip); loadLog[kind].push(file);
  } catch (e) { loadLog.missing.push(ref); }
}

// ------------------------------------------------------------------ controller
const ac = new ActionController(vrm, { library, manifest, scene });
window.ac = ac;
const S = { hudOn: true, paused: false, stepClock: 0, mouse: { x: 0, y: 0 } };
window.addEventListener('mousemove', (e) => { S.mouse.x = (e.clientX / innerWidth) * 2 - 1; S.mouse.y = -((e.clientY / innerHeight) * 2 - 1); ac.setCursor(S.mouse.x, S.mouse.y); });

// ------------------------------------------------------------------ loop / stats
const stats = { frames: 0, ms: [], t0: performance.now(), last: performance.now() };
let prev = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (S.paused) return;
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  stats.ms.push(now - stats.last); stats.last = now; stats.frames++; if (stats.ms.length > 2000) stats.ms.shift();
  ac.update(dt);
  renderer.render(scene, camera);
  if (S.hudOn) drawHud();
}
function drawHud() {
  const n = Math.min(stats.ms.length, 120), recent = stats.ms.slice(-n), avg = recent.reduce((a, b) => a + b, 0) / (n || 1);
  const c = ac.current, snap = ac.snapshot();
  hud.textContent = `actions lab  ${(1000 / avg).toFixed(0)} fps  ${avg.toFixed(1)} ms\n` +
    `body ${c ? c.name + ' ' + c.t.toFixed(1) + 's/' + (c.duration == null ? 'inf' : c.duration.toFixed(1)) + ' [' + c.source + ']' : '-'}   clip ${snap.clip ? snap.clip.name + ' ' + snap.clip.time.toFixed(2) + ' w' + snap.clip.weight : '-'}\n` +
    `gaze ${snap.gaze.pattern} (${snap.gaze.yawDeg},${snap.gaze.pitchDeg})   emotion ${JSON.stringify(snap.emotion)}   lanes ${snap.lanes.join('+')}\n` +
    `[1-9] neutral happy sad angry think surprised awkward question curious\n` +
    `[I] idle [W] walk [H] hop [S] sit [Z] sleep [K] wake [X] stretch [U] stumble [R] reach->mouse [N] inspect->mouse\n` +
    `[V] wave [E] eat [D] drink [C] celebrate [T] tail_react [L] cycle look (${snap.gaze.pattern}) [Space] stop [G] hud`;
}

// ------------------------------------------------------------------ control surface
const mousePoint = () => new THREE.Vector3(S.mouse.x * 0.7, ac.headY - 0.25 + S.mouse.y * 0.5, 0.45);
const lab = window.lab = {
  actions: () => ACTIONS, emotions: () => EMOTIONS, lookPatterns: () => LOOK_PATTERNS,
  start(name, opts = {}) { if (opts.target && Array.isArray(opts.target)) opts.target = new THREE.Vector3().fromArray(opts.target); return ac.start(name, opts); },
  stop(lane) { ac.stop(lane); },
  emotion(name, w = 1) { ac.setEmotion(name, w); },
  look(pattern, target) { return ac.start('look', { pattern, target: target ? new THREE.Vector3().fromArray(target) : undefined }); },
  cursor(nx, ny) { S.mouse.x = nx; S.mouse.y = ny; ac.setCursor(nx, ny); },
  blink(on) { ac.blinkAuto = on; }, forceBlink(w) { ac.forcedBlink = w; },
  hud(on) { S.hudOn = on; if (!on) hud.textContent = ''; },
  // deterministic stepping for the capture harness: pause the rAF loop, step 1/60 s at a time, render
  pause(on) { S.paused = on; if (!on) prev = performance.now(); },
  begin(name, opts = {}) { S.paused = true; S.stepClock = 0; const r = lab.start(name, opts); lab.render(); return r; },
  stepTo(t, dt = 1 / 60) { S.paused = true; let n = 0; while (S.stepClock < t - 1e-6 && n < 100000) { ac.update(dt); S.stepClock += dt; n++; } lab.render(); return S.stepClock; },
  step(seconds, dt = 1 / 60) { return lab.stepTo(S.stepClock + seconds, dt); },
  render() { renderer.render(scene, camera); if (S.hudOn) drawHud(); },
  snapshot: () => ac.snapshot(),
  arm(side = 'right') { model.updateWorldMatrix(true, true); const s = B(side + 'UpperArm').getWorldPosition(new THREE.Vector3()), e = B(side + 'LowerArm').getWorldPosition(new THREE.Vector3()), h = B(side + 'Hand').getWorldPosition(new THREE.Vector3()); return { shoulder: s.toArray(), length: s.distanceTo(e) + e.distanceTo(h) }; },
  mouth() { model.updateWorldMatrix(true, true); return B('head').getWorldPosition(new THREE.Vector3()).toArray(); },
  handWorld(side = 'right') { model.updateWorldMatrix(true, true); return B(side + 'Hand').getWorldPosition(new THREE.Vector3()).toArray(); },
  propWorld() { const k = ac.props[0]; if (!k) return null; const m = ac._props[k]; model.updateWorldMatrix(true, true); return m.getWorldPosition(new THREE.Vector3()).toArray(); },
  springSample() { const out = []; model.updateWorldMatrix(true, true); vrm.springBoneManager?.joints.forEach((j) => { if (out.length < 6 && j.child) out.push(+(j.child.getWorldPosition(new THREE.Vector3()).x - model.position.x).toFixed(4)); }); return out; },
  resetStats() { stats.ms.length = 0; stats.frames = 0; stats.t0 = performance.now(); stats.last = performance.now(); },
  stats() { const ms = stats.ms.slice().sort((a, b) => a - b), n = ms.length, sum = ms.reduce((a, b) => a + b, 0); return { frames: stats.frames, seconds: (performance.now() - stats.t0) / 1000, avgMs: sum / n, p50Ms: ms[Math.floor(n * 0.5)], p95Ms: ms[Math.floor(n * 0.95)], maxMs: ms[n - 1], fps: stats.frames / ((performance.now() - stats.t0) / 1000), dpr: devicePixelRatio, size: [renderer.domElement.width, renderer.domElement.height] }; },
  info() {
    const em = vrm.expressionManager; let joints = 0; vrm.springBoneManager?.joints.forEach(() => joints++);
    return { vrm: VRM_URL, meta: vrm.meta.name, metaVersion: vrm.meta.metaVersion, expressions: em.expressions.map((e) => e.expressionName), springJoints: joints, height: size.y, headY: ac.headY, library: loadLog, manifestGenerated: manifest.generated, actions: Object.keys(ACTIONS) };
  },
};

let lookIdx = 0;
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const em = { 1: 'neutral', 2: 'happy', 3: 'sad', 4: 'angry', 5: 'think', 6: 'surprised', 7: 'awkward', 8: 'question', 9: 'curious' }[k]; if (em) return ac.setEmotion(em, 1);
  const act = { i: 'idle', w: 'walk', h: 'hop', s: 'sit', z: 'sleep', k: 'wake', x: 'stretch', u: 'stumble', v: 'wave', e: 'eat', d: 'drink', c: 'celebrate', t: 'tail_react' }[k];
  try {
    if (act) ac.start(act);
    else if (k === 'r') ac.start('reach', { target: mousePoint(), duration: 2.5 });
    else if (k === 'n') ac.start('inspect', { target: mousePoint() });
    else if (k === 'l') { lookIdx = (lookIdx + 1) % LOOK_PATTERNS.length; ac.start('look', { pattern: LOOK_PATTERNS[lookIdx] }); }
    else if (k === ' ') ac.stop(); else if (k === 'g') lab.hud(!S.hudOn);
  } catch (err) { window.__error = String(err.stack || err); }
});
ac.start('look', { pattern: 'follow' });
requestAnimationFrame(frame);
window.__ready = true;
