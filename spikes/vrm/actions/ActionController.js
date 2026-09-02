// =====================================================================================
// ActionController — the action layer the pet's brain drives, over a loaded three-vrm VRM.
//
//   const ac = new ActionController(vrm, { library, manifest, headY });
//   ac.start('wave'); ac.start('reach', { target: v3 }); ac.start('look', { pattern: 'wander' });
//   ac.setEmotion('curious', 1);
//   each frame: ac.update(dt)   // includes vrm.update(dt) unless opts.updateVRM === false
//
// Frame stack (fixed order, every update):
//   resetNormalizedPose -> body clip machine + AnimationMixer -> at-rest breathing (damped under
//   actions) -> procedural body layers (stretch / wave / stumble / hop flight / eat / drink /
//   reach / inspect / seat pin / tail_react) -> gaze (head+neck turn, eye look-at target) ->
//   emotion head posture -> expression blend (emotion recipes + blink + visemes/chew) -> root
//   offset -> vrm.update(dt) (normalized->raw, lookAt, expressions, spring bones)
//
// Lanes are DATA (ACTIONS[name].lanes); nothing here depends on the pet's arbiter.
// =====================================================================================
import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const expDamp = (dt, tau) => 1 - Math.exp(-dt / tau);

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious'];
export const LOOK_PATTERNS = ['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none'];

// docs/ACTION_VOCABULARY.md §3, as data. kind: how THIS controller realises it on the stock
// library (clip = AnimationMixer, procedural = computed in update(), clip+procedural = both).
export const ACTIONS = {
  idle:       { lanes: ['body'],                       kind: 'clip',            interrupt: 'always' },
  walk:       { lanes: ['body', 'gaze'],               kind: 'clip+procedural', interrupt: 'drag,touch' },
  hop:        { lanes: ['body'],                       kind: 'clip+procedural', interrupt: 'drag' },
  sit:        { lanes: ['body', 'gaze'],               kind: 'clip+procedural', interrupt: 'drag,touch' },
  sleep:      { lanes: ['body', 'expression', 'gaze'], kind: 'clip+procedural', interrupt: 'touch->wake,drag' },
  wake:       { lanes: ['body', 'expression'],         kind: 'clip',            interrupt: 'none', maxDuration: 1.5 },
  stretch:    { lanes: ['body'],                       kind: 'procedural',      interrupt: 'drag,touch' },
  stumble:    { lanes: ['body', 'expression'],         kind: 'procedural',      interrupt: 'drag' },
  recover:    { lanes: ['body', 'expression'],         kind: 'clip',            interrupt: 'none', maxDuration: 1.2 },
  reach:      { lanes: ['body'],                       kind: 'procedural',      interrupt: 'always', needs: 'target' },
  inspect:    { lanes: ['body', 'gaze'],               kind: 'procedural',      interrupt: 'drag,touch', needs: 'target' },
  wave:       { lanes: ['body'],                       kind: 'procedural',      interrupt: 'drag' },
  eat:        { lanes: ['body', 'expression'],         kind: 'procedural',      interrupt: 'not-in-last-30%', needs: 'prop' },
  drink:      { lanes: ['body', 'expression'],         kind: 'procedural',      interrupt: 'not-in-last-30%', needs: 'prop' },
  celebrate:  { lanes: ['body', 'expression'],         kind: 'clip+procedural', interrupt: 'drag,touch' },
  tail_react: { lanes: ['body'],                       kind: 'procedural',      interrupt: 'always' },
  look:       { lanes: ['gaze'],                       kind: 'procedural',      interrupt: 'always', needs: 'pattern' },
};

// Emotion -> expression recipe. `presets` are VRM 1.0 preset names; entries the model does not
// have are skipped, so a model with custom expressions (Whale-chan's face kit: focused, shy,
// confused, ...) can add them here and the stock sample simply ignores them. `head` is a small
// posture overlay in degrees (pitch>0 = chin down, yaw>0 = turn to the character's left,
// roll>0 = tilt toward the character's left shoulder).
export const EMOTION_RECIPES = {
  neutral:   { presets: {},                                                                                head: { pitch: 0, yaw: 0, roll: 0 } },
  happy:     { presets: { happy: 1.0 },                                                                    head: { pitch: -2, yaw: 0, roll: 2 } },
  sad:       { presets: { sad: 1.0, lookDown: 0.35 },                                                      head: { pitch: 8, yaw: 0, roll: 0 } },
  angry:     { presets: { angry: 1.0 },                                                                    head: { pitch: 5, yaw: 0, roll: 0 } },
  think:     { presets: { relaxed: 0.35, lookUp: 0.7, lookLeft: 0.4, focused: 1.0 },                       head: { pitch: -5, yaw: -8, roll: 9 } },
  surprised: { presets: { surprised: 1.0, oh: 0.25, shocked: 1.0 },                                        head: { pitch: -4, yaw: 0, roll: 0 } },
  awkward:   { presets: { happy: 0.35, sad: 0.3, lookDown: 0.45, lookRight: 0.35, ih: 0.15, shy: 1.0 },    head: { pitch: 6, yaw: 12, roll: -5 } },
  question:  { presets: { surprised: 0.45, blinkLeft: 0.6, lookUp: 0.25, oh: 0.15, confused: 1.0 },       head: { pitch: -2, yaw: 4, roll: -12 } },
  curious:   { presets: { surprised: 0.4, happy: 0.3, lookUp: 0.15, ih: 0.1 },                             head: { pitch: 3, yaw: -3, roll: 8 } },
};
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

