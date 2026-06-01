import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'favicon-16.png', 'favicon-32.png'],
      manifest: {
        name: 'Voxen',
        short_name: 'Voxen',
        description: 'Base de conhecimento self-hosted com IA, transcricao e biblioteca.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111113',
        theme_color: '#1a1a1d',
        categories: ['productivity', 'education', 'utilities'],
        icons: [
          {
            src: '/voxen-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/voxen-256.png',
            sizes: '256x256',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/voxen-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Conversar',
            short_name: 'Chat',
            url: '/chat',
            icons: [{ src: '/voxen-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Transcrever',
            short_name: 'Jobs',
            url: '/jobs',
            icons: [{ src: '/voxen-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Brain',
            short_name: 'Brain',
            url: '/grafo',
            icons: [{ src: '/voxen-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: [
                  'image/*',
                  'audio/*',
                  'video/*',
                  'application/pdf',
                  'text/plain',
                  'text/markdown',
                  '.pdf',
                  '.txt',
                  '.md',
                  '.csv',
                  '.docx',
                  '.pptx',
                  '.xlsx',
                ],
              },
            ],
          },
        },
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp\//, /^\/share-target$/],
      },
    }),
  ],
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
      '/share-target': API_TARGET,
    },
  },
});
