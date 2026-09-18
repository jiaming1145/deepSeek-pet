// Turns the frames recorded by record.js into the README media: each scene is cropped to where she actually
// moved, composited over a plain wallpaper, and encoded as a palette GIF with ffmpeg. Needs ffmpeg and
// ImageMagick (`magick`) on PATH; gifsicle (or npx) is optional and makes the files smaller.
//
//   node tools/media/build.mjs --rec .cache/media --out media [--scene hero]
//
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argOf = (flag, dflt) => { const i = process.argv.indexOf(flag); const v = i >= 0 ? process.argv[i + 1] : undefined; return v != null && !v.startsWith('--') ? v : dflt; };
const REC = path.resolve(ROOT, argOf('--rec', '.cache/media'));
const OUT = path.resolve(ROOT, argOf('--out', 'media'));
const ONLY = argOf('--scene', null);

// width: output px; fps: GIF rate (the recording is 20 fps); pad: px of air around her path; start/end: seconds
// of the recording to keep; colors/dither: palette settings. No dither: the art is flat-shaded, and dither noise
// is what makes an animated GIF of it three times the size.
const SCENES = {
  hero: { width: 720, fps: 12, pad: 30, colors: 160, dither: 'none', stats: 'full' },
  dance: { width: 320, fps: 12, pad: 20, colors: 128, dither: 'none', stats: 'full' },
  chat: { width: 880, fps: 10, pad: 30, colors: 128, dither: 'none', stats: 'full' },
  carry: { stills: true, width: 1800, cell: 470 },   // one column per recorded moment, side by side
};
const WALL = { c0: '#eef2f9', c1: '#d9e1ef' };   // her navy and white need a light, faintly blue ground to read on

const frames = (dir) => fs.readdirSync(dir).filter((f) => /^frame_\d{4}\.png$/.test(f)).sort().map((f) => path.join(dir, f));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// Union of the opaque area over every frame of the recording, so the crop follows her path, the speech bubble
// and the top of a throw instead of the whole window. The bottom edge stays put: she stands on it.
function pathBox(files, W, H, pad) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < files.length; i++) {
    const m = run('magick', [files[i], '-format', '%@', 'info:']).trim().match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
    if (!m) continue;
    const [w, h, x, y] = m.slice(1).map(Number);
    if (!w || !h) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('no opaque pixels in any frame; is the recording empty?');
  const even = (n) => n - (n % 2);
  const cx0 = even(Math.max(0, x0 - pad)), cy0 = even(Math.max(0, y0 - pad));
  const cx1 = even(Math.min(W, x1 + pad));
  return { x: cx0, y: cy0, w: cx1 - cx0, h: H - cy0 };
}

// gifsicle's lossy LZW takes about a third off with no visible change. It is looked for on PATH (argv, no
// shell), then through npx, which on Windows has to go through cmd.exe: that path is only taken when the file
// name is safe to quote there (no % signs). When neither works the GIF is left as ffmpeg wrote it.
function shrink(gif) {
  const args = ['-O3', '--lossy=40', gif, '-o', gif + '.tmp'];
  const attempts = [() => execFileSync('gifsicle', args, { stdio: ['ignore', 'pipe', 'pipe'] })];
  if (!gif.includes('%')) attempts.push(() => execSync(['npx', '--yes', 'gifsicle', ...args].map((x) => `"${x}"`).join(' '), { stdio: ['ignore', 'pipe', 'pipe'] }));
  for (const attempt of attempts) {
    try { attempt(); fs.renameSync(gif + '.tmp', gif); return true; } catch (e) { fs.rmSync(gif + '.tmp', { force: true }); }
  }
  return false;
}

// A strip of stills: each recorded moment cropped to the same column of the window (full height, so how high
// she is held reads across the strip), on the same wallpaper, side by side with a hairline between them.
function strip(scene, cfg, dir, report) {
  const cw = cfg.cell;
  const cells = [];
  for (const m of report.moments || []) {
    const src = path.join(dir, `frame_${String(m.frame).padStart(4, '0')}.png`);
    const [W, H] = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).trim().split(',').map(Number);
    const x = Math.round(W / 2 - cw / 2);
    const cell = path.join(dir, `cell_${m.name}.png`);
    run('magick', ['-size', `${cw}x${H}`, `gradient:${WALL.c0}-${WALL.c1}`, '(', src, '-crop', `${cw}x${H}+${x}+0`, '+repage', ')',
      '-compose', 'over', '-composite', '-bordercolor', '#ffffff', '-border', '3x0', cell]);
    cells.push(cell);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, `${scene}.png`);
  run('magick', [...cells, '+append', '-shave', '3x0', '-resize', `${cfg.width}x`, '-depth', '8', '-strip', 'PNG24:' + png]);
  console.log(`${scene}: ${cells.length} stills (${(report.moments || []).map((m) => m.name).join(', ')}) -> ${png} (${Math.round(fs.statSync(png).size / 1024)} KB)`);
}

function build(scene, cfg) {
  const dir = path.join(REC, scene);
  const files = frames(dir);
  if (!files.length) { console.log(`skip ${scene}: no frames in ${dir}`); return; }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  if (cfg.stills) return strip(scene, cfg, dir, report);
  const [W, H] = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]]).trim().split(',').map(Number);
  const box = pathBox(files, W, H, Math.round(cfg.pad * (report.dpr || 1)));
  const inFps = report.fps || 20;
  const trim = cfg.start != null || cfg.end != null ? `trim=${cfg.start != null ? `start=${cfg.start}` : ''}${cfg.start != null && cfg.end != null ? ':' : ''}${cfg.end != null ? `end=${cfg.end}` : ''},setpts=PTS-STARTPTS,` : '';
  const chain = [
    `[1:v]${trim}crop=${box.w}:${box.h}:${box.x}:${box.y}[fr]`,
    `[0:v][fr]overlay=shortest=1:format=auto,scale=${cfg.width}:-2:flags=lanczos,fps=${cfg.fps},split[a][b]`,
    `[a]palettegen=max_colors=${cfg.colors}:stats_mode=${cfg.stats}[p]`,
    `[b][p]paletteuse=dither=${cfg.dither}:diff_mode=rectangle`,
  ].join(';');
  fs.mkdirSync(OUT, { recursive: true });
  const gif = path.join(OUT, `${scene}.gif`);
  run('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `gradients=s=${box.w}x${box.h}:c0=${WALL.c0}:c1=${WALL.c1}:x0=0:y0=0:x1=${box.w}:y1=${box.h}:nb_colors=2`,
    '-framerate', String(inFps), '-i', path.join(dir, 'frame_%04d.png'),
    '-filter_complex', chain, '-loop', '0', gif]);
  const shrunk = shrink(gif);
  const kb = Math.round(fs.statSync(gif).size / 1024);
  const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames', '-of', 'csv=p=0', gif]).trim();
  console.log(`${scene}: ${files.length} frames, crop ${box.w}x${box.h}+${box.x}+${box.y} -> ${gif} (${probe.replace(/,/g, 'x').replace(/x(\d+)$/, ', $1 frames')}, ${kb} KB${shrunk ? '' : ', gifsicle not found'})`);
}

if (ONLY && !SCENES[ONLY]) { console.error(`unknown scene '${ONLY}'; one of ${Object.keys(SCENES).join(', ')}`); process.exit(1); }
for (const [scene, cfg] of Object.entries(SCENES)) if (!ONLY || ONLY === scene) build(scene, cfg);