// Per-action recipes on the stock library. Clip refs are `<source>:<name>` exactly as in
// anim/ACTION_CLIPS.json. A step is a clip segment ({ clip, from, to, timeScale, loop, reps })
// or a hold ({ hold: seconds }). `procedural` gives the default duration of a computed action.
const RECIPES = {
  idle:      { steps: [{ clip: 'quaternius:Idle_Loop', loop: true }] },
  walk:      { steps: [{ clip: 'quaternius:Walk_Loop', loop: true }], gaze: 'none' },
  // Jump_Start's first frame is a stray landing pose (hips 0.52 vs 0.87 standing), so start at 0.1 s.
  // The airborne part is a root arc here; in the pet it is the window moving.
  hop:       { steps: [{ clip: 'quaternius:Jump_Start', from: 0.1, to: 1.0, timeScale: 1.4 }, { hold: 0.42, flight: true }, { clip: 'quaternius:Jump_Land', from: 0.0, to: 1.0, timeScale: 1.35 }], then: 'idle' },
  sit:       { steps: [{ clip: 'quaternius:Sitting_Enter', from: 0, to: 1.3 }, { clip: 'quaternius:Sitting_Idle_Loop', loop: true }], exit: [{ clip: 'quaternius:Sitting_Exit', from: 0, to: 1.033 }] },
  // Quaternius has no sleep clip: Death01 slowed to 0.6x from 0.4 s (skips the standing head) and held.
  sleep:     { steps: [{ clip: 'quaternius:Death01', from: 0.4, to: 2.4, timeScale: 0.6, clamp: true }, { hold: Infinity }], gaze: 'none' },
  wake:      { steps: [{ clip: 'quaternius:Death01', from: 2.4, to: 0.4, timeScale: -1.45 }], then: 'idle' },
  stretch:   { procedural: 2.6, then: 'idle' },
  stumble:   { procedural: 1.1, then: 'recover' },
  recover:   { steps: [{ clip: 'quaternius:Jump_Land', from: 0.5, to: 1.267 }], then: 'idle' },
  reach:     { procedural: Infinity },
  inspect:   { procedural: 2.4, then: 'idle' },
  wave:      { procedural: 2.4, then: 'idle' },
  eat:       { procedural: null, then: 'idle' },     // bites * 1.3 + 0.4
  drink:     { procedural: null, then: 'idle' },     // sips * 1.7 + 0.4
  celebrate: { steps: [{ clip: 'quaternius:Dance_Loop', loop: true, reps: 3 }], then: 'idle', emotion: 'happy' },
};
const FADE = 0.22;
const IDENTITY_Q = new THREE.Quaternion();
const FINGERS = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal', 'IndexProximal', 'IndexIntermediate', 'IndexDistal', 'MiddleProximal', 'MiddleIntermediate', 'MiddleDistal', 'RingProximal', 'RingIntermediate', 'RingDistal', 'LittleProximal', 'LittleIntermediate', 'LittleDistal'];
// wave tunables (world directions for the right arm; the character faces +Z, her right is -X)
export const WAVE = { upperDir: [-0.85, 0.05, 0.5], foreDir: [-0.3, 1, 0.2], swingDeg: 22, hz: 2.4, twistDeg: -90, handDeg: 14, handTwistDeg: 0 };

export class ActionController {
  /**
   * @param {import('@pixiv/three-vrm').VRM} vrm
   * @param {object} opts
   * @param {{quaternius?:Map, vrma?:Map, mixamo?:Map}} opts.library  loaded, retargeted clips by source
   * @param {object} [opts.manifest]   anim/ACTION_CLIPS.json (used to upgrade owner-status actions when their primary clip is present)
   * @param {THREE.Scene} [opts.scene] where props / the look-at target live (default vrm.scene.parent)
   * @param {boolean} [opts.updateVRM=true]  call vrm.update(dt) at the end of update()
   * @param {object} [opts.emotionRecipes]  overrides / additions to EMOTION_RECIPES
   */
  constructor(vrm, opts = {}) {
    this.vrm = vrm;
    this.model = vrm.scene;
    this.hum = vrm.humanoid;
    this.library = { quaternius: new Map(), vrma: new Map(), mixamo: new Map(), ...(opts.library || {}) };
    this.manifest = opts.manifest || null;
    this.scene = opts.scene || vrm.scene.parent;
    this.updateVRM = opts.updateVRM !== false;
    this.recipes = { ...EMOTION_RECIPES, ...(opts.emotionRecipes || {}) };
    this.basePosition = this.model.position.clone();
    this.clock = 0;
    this.mixer = new THREE.AnimationMixer(this.model);
    this._clip = null;                 // current THREE.AnimationAction (base or step clip)
    this._fading = [];                 // actions fading out: { action, until }
    this._rootOffset = new THREE.Vector3();
    this._rootScale = 1;
    this.body = null;                  // { name, opts, t, dur, stepIndex, stepT, steps, then, ... }
    this.overlay = null;               // tail_react: { t, dur, sign }
    this.gaze = { pattern: 'none', cursor: { x: 0, y: 0 }, target: new THREE.Vector3(), desired: new THREE.Vector3(), yaw: 0, pitch: 0, headShare: 0, tau: 0.16, wanderT: 0 };
    this.emotion = {};                 // target weight per emotion
    this.emotionW = {};                // smoothed weight per emotion
    for (const e of EMOTIONS) { this.emotion[e] = e === 'neutral' ? 1 : 0; this.emotionW[e] = this.emotion[e]; }
    this.exprW = {};                   // smoothed weight per VRM expression
    this.blinkAuto = true; this._blinkT = 0; this._nextBlink = 2.2; this.forcedBlink = null;
    this.breatheOn = true;
    this._viseme = { name: null, w: 0 };
    this._props = {};
    this.lastIK = null;

    // frame helpers
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._q3 = new THREE.Quaternion();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this.model.updateWorldMatrix(true, true);
    const head = this.B('head');
    this.headY = opts.headY ?? (head ? head.getWorldPosition(new THREE.Vector3()).y : 1.3);
    this.lookTarget = new THREE.Object3D(); this.lookTarget.name = 'ActionController.lookTarget';
    this.scene?.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.gaze.target.set(0, this.headY, 3); this.gaze.desired.copy(this.gaze.target);
    this.lookTarget.position.copy(this.gaze.target);
    this._tailJoints = this._findTailJoints();
    // steps that mutate quaternions of the whole arm are slerped from what the clip left there
    this._pre = { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion() };
    // start in idle immediately
    this.start('idle');
  }

  // ------------------------------------------------------------------ public API
  static get ACTIONS() { return ACTIONS; }
  static lanesOf(name) { return ACTIONS[name]?.lanes ?? []; }
  B(name) { return this.hum.getNormalizedBoneNode(name); }

