// Usage: node retarget/inspect-file.mjs <file.glb|.gltf|.vrma|.fbx>
// Prints skeleton node names and every AnimationClip with its track count. Node-only tool.
import './node-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const file = process.argv[2];
if (!file) { console.error('usage: inspect-file.mjs <file>'); process.exit(2); }
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const ext = path.extname(file).toLowerCase();

let root, animations;
if (ext === '.fbx') {
  const loader = new FBXLoader();
  root = loader.parse(ab, path.dirname(file) + '/');
  animations = root.animations;
} else {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.parse(ab, path.dirname(file) + '/', res, rej));
  root = gltf.scene;
  animations = gltf.animations;
}
const names = [];
root.traverse((o) => { if (o.isBone || o.type === 'Bone') names.push(o.name); });
console.log(`file: ${file}`);
console.log(`bones (${names.length}): ${names.join(', ')}`);
console.log(`animations: ${animations.length}`);
for (const clip of animations) {
  console.log(`  ${clip.name}\tduration=${clip.duration.toFixed(3)}s\ttracks=${clip.tracks.length}`);
}
