import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clientRoot = join(import.meta.dir, '..');

function source(path: string): string {
  return readFileSync(join(clientRoot, path), 'utf8');
}

describe('page presentation contracts', () => {
  test('keeps the chat history and both composers in the same column', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).not.toContain('max-w-5xl');
    expect(chat.match(/max-w-3xl/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  // Spec 126: o glifo de enviar sai do avião de papel e passa a usar a família
  // de chevrons — a mais empregada no resto da aplicação. O apelido `ArrowUp`
  // continua proibido aqui porque o catálogo animado não tem seta simples: ele
  // cai no `AArrowUpIcon` ("A↑", tamanho de fonte), que é ambíguo.
  test('uses the chevron send glyph shared with the rest of the app', () => {
    const chat = source('pages/chat.tsx');
    const icons = source('components/ui/icons.ts');

    expect(chat).toContain('<ChevronUp className="h-4 w-4" />');
    expect(chat).not.toContain('<Send className="h-4 w-4" />');
    expect(chat).not.toContain('<ArrowUp className="h-4 w-4" />');
    expect(icons).toContain('export const ChevronUp = accessibleIcon(ChevronUpIcon);');
  });

  // Spec 126: o composer cresce com o texto até um teto e só então rola.
  // `rows={1}` + `max-h-*` sozinho nunca cresce — precisa medir o scrollHeight.
  test('grows the chat composer with the text up to a ceiling', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).toContain('const COMPOSER_MAX_HEIGHT_PX = 200');
    expect(chat).toContain("element.style.height = 'auto'");
    expect(chat).toContain(
      'element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`',
    );
    expect(chat).toContain('overflow-y-auto');
  });

  test('does not paint a focus frame around the update scroll region', () => {
    const modal = source('components/update-modal.tsx');
    const scrollRegion = modal.slice(
      modal.indexOf('data-update-scroll-region'),
      modal.indexOf('data-update-scroll-region') + 700,
    );

    expect(scrollRegion).not.toContain('focus-visible:ring');
    expect(scrollRegion).toContain('focus-visible:shadow');
  });

  test('uses the wide operational shell for the extension page', () => {
    expect(source('pages/extensao.tsx')).toContain('<PageShell width="wide"');
  });

  test('page headers own an animated colored eyebrow icon', () => {
    const pageShell = source('components/ui/page-shell.tsx');

    expect(pageShell).toContain('icon: AnimatedIcon');
    expect(pageShell).toContain('isAnimated');
    expect(pageShell).toContain('iconClassName');
  });

  test('does not duplicate the vertical reservation made by the floating topbar', () => {
    const pageShell = source('components/ui/page-shell.tsx');

    expect(pageShell).toContain('pt-0');
    expect(pageShell).not.toContain('sm:py-9');
  });
});