  /** true when `ref` (e.g. 'quaternius:Idle_Loop') is in the loaded library */
  hasClip(ref) { return !!this.resolveClip(ref); }
  resolveClip(ref) {
    if (!ref) return null;
    const m = /^(\w+):([^\s(]+)/.exec(ref); if (!m) return null;
    return this.library[m[1]]?.get(m[2]) || null;
  }
  /** first resolvable ref among the manifest's primary + alternates for `action` */
  manifestClip(action, primaryOnly = false) {
    const a = this.manifest?.actions?.[action]; if (!a) return null;
    const refs = [a.primary].concat(primaryOnly ? [] : a.alternates || []);
    for (const r of refs) { const c = this.resolveClip(r); if (c) return { ref: r, clip: c }; }
    return null;
  }

  /**
   * Start an action. `look` and `tail_react` are overlays (gaze lane / impulse) and do not
   * replace the current body action. Everything else replaces the body action with a crossfade.
   * Returns { name, duration } where duration is null for open-ended actions.
   */
  start(name, opts = {}) {
    if (!ACTIONS[name]) throw new Error('ActionController: unknown action ' + name);
    if (name === 'look') return this._startLook(opts);
    if (name === 'tail_react') return this._startTailReact(opts);
    const recipe = { ...RECIPES[name] };
    let steps = recipe.steps ? recipe.steps.map((s) => ({ ...s })) : null;
    let source = steps ? 'clip' : 'procedural';
    // data-driven upgrade: an owner-status action whose manifest PRIMARY is present plays it as one clip
    const status = this.manifest?.actions?.[name]?.status;
    // owner-status actions upgrade to a real clip as soon as the owner drops one: the manifest
    // primary first, then any owner-provided alternate (vrma:/mixamo:), never the Quaternius
    // fallbacks, which stay composite/procedural on purpose.
    if (status === 'owner') { let mc = this.manifestClip(name, true); if (!mc) { const a = (this.manifest?.actions?.[name]?.alternates || this.manifest?.[name]?.alternates || []).filter((r) => /^(vrma|mixamo):/.test(String(r).split(' ')[0])); for (const r of a) { const c = this.resolveClip(String(r).split(' ')[0]); if (c) { mc = { ref: String(r).split(' ')[0], clip: c }; break; } } } if (mc) { steps = [{ clip: mc.ref, from: 0, to: mc.clip.duration }]; source = 'clip:' + mc.ref; } }
    if (opts.clip) { const c = this.resolveClip(opts.clip); if (!c) throw new Error('clip not loaded: ' + opts.clip); steps = [{ clip: opts.clip, from: 0, to: c.duration, loop: !!opts.loop }]; source = 'clip:' + opts.clip; }

    const prev = this.body;
    if (prev?.name === 'wake') this.forcedBlink = null;   // the wake squint must not outlive an interrupted wake
    const st = { name, opts, t: 0, dur: null, steps, stepIndex: -1, stepT: 0, then: recipe.then ?? null, exit: recipe.exit ?? null, source, done: false, state: {} };
    if (steps) {
      st.dur = 0;
      for (const s of steps) { const d = this._stepDuration(s); if (d === Infinity) { st.dur = null; break; } st.dur += d; }
    } else {
      st.dur = opts.duration ?? recipe.procedural ?? 2;
      if (name === 'eat') { st.state.bites = opts.bites ?? 3; st.state.cycle = 1.3; st.dur = opts.duration ?? st.state.bites * st.state.cycle + 0.4; }
      if (name === 'drink') { st.state.sips = opts.sips ?? 2; st.state.cycle = 1.7; st.dur = opts.duration ?? st.state.sips * st.state.cycle + 0.4; }
      if (st.dur === Infinity) st.dur = null;
    }
    if (name === 'reach' || name === 'inspect') {
      if (!opts.target) throw new Error(name + ' needs opts.target (THREE.Vector3, world)');
      st.state.target = opts.target.clone ? opts.target.clone() : new THREE.Vector3().fromArray(opts.target);
      st.state.side = opts.side || this._nearerArm(st.state.target);
    }
    if (name === 'stumble') { const imp = opts.impulse ? new THREE.Vector3().fromArray(opts.impulse.toArray ? opts.impulse.toArray() : opts.impulse) : new THREE.Vector3(1.1, 0, 0.35); st.state.v = imp; st.state.p = new THREE.Vector3(); }
    if (name === 'eat' || name === 'drink') { this._attachProp(name === 'eat' ? (opts.prop || 'food') : (opts.prop || 'drink'), opts.hand || 'right'); st.state.hand = opts.hand || 'right'; }
    if (name === 'sit') st.state.seatHeight = opts.seatHeight ?? null;
    // gaze/emotion side effects declared by the recipe (sleep closes the eyes; celebrate is happy)
    if (recipe.gaze) this._startLook({ pattern: recipe.gaze });
    if (recipe.emotion) this.setEmotion(recipe.emotion, 1);
    if (name === 'wake') this.setEmotion('neutral', 1);
    if (name === 'stumble') this.setEmotion('surprised', 1);
    if (name === 'recover' && prev?.name !== 'stumble') this.setEmotion('neutral', 1);
    if (prev && prev.name === 'eat' || prev && prev.name === 'drink') { if (name !== 'eat' && name !== 'drink') this._detachProps(); }

    this.body = st;
    if (steps) this._enterStep(0);
    else this._ensureBaseLoop();
    return { name, duration: st.dur, source };
  }

  /** Stop the body action (sit plays its exit clip) and return to idle. stop('gaze') resets the look pattern. */
  stop(lane) {
    if (lane === 'gaze') return this._startLook({ pattern: 'none' });
    const cur = this.body;
    if (!cur || cur.name === 'idle') return;
    this._detachProps();
    if (cur.state?.prevGaze != null) this._startLook({ pattern: cur.state.prevGaze });
    if (cur.name === 'sleep') this.setEmotion('neutral', 1);
    if (cur.name === 'celebrate' || cur.name === 'stumble' || cur.name === 'recover') this.setEmotion('neutral', 1);
    if (cur.exit && cur.stepIndex >= 1) {
      const st = { name: cur.name + ':exit', opts: {}, t: 0, dur: cur.exit.reduce((a, s) => a + this._stepDuration(s), 0), steps: cur.exit.map((s) => ({ ...s })), stepIndex: -1, stepT: 0, then: 'idle', source: 'clip', state: {} };
      this.body = st; this._enterStep(0); return;
    }
    this.start('idle');
  }

  /** Exclusive emotion with a ~250 ms crossfade. `weight` scales it (0..1); the rest fades out. */
  setEmotion(name, weight = 1, { additive = false } = {}) {
    if (!EMOTIONS.includes(name)) throw new Error('unknown emotion ' + name);
    if (!additive) for (const e of EMOTIONS) this.emotion[e] = 0;
    this.emotion[name] = clamp(weight, 0, 1);
    if (!additive && name !== 'neutral') this.emotion.neutral = 1 - this.emotion[name];
  }
  /** Mix several: setEmotionWeights({ happy: 0.5, curious: 0.5 }) */
  setEmotionWeights(map) { for (const e of EMOTIONS) this.emotion[e] = clamp(map[e] ?? 0, 0, 1); }
  setCursor(nx, ny) { this.gaze.cursor.x = clamp(nx, -1, 1); this.gaze.cursor.y = clamp(ny, -1, 1); }
  setLookPoint(v) { this.gaze.pattern = 'point'; this.gaze.point = v.clone(); this.gaze.headShare = 0.7; }

  get current() { return this.body ? { name: this.body.name, t: this.body.t, duration: this.body.dur, step: this.body.stepIndex, source: this.body.source } : null; }
  get lanesInUse() { const s = new Set(this.body ? ACTIONS[this.body.name.replace(/:exit$/, '')].lanes : []); if (this.gaze.pattern !== 'none') s.add('gaze'); if (this.overlay) s.add('body'); return [...s]; }

  // ------------------------------------------------------------------ per-frame
  update(dtIn) {
    const dt = clamp(dtIn, 0, 0.05);
    this.clock += dt;
    const hum = this.hum, model = this.model;
    hum.resetNormalizedPose();
    this._rootOffset.set(0, 0, 0); this._rootScale = 1;

    // 1. body clip machine + mixer
    this._advanceBody(dt);
    this.mixer.update(dt);
    this._forceApply();
    this._pruneFades();
    if (!this._clip) this._fallbackPose();

    // 2. at-rest layer (damped, not stopped, under actions)
    this._breathing(dt);

    // 3. procedural body layers
    this._procedural(dt);
    this._tailReact(dt);

    // 4. gaze: neck+head turn, eye target
    this._gaze(dt);

    // 5. emotion posture + expressions
    this._expressions(dt);

    // 6. root
    model.position.copy(this.basePosition).add(this._rootOffset);
    if (this._rootScale !== 1) { const sy = this._rootScale, sx = 1 / Math.sqrt(sy); model.scale.set(sx, sy, sx); } else model.scale.set(1, 1, 1);

    if (this.updateVRM) this.vrm.update(dt);
  }

  // ------------------------------------------------------------------ clip machine
  _stepDuration(s) {
    if (s.hold != null) return s.hold;
    const clip = this.resolveClip(s.clip); if (!clip) return 0;
    const ts = Math.abs(s.timeScale ?? 1);
    if (s.loop) return s.reps ? s.reps * clip.duration / ts : Infinity;
    const from = s.from ?? 0, to = s.to ?? clip.duration;
    return Math.abs(to - from) / ts;
  }
  _enterStep(i) {
    const st = this.body; st.stepIndex = i; st.stepT = 0;
    const s = st.steps[i];
    if (!s) { this._finishBody(); return; }
    if (s.hold != null) return;                          // keep whatever clip is playing (clamped)
    const clip = this.resolveClip(s.clip);
    if (!clip) { console.warn('ActionController: clip missing', s.clip, '- skipping step'); this._enterStep(i + 1); return; }
    this._playClip(clip, s);
  }
  _playClip(clip, s = {}) {
    const a = this.mixer.clipAction(clip);
    const prev = this._clip;
    if (prev === a) { a.time = s.from ?? 0; a.timeScale = s.timeScale ?? 1; a.setLoop(s.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.paused = false; return; }
    a.reset(); a.enabled = true; a.paused = false;
    a.setLoop(s.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = s.timeScale ?? 1;
    a.time = s.from ?? (a.timeScale < 0 ? clip.duration : 0);
    a.setEffectiveWeight(1);
    if (prev) { a.crossFadeFrom(prev, s.fade ?? FADE, false); this._fading.push({ action: prev, until: this.clock + (s.fade ?? FADE) + 0.05 }); }
    a.play();
    // crossFadeFrom sets the time of `a` from prev when warp; keep our explicit start time
    a.time = s.from ?? (a.timeScale < 0 ? clip.duration : 0);
    this._clip = a;
  }
  // three's PropertyMixer.apply() skips binding.setValue when the blended value did not change
  // since the previous frame (a change-detection optimisation). A clamped LoopOnce clip (hop
  // flight hold, sleep hold, the start of wake) therefore writes nothing while
  // resetNormalizedPose() keeps wiping the bones -> T-pose. Re-apply the final blended value
  // of every active binding each frame (the current accumulation region already holds it).
  _forceApply() {
    const m = this.mixer, n = m._nActiveBindings, bindings = m._bindings, accu = m._accuIndex;
    for (let i = 0; i < n; i++) { const pm = bindings[i]; const stride = pm.valueSize; pm.binding.setValue(pm.buffer, accu * stride + stride); }
  }
  _pruneFades() {
    for (let i = this._fading.length - 1; i >= 0; i--) {
      const f = this._fading[i];
      if (this.clock >= f.until) { if (f.action !== this._clip) f.action.stop(); this._fading.splice(i, 1); }
    }
  }
  _ensureBaseLoop() {
    // procedural actions keep a looping clip underneath; if the current clip is not looping, go idle
    if (this._clip && this._clip.loop === THREE.LoopRepeat && this._clip.isRunning()) return;
    const idle = this.resolveClip('quaternius:Idle_Loop');
    if (idle) this._playClip(idle, { loop: true });
  }
  _advanceBody(dt) {
    const st = this.body; if (!st) return;
    st.t += dt;
    if (st.steps) {
      const s = st.steps[st.stepIndex];
      if (!s) return;
      st.stepT += dt;
      let done = false;
      if (s.hold != null) done = st.stepT >= s.hold;
      else if (s.loop) done = s.reps ? st.stepT >= this._stepDuration(s) : false;
      else {
        const a = this._clip, to = s.to ?? a?.getClip().duration ?? 0;
        if (a) done = (a.timeScale >= 0) ? a.time >= to - 1e-4 : a.time <= to + 1e-4;
        if (!done && st.stepT >= this._stepDuration(s) + 0.05) done = true;      // safety net (mixer time can lag a frame)
      }
      if (done) { if (s.clamp && s.to != null && this._clip) { this._clip.paused = true; } this._enterStep(st.stepIndex + 1); }
    } else if (st.dur != null && st.t >= st.dur) this._finishBody();
  }
  _finishBody() {
    const st = this.body; if (!st || st.done) return;
    st.done = true;
    if (st.name === 'wake') this.forcedBlink = null;
    const next = st.then;
    if (st.state.prevGaze != null) this._startLook({ pattern: st.state.prevGaze });
    if (st.name === 'celebrate') this.setEmotion('neutral', 1);
    if (st.name === 'eat' || st.name === 'drink') this._detachProps();
    if (next) this.start(next);
    else if (st.name.endsWith(':exit')) this.start('idle');
  }
  _fallbackPose() {
    // no clip loaded (library empty): bring the T-pose arms down so the model at least stands
    this._rotZ('rightUpperArm', 68 * DEG); this._rotZ('leftUpperArm', -68 * DEG);
    this._rotZ('rightLowerArm', 8 * DEG); this._rotZ('leftLowerArm', -8 * DEG);
  }

  // ------------------------------------------------------------------ bone helpers
  _rotZ(n, a) { const b = this.B(n); if (b) b.quaternion.multiply(this._q.setFromAxisAngle(this._v.set(0, 0, 1), a)); }
  _rotX(n, a) { const b = this.B(n); if (b) b.quaternion.multiply(this._q.setFromAxisAngle(this._v.set(1, 0, 0), a)); }
  _rotY(n, a) { const b = this.B(n); if (b) b.quaternion.multiply(this._q.setFromAxisAngle(this._v.set(0, 1, 0), a)); }
  /** absolute pose in normalized (T-pose = identity) space, slerped over what the clip left by w */
  _poseAbs(n, q, w) { const b = this.B(n); if (!b) return; if (w >= 1) b.quaternion.copy(q); else b.quaternion.slerp(q, w); }
  _euler(x, y, z) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'ZYX')); }
  _nearerArm(target) { const l = this.model.worldToLocal(target.clone()); return l.x > 0 ? 'left' : 'right'; }

