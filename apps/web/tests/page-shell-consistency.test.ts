import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_ROOT = join(import.meta.dir, '../src/client/pages');
const CLIENT_STYLES = join(import.meta.dir, '../src/client/index.css');

const CANONICAL_CONTENT_PAGES: Record<string, 'reading' | 'workspace' | 'wide'> = {
  'admin-custos.tsx': 'wide',
  'admin-integracoes.tsx': 'workspace',
  'admin-usuarios.tsx': 'wide',
  'automacoes.tsx': 'wide',
  'conta.tsx': 'reading',
  'extensao.tsx': 'reading',
  'fila.tsx': 'wide',
  'jobs-detalhe.tsx': 'workspace',
  'notas.tsx': 'workspace',
  'novidades.tsx': 'wide',
  'setup.tsx': 'workspace',
  'transcricoes-detalhe.tsx': 'wide',
  'transcricoes.tsx': 'wide',
};

const CANONICAL_HEADER_PAGES = [
  'admin-custos.tsx',
  'admin-integracoes.tsx',
  'admin-usuarios.tsx',
  'automacoes.tsx',
  'conta.tsx',
  'extensao.tsx',
  'fila.tsx',
  'notas.tsx',
  'novidades.tsx',
  'setup.tsx',
  'transcricoes.tsx',
] as const;

describe('consistência dos shells de página', () => {
  test('todas as páginas de conteúdo adotam largura e gutters canônicos', () => {
    for (const [file, width] of Object.entries(CANONICAL_CONTENT_PAGES)) {
      const source = readFileSync(join(PAGES_ROOT, file), 'utf8');
      expect(source, file).toContain(`<PageShell width="${width}"`);
      const openings = source.match(/<PageShell\b[\s\S]*?>/gu) ?? [];
      expect(openings.length, file).toBeGreaterThan(0);
      for (const opening of openings) {
        expect(opening, file).not.toMatch(/className="[^"]*(?:max-w-|mx-auto|px-|py-)[^"]*"/u);
      }
    }
  });

  test('páginas canônicas não repetem animação de entrada com AnimatedPage', () => {
    for (const file of Object.keys(CANONICAL_CONTENT_PAGES)) {
      const source = readFileSync(join(PAGES_ROOT, file), 'utf8');
      expect(source, file).not.toContain('<AnimatedPage');
      expect(source, file).not.toContain('<StaggerContainer');
      expect(source, file).not.toContain('<StaggerItem');
    }
  });

  test('páginas canônicas deixam a entrada exclusivamente a cargo do PageShell', () => {
    const pagesWithoutLocalEntryMotion = [
      'conta.tsx',
      'setup.tsx',
      'transcricoes-detalhe.tsx',
    ] as const;
    for (const file of pagesWithoutLocalEntryMotion) {
      const source = readFileSync(join(PAGES_ROOT, file), 'utf8');
      expect(source, file).not.toContain("from 'motion/react'");
      expect(source, file).not.toContain('<motion.');
      expect(source, file).not.toContain('<AnimatePresence');
    }
  });

  test('estados de carregamento preservam o mesmo shell e largura da página', () => {
    const detail = readFileSync(join(PAGES_ROOT, 'jobs-detalhe.tsx'), 'utf8');
    expect(detail.match(/<PageShell width="workspace"/gu)).toHaveLength(2);
  });

  test('animações utilitárias respeitam preferência por movimento reduzido', () => {
    const styles = readFileSync(CLIENT_STYLES, 'utf8');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.anim-in\s*\{\s*animation: none !important;/u,
    );
  });

  test('páginas de índice usam o mesmo cabeçalho canônico', () => {
    for (const file of CANONICAL_HEADER_PAGES) {
      const source = readFileSync(join(PAGES_ROOT, file), 'utf8');
      expect(source, file).toContain('<PageHeader');
      expect(source, file).toMatch(
        /import \{[^}]*PageHeader[^}]*\} from '\.\.\/components\/ui\/page-shell'/u,
      );
    }
  });

  test('chat e grafo permanecem full-bleed e sem shell limitado', () => {
    for (const file of ['chat.tsx', 'grafo.tsx']) {
      const source = readFileSync(join(PAGES_ROOT, file), 'utf8');
      expect(source, file).toContain('h-full');
      expect(source, file).not.toContain('<PageShell');
    }
  });
});
