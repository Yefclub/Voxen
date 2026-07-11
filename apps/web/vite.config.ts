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
      includeAssets: ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Voxen',
        short_name: 'Voxen',
        description: 'Base de conhecimento self-hosted com IA, transcricao e biblioteca.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#19211f',
        theme_color: '#19211f',
        categories: ['productivity', 'education', 'utilities'],
        icons: [
          {
            src: '/voxen-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/voxen-256.png',
            sizes: '256x256',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/voxen-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/voxen-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/voxen-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/screenshots/wide.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Chat com pesquisa na web e fontes',
          },
          {
            src: '/screenshots/narrow.png',
            sizes: '860x1864',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Chat no mobile',
          },
        ],
        shortcuts: [
          {
            name: 'Novo chat',
            short_name: 'Chat',
            url: '/chat',
            icons: [{ src: '/voxen-maskable-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Biblioteca',
            short_name: 'Biblioteca',
            url: '/transcricoes',
            icons: [{ src: '/voxen-maskable-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Capturar conteúdo',
            short_name: 'Capturar',
            url: '/',
            icons: [{ src: '/voxen-maskable-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Brain',
            short_name: 'Brain',
            url: '/grafo',
            icons: [{ src: '/voxen-maskable-192.png', sizes: '192x192', type: 'image/png' }],
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
    target: 'es2022',
    // Manifest pra Hono servir assets com hash em prod.
    manifest: true,
    rollupOptions: {
      output: {
        // Isola o renderer de markdown (Streamdown + deps de parsing) em chunk
        // próprio. Mantém o bundle principal abaixo do limite por-arquivo de
        // precache do PWA (2 MiB) e tira o markdown do caminho crítico. As deps
        // pesadas opt-in do Streamdown (mermaid/katex/shiki) não são habilitadas
        // e o Rollup as tree-shaka para stubs (~100 B), fora do bundle real.
        manualChunks: {
          markdown: ['streamdown'],
        },
      },
    },
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