  // ------------------------------------------------------------------ at-rest
  _breathing(dt) {
    if (!this.breatheOn) return;
    const name = this.body?.name;
    const sleeping = name === 'sleep';
    const rest = !name || name === 'idle' || name === 'sit' || sleeping;
    const amp = sleeping ? 1.4 : rest ? 1 : 0.4;                       // damped under actions
    const period = sleeping ? 5.2 : 3.6;
    const b = Math.sin(this.clock * 2 * Math.PI / period) * amp;
    this._rotX('spine', -1.2 * DEG * b); this._rotX('chest', -1.8 * DEG * b); this._rotX('upperChest', -1.2 * DEG * b);
    this._rotX('neck', 0.8 * DEG * b); this._rotX('head', 0.6 * DEG * b);
    this._rotZ('rightShoulder', -2.0 * DEG * b); this._rotZ('leftShoulder', 2.0 * DEG * b);
  }

  // ------------------------------------------------------------------ procedural body layers
  _procedural(dt) {
    const st = this.body; if (!st) return;
    const p = st.dur ? clamp(st.t / st.dur, 0, 1) : 0;
    switch (st.name) {
      case 'stretch': this._stretch(st, p); break;
      case 'wave': this._wave(st, p); break;
      case 'stumble': this._stumble(st, dt, p); break;
      case 'reach': this._reach(st, dt, false); break;
      case 'inspect': this._reach(st, dt, true); break;
      case 'eat': this._eatDrink(st, dt, 'eat'); break;
      case 'drink': this._eatDrink(st, dt, 'drink'); break;
      case 'hop': this._hopFlight(st); break;
      case 'sit': this._seat(st); break;
      case 'celebrate': this._celebrateWag(st); break;
      case 'wake': this._wakeOverlay(st, p); break;
    }
  }
  _envelope(p, inF, outF) { return p < inF ? smooth(p / inF) : p > 1 - outF ? smooth((1 - p) / outF) : 1; }

