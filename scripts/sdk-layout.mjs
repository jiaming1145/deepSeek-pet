export const SDK_VERSION = '5-r.5';
export const SDK_URL = `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-${SDK_VERSION}.zip`;
export const MODELS = ['Haru', 'Hiyori'];

/** @param {string} entry zip entry name → list of repo-relative destinations (empty = skip) */
export function destinationFor(entry) {
  if (entry.endsWith('/')) return [];
  const m = entry.match(/^CubismSdkForWeb-[^/]+\/(.*)$/);
  if (!m) return [];
  const rel = m[1];

  if (rel === 'Core/live2dcubismcore.min.js') {
    return ['vendor/core/live2dcubismcore.min.js', 'apps/desktop/public/live2d/core/live2dcubismcore.min.js'];
  }
  if (rel === 'Core/live2dcubismcore.d.ts') return ['vendor/core/live2dcubismcore.d.ts'];

  const sh = rel.match(/^Framework\/Shaders\/WebGL\/([^/]+)$/);
  if (sh) return [`apps/desktop/public/live2d/shaders/${sh[1]}`];

  const md = rel.match(/^Samples\/Resources\/([^/]+)\/(.+)$/);
  if (md && MODELS.includes(md[1])) return [`characters/${md[1].toLowerCase()}/model/${md[2]}`];

  return [];
}
