// Face kit: assembles her front face from the expression atlases in spikes/model/face (eyes, brows, mouth,
// fx) as swappable pieces anchored on the face, with crossfades, blink, visemes and look states.
// Face space = neutral.png pixels (1360x1152, y down). The host maps face space into its own world by
// giving a `place(px, py)` function and a parent Object3D (the head bone).
import * as THREE from 'three';

const BROW_ALIAS = { verbatim: 'neutral_verbatim' };
const REGION_ATLAS = { eye_l: 'eyes', eye_r: 'eyes', brow_l: 'brows', brow_r: 'brows', mouth: 'mouth' };

export class FaceKit {
  constructor(opts) {
    this.base = opts.base;                       // 'spikes/model/face' URL prefix
    this.parent = opts.parent;                   // Object3D the pieces attach to
    this.place = opts.place;                     // (px, py) face px -> THREE.Vector3 in parent space
    this.pxScale = opts.pxScale;                 // world units per face px
    this.renderOrder = opts.renderOrder || 100;
    this.atlasJson = opts.atlasJson || 'atlas.json';   // 'atlas_matted.json': cells re-matted to the drawn feature only
    this.mood = 'neutral'; this.pending = null; this.fade = 0; this.FADE = 0.12;
    this.blink = { next: 2.5, phase: 0 }; this.viseme = null; this.look = null; this.eyesClosed = 0;
    this.regions = {}; this.fx = {}; this.state = {};
  }