  _stretch(st, p) {
    const w = this._envelope(p, 0.28, 0.25);
    const tremble = 1.5 * Math.sin(this.clock * 2 * Math.PI * 9) * (w > 0.95 ? 1 : 0);
    // arms straight up and slightly out; from T-pose (identity) the right arm points -X, so -Z rotation lifts it
    this._poseAbs('rightUpperArm', this._euler(0, 0, -82 + tremble), w);
    this._poseAbs('leftUpperArm', this._euler(0, 0, 82 - tremble), w);
    this._poseAbs('rightLowerArm', this._euler(0, 0, -12), w);
    this._poseAbs('leftLowerArm', this._euler(0, 0, 12), w);
    this._poseAbs('rightHand', this._euler(0, 0, -10), w);
    this._poseAbs('leftHand', this._euler(0, 0, 10), w);
    this._rotZ('rightShoulder', -14 * DEG * w); this._rotZ('leftShoulder', 14 * DEG * w);
    this._rotX('spine', -6 * DEG * w); this._rotX('chest', -6 * DEG * w); this._rotX('upperChest', -4 * DEG * w);
    this._rotX('neck', -8 * DEG * w); this._rotX('head', -10 * DEG * w);
    // rise on the toes a touch
    this._rootOffset.y += 0.012 * w;
  }
  _wave(st, p) {
    const w = this._envelope(p, 0.16, 0.18), t = st.t, T = WAVE;
    const swing = T.swingDeg * DEG * Math.sin(t * 2 * Math.PI * T.hz);
    // Build the arm from world directions (normalized space: T-pose = identity, right arm bone = -X):
    // upper arm out/forward with the elbow near shoulder height, forearm up, swinging about the
    // view axis (Z) so the hand goes side to side in the frontal plane; then a twist about the
    // forearm axis turns the palm to the viewer.
    const upDir = this._v.fromArray(T.upperDir).normalize();
    const qUp = new THREE.Quaternion().setFromUnitVectors(this._v2.set(-1, 0, 0), upDir);
    const foreWorld = this._v3.fromArray(T.foreDir).normalize().applyAxisAngle(this._v2.set(0, 0, 1), swing);
    const foreLocal = foreWorld.clone().applyQuaternion(this._q3.copy(qUp).invert());
    const qLo = new THREE.Quaternion().setFromUnitVectors(this._v2.set(-1, 0, 0), foreLocal).multiply(this._euler(T.twistDeg, 0, 0));
    this._poseAbs('rightUpperArm', qUp, w);
    this._poseAbs('rightLowerArm', qLo, w);
    this._poseAbs('rightHand', this._euler(0, 0, T.handDeg * Math.sin(t * 2 * Math.PI * T.hz + 0.9)).multiply(this._euler(T.handTwistDeg, 0, 0)), w);
    this._openHand('right', w);
    this._rotZ('rightShoulder', -8 * DEG * w);
    this._rotZ('spine', 2.5 * DEG * w); this._rotZ('head', -5 * DEG * w);
  }
  /** straighten the fingers (normalized rest = open flat hand) over whatever the clip left, by w */
  _openHand(side, w) {
    for (const f of FINGERS) this._poseAbs(side + f, IDENTITY_Q, w);
  }
  _stumble(st, dt, p) {
    const s = st.state, k = 55, c = 2 * Math.sqrt(k) * 0.32;
    s.v.addScaledVector(s.p, -k * dt).addScaledVector(s.v, -c * dt);
    s.p.addScaledVector(s.v, dt);
    const out = smooth(clamp((1 - p) / 0.25, 0, 1));                 // settle into recover
    this._rootOffset.addScaledVector(s.p, 0.6 * out);
    const lean = clamp(s.v.length(), 0, 2.5) * out;
    // lean opposite to the velocity, bend the knees, throw the arms out
    this._rotZ('hips', -clamp(s.v.x, -2.5, 2.5) * 12 * DEG * out); this._rotX('hips', clamp(s.v.z, -2.5, 2.5) * 9 * DEG * out);
    this._rotZ('spine', -clamp(s.v.x, -2.5, 2.5) * 6 * DEG * out);
    const bend = lean * 14 * DEG;
    this._rotX('rightUpperLeg', -bend * 0.6); this._rotX('leftUpperLeg', -bend * 0.6);
    this._rotX('rightLowerLeg', bend * 1.3); this._rotX('leftLowerLeg', bend * 1.3);
    const aw = clamp(lean / 1.6, 0, 1);
    this._poseAbs('rightUpperArm', this._euler(0, 20, 12), aw * 0.8); this._poseAbs('leftUpperArm', this._euler(0, -20, -12), aw * 0.8);
    this._poseAbs('rightLowerArm', this._euler(0, 35, -10), aw * 0.8); this._poseAbs('leftLowerArm', this._euler(0, -35, 10), aw * 0.8);
    this._rootOffset.y -= 0.02 * lean;
  }
  _hopFlight(st) {
    const s = st.steps[st.stepIndex]; if (!s) return;
    if (s.flight) {
      const k = clamp(st.stepT / s.hold, 0, 1);
      this._rootOffset.y += 0.20 * Math.sin(k * Math.PI);
      this._rootScale = 1 + 0.06 * Math.sin(k * Math.PI);                 // slight stretch in the air
      this._rotX('rightUpperLeg', -18 * DEG * Math.sin(k * Math.PI)); this._rotX('leftUpperLeg', -18 * DEG * Math.sin(k * Math.PI));
      this._rotX('rightLowerLeg', 30 * DEG * Math.sin(k * Math.PI)); this._rotX('leftLowerLeg', 30 * DEG * Math.sin(k * Math.PI));
    } else if (st.stepIndex === 2 && st.stepT < 0.12) {
      this._rootScale = lerp(0.9, 1, st.stepT / 0.12);                  // landing squash
    }
  }
  _seat(st) {
    const h = st.state.seatHeight; if (h == null) return;
    const hips = this.B('hips'); if (!hips) return;
    const w = st.stepIndex >= 1 ? 1 : smooth(clamp((st.stepT - 0.5) / 0.8, 0, 1));
    hips.position.y = lerp(hips.position.y, h, w);
  }
  _celebrateWag(st) {
    // tail wag: alternate spring impulses every 0.35 s (hair on the stock model — it has no tail)
    const phase = Math.floor(st.t / 0.35);
    if (phase !== st.state.lastWag) { st.state.lastWag = phase; this._impulseTail((phase % 2 ? 1 : -1) * 0.035, 0.01); }
  }
  _wakeOverlay(st, p) {
    // squint open + a small rub-eyes head roll while the clip plays back to standing
    this.forcedBlink = clamp(0.85 - p, 0, 1);
    this._rotZ('head', 6 * DEG * Math.sin(p * Math.PI));
    if (p >= 1) this.forcedBlink = null;
  }

