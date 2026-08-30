import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageTestHook } from '../src/renderer/pet/main';
import type { HitPart } from '@ds/protocol';

test.use({ deviceScaleFactor: 1.5, viewport: { width: 420, height: 720 } });

// DEVIATION: @ds/desktop is `"type": "module"`, so `__dirname` is not defined in this spec.
const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE_MOD = '/@fs/' + resolve(HERE, '../../../packages/stage/src/index.ts').replace(/\\/g, '/');
const REPO_ROOT = resolve(HERE, '../../..');
const EVIDENCE = resolve(REPO_ROOT, 'docs/evidence/phase3');
/**
 * A-5: the banner names the repository the artefact belongs to, not the directory playwright was
 * launched from. An isolated worktree checkout (`<repo>\.claude\worktrees\<branch>`) is normalised
 * back to its main checkout, which is where the integrator copies the artefact; `runDir` keeps the
 * directory the run actually happened in.
 */
const CWD_BANNER = REPO_ROOT.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '');
const GATE = { fp: 0.005, fn: 0.005, p95Ms: 0.2, samples: 20_000, boundaryShare: 0.5, perPart: 200 };
/** §6.5 step 2, in order. `expression` replaces the pose's expression; F07 carries ParamTere 1 (blush, §0.2). */
const POSES: { motion: [string, number]; t: number; expression?: string }[] = [
  { motion: ['Idle', 0], t: 0 }, { motion: ['Idle', 0], t: 2 }, { motion: ['Idle', 0], t: 5 },
  { motion: ['Idle', 1], t: 0 }, { motion: ['Idle', 1], t: 2 },
  { motion: ['TapBody', 0], t: 1 }, { motion: ['TapBody', 1], t: 1 }, { motion: ['TapBody', 2], t: 1 }, { motion: ['TapBody', 3], t: 1 },
  { motion: ['Idle', 0], t: 1, expression: 'F05' },
  { motion: ['Idle', 0], t: 1, expression: 'F07' },
  { motion: ['TapBody', 1], t: 3 },
];

interface PoseResult {
  pose: number; samples: number; boundary: number; fp: number; fn: number; mismatch: number;
  /** False negatives whose whole 5x5 device-pixel neighbourhood is opaque in the reference frame. */
  fnInterior: number;
  /** The largest reference alpha at any false negative: how deep inside the silhouette the miss was. */
  fnMaxRefAlpha: number;
  parts: Record<string, number>; timesMs: number[]; pressAlphaAgrees: boolean;
}
interface OracleJson {
  cwd: string; runDir: string; date: string; renderer: string; hardware: string; dpr: number; canvas: { w: number; h: number };
  samples: number; boundaryShare: number; fpRate: number; fnRate: number; mismatchRate: number;
  fnInterior: number; fnMaxRefAlpha: number;
  p50Ms: number; p95Ms: number; p99Ms: number; parts: Record<string, number>; poses: PoseResult[];
  gate: typeof GATE; verdict: 'PASS' | 'FAIL'; ships: 'cpu' | 'fbo';
}

async function openSeededPage(page: Page): Promise<void> {
  await page.goto('/pet.html?test=1&seed=1&character=haru');
  await page.waitForFunction(() => (window as unknown as { __stage?: StageTestHook }).__stage?.ready === true, null, { timeout: 45_000 });
}

