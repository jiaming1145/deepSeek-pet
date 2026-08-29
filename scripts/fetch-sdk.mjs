import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { SDK_URL, SDK_VERSION, destinationFor, MODELS } from './sdk-layout.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, '.cache');
const zipPath = join(cacheDir, `CubismSdkForWeb-${SDK_VERSION}.zip`);

mkdirSync(cacheDir, { recursive: true });
if (!existsSync(zipPath)) {
  console.log(`downloading ${SDK_URL}`);
  const res = await fetch(SDK_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}

const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
let written = 0;
for (const [name, bytes] of Object.entries(entries)) {
  for (const dest of destinationFor(name)) {
    const abs = join(root, dest);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    written++;
  }
}

// publish characters (character.json + model/) to the renderer's public dir
for (const id of MODELS.map((m) => m.toLowerCase())) {
  const src = join(root, 'characters', id);
  const dst = join(root, 'apps/desktop/public/characters', id);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

const core = readFileSync(join(root, 'vendor/core/live2dcubismcore.min.js'), 'utf8');
if (!core.includes('offscreens')) throw new Error('Core is not version 6 — wrong SDK zip');
console.log(`wrote ${written} files; Core 6 OK; shaders + ${MODELS.join(', ')} ready`);
