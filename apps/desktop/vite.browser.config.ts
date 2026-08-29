import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
  server: { port: 5174, fs: { allow: [resolve(__dirname, '../..')] } },
});
