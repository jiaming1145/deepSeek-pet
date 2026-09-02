// Node module-resolution hook so the shared loaders in anim/retarget/ can be imported from a
// directory that has no node_modules of its own: bare `three`, `three/examples/jsm/...`,
// `three/addons/...` and `@pixiv/three-vrm*` resolve to the copies pnpm installed for
// apps/desktop (the same files the Electron page's importmap uses, so tests and runtime share one
// three instance). Registered via `node --import ./test/register.mjs`.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.resolve(here, '..', '..', '..', 'apps', 'desktop', 'node_modules');
const threeDir = path.join(nodeModules, 'three');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: pathToFileURL(path.join(threeDir, 'build', 'three.module.js')).href, shortCircuit: true };
  }
  for (const prefix of ['three/addons/', 'three/examples/jsm/']) {
    if (specifier.startsWith(prefix)) {
      const rel = specifier.slice(prefix.length);
      return { url: pathToFileURL(path.join(threeDir, 'examples', 'jsm', rel)).href, shortCircuit: true };
    }
  }
  const pixiv = /^@pixiv\/(three-vrm(?:-animation|-core)?)$/.exec(specifier);
  if (pixiv) {
    return { url: pathToFileURL(path.join(nodeModules, '@pixiv', pixiv[1], 'lib', pixiv[1] + '.module.js')).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
