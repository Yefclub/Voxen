import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('carregamento progressivo de rotas', () => {
  test('declara telas roteáveis como imports dinâmicos em vez de incluí-las no bundle inicial', () => {
    const source = readClientSource('App.tsx');

    expect(source).toContain("const ChatPage = lazy(() => import('./pages/chat')");
    expect(source).toContain('const GrafoPage = lazy(() =>');
    expect(source).toContain("import('./pages/grafo')");
    expect(source).toContain("import('./pages/notas')");
    expect(source).toContain("import('./pages/transcricoes')");
    expect(source).toContain("import('./pages/automacoes')");
    expect(source).not.toContain("import { GrafoPage } from './pages/grafo';");
    expect(source).not.toContain("import { ChatPage } from './pages/chat';");
  });

  test('mantém a entrada inicial do chat e share target sem importar chat estaticamente', () => {
    const source = readClientSource('pages/root-entry.tsx');

    expect(source).toContain('ChatPage: ComponentType;');
    expect(source).toContain('return <ChatPage />;');
    expect(source).toContain("params.get('shared') === '1'");
    expect(source).not.toContain("from './chat'");
  });

  test('mantém o shell autenticado e o fallback de rota acessível durante o carregamento', () => {
    const source = readClientSource('components/layout/app-layout.tsx');

    expect(source).toContain('import { Suspense, useCallback, useLayoutEffect, useRef, useState }');
    expect(source).toContain('<Suspense fallback={<RouteLoading />}>');
    expect(source).toContain('data-route-loading');
    expect(source).toContain('Carregando tela');
  });

  test('não antecipa o renderer de Markdown antes de uma rota que o utiliza', () => {
    const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

    expect(viteConfig).not.toContain('manualChunks');
    expect(viteConfig).not.toContain("markdown: ['streamdown']");
  });

  test('mantém artefatos implementados, mas não carrega a página enquanto a rota está pausada', () => {
    const source = readClientSource('App.tsx');
    const artifacts = readClientSource('pages/artefatos.tsx');

    expect(source).toContain('<Route path="/artefatos" element={<Navigate to="/" replace />} />');
    expect(source).not.toContain("import('./pages/artefatos')");
    expect(artifacts).toContain('export function ArtefatosPage');
  });
});
