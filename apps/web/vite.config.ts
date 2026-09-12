import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import packageJson from './package.json';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';
const BUILD_VERSION = process.env.VOXEN_VERSION?.trim() || packageJson.version;
const BUILD_SHA = process.env.VOXEN_GIT_SHA?.trim() || process.env.GIT_SHA?.trim() || '';
const BUILD_ID = (BUILD_SHA || BUILD_VERSION).replace(/[^A-Za-z0-9._+-]/g, '');
const BUILD_TIME =
  process.env.VOXEN_BUILT_AT?.trim() || deployTimestampToIso(process.env.DEPLOY_TIMESTAMP) || '';

function deployTimestampToIso(value?: string): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  const milliseconds = numeric > 9_999_999_999 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildMetadataPlugin(): Plugin {
  return {
    name: 'voxen-build-metadata',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { name: 'voxen-build', content: BUILD_ID },
          injectTo: 'head-prepend',
        },
        {
          tag: 'meta',
          attrs: { name: 'voxen-version', content: BUILD_VERSION },
          injectTo: 'head-prepend',
        },
        {
          tag: 'meta',
          attrs: { name: 'voxen-built-at', content: BUILD_TIME },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig({
  plugins: [
    buildMetadataPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      // A troca de controller só acontece após a ação explícita no modal.
      // O monitor pode baixar o SW novo em background, mas não o ativa sozinho.
      registerType: 'prompt',
      injectRegister: false,
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
        background_color: '#111113',
        theme_color: '#111113',
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
            label: 'Biblioteca e captura de conteúdo',
          },
          {
            src: '/screenshots/narrow.png',
            sizes: '860x1864',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'App no mobile',
          },
        ],
        shortcuts: [
          {
            name: 'Capturar conteúdo',
            short_name: 'Capturar',
            url: '/',
            icons: [{ src: '/voxen-maskable-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Biblioteca',
            short_name: 'Biblioteca',
            url: '/transcricoes',
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
        cleanupOutdatedCaches: true,
        importScripts: ['pwa-cache-cleanup.js'],
        // O HTML contém a identidade do build servido. Se index.html entrar no
        // precache, um cliente pode continuar executando o modal/bundle antigo
        // justamente quando precisa aplicar uma atualização.
        navigateFallback: null,
        navigationPreload: true,
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/mcp/') &&
              url.pathname !== '/share-target',
            handler: 'NetworkFirst',
            options: {
              cacheName: `voxen-navigation-${BUILD_ID}`,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
    },
  },
  optimizeDeps: {
    // Keep dependency pre-bundling aligned with the production build target.
    // esbuild 0.28 no longer lowers destructuring for Vite's legacy browser
    // target set, which otherwise prevents the development server from booting.
    esbuildOptions: {
      target: 'es2022',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
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
