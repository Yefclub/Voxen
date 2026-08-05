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
    expect(source).toContain('pt-16');
  });

  test('fontes ficam nas ações por hover e abrem um painel que reduz o chat', () => {
    const source = readClientSource('pages/chat.tsx');
    const panel = readClientSource('components/chat/chat-sources-panel.tsx');

    expect(source).toContain('CitationSourcesButton');
    expect(panel).toContain('md:group-hover:opacity-100');
    expect(source).toContain('setSourceCitations(message.citations ?? [])');
    expect(source).toContain("sourceCitations && 'md:pr-[22rem]'");
    expect(panel).toContain('absolute inset-y-0 right-0 hidden w-[22rem]');
  });

  test('markdown converte apenas marcadores internos em citações inline', () => {
    const source = readClientSource('components/ui/markdown.tsx');

    expect(source).toContain('renderInlineCitations');
    expect(source).toContain('citationFromInlineHref');
    expect(source).toContain('TooltipContent');
    expect(source).toContain('disableHoverableContent');
    expect(source).not.toContain('onMouseEnter={() => setOpen(true)}');
  });
});
