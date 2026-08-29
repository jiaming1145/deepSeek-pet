import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// This package is `"type": "module"`, so electron-vite would emit ESM (.mjs) for main and preload.
// A *sandboxed* preload script runs as plain JavaScript without an ESM context and cannot use ESM
// imports (Electron docs, "ES Modules (ESM) in Electron" → Sandboxed Preload Scripts), so the
// preload must be CommonJS. Main is emitted as CJS too so both artifacts follow one convention and
// `__dirname` is real rather than shimmed. The `.cjs` extension is required because `"type":
// "module"` would otherwise make Electron parse `out/main/index.js` as ESM (package.json `main`
// points at `./out/main/index.cjs`).
const cjsOutput = { format: 'cjs' as const, entryFileNames: '[name].cjs', chunkFileNames: '[name]-[hash].cjs' };

export default defineConfig({
  main: {
    build: {
      // Workspace packages (@ds/*) are TypeScript sources — they must be BUNDLED, never
      // externalized (main cannot `require()` a .ts file). electron-vite externalizes every
      // package.json dependency by default, so they are excluded here.
      externalizeDeps: { exclude: ['@ds/protocol', '@ds/stage', 'zod'] },
      rollupOptions: {
        // koffi is a native N-API module: it must stay external even once something imports it.
        external: ['koffi'],
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: cjsOutput,
      },
    },
  },
  preload: {
    build: {
      // A sandboxed preload has no module resolution at all: everything except `electron` and the
      // node builtins has to be inlined. Leaving electron-vite's default externalization on emitted
      // `require("@ds/protocol")`, which throws at preload load time.
      externalizeDeps: false,
      rollupOptions: {
        input: { pet: resolve(__dirname, 'src/preload/pet.ts') },
        output: cjsOutput,
      },
    },
  },
  renderer: {
    // electron-vite roots the renderer at src/renderer, so Vite's default publicDir would be
    // src/renderer/public. The SDK assets (scripts/fetch-sdk.mjs) land in apps/desktop/public.
    publicDir: resolve(__dirname, 'public'),
    resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
    server: { fs: { allow: [resolve(__dirname, '../..')] } },
    build: { rollupOptions: { input: { pet: resolve(__dirname, 'src/renderer/pet.html') } } },
  },
});
