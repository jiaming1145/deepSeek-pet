// Node module-resolution hook so the spike's lib/ files can `import 'three'` from a directory that
// has no node_modules of its own: bare `three` resolves to the copy pnpm installed for
// apps/desktop. Registered via `node --import ./test/register.mjs`.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const threeDir = path.resolve(here, '..', '..', '..', 'apps', 'desktop', 'node_modules', 'three');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: pathToFileURL(path.join(threeDir, 'build', 'three.module.js')).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    const rel = specifier.slice('three/addons/'.length);
    return { url: pathToFileURL(path.join(threeDir, 'examples', 'jsm', rel)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
