// ============================================================================
// Contratos de i18n das telas de conteúdo e fila (spec 128)
// ============================================================================
// Este arquivo cobre SOMENTE o que é contrato observável e não dá pra afirmar
// de outro jeito barato: as strings que o usuário lê, presentes nos dois
// idiomas.
//
// Uma versão anterior também afirmava classes CSS por busca textual no fonte
// (`toContain('focus:ring-[var(--color-accent-primary-soft)]')`,
// `toContain('className="absolute inset-0 …')`). Foram removidas no review da
// PR #501, por dois motivos concretos:
//
//   1. Quebravam sem mudança de comportamento — e quebraram mesmo, ao
//      acrescentar uma classe `focus:` legítima ao campo de link.
//   2. Davam confiança falsa. `expect(queue).not.toContain('userId')` parece
//      garantia de que o cliente não envia userId, mas é `grep`: passaria
//      igual com a rota aceitando userId do body. A garantia real está no
//      endpoint (`jobs.ts`, `findFirst({ where: { id, userId } })`), e o
//      comportamento de foco/clique/tabulação só se prova em browser.
//
// Comportamento de verdade está em `transcript-render-mode.test.ts` e
// `job-retry-action.test.ts` (lógica pura), e foi verificado em browser real
// durante o review.
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = join(import.meta.dir, '../src/client');

function read(path: string): string {
  return readFileSync(join(CLIENT_ROOT, path), 'utf8');
}

describe('strings visíveis ao usuário (PT e EN)', () => {
  test('placeholder do campo de link é curto e direto nos dois idiomas', () => {
    const i18n = read('lib/i18n.tsx');
    expect(i18n).toContain("'home.urlPlaceholder': 'Cole o link aqui'");
    expect(i18n).toContain("'home.urlPlaceholder': 'Paste the link here'");
    // O placeholder longo de exemplos de URL não deve voltar.
    expect(i18n).not.toContain('https://youtu.be/... ·');
  });

  test('rótulos de reprocessamento existem em PT e EN', () => {
    const i18n = read('lib/i18n.tsx');
    for (const key of [
      'jobs.reprocess',
      'jobs.reprocessing',
      'jobs.reprocessQueued',
      'jobs.reprocessError',
    ]) {
      expect(i18n.match(new RegExp(`'${key}':`, 'gu'))?.length).toBe(2);
    }
  });
});

describe('escolha do modo de renderização da transcrição', () => {
  test('a página delega ao helper testado em vez de listar origens inline', () => {
    // Regressão da spec 128: a condição inline por lista de origens deixava
    // posts do X (maior grupo da Base de conhecimento) caírem no viewer de timestamp.
    const page = read('pages/transcricoes-detalhe.tsx');
    expect(page).toContain('transcriptRenderMode');
    expect(page).not.toContain("t.source === 'WEB' || isVisualTranscript || isDocumentTranscript");
  });
});
