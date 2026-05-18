import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Manifest pra Hono servir assets com hash em prod.
    manifest: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // /api/* e /health proxied pro server Hono (rodando no docker compose)
      '/api': API_TARGET,
      '/health': API_TARGET,
    },
  },
});
