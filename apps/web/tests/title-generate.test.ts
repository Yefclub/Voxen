import { describe, expect, test } from 'bun:test';
import { cleanGeneratedTitle, resolveTitleDecision } from '../src/lib/title-generate';

describe('resolveTitleDecision', () => {
  test('KEEP variants fall back to the candidate title', () => {
    expect(resolveTitleDecision('KEEP', 'Título Bom do Canal')).toBe('Título Bom do Canal');
    expect(resolveTitleDecision('manter', 'Título Bom do Canal')).toBe('Título Bom do Canal');
    expect(resolveTitleDecision('KEEP_TITLE', 'Título Bom do Canal')).toBe('Título Bom do Canal');
  });

  test('title identical to fallback keeps the fallback', () => {
    expect(resolveTitleDecision('Título Bom do Canal', 'Título Bom do Canal')).toBe(
      'Título Bom do Canal',
    );
  });

  test('a real new editorial title is used', () => {
    expect(resolveTitleDecision('Novo título editorial', 'arquivo.mp4')).toBe(
      'Novo título editorial',
    );
  });

  test('model preamble/reasoning never becomes the title (issue #335)', () => {
    expect(
      resolveTitleDecision(
        'The user wants a final title for a knowledge base entry based on the provided content',
        'Post do X',
      ),
    ).toBe('Post do X');
    expect(
      resolveTitleDecision(
        'The candidate title is "GitHub - hyperdxio/hyperdx: fast. An',
        'HyperDX',
      ),
    ).toBe('HyperDX');
  });

  test('empty/garbage output falls back to the candidate', () => {
    expect(resolveTitleDecision('', 'Fallback')).toBe('Fallback');
    expect(resolveTitleDecision('   ', 'Fallback')).toBe('Fallback');
  });
});

describe('cleanGeneratedTitle', () => {
  test('strips quotes, hashes and trailing punctuation', () => {
    expect(cleanGeneratedTitle('"Meu Título"')).toBe('Meu Título');
    expect(cleanGeneratedTitle('# Meu Título.')).toBe('Meu Título');
    expect(cleanGeneratedTitle('  Meu   Título  ')).toBe('Meu Título');
  });

  test('caps very long titles', () => {
    const long = 'palavra '.repeat(30).trim();
    expect(cleanGeneratedTitle(long).length).toBeLessThanOrEqual(90);
  });

  test('collapses newlines into a single line', () => {
    expect(cleanGeneratedTitle('linha um\nlinha dois')).toBe('linha um linha dois');
  });
});
