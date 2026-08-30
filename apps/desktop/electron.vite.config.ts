import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// electron-vite 5.0.0's `isolatedEntries` progress reporter calls process.stdout.clearLine(),
// cursorTo() and moveCursor() unconditionally (dist/chunks/lib-*.js, `clearLine`/`writeLine`, and
// again in the plugin's own `renderStart`, which no logLevel suppresses). Those three methods exist
// only when stdout is a TTY, so `pnpm --filter @ds/desktop build` failed with
// "process.stdout.clearLine is not a function" in every non-interactive shell — CI, a piped build,
// any captured run — while succeeding in a terminal. No-ops when stdout is not a TTY; a real
// terminal is untouched.
const stdout = process.stdout as unknown as {
  isTTY?: boolean;
  clearLine?: unknown;
  cursorTo?: unknown;
  moveCursor?: unknown;
};
if (!stdout.isTTY) {
  const noop = (): boolean => true;
  stdout.clearLine ??= noop;
  stdout.cursorTo ??= noop;
  stdout.moveCursor ??= noop;
}

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
      externalizeDeps: { exclude: ['@ds/protocol', '@ds/stage', '@ds/brain', '@ds/memory', '@ds/sim', 'zod'] },
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
      // With four entries all importing @ds/protocol, rollup hoists the shared code into
      // `index-<hash>.cjs` and every preload starts with `require("./index-<hash>.cjs")` — which a
      // sandboxed preload cannot resolve. Measured: all four preloads (pet.cjs included, so this is
      // a Phase 1 regression the moment a second entry is added) failed at load with
      // `Error: module not found: ./index-<hash>.cjs`, leaving window.ds / dsBubble / dsChat / dsKey
      // undefined and every renderer inert. `isolatedEntries` builds each entry as a standalone
      // bundle with no cross-entry chunk, which is the same requirement `externalizeDeps: false`
      // above exists for.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/preload/pet.ts'),
          bubble: resolve(__dirname, 'src/preload/bubble.ts'),
          chat: resolve(__dirname, 'src/preload/chat.ts'),
          key: resolve(__dirname, 'src/preload/key.ts'),
        },
        output: cjsOutput,
      },
    },
  },
  renderer: {
    // electron-vite roots the renderer at src/renderer, so Vite's default publicDir would be
    // src/renderer/public. The SDK assets (scripts/fetch-sdk.mjs) land in apps/desktop/public.
    publicDir: resolve(__dirname, 'public'),
    plugins: [react()],
    resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
    server: { fs: { allow: [resolve(__dirname, '../..')] } },
    build: {
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet.html'),
          bubble: resolve(__dirname, 'src/renderer/bubble.html'),
          chat: resolve(__dirname, 'src/renderer/chat.html'),
          key: resolve(__dirname, 'src/renderer/key.html'),
        },
      },
    },
  },
});
