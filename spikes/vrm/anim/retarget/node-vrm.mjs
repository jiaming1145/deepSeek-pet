// Node-side VRM loading for tests/tools. Textures are stripped from the glTF JSON before
// parsing because jsdom cannot decode images (three's ImageLoader would hang forever);
// humanoid, expressions and lookAt are all that retargeting needs.
import './node-env.mjs';
import fs from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

const GLB_MAGIC = 0x46546c67;

/** Return a copy of a GLB ArrayBuffer whose JSON chunk has no images/textures. */
export function stripGLBTextures(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON');
  const jsonBytes = new Uint8Array(arrayBuffer, 20, jsonLen);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    const mtoon = m.extensions?.VRMC_materials_mtoon;
    if (mtoon) for (const k of Object.keys(mtoon)) if (k.endsWith('Texture')) delete mtoon[k];
    const khr = m.extensions?.KHR_materials_emissive_strength; // harmless, keep
    void khr;
  }
  const vrm1 = json.extensions?.VRMC_vrm;
  if (vrm1?.meta) delete vrm1.meta.thumbnailImage;
  const vrm0 = json.extensions?.VRM;
  if (vrm0?.meta) delete vrm0.meta.texture;
  if (vrm0?.materialProperties) for (const mp of vrm0.materialProperties) mp.textureProperties = {};

  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const newJson = new TextEncoder().encode(text);
  const rest = new Uint8Array(arrayBuffer, 20 + jsonLen); // remaining chunks (BIN)
  const out = new Uint8Array(20 + newJson.length + rest.length);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, GLB_MAGIC, true);
  odv.setUint32(4, 2, true);
  odv.setUint32(8, out.length, true);
  odv.setUint32(12, newJson.length, true);
  odv.setUint32(16, 0x4e4f534a, true);
  out.set(newJson, 20);
  out.set(rest, 20 + newJson.length);
  return out.buffer;
}

export function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** @returns {Promise<import('@pixiv/three-vrm').VRM>} */
export async function loadVRMFromFile(file) {
  const ab = stripGLBTextures(toArrayBuffer(fs.readFileSync(file)));
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error(`${file}: no VRM extension`);
  return vrm;
}
