import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clientRoot = join(import.meta.dir, '../src/client');

describe('contrato global de toast', () => {
  test('somente a fachada e o Toaster acessam o Sonner diretamente', async () => {
    const glob = new Bun.Glob('**/*.{ts,tsx}');
    const directImports: string[] = [];

    for await (const relativePath of glob.scan({ cwd: clientRoot })) {
      const source = readFileSync(join(clientRoot, relativePath), 'utf8');
      if (!source.includes("from 'sonner'")) continue;
      directImports.push(relativePath.replaceAll('\\', '/'));
    }

    expect(directImports.sort()).toEqual(['components/ui/sonner.tsx', 'lib/toast.ts']);
  });

  test('o Toaster expõe uma única região visível com duração canônica', () => {
    const source = readFileSync(join(clientRoot, 'components/ui/sonner.tsx'), 'utf8');

    expect(source).toContain('duration={TOAST_DURATION_MS}');
    expect(source).toContain('visibleToasts={1}');
    expect(source.indexOf('{...props}')).toBeLessThan(
      source.indexOf('duration={TOAST_DURATION_MS}'),
    );
  });
});
