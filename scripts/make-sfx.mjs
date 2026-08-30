// Synthesises the four X13 sound effects (contracts §5.12) — a windowed sine/noise burst each — and
// writes them as Ogg Vorbis to apps/desktop/public/sfx/. Self-made by construction: no third-party
// audio. Encoding uses ffmpeg (8.1.2, §0.2) with bitexact flags so the files are reproducible.
// Run: node scripts/make-sfx.mjs        Fails visibly (exit 1) if ffmpeg is missing or a file exceeds 24 KB.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const RATE = 22050;
const env = (t, attack, dur) => (t < attack ? t / attack : Math.max(0, 1 - (t - attack) / (dur - attack)));
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
let seed = 0x9e3779b9;
const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };

const SOUNDS = {
  tap:     { ms: 90,  gen: (t) => sine(880 * Math.exp(-t * 18), t) * env(t, 0.004, 0.09) },                       // descending pip
  annoyed: { ms: 260, gen: (t) => (0.6 * sine(330, t) + 0.4 * sine(247, t)) * env(t, 0.01, 0.26) * (t < 0.12 || t > 0.15 ? 1 : 0) }, // two-note grumble
  land:    { ms: 140, gen: (t) => 0.8 * noise() * Math.exp(-t * 40) + 0.6 * sine(120 * Math.exp(-t * 6), t) * env(t, 0.003, 0.14) },  // thud
  notify:  { ms: 380, gen: (t) => (t < 0.18 ? sine(659, t) * env(t, 0.01, 0.18) : sine(988, t - 0.18) * env(t - 0.18, 0.01, 0.2)) }, // two-tone chime
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const outDir = join(root, 'apps/desktop/public/sfx');
mkdirSync(outDir, { recursive: true });
for (const [name, { ms, gen }] of Object.entries(SOUNDS)) {
  const n = Math.round((RATE * ms) / 1000);
  const samples = Array.from({ length: n }, (_, i) => 0.9 * gen(i / RATE));
  const tmp = join(tmpdir(), `ds-sfx-${name}.wav`);
  writeFileSync(tmp, wav(samples));
  const out = join(outDir, `${name}.ogg`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', String(RATE), '-c:a', 'libvorbis', '-q:a', '2',
    '-fflags', '+bitexact', '-flags', '+bitexact', out], { stdio: 'inherit' });
  rmSync(tmp, { force: true });
  if (r.status !== 0) { console.error(`ffmpeg failed for ${name} (status ${r.status ?? r.error?.message}); no fallback`); process.exit(1); }
  const bytes = statSync(out).size;
  if (bytes > 24 * 1024) { console.error(`${name}.ogg is ${bytes} bytes > 24 KB`); process.exit(1); }
  console.log(`wrote apps/desktop/public/sfx/${name}.ogg ${bytes} bytes ${ms} ms`);
}
