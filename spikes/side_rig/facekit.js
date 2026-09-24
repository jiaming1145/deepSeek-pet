// Face kit: assembles her front face from the expression atlases in spikes/model/face (eyes, brows, mouth,
// fx) as swappable pieces anchored on the face, with crossfades, blink, visemes and look states.
// Face space = neutral.png pixels (1360x1152, y down). The host maps face space into its own world by
// giving a `place(px, py)` function and a parent Object3D (the head bone).
import * as THREE from 'three';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const BROW_ALIAS = { verbatim: 'neutral' };   // the atlas's 'neutral_verbatim' cell is erased-hair strands, not a brow
const REGION_ATLAS = { eye_l: 'eyes', eye_r: 'eyes', brow_l: 'brows', brow_r: 'brows', mouth: 'mouth' };
// paint on her skin, so it belongs under her hair; everything else is a floating symbol and goes on top
const SKIN_FX = new Set(['blush_l', 'blush_r', 'face_shadow', 'panic_shadow']);
// a shut eye is not a binary. These are the rungs, and which cell shows at each.
const LID_CELL = (lid) => (lid > 0.72 ? 'closed' : lid > 0.34 ? 'half_lid' : null);
// Eyes drawn as something other than an open eye - shut, arcs, hearts, spirals - have no half-way lid. Swapping
// one for 'half_lid' mid-blink or mid-squint popped a half-OPEN iris into a sleeping or delighted face, so these
// only ever go fully shut, and a squint on them is drawn as the cheeks pushing up instead (see `squint`).
const NO_LID = new Set(['closed', 'happy', 'heart', 'spiral']);
const SQUINTS = new Set(['happy', 'heart', 'spiral']);   // ...of which these are open enough to squint (a shut eye cannot)
// Gaze swaps the whole eye for a looking one, so only a plain open eye may do it: a half-lidded relaxed, smug or
// focused eye opened wide the moment the cursor came near, which threw the expression away.
const GAZE_OK = new Set(['open']);