  // ------------------------------------------------------------------ IK
  /** Two-bone analytic IK on one arm toward a world target; w blends from the underlying pose. */
  solveArm(side, target, w = 1) {
    const up = this.B(side + 'UpperArm'), lo = this.B(side + 'LowerArm'), hand = this.B(side + 'Hand');
    if (!up || !lo || !hand) return null;
    const model = this.model, _v = this._v, _v2 = this._v2, _v3 = this._v3, _q = this._q, _q2 = this._q2;
    this._pre.up.copy(up.quaternion); this._pre.lo.copy(lo.quaternion);
    model.updateWorldMatrix(true, true);
    const s = up.getWorldPosition(new THREE.Vector3()), e0 = lo.getWorldPosition(new THREE.Vector3()), h0 = hand.getWorldPosition(new THREE.Vector3());
    const a = s.distanceTo(e0), b = e0.distanceTo(h0);
    const d = clamp(s.distanceTo(target), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const elbow = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    const sign = side === 'right' ? 1 : -1;
    lo.quaternion.setFromAxisAngle(_v.set(0, 1, 0), sign * (Math.PI - elbow));   // forward-bending elbow
    for (let it = 0; it < 2; it++) {
      model.updateWorldMatrix(true, true);
      hand.getWorldPosition(h0);
      _v.subVectors(h0, s).normalize(); _v2.subVectors(target, s).normalize();
      _q.setFromUnitVectors(_v, _v2);
      up.parent.getWorldQuaternion(_q2);
      up.quaternion.premultiply(_q2).premultiply(_q).premultiply(this._q3.copy(_q2).invert());
    }
    // pole: drop the elbow below/behind
    model.updateWorldMatrix(true, true);
    lo.getWorldPosition(e0);
    const axis = _v2.subVectors(target, s).normalize();
    const pole = _v3.set(s.x - 0.3 * sign, s.y - 0.6, s.z - 0.3);
    const pe = e0.clone().sub(s).projectOnPlane(axis).normalize(), pp = pole.sub(s).projectOnPlane(axis).normalize();
    let ang = Math.acos(clamp(pe.dot(pp), -1, 1)); if (pe.clone().cross(pp).dot(axis) < 0) ang = -ang;
    _q.setFromAxisAngle(axis, ang * 0.85);
    up.parent.getWorldQuaternion(_q2);
    up.quaternion.premultiply(_q2).premultiply(_q).premultiply(this._q3.copy(_q2).invert());
    if (w < 1) { up.quaternion.slerp(this._pre.up, 1 - w); lo.quaternion.slerp(this._pre.lo, 1 - w); }
    model.updateWorldMatrix(true, true);
    const err = hand.getWorldPosition(h0).distanceTo(target);
    this.lastIK = { side, target: target.toArray(), errorM: err, reachable: s.distanceTo(target) <= a + b };
    return this.lastIK;
  }
  _reach(st, dt, inspect) {
    const s = st.state, tgt = s.target;
    const inW = smooth(clamp(st.t / 0.45, 0, 1));
    const outW = st.dur ? smooth(clamp((st.dur - st.t) / 0.35, 0, 1)) : 1;
    const w = inW * outW;
    if (inspect) {
      // lean toward the target from the spine, and lock the gaze on it
      const l = this.model.worldToLocal(tgt.clone());
      const yaw = clamp(Math.atan2(l.x, Math.max(0.05, l.z)), -0.6, 0.6), pitch = clamp(-Math.atan2(l.y - this.headY * 0.75, Math.hypot(l.x, l.z)), -0.35, 0.45);
      this._rotY('spine', yaw * 0.35 * w); this._rotY('chest', yaw * 0.25 * w);
      this._rotX('spine', pitch * 0.35 * w); this._rotX('chest', pitch * 0.3 * w);
      if (s.prevGaze == null) s.prevGaze = this.gaze.pattern === 'point' ? 'none' : this.gaze.pattern;
      this.gaze.point = tgt; this.gaze.pattern = 'point'; this.gaze.headShare = 1.0;
    }
    this.solveArm(s.side, tgt, w);
    this._openHand(s.side, w);
  }
  _eatDrink(st, dt, kind) {
    const s = st.state, side = s.hand, cyc = s.cycle, n = kind === 'eat' ? s.bites : s.sips;
    const model = this.model;
    model.updateWorldMatrix(true, true);
    const head = this.B('head').getWorldPosition(new THREE.Vector3());
    const chest = this.B('chest').getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(model.quaternion);
    const sx = side === 'right' ? -1 : 1;
    // hand targets: hold in front of the chest; mouth just below the head joint + forward
    const hold = chest.clone().addScaledVector(fwd, 0.27).addScaledVector(right, sx * 0.12).add(new THREE.Vector3(0, 0.02, 0));
    const mouthHand = head.clone().addScaledVector(fwd, kind === 'eat' ? 0.14 : 0.12).addScaledVector(right, sx * 0.03).add(new THREE.Vector3(0, kind === 'eat' ? -0.09 : -0.07, 0));
    const k = st.t / cyc, i = Math.min(n - 1, Math.floor(k)), ph = k < n ? k - i : 1;
    const settle = k >= n;
    let target, chew = 0, vis = null, sip = 0;
    if (kind === 'eat') {
      if (ph < 0.32) target = hold.clone().lerp(mouthHand, smooth(ph / 0.32));
      else if (ph < 0.58) { target = mouthHand; const q = (ph - 0.32) / 0.26; vis = 'aa'; chew = 0.55 * Math.sin(q * Math.PI); }
      else { target = mouthHand.clone().lerp(hold, smooth((ph - 0.58) / 0.42)); vis = 'aa'; chew = 0.22 * Math.abs(Math.sin(this.clock * 2 * Math.PI * 4.5)); }
    } else {
      if (ph < 0.3) target = hold.clone().lerp(mouthHand, smooth(ph / 0.3));
      else if (ph < 0.72) { target = mouthHand; sip = smooth(clamp((ph - 0.3) / 0.15, 0, 1)) * smooth(clamp((0.72 - ph) / 0.15, 0, 1)); vis = 'ou'; chew = 0.35 * sip; }
      else target = mouthHand.clone().lerp(hold, smooth((ph - 0.72) / 0.28));
    }
    if (settle) { target = hold; vis = 'aa'; chew = 0.18 * Math.abs(Math.sin(this.clock * 2 * Math.PI * 4.5)) * smooth(clamp((st.dur - st.t) / 0.3, 0, 1)); }
    const w = smooth(clamp(st.t / 0.3, 0, 1)) * smooth(clamp((st.dur - st.t) / 0.35, 0, 1));
    // head tips back for a sip, down a little for a bite
    if (kind === 'drink') { this._rotX('neck', -6 * DEG * sip * w); this._rotX('head', -10 * DEG * sip * w); }
    else if (ph >= 0.32 && ph < 0.58 && !settle) this._rotX('head', 6 * DEG * w);
    this.solveArm(side, target, w);
    // wrist: turn the palm up toward the face so the prop faces the mouth
    const hand = this.B(side + 'Hand'); if (hand) hand.quaternion.multiply(this._q.setFromAxisAngle(this._v.set(1, 0, 0), sx * -55 * DEG * w));
    this._viseme.name = vis; this._viseme.w = chew * w;
  }

  // ------------------------------------------------------------------ props
  _attachProp(kind, side) {
    this._detachProps();
    let mesh;
    if (kind === 'food' || kind === 'apple') {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.036, 20, 14), new THREE.MeshToonMaterial({ color: 0xd9453a }));
      body.scale.set(1, 0.92, 1);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.02, 6), new THREE.MeshToonMaterial({ color: 0x5b3a1e }));
      stem.position.y = 0.04; mesh.add(body, stem);
    } else if (kind === 'bowl') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.035, 20, 1, true), new THREE.MeshToonMaterial({ color: 0xf2e9d8, side: THREE.DoubleSide }));
    } else { // drink: a cup
      mesh = new THREE.Group();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.085, 18, 1, true), new THREE.MeshToonMaterial({ color: 0x4f8fd9, side: THREE.DoubleSide }));
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), new THREE.MeshToonMaterial({ color: 0x3c6fae, side: THREE.DoubleSide }));
      bottom.rotation.x = Math.PI / 2; bottom.position.y = -0.0425;
      mesh.add(cup, bottom);
    }
    mesh.name = 'prop:' + kind;
    const hand = this.B(side + 'Hand');
    // normalized hand bone: identity rest, bone runs along -X (right) / +X (left); palm side is -Y
    mesh.position.set(side === 'right' ? -0.075 : 0.075, -0.035, 0.0);
    hand.add(mesh);
    this._props[kind] = mesh;
    return mesh;
  }
  _detachProps() { for (const k of Object.keys(this._props)) { const m = this._props[k]; m.parent?.remove(m); delete this._props[k]; } }
  get props() { return Object.keys(this._props); }

  // ------------------------------------------------------------------ tail_react (spring impulse)
  _findTailJoints() {
    const all = [], tail = [];
    this.vrm.springBoneManager?.joints.forEach((j) => { all.push(j); if (/tail/i.test(j.bone?.name || '')) tail.push(j); });
    return { tail, all, usingFallback: tail.length === 0 };
  }
  _impulseTail(dx, dy = 0, dz = 0) {
    const js = this._tailJoints.tail.length ? this._tailJoints.tail : this._tailJoints.all;
    // Verlet: next = cur + (cur - prev)*(1-drag); pulling prevTail back adds velocity for one step
    for (const j of js) { if (j._prevTail) { j._prevTail.x -= dx; j._prevTail.y -= dy; j._prevTail.z -= dz; } }
    return js.length;
  }
  _startTailReact(opts) {
    const sign = opts.sign ?? (this.overlay ? -this.overlay.sign : 1);
    this.overlay = { t: 0, dur: opts.duration ?? 0.9, sign, strength: opts.strength ?? 1, wiggle: opts.wiggle !== false };
    const n = this._impulseTail(sign * 0.06 * this.overlay.strength, 0.015 * this.overlay.strength, 0);
    return { name: 'tail_react', duration: this.overlay.dur, joints: n, fallback: this._tailJoints.usingFallback };
  }
  _tailReact(dt) {
    const o = this.overlay; if (!o) return;
    o.t += dt;
    if (o.t >= o.dur) { this.overlay = null; return; }
    const p = o.t / o.dur, decay = Math.exp(-p * 3.2);
    // no tail on the stock model: a hip wiggle so the reaction is visible on the body too
    if (o.wiggle) { const a = 7 * DEG * Math.sin(o.t * 2 * Math.PI * 4.5) * decay * o.sign * o.strength; this._rotY('hips', a); this._rotY('spine', -a * 0.6); }
    if (o.t < 0.25 && Math.floor(o.t / 0.08) !== o.lastKick) { o.lastKick = Math.floor(o.t / 0.08); this._impulseTail(o.sign * 0.02 * o.strength, 0.006, 0); }
  }

  // ------------------------------------------------------------------ gaze
  _startLook(opts) {
    const pattern = opts.pattern ?? 'follow';
    if (!LOOK_PATTERNS.includes(pattern) && pattern !== 'point') throw new Error('unknown look pattern ' + pattern);
    const g = this.gaze;
    g.pattern = pattern; g.wanderT = 0;
    if (opts.target) { g.point = opts.target.clone ? opts.target.clone() : new THREE.Vector3().fromArray(opts.target); g.pattern = 'point'; }
    g.headShare = { follow: 0.6, wander: 0.5, cursorLock: 1.0, away: 0.75, down: 0.7, up: 0.7, edge: 0.85, none: 0, point: 0.8 }[g.pattern];
    g.tau = g.pattern === 'cursorLock' ? 0.04 : 0.16;
    return { name: 'look', pattern: g.pattern, duration: null };
  }
  _gaze(dt) {
    const g = this.gaze, hy = this.headY, c = g.cursor, d = g.desired;
    const plane = (x, y) => d.set(x * 1.2, hy + y * 0.9, 1.2);
    switch (g.pattern) {
      case 'follow': case 'cursorLock': plane(c.x, c.y); break;
      case 'wander': g.wanderT -= dt; if (g.wanderT <= 0) { g.wanderT = 1.2 + Math.random() * 1.6; plane((Math.random() * 2 - 1) * 0.7, (Math.random() * 2 - 1) * 0.5); g.wanderTarget = d.clone(); } if (g.wanderTarget) d.copy(g.wanderTarget); break;
      case 'away': { const sx = c.x >= 0 ? -1 : 1; d.set(sx * 1.3, hy - 0.08, 0.7); break; }
      case 'down': d.set(0.05, hy - 1.1, 0.75); break;
      case 'up': d.set(0, hy + 1.3, 0.8); break;
      case 'edge': { const sx = Math.abs(c.x) < 0.05 ? 1 : Math.sign(c.x); d.set(sx * 1.6, hy - 0.25, 0.45); break; }
      case 'point': if (g.point) d.copy(g.point); break;
      default: d.set(0, hy, 3); break;
    }
    g.target.lerp(d, expDamp(dt, g.tau));
    this.lookTarget.position.copy(g.target);
    // head+neck turn toward the target by headShare; the eyes (vrm.lookAt) cover the remainder
    const head = this.B('head'); if (!head) return;
    this.model.updateWorldMatrix(true, true);
    const hp = head.getWorldPosition(this._v);
    const l = this.model.worldToLocal(this._v2.copy(g.target)); const hl = this.model.worldToLocal(hp.clone());
    const dx = l.x - hl.x, dy = l.y - hl.y, dz = l.z - hl.z;
    const yaw = clamp(Math.atan2(dx, Math.max(0.05, dz)), -48 * DEG, 48 * DEG) * g.headShare;
    const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -28 * DEG, 30 * DEG) * g.headShare;
    g.yaw = lerp(g.yaw, yaw, expDamp(dt, g.tau)); g.pitch = lerp(g.pitch, pitch, expDamp(dt, g.tau));
    this._rotY('neck', g.yaw * 0.35); this._rotX('neck', g.pitch * 0.35);
    this._rotY('head', g.yaw * 0.65); this._rotX('head', g.pitch * 0.65);
  }

  // ------------------------------------------------------------------ expressions
  _blink(dt) {
    if (this.forcedBlink != null) return this.forcedBlink;
    if (this.body?.name === 'sleep') return 1;
    if (!this.blinkAuto) return 0;
    this._blinkT += dt;
    if (this._blinkT < this._nextBlink) return 0;
    const p = (this._blinkT - this._nextBlink) / 0.18;
    if (p >= 1) { this._blinkT = 0; this._nextBlink = 1.8 + Math.random() * 3.2; return 0; }
    return p < 0.35 ? smooth(p / 0.35) : 1 - smooth((p - 0.35) / 0.65);
  }
  _expressions(dt) {
    const em = this.vrm.expressionManager; if (!em) return;
    const k = expDamp(dt, 0.09);                                          // ~250 ms crossfade
    const target = {};
    let headPitch = 0, headYaw = 0, headRoll = 0;
    for (const e of EMOTIONS) {
      this.emotionW[e] = lerp(this.emotionW[e], this.emotion[e], k);
      const w = this.emotionW[e]; if (w <= 1e-4) continue;
      const r = this.recipes[e]; if (!r) continue;
      for (const [name, v] of Object.entries(r.presets)) target[name] = (target[name] || 0) + v * w;
      headPitch += (r.head?.pitch || 0) * w; headYaw += (r.head?.yaw || 0) * w; headRoll += (r.head?.roll || 0) * w;
    }
    const sleeping = this.body?.name === 'sleep';
    if (sleeping) target.relaxed = Math.max(target.relaxed || 0, 0.6);
    this._rotX('head', headPitch * DEG); this._rotY('head', headYaw * DEG); this._rotZ('head', headRoll * DEG);
    // write every expression we ever touched so removed ones decay to 0
    for (const name of new Set([...Object.keys(this.exprW), ...Object.keys(target)])) {
      if (!em.getExpression(name)) continue;
      if (name === 'blink') continue;
      this.exprW[name] = lerp(this.exprW[name] || 0, clamp(target[name] || 0, 0, 1), k);
      if (!VISEMES.includes(name)) em.setValue(name, this.exprW[name]);
    }
    em.setValue('blink', this._blink(dt));
    // visemes: the emotion recipe's mouth shape, overridden by the chew/sip viseme while eating
    for (const v of VISEMES) em.setValue(v, clamp(Math.max(this.exprW[v] || 0, this._viseme.name === v ? this._viseme.w : 0), 0, 1));
    if (this.body?.name !== 'eat' && this.body?.name !== 'drink') { this._viseme.name = null; this._viseme.w = 0; }
  }

  // ------------------------------------------------------------------ introspection
  snapshot() {
    return {
      body: this.current, gaze: { pattern: this.gaze.pattern, headShare: this.gaze.headShare, yawDeg: +(this.gaze.yaw / DEG).toFixed(1), pitchDeg: +(this.gaze.pitch / DEG).toFixed(1) },
      emotion: Object.fromEntries(EMOTIONS.filter((e) => this.emotionW[e] > 0.01).map((e) => [e, +this.emotionW[e].toFixed(2)])),
      expressions: Object.fromEntries(Object.entries(this.exprW).filter(([, v]) => v > 0.01).map(([n, v]) => [n, +v.toFixed(2)])),
      clip: this._clip ? { name: this._clip.getClip().name, time: +this._clip.time.toFixed(3), weight: +this._clip.getEffectiveWeight().toFixed(2), timeScale: this._clip.timeScale } : null,
      lanes: this.lanesInUse, props: this.props, ik: this.lastIK, tail: { joints: this._tailJoints.tail.length, fallbackJoints: this._tailJoints.all.length },
    };
  }
}
