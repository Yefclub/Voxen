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
  //
  // Sem asserção sobre `components/ui/icons.ts`: um contrato de apresentação
  // não deve depender do TEXTO de outro arquivo (o catálogo é refatorado à
  // parte). Se `ChevronUp` deixar de existir, o typecheck e o build acusam.
  test('uses the chevron send glyph in the main composer', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).toContain('<ChevronUp className="h-4 w-4" />');
    expect(chat).not.toContain('<Send className="h-4 w-4" />');
    expect(chat).not.toContain('<ArrowUp className="h-4 w-4" />');
  });

  // Spec 126: divergência DELIBERADA entre os dois composers. O dock já usa
  // `ChevronUp` como affordance de expandir/recolher no próprio cabeçalho —
  // reaproveitar o mesmo glifo no botão de enviar colocaria dois desenhos
  // idênticos com significados diferentes lado a lado. O avião de papel fica.
  test('keeps the paper plane in the transcript dock, where the chevron already means expand', () => {
    const dock = source('components/library/transcript-chat-dock.tsx');

    expect(dock).toContain('<Send className="h-4 w-4" />');
    expect(dock).toContain("expanded && 'rotate-180'");
  });

  // Spec 126: o composer cresce com o texto até um teto e só então rola.
  // `rows={1}` + `max-h-*` sozinho nunca cresce — precisa medir o scrollHeight.
  // O teto é relativo à viewport: 200px fixos comem quase toda a área útil de
  // um celular com o teclado aberto (~300px sobrando).
  test('grows the chat composer with the text up to a viewport-aware ceiling', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).toContain('const COMPOSER_MAX_HEIGHT_PX = 200');
    expect(chat).toContain('const COMPOSER_MAX_HEIGHT_VH = 0.3');
    expect(chat).toContain("element.style.height = 'auto'");
    expect(chat).toContain('composerMaxHeight()');
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