export class FaceKit {
  constructor(opts) {
    this.base = opts.base;                       // 'spikes/model/face' URL prefix
    this.parent = opts.parent;                   // Object3D the pieces attach to
    this.place = opts.place;                     // (px, py) face px -> THREE.Vector3 in parent space
    this.pxScale = opts.pxScale;                 // world units per face px
    this.renderOrder = opts.renderOrder || 100;
    this.fxRenderOrder = opts.fxRenderOrder ?? (this.renderOrder + 4);   // effect decals are floating symbols: above the hair, not under it
    // ...except the ones that are paint ON her skin. Blush drawn above the hair put a purple lozenge over the
    // strands lying on her cheeks, in six of the moods she wears most often.
    this.skinFxRenderOrder = opts.skinFxRenderOrder ?? (this.renderOrder + 0.5);
    this.atlasJson = opts.atlasJson || 'atlas.json';   // 'atlas_matted.json': cells re-matted to the drawn feature only
    this.mood = 'neutral'; this.pending = null; this.fade = 0; this.FADE = 0.12;
    this.blink = { next: 2.5, phase: 0, t: [0.055, 0.035, 0.125], slow: false, double: false };
    this.viseme = null; this.look = null; this.eyesClosed = 0; this.sleepy = 0; this.wink = null;
    this.mouthOpen = 0; this.openCell = null; this.noBlink = false; this.squint = 0; this.lid = 0;
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
    this.setRegion('eye_l', 'open'); this.setRegion('eye_r', 'open'); this.setRegion('brow_l', 'neutral'); this.setRegion('brow_r', 'neutral'); this.setRegion('mouth', 'closed');
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
      m.position.copy(this.place((fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2)); m.renderOrder = SKIN_FX.has(name) ? this.skinFxRenderOrder : this.fxRenderOrder; m.frustumCulled = false; m.visible = false;
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
    // some cells are drawn higher in their frame than the rest of the set; the re-matte tool measures that and
    // records the correction, so a blink lands where her eye actually shuts instead of floating above it
    const off = (this.atlas.regions[region].state_offsets_px || {})[stateName];
    const base = mesh.userData.base;
    if (base) {
      if (off) mesh.position.set(base.x + off[0] * this.pxScale, base.y - off[1] * this.pxScale, base.z);
      else mesh.position.copy(base);
      mesh.userData.seat = mesh.position.clone();          // where this cell sits; the squint lifts it from here
    }
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
    const recipes = this.states.recipes || {};
    const rec = Object.hasOwn(recipes, mood) ? recipes[mood] : null;
    if (!rec) return null;
    const brow = (v) => BROW_ALIAS[v] || v;
    return { eye_l: rec.eye_l || 'open', eye_r: rec.eye_r || 'open', brow_l: brow(rec.brow_l || 'neutral'), brow_r: brow(rec.brow_r || 'neutral'), mouth: rec.mouth || 'closed', fx: (rec.fx || []).map((f) => (typeof f === 'string' ? f : f.name)) };
  }
  moods() { return Object.keys(this.states.recipes || {}); }
  setMood(mood) { if (!this.recipe(mood)) throw new Error('unknown mood ' + mood); this.mood = mood; }
  setViseme(v) { this.viseme = v; }          // 'aa'|'ih'|'ou'|'ee'|'oh'|null
  setLook(dir) { this.look = dir; }          // 'left'|'right'|'up'|'down'|null (her perspective)

  update(dt) {
    const rec = this.recipe(this.mood);
    // A blink is a lid travelling down and back up, not a light switch. Closing is fast, opening is slower, and
    // there is a drawn half-closed cell for the middle of the journey. Sleepy blinks are long, and about one in
    // seven is a double.
    const B = this.blink;
    B.next -= dt;
    if (this.noBlink) { B.phase = 0; B.next = Math.max(B.next, 0.3); }     // the host is holding a stare
    if (B.next <= 0 && B.phase === 0) {
      B.phase = 1e-4;
      B.slow = this.sleepy > 0.5;
      B.t = B.slow ? [0.20, 0.10, 0.28] : [0.055, 0.035, 0.125];
      B.double = !B.slow && Math.random() < 0.15;
      B.next = (B.slow ? 1.4 : 2) + Math.random() * 3;
    }
    let lid = 0;
    if (B.phase > 0) {
      B.phase += dt;
      const [tc, th, to] = B.t, total = tc + th + to;
      if (B.phase < tc) lid = B.phase / tc;
      else if (B.phase < tc + th) lid = 1;
      else if (B.phase < total) lid = 1 - (B.phase - tc - th) / to;
      else { B.phase = 0; if (B.double) { B.double = false; B.next = 0.16; } }
    }
    lid = Math.max(lid, this.eyesClosed || 0);
    this.lid = lid;
    const drawn = NO_LID.has(rec.eye_l) || NO_LID.has(rec.eye_r);
    let lidCell = LID_CELL(lid);
    if (drawn && lidCell !== 'closed') lidCell = null;
    let eyeL = rec.eye_l, eyeR = rec.eye_r;
    if (this.look && GAZE_OK.has(rec.eye_l) && GAZE_OK.has(rec.eye_r)) { eyeL = eyeR = 'look_' + this.look; }
    if (this.wink && !lidCell) { if (this.wink === 'l') eyeL = 'closed'; else eyeR = 'closed'; }
    if (lidCell) { eyeL = eyeR = lidCell; }
    const blinking = lid > 0.34;
    // A mouth held open by the body (a gasp, a yawn, a cry) wins over the mood's resting mouth; speech wins over
    // both. Hysteresis, so a value hovering at a threshold does not flicker between two cells.
    const mo = this.mouthOpen || 0;
    this.openCell = mo > (this.openCell === 'open_wide' ? 0.46 : 0.54) ? 'open_wide' : mo > (this.openCell ? 0.24 : 0.3) ? 'open_small' : null;
    let mouth = this.viseme || this.openCell || rec.mouth;
    const want = { eye_l: eyeL, eye_r: eyeR, brow_l: rec.brow_l, brow_r: rec.brow_r, mouth };
    for (const [region, st] of Object.entries(want)) {
      const r = this.regions[region];
      // Blinks snap. The lid's rungs are frames of one movement, not moods, so going to or from one snaps too: a
      // blink reopening through 'half_lid' used to crossfade into 'open', and two half-transparent cells over her
      // skin read as a washed-out, ghostly eye for a tenth of a second after every blink.
      // A change of gaze snaps too: eyes do not dissolve from one direction to the next, they jump (a saccade).
      const lidRung = (s) => s === 'closed' || s === 'half_lid';
      const gaze = (s) => typeof s === 'string' && s.startsWith('look_');
      const glance = (gaze(st) && (gaze(r.state) || r.state === 'open')) || (gaze(r.state) && st === 'open');   // not a mood change
      const instant = region.startsWith('eye') && (blinking || lidRung(st) || lidRung(r.state) || glance);
      // ...even through a crossfade that is still running: a blink that waited for a mood change to finish
      // arrived late or not at all
      if (instant && r.incoming && r.incoming !== st) { r.incoming = null; r.quads[0].material.opacity = 1; r.quads[1].material.opacity = 0; }
      if (r.state !== st && !r.incoming) this.setRegion(region, st, !instant);
      if (r.incoming) {
        r.t += dt / this.FADE;
        const k = Math.min(1, r.t);
        r.quads[1].material.opacity = k; r.quads[0].material.opacity = 1 - k;
        if (k >= 1) { this.applyUV(r.quads[0], region, r.incoming); r.state = r.incoming; r.incoming = null; r.quads[0].material.opacity = 1; r.quads[1].material.opacity = 0; }
      }
    }
    // The squint on eyes that have no lid (happy arcs and the like): the cheeks push the eyes up and flatten them a
    // little, and the brows lift with them. Eased, so it breathes with the move that asks for it.
    // Driven by the body's squint alone, not by the lid: a blink passing through must not drop her cheeks, and the
    // swap to 'closed' at 0.72 must not cut the lift off at its peak.
    const sq = SQUINTS.has(rec.eye_l) || SQUINTS.has(rec.eye_r) ? clamp01((this.eyesClosed || 0) / 0.72) : 0;
    this.squint += (sq - this.squint) * Math.min(1, dt * 12);
    const lift = this.squint * 26 * this.pxScale, browLift = this.squint * 20 * this.pxScale;
    for (const [region, r] of Object.entries(this.regions)) {
      const eye = region.startsWith('eye');
      if (!eye && !region.startsWith('brow')) continue;
      for (const qd of r.quads) {
        const seat = qd.userData.seat || qd.userData.base; if (!seat) continue;
        qd.position.set(seat.x, seat.y + (eye ? lift : browLift), seat.z);
        qd.scale.y = eye ? 1 - 0.14 * this.squint : 1;
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