  async load() {
    const j = async (f) => (await fetch(`${this.base}/${f}`)).json();
    this.atlas = await j(this.atlasJson);
    this.states = await j('face_atlas_states.json');
    const loader = new THREE.TextureLoader();
    const tex = (f) => new Promise((res, rej) => loader.load(`${this.base}/${f}`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; res(t); }, undefined, rej));
    this.tex = {};
    for (const k of ['eyes', 'brows', 'mouth', 'fx']) this.tex[k] = await tex(this.atlas.atlases[k].file);
    // one double-buffered quad per region: [current, incoming]
    for (const [region, atlasName] of Object.entries(REGION_ATLAS)) {
      const reg = this.atlas.regions[region], at = this.atlas.atlases[atlasName];
      const [cw, ch] = reg.cell_px, [ox, oy] = reg.cell_origin_on_face_px;
      const quads = [0, 1].map((i) => {
        const geo = new THREE.PlaneGeometry(cw * this.pxScale, ch * this.pxScale, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: this.tex[atlasName].clone(), transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, opacity: i ? 0 : 1 });
        mat.map.needsUpdate = true;
        const m = new THREE.Mesh(geo, mat);
        const c = this.place(ox + cw / 2, oy + ch / 2);
        m.position.copy(c); m.renderOrder = this.renderOrder + (region.startsWith('brow') ? 3 : region === 'mouth' ? 2 : 1) + i * 0.1;
        m.frustumCulled = false; m.userData.base = c.clone();
        this.parent.add(m);
        return m;
      });
      this.regions[region] = { quads, atlas: at, row: at.rows ? at.rows.indexOf(region) : 0, state: null };
    }
    this.setRegion('eye_l', 'open'); this.setRegion('eye_r', 'open'); this.setRegion('brow_l', 'neutral_verbatim'); this.setRegion('brow_r', 'neutral_verbatim'); this.setRegion('mouth', 'closed');
    for (const q of Object.values(this.regions)) { q.quads[0].material.opacity = 1; q.quads[1].material.opacity = 0; }
    // fx decals (blush etc.), one quad each, toggled by mood recipes
    const fxa = this.atlas.atlases.fx;
    for (const [name, cell] of Object.entries(fxa.cells)) {
      const [x, y, w, h] = cell.px;
      const fb = cell.face_bbox_px;                   // where the cell lands on the face
      const geo = new THREE.PlaneGeometry((fb[2] - fb[0]) * this.pxScale, (fb[3] - fb[1]) * this.pxScale, 1, 1);
      const uv = geo.attributes.uv;
      const [W, H] = fxa.size_px;
      for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (x + u * w) / W, 1 - (y + (1 - v) * h) / H); }
      const mat = new THREE.MeshBasicMaterial({ map: this.tex.fx, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(this.place((fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2)); m.renderOrder = this.renderOrder + 4; m.frustumCulled = false; m.visible = false;
      this.parent.add(m); this.fx[name] = { mesh: m, target: 0 };
    }
    return this;
  }

  cellUV(region, stateName) {
    const r = this.regions[region], at = r.atlas;
    const [W, H] = at.size_px, [cw, ch] = at.cell_px;
    const names = Array.isArray(at.states) ? at.states : Object.keys(at.states);
    let col = names.indexOf(stateName);
    if (col < 0) col = 0;
    const s = !Array.isArray(at.states) && at.states[stateName] && at.states[stateName].u != null ? at.states[stateName] : null;
    const u0 = s ? s.u : (col * cw) / W, v0 = s ? s.v + (s.h || ch / H) * r.row : (r.row * ch) / H;
    return { u0, v0, w: cw / W, h: ch / H };
  }
  applyUV(mesh, region, stateName) {
    const { u0, v0, w, h } = this.cellUV(region, stateName);
    const uv = mesh.geometry.attributes.uv;
    if (!mesh.geometry.userData.baseUV) mesh.geometry.userData.baseUV = Float32Array.from(uv.array);   // pristine corners (0/1)
    const b = mesh.geometry.userData.baseUV;
    // PlaneGeometry uv: (0,1) top-left .. (1,0) bottom-right; atlas v is top-down
    for (let i = 0; i < uv.count; i++) { const u = b[i * 2] <= 0.5 ? 0 : 1, v = b[i * 2 + 1] >= 0.5 ? 0 : 1; uv.setXY(i, u0 + u * w, 1 - (v0 + v * h)); }
    uv.needsUpdate = true;
  }
  setRegion(region, stateName, animate = false) {
    const r = this.regions[region];
    if (r.state === stateName) return;
    if (!animate) { this.applyUV(r.quads[0], region, stateName); r.state = stateName; return; }
    this.applyUV(r.quads[1], region, stateName); r.incoming = stateName; r.t = 0;
  }
  recipe(mood) {
    const rec = (this.states.recipes || {})[mood];
    if (!rec) return null;
    const brow = (v) => BROW_ALIAS[v] || v;
    return { eye_l: rec.eye_l || 'open', eye_r: rec.eye_r || 'open', brow_l: brow(rec.brow_l || 'neutral_verbatim'), brow_r: brow(rec.brow_r || 'neutral_verbatim'), mouth: rec.mouth || 'closed', fx: (rec.fx || []).map((f) => (typeof f === 'string' ? f : f.name)) };
  }
  moods() { return Object.keys(this.states.recipes || {}); }
  setMood(mood) { if (!this.recipe(mood)) throw new Error('unknown mood ' + mood); this.mood = mood; }
  setViseme(v) { this.viseme = v; }          // 'aa'|'ih'|'ou'|'ee'|'oh'|null
  setLook(dir) { this.look = dir; }          // 'left'|'right'|'up'|'down'|null (her perspective)

  update(dt) {
    const rec = this.recipe(this.mood);
    // blink schedule
    this.blink.next -= dt;
    if (this.blink.next <= 0 && this.blink.phase === 0) { this.blink.phase = 0.001; this.blink.next = 2 + Math.random() * 3; }
    if (this.blink.phase > 0) { this.blink.phase += dt; if (this.blink.phase > 0.16) this.blink.phase = 0; }
    const blinking = this.blink.phase > 0.02 && this.blink.phase < 0.13;
    let eyeL = rec.eye_l, eyeR = rec.eye_r;
    if (this.look && rec.eye_l === 'open' && rec.eye_r === 'open') { eyeL = eyeR = 'look_' + this.look; }
    if (blinking || this.eyesClosed > 0.5) { eyeL = eyeR = 'closed'; }
    let mouth = this.viseme || rec.mouth;
    const want = { eye_l: eyeL, eye_r: eyeR, brow_l: rec.brow_l, brow_r: rec.brow_r, mouth };
    for (const [region, st] of Object.entries(want)) {
      const r = this.regions[region];
      const instant = region.startsWith('eye') && (blinking || st === 'closed' || r.state === 'closed');   // blinks snap
      if (r.state !== st && !r.incoming) this.setRegion(region, st, !instant);
      if (r.incoming) {
        r.t += dt / this.FADE;
        const k = Math.min(1, r.t);
        r.quads[1].material.opacity = k; r.quads[0].material.opacity = 1 - k;
        if (k >= 1) { this.applyUV(r.quads[0], region, r.incoming); r.state = r.incoming; r.incoming = null; r.quads[0].material.opacity = 1; r.quads[1].material.opacity = 0; }
      }
    }
    const on = new Set(rec.fx);
    for (const [name, f] of Object.entries(this.fx)) {
      f.target = on.has(name) ? 1 : 0;
      const m = f.mesh, o = m.material.opacity + (f.target - m.material.opacity) * Math.min(1, dt * 8);
      m.material.opacity = o; m.visible = o > 0.01;
    }
  }
}
