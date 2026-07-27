import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('tom visual do markdown do chat (spec 091)', () => {
  test('código inline e links não usam chips saturados', () => {
    const source = readClientSource('components/ui/markdown.tsx');

    expect(source).not.toContain('text-emerald-300');
    expect(source).not.toContain('text-violet-300');
    expect(source).toContain('text-[var(--color-app-subtle)]');
    expect(source).toContain('font-medium');
  });

  test('chat expõe botão de copiar mensagem', () => {
    const source = readClientSource('pages/chat.tsx');

    expect(source).toContain('MessageCopyButton');
    expect(source).toContain('chat.copyMessage');
    expect(source).toContain('pt-12');
  });
});