test('B-08 picker/holes-and-parts — §6.5 oracle over 12 poses (R3-6e gate)', async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  await openSeededPage(page);
  const result = await page.evaluate(async ({ STAGE_MOD, POSES, GATE }) => {
    const S = await import(/* @vite-ignore */ STAGE_MOD);
    // mulberry32(1), the same generator pet/main.ts seeds — reproducible sample draws.
    let a = 1 >>> 0;
    const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:720px;z-index:5';
    document.body.appendChild(canvas);
    const stage = await S.Live2DStage.create({ canvas, characterUrl: '/characters/haru', shaderPath: '/live2d/shaders/', preserveDrawingBuffer: true, rng });
    const gl = canvas.getContext('webgl2')!;
    const W = canvas.width, H = canvas.height, dpr = devicePixelRatio;
    const model = stage.model;
    model.autoIdle = false;
    model.setExpressionFades(0, 0);
    const textures = await S.loadPickerTextures('/characters/haru', stage.config.model);
    const map = S.pickerMapFromConfig(stage.config);
    const picker = new S.Picker(model, map, textures, canvas);
    const cm = model.getModel();
    const partName = (p: number) => cm.getPartId(p).getString();
    const entryOf = (i: number) => map.hitParts[cm.getDrawableId(i).getString()] ?? map.hitParts[partName(cm.getDrawableParentPartIndex(i))];
    const participates = (i: number) => { const e = entryOf(i); return !e || e.participatesInHitTest; };
    const partOfIndex = (p: number): string => map.hitParts[partName(p)]?.part ?? map.hitPartDefault;
    // GL textures the Framework uploaded: CompanionModel keeps them private; re-upload from the ImageData.
    const glTex = textures.map((img: ImageData) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); return t; });
    const renderer = (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)); })();

    const perPose: PoseResult[] = [];
    const totals: Record<string, number> = {};
    const perPoseN = Math.ceil(GATE.samples / POSES.length);
    for (let pi = 0; pi < POSES.length; pi++) {
      const pose = POSES[pi];
      model.setExpression(null);
      model.startMotionForced(pose.motion[0], pose.motion[1], 0);
      if (pose.expression) model.setExpression(pose.expression);
      const steps = Math.max(2, Math.round(pose.t * 30));
      for (let s = 0; s < steps; s++) stage.frame(1 / 30);
      stage.stop();
      // Reference alpha: the frame's own default framebuffer, read in the same task as the draw.
      const ref = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ref);
      const refAlpha = (x: number, y: number) => ref[((H - 1 - y) * W + x) * 4 + 3];
      const ids = S.renderIdPass(gl, { model, projection: stage.currentProjection(), textures: glTex, width: W, height: H, participates });
      // Boundary set: within 3 device px of an alpha edge (Sobel on the ENTER_ALPHA-thresholded alpha) or inside an enclosed hole.
      const opaque = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) opaque[y * W + x] = refAlpha(x, y) >= S.ENTER_ALPHA ? 1 : 0;
      const edge = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const o = (dx: number, dy: number) => opaque[(y + dy) * W + x + dx];
        const gx = -o(-1, -1) - 2 * o(-1, 0) - o(-1, 1) + o(1, -1) + 2 * o(1, 0) + o(1, 1);
        const gy = -o(-1, -1) - 2 * o(0, -1) - o(1, -1) + o(-1, 1) + 2 * o(0, 1) + o(1, 1);
        if (gx !== 0 || gy !== 0) edge[y * W + x] = 1;
      }
      const boundary: number[] = [];
      const reach = new Uint8Array(W * H); // transparent pixels connected to the border
      const stack: number[] = [];
      for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
      for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
      while (stack.length) { const p = stack.pop()!; if (reach[p] || opaque[p]) continue; reach[p] = 1; const x = p % W, y = (p - x) / W; if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1); if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        let near = false;
        for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3 && !near; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && edge[yy * W + xx]) near = true; }
        if (near || (!opaque[p] && !reach[p])) boundary.push(p);
      }
      const partPixels: Record<string, number[]> = {};
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const id = ids.idAt(x, y); if (id > 0) (partPixels[partOfIndex(id - 1)] ??= []).push(y * W + x); }
      // DEVIATION (§6.5 sample composition, two defects in the brief's draw plan):
      // (a) the per-part top-ups were appended AFTER the 50/50 boundary/random split, diluting the
      //     boundary-weighted share below R3-6e's 50 % (first run measured 49.478 %); extra boundary
      //     draws now match the top-ups one for one.
      // (b) the top-up quota was checked against the id pass, but the recorded reference part applies
      //     the ticklishRect override, so arm/face pixels inside the rect never raised their own
      //     quota (first run left `arm` at 46 of the required 200). The quota is now checked against
      //     the FINAL reference part, with a guard for a part whose pixels all fall inside the rect.
      const nBoundary = Math.ceil(perPoseN / 2);
      const draws: number[] = [];
      for (let k = 0; k < nBoundary; k++) draws.push(boundary[Math.floor(rng() * boundary.length)]);
      for (let k = 0; k < Math.floor(perPoseN / 2); k++) draws.push(Math.floor(rng() * W * H));
      const r: PoseResult = { pose: pi, samples: 0, boundary: nBoundary, fp: 0, fn: 0, mismatch: 0, fnInterior: 0, fnMaxRefAlpha: 0, parts: {}, timesMs: [], pressAlphaAgrees: true };
      const proj = stage.currentProjection();
      const score = (p: number): void => {
        const x = p % W, y = (p - x) / W;
        const cx = (x + 0.5) / dpr, cy = (y + 0.5) / dpr;
        const t0 = performance.now();
        const res = picker.pick(cx, cy, proj);
        r.timesMs.push(performance.now() - t0);
        r.samples++;
        const ra = refAlpha(x, y);
        if (res.alpha >= S.ENTER_ALPHA && ra < S.ENTER_ALPHA) r.fp++;
        if (res.alpha < S.ENTER_ALPHA && ra >= S.ENTER_ALPHA) {
          r.fn++;
          if (ra > r.fnMaxRefAlpha) r.fnMaxRefAlpha = ra;
          // Is the miss deep inside the silhouette (a real predicate defect) or on the antialiased
          // rim (a sub-pixel coverage difference between the GPU rasteriser and a point-in-triangle test)?
          let interior = x >= 2 && y >= 2 && x < W - 2 && y < H - 2;
          for (let dy = -2; dy <= 2 && interior; dy++) for (let dx = -2; dx <= 2 && interior; dx++) if (refAlpha(x + dx, y + dy) < S.ENTER_ALPHA) interior = false;
          if (interior) r.fnInterior++;
        }
        const id = ids.idAt(x, y);
        let refPart: HitPart | null = id > 0 ? (partOfIndex(id - 1) as HitPart) : ra >= S.ENTER_ALPHA ? map.hitPartDefault : null;
        if (refPart && map.ticklishRect) { const u = (res.modelX + 1) / 2, v = (res.modelY + 1) / 2; const q = map.ticklishRect; if (u >= q.x0 && u <= q.x1 && v >= q.y0 && v <= q.y1) refPart = 'ticklish'; }
        if (refPart) { r.parts[refPart] = (r.parts[refPart] ?? 0) + 1; totals[refPart] = (totals[refPart] ?? 0) + 1; }
        if (refPart !== res.part) r.mismatch++;
      };
      for (const p of draws) score(p);
      // The quota is a RUNNING target across poses, not a flat per-pose one: `arm` is fully occluded
      // in some poses, so a flat quota can never reach GATE.perPart (measured 173 of 200). Deficits
      // carry forward and are made up in the poses where the part is actually on screen.
      const target = Math.ceil((GATE.perPart * (pi + 1)) / POSES.length);
      let topUps = 0;
      for (const [part, px] of Object.entries(partPixels)) {
        for (let guard = 0; (totals[part] ?? 0) < target && guard < GATE.perPart * 4 && px.length > 0; guard++) { score(px[Math.floor(rng() * px.length)]); topUps++; }
      }
      for (let k = 0; k <= topUps; k++) { score(boundary[Math.floor(rng() * boundary.length)]); r.boundary++; }
      // §6.3 hook: a queued press at the first opaque sample must report the framebuffer alpha on the next frame.
      const opaqueSample = draws.find((p) => refAlpha(p % W, (p - (p % W)) / W) >= S.ENTER_ALPHA);
      if (opaqueSample !== undefined) {
        const x = opaqueSample % W, y = (opaqueSample - x) / W;
        let got: { pressId: number; alpha: number } | null = null;
        stage.onPressRead = (rr: { pressId: number; alpha: number }) => { got = rr; };
        stage.pressReader.queue({ pressId: 42, deviceX: x, deviceY: y });
        stage.frame(0);
        r.pressAlphaAgrees = got !== null && (got as { pressId: number }).pressId === 42 && Math.abs((got as { alpha: number }).alpha - refAlpha(x, y)) <= 2;
      }
      perPose.push(r);
    }
    stage.dispose();
    const all = perPose.flatMap((r) => r.timesMs).sort((x, y) => x - y);
    const q = (f: number) => all[Math.min(all.length - 1, Math.floor(f * all.length))];
    const n = perPose.reduce((s, r) => s + r.samples, 0);
    return {
      renderer, dpr, canvas: { w: W, h: H }, samples: n,
      boundaryShare: perPose.reduce((s, r) => s + r.boundary, 0) / n,
      fpRate: perPose.reduce((s, r) => s + r.fp, 0) / n, fnRate: perPose.reduce((s, r) => s + r.fn, 0) / n,
      mismatchRate: perPose.reduce((s, r) => s + r.mismatch, 0) / n,
      fnInterior: perPose.reduce((s, r) => s + r.fnInterior, 0),
      fnMaxRefAlpha: perPose.reduce((s, r) => Math.max(s, r.fnMaxRefAlpha), 0),
      p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), parts: totals,
      poses: perPose.map((r) => ({ ...r, timesMs: [] as number[] })),
    };
  }, { STAGE_MOD, POSES, GATE });

  const pass = result.fpRate <= GATE.fp && result.fnRate <= GATE.fn && result.p95Ms <= GATE.p95Ms;
  const json: OracleJson = {
    cwd: CWD_BANNER, runDir: process.cwd(), date: new Date().toISOString(),
    hardware: `Windows ${release()} (Windows 11 Home 10.0.26200), CPU ${cpus()[0]?.model ?? 'unknown'}, GPU/driver ${result.renderer}, display 3840x2160 @ 150 % (devicePixelRatio ${result.dpr})`,
    ...result, gate: GATE, verdict: pass ? 'PASS' : 'FAIL', ships: pass ? 'cpu' : 'fbo',
  };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(resolve(EVIDENCE, 'picker-oracle.json'), JSON.stringify(json, null, 2) + '\n');
  const pct = (v: number) => (v * 100).toFixed(3) + ' %';
  writeFileSync(resolve(EVIDENCE, 'picker-oracle.md'), [
    '# Picker oracle (§6.5, R3-6e, B-08)', '', `cwd: \`${json.cwd}\`  ·  ${json.date}`, '', `Run directory: \`${json.runDir}\`.`, '',
    `HARDWARE: ${json.hardware}`, '', `Renderer under test: CPU mesh + texture-alpha predicate (\`packages/stage/src/picker.ts\`), reference = default-framebuffer alpha + \`renderIdPass\`.`, '',
    '| Metric | Value | Gate |', '|---|---|---|',
    `| samples | ${json.samples} | ≥ 20 000 |`, `| boundary-weighted share | ${pct(json.boundaryShare)} | ≥ 50 % |`,
    `| false-positive rate | ${pct(json.fpRate)} | ≤ 0.5 % |`, `| false-negative rate | ${pct(json.fnRate)} | ≤ 0.5 % |`,
    `| part mismatch (reported, not gated; > 2 % is a finding) | ${pct(json.mismatchRate)} | — |`,
    `| false negatives INSIDE the silhouette (whole 5x5 neighbourhood opaque) | ${json.fnInterior} | diagnostic |`,
    `| largest reference alpha at a false negative | ${json.fnMaxRefAlpha} / 255 | diagnostic |`,
    `| pick p50 / p95 / p99 (ms, excl. model.update) | ${json.p50Ms.toFixed(3)} / ${json.p95Ms.toFixed(3)} / ${json.p99Ms.toFixed(3)} | p95 ≤ 0.2 |`,
    `| parts (reference counts) | ${Object.entries(json.parts).map(([k, v]) => `${k}=${v}`).join(', ')} | every exposed part ≥ 200 |`,
    `| §6.3 press read agrees with the framebuffer | ${json.poses.every((p) => p.pressAlphaAgrees)} | true |`, '',
    `**Verdict: ${json.verdict} — ${json.ships === 'cpu' ? 'the CPU predicate ships for hover; §6.6 is not built' : 'the CPU predicate FAILS the gate; §6.6 FboPicker ships (Task 11 Step 12) and this oracle is re-run against it'}.**`, '',
  ].join('\n'));

  expect(result.samples).toBeGreaterThanOrEqual(GATE.samples);
  expect(result.boundaryShare).toBeGreaterThanOrEqual(GATE.boundaryShare);
  for (const [part, n] of Object.entries(result.parts)) expect(n, `part ${part} >= 200`).toBeGreaterThanOrEqual(GATE.perPart);
  expect(result.poses.every((p) => p.pressAlphaAgrees), 'GpuPressReader agrees with the framebuffer').toBe(true);
  expect(result.fpRate, 'false-positive rate').toBeLessThanOrEqual(GATE.fp);
  expect(result.fnRate, 'false-negative rate').toBeLessThanOrEqual(GATE.fn);
  expect(result.p95Ms, 'pick p95 ms').toBeLessThanOrEqual(GATE.p95Ms);
});
