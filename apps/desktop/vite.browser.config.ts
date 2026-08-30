import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
  server: { port: 5174, fs: { allow: [resolve(__dirname, '../..')] } },
});
